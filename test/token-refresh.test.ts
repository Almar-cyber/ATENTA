import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/worker.js';
import { getAccountStatus, insertAccount, resetDb } from './helpers.js';

// QUANDO UMA CONTA PODE SER DESCONECTADA — e, principalmente, quando NÃO pode.
//
// O sintoma relatado foi "YouTube e TikTok ficam desconectando". A causa era o `catch` único da
// varredura de saúde de token: QUALQUER falha da renovação virava `needs_reauth`. Como o cron roda
// de minuto em minuto e a janela de renovação dura minutos (YouTube) ou horas (TikTok), bastava um
// tropeço — um 500 do Google, um 429 da TikTok, uma conexão caída — pra derrubar uma conta cujo
// refresh_token estava vivo. E são exatamente essas duas as redes com renovação automática de
// verdade: Instagram e Facebook nem entram nesta varredura (needsRefresh() é false).
//
// A régua agora é a classe do erro. Estes testes prendem os dois lados: o passageiro NÃO
// desconecta, e a recusa de verdade continua desconectando.

/** Roda o mesmo caminho que o Cron Trigger roda. */
async function runPoller(): Promise<void> {
  const ctx = createExecutionContext();
  await worker.scheduled({} as ScheduledEvent, env, ctx);
  await waitOnExecutionContext(ctx);
}

/** Uma conta com token guardado e prestes a vencer — o que faz needsRefresh() disparar. */
async function contaQuaseVencendo(platform: 'youtube' | 'tiktok'): Promise<string> {
  const id = await insertAccount({ platform, display_name: `conta-${platform}` });
  const { encryptJSON } = await import('../src/lib/crypto.js');
  const { ciphertext, iv } = await encryptJSON(
    { access_token: 'velho', refresh_token: 'refresh-vivo' },
    env.TOKEN_ENCRYPTION_KEY
  );
  await env.DB.prepare(
    `update accounts set token_ciphertext = ?, token_iv = ?, access_token_expires_at = ? where id = ?`
  )
    .bind(ciphertext, iv, new Date(Date.now() + 60_000).toISOString(), id)
    .run();
  return id;
}

/** Responde a renovação com o que o caso pedir e roda a varredura. */
async function renovarRespondendo(status: number, corpo: unknown): Promise<void> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(typeof corpo === 'string' ? corpo : JSON.stringify(corpo), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch;
  try {
    await runPoller();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

describe('varredura de saúde de token', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('YouTube: plataforma fora do ar (500) NÃO desconecta — foi isso que derrubava a conta', async () => {
    const id = await contaQuaseVencendo('youtube');
    await renovarRespondendo(500, { error: 'internal' });
    expect(await getAccountStatus(id)).toBe('active');
    // Timeout maior que o padrão: o fetchWithRetry ainda tenta 5xx três vezes, com espera
    // exponencial (0,5s + 1s + 2s) antes de desistir. É o único caso da suíte que paga isso.
  }, 20_000);

  it('TikTok: limite de requisição (429) NÃO desconecta', async () => {
    const id = await contaQuaseVencendo('tiktok');
    await renovarRespondendo(429, { error: 'rate_limit' });
    expect(await getAccountStatus(id)).toBe('active');
  });

  it('YouTube: refresh_token recusado (400 invalid_grant) DESCONECTA — aí é de verdade', async () => {
    const id = await contaQuaseVencendo('youtube');
    await renovarRespondendo(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
    expect(await getAccountStatus(id)).toBe('needs_reauth');
  });

  it('TikTok: 400 do endpoint de token também desconecta', async () => {
    const id = await contaQuaseVencendo('tiktok');
    await renovarRespondendo(400, { error: 'invalid_grant', message: 'refresh token invalid' });
    expect(await getAccountStatus(id)).toBe('needs_reauth');
  });

  it('renovação bem-sucedida mantém a conta ativa e empurra o vencimento', async () => {
    const id = await contaQuaseVencendo('youtube');
    await renovarRespondendo(200, { access_token: 'novo', expires_in: 3600 });

    expect(await getAccountStatus(id)).toBe('active');
    const row = await env.DB.prepare(`select access_token_expires_at from accounts where id = ?`)
      .bind(id)
      .first<{ access_token_expires_at: string }>();
    expect(new Date(row!.access_token_expires_at).getTime()).toBeGreaterThan(Date.now() + 30 * 60_000);
  });

  it('resposta 200 SEM access_token não desconecta E não apaga o refresh_token guardado', async () => {
    // O pior caso silencioso: setAccountTokens grava o payload inteiro, então escrever uma resposta
    // vazia mataria a conta de vez, sem erro nenhum.
    const id = await contaQuaseVencendo('tiktok');
    const antes = await env.DB.prepare(`select token_ciphertext from accounts where id = ?`)
      .bind(id)
      .first<{ token_ciphertext: string }>();

    await renovarRespondendo(200, { error: { code: 'invalid_grant' } });

    expect(await getAccountStatus(id)).toBe('active');
    const depois = await env.DB.prepare(`select token_ciphertext from accounts where id = ?`)
      .bind(id)
      .first<{ token_ciphertext: string }>();
    expect(depois!.token_ciphertext).toBe(antes!.token_ciphertext);
  });

  it('LinkedIn continua desconectando perto do vencimento — lá não HÁ renovação', async () => {
    // A rede não tem refresh nessa camada: o adapter lança com `no_refresh_mechanism`, e é esse
    // código que mantém o comportamento de sempre agora que o padrão deixou de ser desconectar.
    const id = await insertAccount({ platform: 'linkedin', display_name: 'conta-li' });
    await env.DB.prepare(`update accounts set access_token_expires_at = ? where id = ?`)
      .bind(new Date(Date.now() + 3_600_000).toISOString(), id)
      .run();

    await runPoller();
    expect(await getAccountStatus(id)).toBe('needs_reauth');
  });

  it('conta longe do vencimento não é tocada', async () => {
    const id = await insertAccount({ platform: 'youtube', display_name: 'conta-yt' });
    await env.DB.prepare(`update accounts set access_token_expires_at = ? where id = ?`)
      .bind(new Date(Date.now() + 6 * 3_600_000).toISOString(), id)
      .run();

    // Sem stub de fetch: se a varredura tentasse renovar, a chamada real falharia e o teste veria.
    await runPoller();
    expect(await getAccountStatus(id)).toBe('active');
  });
});
