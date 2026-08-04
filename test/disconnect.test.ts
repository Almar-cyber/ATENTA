import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/worker.js';
import { resetDb } from './helpers.js';

// Desconectar conta de rede social (DELETE /api/accounts/:id).
//
// A página /data-deletion promete que remover a conta apaga o token IMEDIATAMENTE, e ela é lida
// pelos revisores das plataformas. Uma promessa dessas sem teste é a que quebra sem ninguém notar.

const ORIGIN = 'https://atenta.omangue.co';

async function call(request: Request): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function register(email: string) {
  await env.DB.prepare(`insert into signup_invites (email) values (?)`).bind(email).run();
  const res = await call(
    new Request(`${ORIGIN}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'senha-de-teste-123', name: email }),
    })
  );
  const body = (await res.json()) as { user: { id: string } };
  return { id: body.user.id, cookie: (res.headers.get('set-cookie') ?? '').split(';')[0] };
}

async function seedAccount(owner: string) {
  await env.DB.prepare(
    `insert into accounts (id, platform, display_name, external_account_id, status, token_ciphertext, token_iv, extra, owner_id)
     values ('acc-1', 'instagram', 'minha conta', 'ext-1', 'active', 'CIFRA', 'IV', '{}', ?)`
  )
    .bind(owner)
    .run();
}

/** Cria um destino no status dado, pra medir o efeito no histórico. */
async function seedTarget(status: string) {
  await env.DB.prepare(
    `insert into scheduled_posts (id, title, body, scheduled_for, owner_id) values ('sp-1', '', 'x', '2026-01-01T12:00:00Z', 'quem-seja')`
  ).run();
  await env.DB.prepare(
    `insert into post_targets (id, scheduled_post_id, account_id, platform, status, options, adapter_state)
     values ('pt-1', 'sp-1', 'acc-1', 'instagram', ?, '{}', '{}')`
  )
    .bind(status)
    .run();
}

describe('desconectar conta', () => {
  let user: Awaited<ReturnType<typeof register>>;

  beforeEach(async () => {
    await resetDb();
    user = await register('dona@exemplo.com');
    await seedAccount(user.id);
  });

  const del = () =>
    call(new Request(`${ORIGIN}/api/accounts/acc-1`, { method: 'DELETE', headers: { Cookie: user.cookie } }));

  it('sem histórico: a linha some inteira', async () => {
    const res = await del();
    expect(res.status).toBe(200);
    const row = await env.DB.prepare(`select id from accounts where id = 'acc-1'`).first();
    expect(row).toBeNull();
  });

  it('com histórico publicado: o TOKEN some, a linha fica', async () => {
    await seedTarget('published');
    const res = await del();
    expect(res.status).toBe(200);
    const row = await env.DB.prepare(
      `select status, token_ciphertext, token_iv from accounts where id = 'acc-1'`
    ).first<{ status: string; token_ciphertext: string | null; token_iv: string | null }>();
    // O que a /data-deletion promete é a remoção da CREDENCIAL — não a do registro do que já saiu.
    expect(row?.token_ciphertext).toBeNull();
    expect(row?.token_iv).toBeNull();
    expect(row?.status).toBe('disabled');
    // E o histórico continua lá.
    const alvo = await env.DB.prepare(`select id from post_targets where id = 'pt-1'`).first();
    expect(alvo).not.toBeNull();
  });

  it('com post a caminho: recusa, e o token continua intacto', async () => {
    await seedTarget('queued');
    const res = await del();
    expect(res.status).toBe(409);
    const row = await env.DB.prepare(`select status, token_ciphertext from accounts where id = 'acc-1'`).first<{
      status: string;
      token_ciphertext: string | null;
    }>();
    expect(row?.status).toBe('active');
    expect(row?.token_ciphertext).toBe('CIFRA');
  });

  it('sem sessão, não desconecta', async () => {
    const res = await call(new Request(`${ORIGIN}/api/accounts/acc-1`, { method: 'DELETE' }));
    expect(res.status).toBe(401);
    const row = await env.DB.prepare(`select id from accounts where id = 'acc-1'`).first();
    expect(row).not.toBeNull();
  });
});
