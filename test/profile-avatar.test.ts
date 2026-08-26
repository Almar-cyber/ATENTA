import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/worker.js';
import { resetDb } from './helpers.js';
import { validarAvatar } from '../src/lib/avatar.js';

// Avatar do usuário (PUT/DELETE /api/profile/avatar).
//
// O que importa provar: só variante conhecida entra (o campo volta pro navegador dentro de um
// `<svg>`, então string arbitrária aqui não pode existir), cada dono escreve só no próprio, e
// remover não deixa ninguém sem rosto — nulo é "usa o padrão derivado do id", não "sem avatar".

const ORIGIN = 'https://atenta.omangue.co';

/** Um avatar válido, pra servir de base nos testes que mexem num campo só. */
const VALIDO = {
  head: 'afro',
  expression: 'smile',
  facialHair: null,
  accessories: null,
  skin: '#edb98a',
  clothing: '#FCEC0E',
  hair: '#2c1b18',
};

async function call(request: Request): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function register(email: string): Promise<{ id: string; cookie: string }> {
  await env.DB.prepare(`insert into signup_invites (email) values (?)`).bind(email.toLowerCase()).run();
  const res = await call(
    new Request(`${ORIGIN}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'senha-de-teste-123', name: email }),
    })
  );
  if (!res.ok) throw new Error(`sign-up falhou (${res.status}): ${await res.text()}`);
  const body = (await res.json()) as { user: { id: string } };
  const cookie = res.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('sign-up não devolveu cookie de sessão');
  return { id: body.user.id, cookie };
}

async function salvar(user: { cookie: string }, avatar: unknown): Promise<Response> {
  return call(
    new Request(`${ORIGIN}/api/profile/avatar`, {
      method: 'PUT',
      headers: { Cookie: user.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(avatar),
    })
  );
}

async function avatarNoBanco(userId: string): Promise<string | null> {
  const row = await env.DB.prepare(`select avatar from user where id = ?`).bind(userId).first<{ avatar: string | null }>();
  return row?.avatar ?? null;
}

describe('avatar do usuário', () => {
  let alice: Awaited<ReturnType<typeof register>>;

  beforeEach(async () => {
    await resetDb();
    alice = await register('alice@exemplo.com');
  });

  it('exige sessão', async () => {
    const res = await call(
      new Request(`${ORIGIN}/api/profile/avatar`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(VALIDO),
      })
    );
    expect(res.ok).toBe(false);
  });

  it('grava as escolhas e devolve o que gravou', async () => {
    const res = await salvar(alice, VALIDO);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ avatar: VALIDO });
    expect(JSON.parse((await avatarNoBanco(alice.id))!)).toEqual(VALIDO);
  });

  it('nasce nulo — o padrão é derivado do id, não gravado', async () => {
    expect(await avatarNoBanco(alice.id)).toBeNull();
  });

  // A allowlist é o ponto do endpoint: o valor volta pro navegador dentro de um <svg>.
  it.each([
    ['cabeça inexistente', { ...VALIDO, head: 'moicano-brasileiro' }],
    ['expressão inexistente', { ...VALIDO, expression: 'feliz' }],
    ['barba inexistente', { ...VALIDO, facialHair: 'cavanhaque' }],
    ['acessório inexistente', { ...VALIDO, accessories: 'monoculo' }],
    ['cor de pele fora da paleta', { ...VALIDO, skin: '#123456' }],
    ['tentativa de injeção', { ...VALIDO, head: '"><script>alert(1)</script>' }],
    ['campo faltando', { head: 'afro' }],
    ['não é objeto', 'afro'],
  ])('recusa %s, sem tocar no banco', async (_nome, ruim) => {
    const res = await salvar(alice, ruim);
    expect(res.status).toBe(400);
    expect(await avatarNoBanco(alice.id)).toBeNull();
  });

  it('aceita barba e acessório quando são variantes de verdade', async () => {
    const res = await salvar(alice, { ...VALIDO, facialHair: 'chin', accessories: 'glasses' });
    expect(res.status).toBe(200);
  });

  it('remover volta pra nulo (e a pessoa cai no padrão, não em nada)', async () => {
    await salvar(alice, VALIDO);
    const res = await call(
      new Request(`${ORIGIN}/api/profile/avatar`, { method: 'DELETE', headers: { Cookie: alice.cookie } })
    );
    expect(res.status).toBe(200);
    expect(await avatarNoBanco(alice.id)).toBeNull();
  });

  it('um dono não escreve no avatar do outro', async () => {
    const bob = await register('bob@exemplo.com');
    await salvar(alice, VALIDO);
    await salvar(bob, { ...VALIDO, head: 'turban' });

    expect(JSON.parse((await avatarNoBanco(alice.id))!).head).toBe('afro');
    expect(JSON.parse((await avatarNoBanco(bob.id))!).head).toBe('turban');
  });

  it('a sessão devolve o avatar junto do usuário (é o que o cabeçalho lê)', async () => {
    await salvar(alice, VALIDO);
    const res = await call(new Request(`${ORIGIN}/api/auth/get-session`, { headers: { Cookie: alice.cookie } }));
    const body = (await res.json()) as { user: { avatar: string | null } };
    expect(JSON.parse(body.user.avatar!)).toEqual(VALIDO);
  });
});

describe('validarAvatar', () => {
  it('trata ausente e null como a mesma coisa nos opcionais', () => {
    const semBarba = validarAvatar({ ...VALIDO, facialHair: undefined, accessories: undefined });
    expect(semBarba).toEqual(VALIDO);
  });

  it('não deixa passar chave extra pro que é gravado', () => {
    const limpo = validarAvatar({ ...VALIDO, malicioso: '<script>' });
    expect(limpo).toEqual(VALIDO);
    expect(limpo).not.toHaveProperty('malicioso');
  });
});
