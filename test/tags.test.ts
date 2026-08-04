import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/worker.js';
import { resetDb } from './helpers.js';

// PILARES DE CONTEÚDO (`/api/tags`).
//
// A razão de existirem como tabela, e não como texto num campo, é o Insights: ele agrupa desempenho
// por assunto, e agrupar por texto digitado quebra "Viagem"/"viagem" em dois pilares com metade da
// amostra cada. Os testes abaixo protegem exatamente isso — a normalização do nome — e a ponte que
// dá sentido a tudo: o pilar SOBREVIVE quando a ideia vira post. Uma marcação que se perde no
// caminho não vira estatística nenhuma.

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

interface Tag {
  id: string;
  name: string;
  color: string;
  uso?: number;
}

function como(user: { cookie: string }, path: string, init: RequestInit = {}): Request {
  return new Request(`${ORIGIN}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), Cookie: user.cookie, 'Content-Type': 'application/json' },
  });
}

async function criarTag(user: { cookie: string }, name: string, color?: string): Promise<Response> {
  return call(como(user, '/api/tags', { method: 'POST', body: JSON.stringify({ name, color }) }));
}

async function listarTags(user: { cookie: string }): Promise<Tag[]> {
  const res = await call(como(user, '/api/tags'));
  expect(res.status).toBe(200);
  return ((await res.json()) as { tags: Tag[] }).tags;
}

describe('pilares de conteúdo (/api/tags)', () => {
  let alice: Awaited<ReturnType<typeof register>>;

  beforeEach(async () => {
    await resetDb();
    alice = await register('alice@exemplo.com');
  });

  it('cria e lista', async () => {
    const res = await criarTag(alice, 'Bastidores', 'verde');
    expect(res.status).toBe(201);
    const tags = await listarTags(alice);
    expect(tags).toHaveLength(1);
    expect(tags[0]).toMatchObject({ name: 'Bastidores', color: 'verde', uso: 0 });
  });

  describe('o nome é normalizado — é o que faz o agrupamento do Insights funcionar', () => {
    it('mesmo nome com outra caixa e espaços devolve o pilar existente, não um segundo', async () => {
      const primeira = (await (await criarTag(alice, 'Viagem')).json()) as Tag;

      const res = await criarTag(alice, '  viagem  ');
      // 200, não 201: nada foi criado. E devolve o MESMO id, pra a tela selecionar o pilar certo em
      // vez de mostrar um erro pra quem só digitou o nome de novo.
      expect(res.status).toBe(200);
      expect(((await res.json()) as Tag).id).toBe(primeira.id);

      // A asserção que importa: continua UM pilar. Dois aqui significaria a amostra partida ao meio
      // no Insights, sem erro nenhum aparecendo.
      expect(await listarTags(alice)).toHaveLength(1);
    });

    it('o mesmo nome em donos diferentes são pilares diferentes', async () => {
      await criarTag(alice, 'Viagem');
      const bob = await register('bob@exemplo.com');
      const res = await criarTag(bob, 'Viagem');
      expect(res.status).toBe(201);
      expect(await listarTags(bob)).toHaveLength(1);
    });

    it('recusa nome vazio ou só de espaços', async () => {
      expect((await criarTag(alice, '')).status).toBe(400);
      expect((await criarTag(alice, '   ')).status).toBe(400);
    });

    it('cor desconhecida cai na primeira da paleta em vez de gravar lixo', async () => {
      const t = (await (await criarTag(alice, 'X', 'arco-íris')).json()) as Tag;
      expect(t.color).toBe('roxo');
    });
  });

  describe('a ponte até o Insights', () => {
    it('o pilar da ideia sobrevive quando ela vira post', async () => {
      const tag = (await (await criarTag(alice, 'Bastidores')).json()) as Tag;

      // A ideia nasce marcada…
      const ideia = await call(
        como(alice, '/api/grid-previews', {
          method: 'POST',
          body: JSON.stringify({ platform: 'instagram', note: 'making of', tag_id: tag.id, sort_at: '2026-09-01T10:00:00Z' }),
        })
      );
      expect(ideia.status).toBe(201);
      expect(((await ideia.json()) as { tag_id: string }).tag_id).toBe(tag.id);

      // …e o post criado a partir dela também. Sem isto, marcar pilar seria trabalho jogado fora:
      // o Insights só enxerga posts publicados.
      await env.DB.prepare(
        `insert into accounts (id, platform, display_name, external_account_id, status, extra, owner_id)
         values ('acc-1', 'instagram', 'perfil', 'ext-1', 'active', '{}', ?)`
      )
        .bind(alice.id)
        .run();
      const post = await call(
        como(alice, '/api/posts', {
          method: 'POST',
          body: JSON.stringify({
            body: 'making of',
            scheduled_for: '2026-09-02T10:00:00Z',
            target_account_ids: ['acc-1'],
            save_as: 'draft',
            tag_id: tag.id,
          }),
        })
      );
      expect(post.status).toBe(201);

      const lista = await call(como(alice, '/api/posts'));
      const { posts } = (await lista.json()) as { posts: Array<{ tag: { id: string; name: string } | null }> };
      expect(posts[0].tag).toMatchObject({ id: tag.id, name: 'Bastidores' });
    });

    it('o `uso` conta ideias e posts, pra a tela poder avisar antes de apagar', async () => {
      const tag = (await (await criarTag(alice, 'Produto')).json()) as Tag;
      await call(
        como(alice, '/api/grid-previews', {
          method: 'POST',
          body: JSON.stringify({ platform: 'instagram', note: 'a', tag_id: tag.id, sort_at: '2026-09-01T10:00:00Z' }),
        })
      );
      expect((await listarTags(alice))[0].uso).toBe(1);
    });
  });

  describe('isolação e integridade', () => {
    it('o pilar de um dono não aparece nem se edita pelo outro', async () => {
      const tag = (await (await criarTag(alice, 'Só da Alice')).json()) as Tag;
      const bob = await register('bob@exemplo.com');

      expect(await listarTags(bob)).toHaveLength(0);
      const patch = await call(como(bob, `/api/tags/${tag.id}`, { method: 'PATCH', body: JSON.stringify({ name: 'roubado' }) }));
      expect(patch.status).toBe(404);
      const del = await call(como(bob, `/api/tags/${tag.id}`, { method: 'DELETE' }));
      expect(del.status).toBe(404);
      expect((await listarTags(alice))[0].name).toBe('Só da Alice');
    });

    it('marcar uma ideia com o pilar de OUTRO dono não grava a referência', async () => {
      const bob = await register('bob@exemplo.com');
      const doBob = (await (await criarTag(bob, 'Do Bob')).json()) as Tag;

      const res = await call(
        como(alice, '/api/grid-previews', {
          method: 'POST',
          body: JSON.stringify({ platform: 'instagram', note: 'minha', tag_id: doBob.id, sort_at: '2026-09-01T10:00:00Z' }),
        })
      );
      // Cria normalmente, mas SEM pilar. Gravar a referência não vazaria o nome, mas agruparia a
      // peça sob um pilar que a Alice não criou nem consegue ver — um fantasma no próprio Insights.
      expect(res.status).toBe(201);
      expect(((await res.json()) as { tag_id: string | null }).tag_id).toBeNull();
    });

    it('apagar o pilar NÃO apaga as peças dele', async () => {
      const tag = (await (await criarTag(alice, 'Temporário')).json()) as Tag;
      const ideia = (await (
        await call(
          como(alice, '/api/grid-previews', {
            method: 'POST',
            body: JSON.stringify({ platform: 'instagram', note: 'sobrevive', tag_id: tag.id, sort_at: '2026-09-01T10:00:00Z' }),
          })
        )
      ).json()) as { id: string };

      expect((await call(como(alice, `/api/tags/${tag.id}`, { method: 'DELETE' }))).status).toBe(200);

      const res = await call(como(alice, '/api/grid-previews?platform=instagram'));
      const { previews } = (await res.json()) as { previews: Array<{ id: string; note: string; tag_id: string | null }> };
      expect(previews).toHaveLength(1);
      expect(previews[0].id).toBe(ideia.id);
      expect(previews[0].note).toBe('sobrevive');
      expect(previews[0].tag_id).toBeNull();
    });

    it('renomear pra um nome que já existe é recusado', async () => {
      await criarTag(alice, 'Bastidores');
      const outra = (await (await criarTag(alice, 'Produto')).json()) as Tag;
      const res = await call(como(alice, `/api/tags/${outra.id}`, { method: 'PATCH', body: JSON.stringify({ name: 'bastidores' }) }));
      expect(res.status).toBe(409);
    });
  });
});
