import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/worker.js';
import { MAX_PERGUNTA, TETO_ATENDENTE } from '../src/lib/atendente.js';
import { consumirCota } from '../src/lib/legenda.js';
import { resetDb } from './helpers.js';

// ATENDENTE DA LANDING (`/api/atendente`).
//
// É o ÚNICO endpoint de IA sem sessão, ou seja, o único que qualquer um na internet alcança. O que
// se testa aqui não é a qualidade da resposta (depende do modelo e de rede) — é o que impede o
// endpoint de virar um problema: entrada recusada, teto do dia e recusa que ainda oferece saída.

const ORIGIN = 'https://atenta.omangue.co';

async function perguntar(pergunta: unknown): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request(`${ORIGIN}/api/atendente`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pergunta }),
    }),
    env,
    ctx
  );
  await waitOnExecutionContext(ctx);
  return res;
}

describe('atendente da landing', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('recusa pergunta vazia', async () => {
    expect((await perguntar('  ')).status).toBe(400);
  });

  // Sem isto, o endpoint vira tradutor/resumidor de graça: cola-se um texto inteiro e o custo é
  // nosso. O teto de entrada é o que torna o gasto por chamada previsível.
  it('recusa pergunta longa demais', async () => {
    const res = await perguntar('a'.repeat(MAX_PERGUNTA + 1));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    // A recusa oferece a saída humana; um "erro 400" seco faria a pessoa ir embora.
    expect(body.error).toContain('contato@omangue.co');
  });

  // Sem sessão não existe dono, então o teto é da CONTA: é ele que impede uma enxurrada na landing
  // de queimar a cota e derrubar a sugestão de legenda de quem paga.
  it('para de responder ao esgotar o teto do dia, mas ainda oferece o e-mail', async () => {
    for (let i = 0; i < TETO_ATENDENTE; i++) {
      await consumirCota(env, 'atendente-landing', new Date(), TETO_ATENDENTE);
    }
    const res = await perguntar('quanto custa?');
    // 200, não erro: a pessoa recebe uma resposta útil em vez de um código de falha.
    expect(res.status).toBe(200);
    const body = (await res.json()) as { resposta: string };
    expect(body.resposta).toContain('contato@omangue.co');
  });

  // O teto do atendente e o da legenda dividem a mesma tabela, com donos diferentes. Se um
  // esvaziasse o outro, uma landing movimentada zeraria a IA de quem está pagando.
  it('o teto da landing não gasta a cota de quem está logado', async () => {
    for (let i = 0; i < TETO_ATENDENTE; i++) {
      await consumirCota(env, 'atendente-landing', new Date(), TETO_ATENDENTE);
    }
    expect(await consumirCota(env, 'alice')).not.toBeNull();
  });
});
