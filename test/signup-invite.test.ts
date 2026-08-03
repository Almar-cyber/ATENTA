import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/worker.js';
import { resetDb } from './helpers.js';

// Portão de convite do cadastro (migrations/0010, src/lib/auth-server.ts).
//
// Enquanto o App Review da Meta não sai, o app fica no ar com a landing convidando a "Comece
// grátis" — quem clicar e não estiver convidado precisa ser barrado. Se este portão falhar aberto,
// o cadastro vira público sem ninguém perceber: a tela funciona igual, e a descoberta só viria por
// contas estranhas aparecendo no banco.

const ORIGIN = 'https://atenta.omangue.co';

async function signUp(email: string): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request(`${ORIGIN}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'senha-de-teste-123', name: 'Fulano' }),
    }),
    env,
    ctx
  );
  await waitOnExecutionContext(ctx);
  return res;
}

async function countUsers(): Promise<number> {
  const row = await env.DB.prepare(`select count(*) as n from "user"`).first<{ n: number }>();
  return row?.n ?? 0;
}

describe('portão de convite do cadastro', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('e-mail convidado cria conta', async () => {
    await env.DB.prepare(`insert into signup_invites (email) values ('convidada@exemplo.com')`).run();
    const res = await signUp('convidada@exemplo.com');
    expect(res.status).toBe(200);
    expect(await countUsers()).toBe(1);
  });

  it('e-mail NÃO convidado é recusado e nenhuma conta é criada', async () => {
    const res = await signUp('estranho@exemplo.com');
    expect(res.status).toBe(403);
    // A asserção que importa: recusar com 403 mas gravar a linha seria pior que não recusar.
    expect(await countUsers()).toBe(0);
  });

  it('o convite não depende de maiúsculas no e-mail', async () => {
    await env.DB.prepare(`insert into signup_invites (email) values ('pessoa@exemplo.com')`).run();
    const res = await signUp('Pessoa@Exemplo.com');
    expect(res.status).toBe(200);
  });

  it('o convite é marcado como usado, e só depois da conta existir', async () => {
    await env.DB.prepare(`insert into signup_invites (email) values ('usada@exemplo.com')`).run();

    const antes = await env.DB.prepare(`select used_at from signup_invites where email = 'usada@exemplo.com'`).first<{
      used_at: string | null;
    }>();
    expect(antes?.used_at).toBeNull();

    await signUp('usada@exemplo.com');

    const depois = await env.DB.prepare(`select used_at from signup_invites where email = 'usada@exemplo.com'`).first<{
      used_at: string | null;
    }>();
    expect(depois?.used_at).not.toBeNull();
  });

  it('convite recusado NÃO é marcado como usado', async () => {
    await signUp('estranho@exemplo.com');
    const row = await env.DB.prepare(`select count(*) as n from signup_invites where used_at is not null`).first<{ n: number }>();
    expect(row?.n).toBe(0);
  });
});
