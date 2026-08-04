import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/worker.js';
import { resetDb } from './helpers.js';

// As IDEIAS (`/api/grid-previews`): um post que ainda não tem data.
//
// A migração 0013 tornou a imagem opcional e acrescentou a nota — é o que separa "imagem solta pra
// ver a capa" de "anotei o que quero postar". Os testes cobrem justamente a fronteira nova: a ideia
// só de texto tem que EXISTIR e VOLTAR na listagem (um `join` em vez de `left join` a faria sumir
// sem erro nenhum), e a ideia sem texto e sem imagem tem que ser recusada.

const ORIGIN = 'https://atenta.omangue.co';

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

interface Ideia {
  id: string;
  note: string | null;
  media_asset_id: string | null;
  public_url: string | null;
  sort_at: string;
}

function comoUsuario(user: { cookie: string }, path: string, init: RequestInit = {}): Request {
  return new Request(`${ORIGIN}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), Cookie: user.cookie, 'Content-Type': 'application/json' },
  });
}

async function criar(user: { cookie: string }, body: Record<string, unknown>): Promise<Response> {
  return call(comoUsuario(user, '/api/grid-previews', { method: 'POST', body: JSON.stringify(body) }));
}

async function listar(user: { cookie: string }): Promise<Ideia[]> {
  const res = await call(comoUsuario(user, '/api/grid-previews?platform=instagram'));
  expect(res.status).toBe(200);
  return ((await res.json()) as { previews: Ideia[] }).previews;
}

describe('ideias (/api/grid-previews)', () => {
  let alice: Awaited<ReturnType<typeof register>>;

  beforeEach(async () => {
    await resetDb();
    await env.DB.prepare(
      `insert into media_assets (id, storage_key, public_url, mime_type, size_bytes)
       values ('md-1', 'k-1', 'https://cdn.exemplo/1.jpg', 'image/jpeg', 10)`
    ).run();
    alice = await register('alice@exemplo.com');
  });

  it('aceita ideia só com texto, e ela volta na listagem', async () => {
    const res = await criar(alice, { platform: 'instagram', note: 'carrossel da colheita', sort_at: '2026-09-01T10:00:00Z' });
    expect(res.status).toBe(201);

    // A parte que importa: com `join` em vez de `left join`, ela seria criada e sumiria aqui — sem
    // erro nenhum, que é o pior jeito de perder dado.
    const ideias = await listar(alice);
    expect(ideias).toHaveLength(1);
    expect(ideias[0].note).toBe('carrossel da colheita');
    expect(ideias[0].media_asset_id).toBeNull();
    expect(ideias[0].public_url).toBeNull();
  });

  it('aceita ideia só com imagem (o caso antigo, que não pode ter quebrado)', async () => {
    const res = await criar(alice, { platform: 'instagram', media_asset_id: 'md-1', sort_at: '2026-09-01T10:00:00Z' });
    expect(res.status).toBe(201);

    const ideias = await listar(alice);
    expect(ideias).toHaveLength(1);
    expect(ideias[0].note).toBeNull();
    expect(ideias[0].public_url).toBe('https://cdn.exemplo/1.jpg');
  });

  it('recusa ideia sem texto e sem imagem', async () => {
    const res = await criar(alice, { platform: 'instagram', sort_at: '2026-09-01T10:00:00Z' });
    expect(res.status).toBe(400);
    expect(await listar(alice)).toHaveLength(0);
  });

  it('texto só de espaços conta como vazio', async () => {
    const res = await criar(alice, { platform: 'instagram', note: '   ', sort_at: '2026-09-01T10:00:00Z' });
    expect(res.status).toBe(400);
  });

  it('anexar arte depois preenche a capa', async () => {
    const criada = await criar(alice, { platform: 'instagram', note: 'ganha arte depois', sort_at: '2026-09-01T10:00:00Z' });
    const { id } = (await criada.json()) as Ideia;

    const res = await call(
      comoUsuario(alice, `/api/grid-previews/${id}`, { method: 'PATCH', body: JSON.stringify({ media_asset_id: 'md-1' }) })
    );
    expect(res.status).toBe(200);

    const ideias = await listar(alice);
    expect(ideias[0].public_url).toBe('https://cdn.exemplo/1.jpg');
    // A nota sobrevive: mandar só a mídia não pode apagar o texto.
    expect(ideias[0].note).toBe('ganha arte depois');
  });

  it('editar não pode deixar a ideia sem texto E sem imagem', async () => {
    const criada = await criar(alice, { platform: 'instagram', note: 'só isto', sort_at: '2026-09-01T10:00:00Z' });
    const { id } = (await criada.json()) as Ideia;

    const res = await call(
      comoUsuario(alice, `/api/grid-previews/${id}`, { method: 'PATCH', body: JSON.stringify({ note: '' }) })
    );
    expect(res.status).toBe(400);
    expect((await listar(alice))[0].note).toBe('só isto');
  });

  it('reordenar continua mexendo só na posição', async () => {
    const criada = await criar(alice, { platform: 'instagram', note: 'mover', sort_at: '2026-09-01T10:00:00Z' });
    const { id } = (await criada.json()) as Ideia;

    const res = await call(
      comoUsuario(alice, `/api/grid-previews/${id}`, { method: 'PATCH', body: JSON.stringify({ sort_at: '2026-09-05T10:00:00Z' }) })
    );
    expect(res.status).toBe(200);

    const ideias = await listar(alice);
    expect(ideias[0].sort_at).toBe('2026-09-05T10:00:00Z');
    expect(ideias[0].note).toBe('mover');
  });

  it('a ideia de um dono não aparece nem se edita pelo outro', async () => {
    const criada = await criar(alice, { platform: 'instagram', note: 'segredo da alice', sort_at: '2026-09-01T10:00:00Z' });
    const { id } = (await criada.json()) as Ideia;

    const bob = await register('bob@exemplo.com');
    expect(await listar(bob)).toHaveLength(0);

    const res = await call(
      comoUsuario(bob, `/api/grid-previews/${id}`, { method: 'PATCH', body: JSON.stringify({ note: 'roubada' }) })
    );
    expect(res.status).toBe(404);
    expect((await listar(alice))[0].note).toBe('segredo da alice');
  });
});
