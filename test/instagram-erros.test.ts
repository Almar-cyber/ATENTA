import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { instagramAdapter } from '../src/adapters/instagram.js';
import type { Account, MediaAsset, PostTarget } from '../src/lib/types.js';
import { resetDb } from './helpers.js';

// COMO UMA RECUSA DA META É CLASSIFICADA.
//
// O adapter jogava `Error` com só um `code` colado, sem o status HTTP. Sem status, todo erro cujo
// `type` não estivesse na tabela caía no 'retryable' padrão: cinco tentativas de 15 em 15 minutos,
// uma hora inteira esperando por uma recusa que nunca ia mudar de resposta — proporção fora da
// faixa, conta sem o recurso, parâmetro errado. Agora eles são `ApiError` e levam o status.
//
// O que estes testes prendem são os DOIS lados, porque só o primeiro seria uma troca ruim:
//   4xx comum  → permanent (para de tentar)
//   5xx        → retryable (continua tentando; o problema é da Meta, não do post)
//   limite de requisição → NÃO vira permanent, apesar do 4xx: a Meta manda esses como
//                          OAuthException, e a tabela vem antes da regra por status.

const conta: Account = {
  id: 'acc-ig',
  platform: 'instagram',
  display_name: 'conta.teste',
  external_account_id: 'ig-user-1',
  status: 'active',
  token_ciphertext: null,
  token_iv: null,
  access_token_expires_at: null,
  refresh_token_expires_at: null,
  scope: null,
  extra: {},
};

const video: MediaAsset = {
  id: 'md-video',
  storage_key: 'k-video',
  public_url: 'https://scheduler-media.omangue.co/k-video',
  mime_type: 'video/mp4',
  size_bytes: 1000,
  duration_seconds: 12,
  width: 1080,
  height: 1920,
};

const destino: PostTarget = {
  id: 't1',
  scheduled_post_id: 'p1',
  account_id: conta.id,
  platform: 'instagram',
  status: 'publishing',
  caption_override: 'legenda',
  title: null,
  options: { format: 'reel' },
  adapter_state: {},
  external_post_id: null,
  external_url: null,
  attempt_count: 0,
  last_error: null,
  published_at: null,
  updated_at: new Date().toISOString(),
};

/** Tenta publicar contra uma Meta que responde o que o caso pedir, e devolve a classe do erro. */
async function classeDoErro(status: number, corpo: unknown): Promise<string> {
  await resetDb();
  await env.DB.prepare(
    `insert into accounts (id, platform, display_name, external_account_id, status, extra)
     values (?, 'instagram', 'conta.teste', ?, 'active', '{}')`
  )
    .bind(conta.id, conta.external_account_id)
    .run();
  const { encryptJSON } = await import('../src/lib/crypto.js');
  const { ciphertext, iv } = await encryptJSON({ access_token: 'tok' }, env.TOKEN_ENCRYPTION_KEY);
  await env.DB.prepare(`update accounts set token_ciphertext = ?, token_iv = ? where id = ?`)
    .bind(ciphertext, iv, conta.id)
    .run();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
  try {
    await instagramAdapter.publish(destino, [video], conta, env as never);
  } catch (err) {
    return instagramAdapter.classifyError(err);
  } finally {
    globalThis.fetch = originalFetch;
  }
  throw new Error('esperava que a publicação falhasse');
}

describe('recusa da Meta no container do Instagram', () => {
  it('4xx de conteúdo falha de primeira, sem gastar cinco tentativas', async () => {
    // A cara de uma recusa por elegibilidade ou por parâmetro: 400, e não muda tentando de novo.
    const classe = await classeDoErro(400, {
      error: { message: 'Instagram account not eligible', type: 'IGApiException', code: 100 },
    });
    expect(classe).toBe('permanent');
  });

  it('5xx continua retryable — aí o problema é da Meta, não do post', async () => {
    const classe = await classeDoErro(500, { error: { message: 'oops', type: 'IGApiException' } });
    expect(classe).toBe('retryable');
  });

  it('limite de requisição NÃO vira permanent, apesar de vir como 4xx', async () => {
    // O caso que essa mudança podia estragar. A Meta manda throttling (4, 17, 32, 613) como
    // OAuthException, e a tabela é consultada ANTES da regra por status — então nada muda pra ele.
    const classe = await classeDoErro(400, {
      error: { message: 'Application request limit reached', type: 'OAuthException', code: 4 },
    });
    expect(classe).not.toBe('permanent');
    expect(classe).toBe('auth');
  });

  it('token revogado continua caindo em auth, que é o que marca a conta pra reconectar', async () => {
    const classe = await classeDoErro(401, {
      error: { message: 'Invalid OAuth access token', type: 'OAuthException', code: 190 },
    });
    expect(classe).toBe('auth');
  });

  it('a mensagem gravada leva o status e o corpo da Meta, pra falha dizer o motivo', async () => {
    await resetDb();
    await env.DB.prepare(
      `insert into accounts (id, platform, display_name, external_account_id, status, extra)
       values (?, 'instagram', 'conta.teste', ?, 'active', '{}')`
    )
      .bind(conta.id, conta.external_account_id)
      .run();
    const { encryptJSON } = await import('../src/lib/crypto.js');
    const { ciphertext, iv } = await encryptJSON({ access_token: 'tok' }, env.TOKEN_ENCRYPTION_KEY);
    await env.DB.prepare(`update accounts set token_ciphertext = ?, token_iv = ? where id = ?`)
      .bind(ciphertext, iv, conta.id)
      .run();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: 'aspect ratio', type: 'IGApiException' } }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch;
    try {
      await instagramAdapter.publish(destino, [video], conta, env as never);
      throw new Error('esperava que a publicação falhasse');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).toContain('container create failed');
      expect(msg).toContain('400');
      expect(msg).toContain('aspect ratio');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
