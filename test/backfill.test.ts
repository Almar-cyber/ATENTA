import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { gravar } from '../src/metrics/backfill.js';
import type { PostExterno } from '../src/metrics/backfill.js';
import { resetDb } from './helpers.js';
import type { Account } from '../src/lib/types.js';

// Importação de histórico. O que se testa aqui é a GRAVAÇÃO — a busca na rede é HTTP e muda com a
// API; a decisão de modelagem (post importado vira post publicado normal) é o que precisa segurar.

const DONO = 'dono-1';

const conta: Account = {
  id: 'acc-1',
  platform: 'instagram',
  display_name: 'perfil',
  external_account_id: 'ig-1',
  status: 'active',
  extra: {},
} as Account;

function post(id: string, quando: string, comMetrica = true): PostExterno {
  return {
    external_id: id,
    publicado_em: quando,
    legenda: `legenda de ${id}`,
    url: `https://exemplo/${id}`,
    formato: 'post',
    metricas: comMetrica ? { reach: 100, likes: 10, raw: {} } : null,
  };
}

beforeEach(async () => {
  await resetDb();
  await env.DB.prepare(
    `insert into accounts (id, platform, display_name, external_account_id, status, extra, owner_id)
     values ('acc-1','instagram','perfil','ig-1','active','{}',?)`
  )
    .bind(DONO)
    .run();
});

const contar = async (tabela: string) =>
  (await env.DB.prepare(`select count(*) as n from ${tabela}`).first<{ n: number }>())?.n ?? 0;

describe('importar histórico', () => {
  it('post externo vira post publicado normal, com dono e marca de importado', async () => {
    await gravar([post('x1', '2024-09-01T12:00:00Z')], conta, DONO, env);

    const alvo = await env.DB.prepare(
      `select status, published_at, external_post_id, options from post_targets`
    ).first<{ status: string; published_at: string; external_post_id: string; options: string }>();
    expect(alvo?.status).toBe('published');
    expect(alvo?.external_post_id).toBe('x1');
    expect(JSON.parse(alvo!.options).imported).toBe(true);

    // Escopado: sem dono correto, a importação não apareceria pra ninguém.
    const sp = await env.DB.prepare(`select owner_id, body from scheduled_posts`).first<{ owner_id: string; body: string }>();
    expect(sp?.owner_id).toBe(DONO);
    expect(sp?.body).toBe('legenda de x1');
  });

  it('reimportar NÃO duplica — atualiza a métrica do mesmo post', async () => {
    await gravar([post('x1', '2024-09-01T12:00:00Z')], conta, DONO, env);
    const r = await gravar([post('x1', '2024-09-01T12:00:00Z')], conta, DONO, env);

    expect(await contar('post_targets')).toBe(1);
    expect(await contar('scheduled_posts')).toBe(1);
    expect(r.ja_existiam).toBe(1);
    expect(r.importados).toBe(0);
    // A série temporal, essa sim, ganha um ponto novo a cada coleta.
    expect(await contar('post_metrics')).toBe(2);
  });

  it('post que JÁ foi publicado por nós é reaproveitado, não duplicado', async () => {
    // Simula um post que saiu pelo ATENTA! e tem o mesmo id externo lá na rede.
    await env.DB.prepare(
      `insert into scheduled_posts (id, title, body, scheduled_for, owner_id) values ('sp-nosso','','nosso','2025-01-01T12:00:00Z',?)`
    ).bind(DONO).run();
    await env.DB.prepare(
      `insert into post_targets (id, scheduled_post_id, account_id, platform, status, external_post_id, options, adapter_state)
       values ('pt-nosso','sp-nosso','acc-1','instagram','published','x9','{}','{}')`
    ).run();

    const r = await gravar([post('x9', '2025-01-01T12:00:00Z')], conta, DONO, env);

    expect(await contar('post_targets')).toBe(1);
    expect(r.importados).toBe(0);
    // E a métrica foi parar no destino que já existia, não num novo.
    const m = await env.DB.prepare(`select post_target_id from post_metrics`).first<{ post_target_id: string }>();
    expect(m?.post_target_id).toBe('pt-nosso');
  });

  it('post sem métrica ainda é importado — a peça existiu e conta na história do feed', async () => {
    const r = await gravar([post('velho', '2019-02-20T22:11:42Z', false)], conta, DONO, env);
    expect(r.importados).toBe(1);
    expect(r.sem_metrica).toBe(1);
    expect(await contar('post_targets')).toBe(1);
    expect(await contar('post_metrics')).toBe(0);
  });
});
