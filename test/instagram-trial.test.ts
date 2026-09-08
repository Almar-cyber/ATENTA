import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/worker.js';
import { instagramAdapter } from '../src/adapters/instagram.js';
import type { Account, MediaAsset, PostTarget, PublishResult } from '../src/lib/types.js';
import { resetDb } from './helpers.js';

// REEL DE TESTE do Instagram: sai só pra quem NÃO segue a conta, pra medir o desempenho antes de
// mostrar aos seguidores; depois "gradua" e vira um Reel normal.
//
// Na API é o container de Reel de sempre (`media_type=REELS`) com um `trial_params` a mais — e é
// por isso que aqui ele é OPÇÃO do Reel, não um quarto formato: o critério do design.md pra ser
// formato é mudar o media_type.
//
// O que estes testes prendem: (1) a escolha chega até o container em vez de sumir no caminho, que
// é o mesmo defeito que o `instagram_format` já teve uma vez (ver format-on-create.test.ts), e
// (2) as combinações que a Meta recusa são recusadas na CRIAÇÃO, quando a pessoa ainda está
// olhando pro arquivo, e não depois de o vídeo inteiro ter subido.

const ORIGIN = 'https://atenta.omangue.co';
const EMAIL = 'criadora@exemplo.com';

async function call(request: Request): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function register(email: string): Promise<{ cookie: string }> {
  await env.DB.prepare(`insert into signup_invites (email) values (?)`).bind(email.toLowerCase()).run();
  const res = await call(
    new Request(`${ORIGIN}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'senha-de-teste-123', name: email }),
    })
  );
  if (!res.ok) throw new Error(`sign-up falhou (${res.status}): ${await res.text()}`);
  const cookie = res.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('sign-up não devolveu cookie de sessão');
  return { cookie };
}

function asUser(user: { cookie: string }, path: string, init: RequestInit = {}): Request {
  return new Request(`${ORIGIN}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}), Cookie: user.cookie },
  });
}

async function optionsDoDestino(scheduledPostId: string): Promise<Record<string, unknown>> {
  const row = await env.DB.prepare(`select options from post_targets where scheduled_post_id = ?`)
    .bind(scheduledPostId)
    .first<{ options: string }>();
  if (!row) throw new Error('destino não encontrado');
  return JSON.parse(row.options) as Record<string, unknown>;
}

describe('criação: a escolha do Reel de teste chega ao destino', () => {
  let user: { cookie: string };
  const accountId = 'acc-ig';
  const videoId = 'md-video';
  const fotoId = 'md-foto';

  beforeEach(async () => {
    await resetDb();
    user = await register(EMAIL);
    await env.DB.prepare(
      `insert into accounts (id, platform, display_name, external_account_id, status, extra, owner_id)
       values (?, 'instagram', 'conta.teste', 'ext-ig', 'active', '{}', (select id from user where email = ?))`
    )
      .bind(accountId, EMAIL)
      .run();
    await env.DB.prepare(
      `insert into media_assets (id, storage_key, public_url, mime_type, size_bytes, duration_seconds, width, height, owner_id)
       values (?, 'k-video', 'https://scheduler-media.omangue.co/k-video', 'video/mp4', 1000, 12, 1080, 1920, (select id from user where email = ?))`
    )
      .bind(videoId, EMAIL)
      .run();
    // 1080x1350 = 4:5, proporção válida de feed — para o caso "Post não aceita teste" falhar pelo
    // motivo certo, e não por proporção.
    await env.DB.prepare(
      `insert into media_assets (id, storage_key, public_url, mime_type, size_bytes, width, height, owner_id)
       values (?, 'k-foto', 'https://scheduler-media.omangue.co/k-foto', 'image/jpeg', 1000, 1080, 1350, (select id from user where email = ?))`
    )
      .bind(fotoId, EMAIL)
      .run();
  });

  function criar(extra: Record<string, unknown>): Promise<Response> {
    return call(
      asUser(user, '/api/posts', {
        method: 'POST',
        body: JSON.stringify({
          body: 'legenda',
          scheduled_for: '2026-01-01T12:00:00Z',
          target_account_ids: [accountId],
          media_asset_ids: [videoId],
          ...extra,
        }),
      })
    );
  }

  it('Reel com graduação MANUAL grava trial_graduation junto do formato', async () => {
    const res = await criar({ instagram_format: 'reel', instagram_trial_graduation: 'MANUAL' });
    const texto = await res.text();
    expect(res.status, `esperava 201, veio ${res.status}: ${texto}`).toBe(201);

    const { id } = JSON.parse(texto) as { id: string };
    expect(await optionsDoDestino(id)).toMatchObject({ format: 'reel', trial_graduation: 'MANUAL' });
  });

  it('SS_PERFORMANCE também passa — são as duas estratégias que a Meta aceita', async () => {
    const res = await criar({ instagram_format: 'reel', instagram_trial_graduation: 'SS_PERFORMANCE' });
    expect(res.status).toBe(201);
    const { id } = JSON.parse(await res.text()) as { id: string };
    expect(await optionsDoDestino(id)).toMatchObject({ trial_graduation: 'SS_PERFORMANCE' });
  });

  it('Reel comum não grava campo nenhum — ausente é o padrão, não uma string vazia', async () => {
    const res = await criar({ instagram_format: 'reel' });
    expect(res.status).toBe(201);
    const { id } = JSON.parse(await res.text()) as { id: string };
    expect(await optionsDoDestino(id)).not.toHaveProperty('trial_graduation');
  });

  it('Story com teste é recusado na criação, não na publicação', async () => {
    const res = await criar({ instagram_format: 'story', instagram_trial_graduation: 'MANUAL' });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('só Reel pode sair como teste');
  });

  it('Post com teste é recusado pelo mesmo motivo', async () => {
    const res = await call(
      asUser(user, '/api/posts', {
        method: 'POST',
        body: JSON.stringify({
          body: 'legenda',
          scheduled_for: '2026-01-01T12:00:00Z',
          target_account_ids: [accountId],
          media_asset_ids: [fotoId],
          instagram_format: 'post',
          instagram_trial_graduation: 'MANUAL',
        }),
      })
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('só Reel pode sair como teste');
  });

  it('graduação desconhecida é recusada aqui — a Meta só recusaria depois do vídeo subir', async () => {
    const res = await criar({ instagram_format: 'reel', instagram_trial_graduation: 'QUANDO_EU_QUISER' });
    expect(res.status).toBe(400);
    const texto = await res.text();
    expect(texto).toContain('QUANDO_EU_QUISER');
    expect(texto).toContain('MANUAL ou SS_PERFORMANCE');
  });

  it('editar tirando a escolha limpa o campo — não fica um teste esquecido no destino', async () => {
    const criado = await criar({ instagram_format: 'reel', instagram_trial_graduation: 'MANUAL' });
    const { id } = JSON.parse(await criado.text()) as { id: string };
    expect(await optionsDoDestino(id)).toMatchObject({ trial_graduation: 'MANUAL' });

    const res = await call(
      asUser(user, `/api/posts/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          target_account_ids: [accountId],
          media_asset_ids: [videoId],
          instagram_format: 'reel',
          // instagram_trial_graduation ausente = "agora sai pra todo mundo".
        }),
      })
    );
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await optionsDoDestino(id)).not.toHaveProperty('trial_graduation');
  });
});

describe('publicação: o container leva trial_params', () => {
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

  function destino(options: Record<string, unknown>): PostTarget {
    return {
      id: 't1',
      scheduled_post_id: 'p1',
      account_id: conta.id,
      platform: 'instagram',
      status: 'publishing',
      caption_override: 'legenda',
      title: null,
      options,
      adapter_state: {},
      external_post_id: null,
      external_url: null,
      attempt_count: 0,
      last_error: null,
      published_at: null,
      updated_at: new Date().toISOString(),
    };
  }

  /** Publica e devolve o corpo do container que foi pra Graph API, já decodificado. */
  async function corpoDoContainer(options: Record<string, unknown>): Promise<URLSearchParams> {
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

    let enviado: URLSearchParams | undefined;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      enviado = new URLSearchParams(String(init?.body));
      return new Response(JSON.stringify({ id: 'container-1' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
    try {
      await instagramAdapter.publish(destino(options), [video], conta, env as never);
    } finally {
      globalThis.fetch = originalFetch;
    }
    if (!enviado) throw new Error('nenhuma chamada de container foi feita');
    return enviado;
  }

  it('Reel de teste vai como REELS + trial_params, no JSON que a Graph API espera', async () => {
    const body = await corpoDoContainer({ format: 'reel', trial_graduation: 'MANUAL' });
    expect(body.get('media_type')).toBe('REELS');
    // `trial_params` é objeto num corpo form-encoded: a convenção da Graph API é JSON em string.
    expect(JSON.parse(body.get('trial_params') ?? 'null')).toEqual({ graduation_strategy: 'MANUAL' });
  });

  it('Reel comum não manda trial_params — nem vazio, nem nulo', async () => {
    const body = await corpoDoContainer({ format: 'reel' });
    expect(body.get('media_type')).toBe('REELS');
    expect(body.has('trial_params')).toBe(false);
  });
});

// O PERMALINK do Instagram, guardado ao publicar.
//
// O Instagram era a única rede que publicava sem `external_url`: Facebook, Pinterest e YouTube
// montam a URL a partir do id, e aqui não dá — o link usa um shortcode que a API não deriva do id.
// Sem isso o botão "ver post publicado" nunca aparecia pra IG, e não havia caminho do painel pro
// post: exatamente o que o lembrete de Reel de teste precisa ter.
//
// A propriedade que mais importa aqui é a SEGUNDA: quando esta busca acontece, o post JÁ SAIU.
// Deixar um erro dela subir faria o poller tratar a publicação como falha e tentar de novo —
// publicando duas vezes, o pior desfecho do projeto (design.md §7, princípio 6).
describe('publicação: o permalink é guardado, e nunca custa o post', () => {
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

  function destinoEmProcessamento(): PostTarget {
    return {
      id: 't1',
      scheduled_post_id: 'p1',
      account_id: conta.id,
      platform: 'instagram',
      status: 'processing',
      caption_override: 'legenda',
      title: null,
      options: { format: 'reel' },
      adapter_state: { creation_id: 'container-1' },
      external_post_id: null,
      external_url: null,
      attempt_count: 0,
      last_error: null,
      published_at: null,
      updated_at: new Date().toISOString(),
    };
  }

  /**
   * Roda o checkStatus com o container já pronto. `permalink` decide o que a terceira chamada
   * (a do permalink) responde: uma URL, um erro HTTP, ou uma exceção de rede.
   */
  async function publicar(permalink: string | 'http-500' | 'explode'): Promise<PublishResult> {
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
    globalThis.fetch = (async (url: string) => {
      const u = String(url);
      if (u.includes('media_publish')) {
        return new Response(JSON.stringify({ id: 'ig-media-1' }), { headers: { 'Content-Type': 'application/json' } });
      }
      if (u.includes('fields=permalink')) {
        if (permalink === 'explode') throw new Error('conexão caiu');
        if (permalink === 'http-500') return new Response('erro', { status: 500 });
        return new Response(JSON.stringify({ permalink }), { headers: { 'Content-Type': 'application/json' } });
      }
      // status do container
      return new Response(JSON.stringify({ status_code: 'FINISHED' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
    try {
      return await instagramAdapter.checkStatus(destinoEmProcessamento(), conta, env as never);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  it('guarda o endereço do post', async () => {
    const r = await publicar('https://www.instagram.com/reel/ABC123/');
    expect(r).toMatchObject({
      state: 'published',
      externalId: 'ig-media-1',
      externalUrl: 'https://www.instagram.com/reel/ABC123/',
    });
  });

  it('permalink que responde erro NÃO derruba a publicação — o post já saiu', async () => {
    const r = await publicar('http-500');
    expect(r.state).toBe('published');
    expect(r).toMatchObject({ externalId: 'ig-media-1' });
    expect((r as { externalUrl?: string }).externalUrl).toBeUndefined();
  });

  it('permalink que estoura a conexão também não — senão o poller republicaria', async () => {
    const r = await publicar('explode');
    expect(r.state).toBe('published');
    expect((r as { externalUrl?: string }).externalUrl).toBeUndefined();
  });
});
