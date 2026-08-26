import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/worker.js';
import { resetDb } from './helpers.js';

// REGRESSÃO: `instagram_format` escolhido no compositor era perdido ao CRIAR um post (só
// updatePost repassava o campo pra validateAccountsAndMedia — createPost esquecia a linha).
//
// O sintoma real: agendar um Story com uma foto 9:16 (1440x2560) recusava na hora de criar, com
// "proporção da imagem fora do permitido — use entre 4:5 e 1.91:1" — a regra de PROPORÇÃO DE FEED,
// que não deveria nem rodar pra Story. O formato escolhido na tela nunca chegava ao adapter; ele
// caía no fallback de igFormat() (imagem → post, vídeo → reel), que era exatamente o
// comportamento de ANTES do seletor de formato existir.
//
// Pior que o caso visível: Story com VÍDEO caía no mesmo fallback e virava REEL — publicava
// errado, em silêncio, sem erro nenhum pra avisar.

const ORIGIN = 'https://atenta.omangue.co';

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

interface TargetRow {
  id: string;
  options: string;
}

async function targetsOf(scheduledPostId: string): Promise<TargetRow[]> {
  const { results } = await env.DB.prepare(`select id, options from post_targets where scheduled_post_id = ?`)
    .bind(scheduledPostId)
    .all<TargetRow>();
  return results ?? [];
}

describe('formato do Instagram sobrevive à criação do post (não só à edição)', () => {
  let user: { cookie: string };
  let accountId: string;
  let mediaId: string;

  beforeEach(async () => {
    await resetDb();
    user = await register('fotografa@exemplo.com');
    accountId = 'acc-ig';
    await env.DB.prepare(
      `insert into accounts (id, platform, display_name, external_account_id, status, extra, owner_id)
       values (?, 'instagram', 'conta.teste', 'ext-ig', 'active', '{}', (select id from user where email = ?))`
    )
      .bind(accountId, 'fotografa@exemplo.com')
      .run();
    // 1440x2560 = 9:16 — proporção correta de Story, e INVÁLIDA pra Post de feed (que exige entre
    // 4:5 e 1.91:1). É essa divergência que expõe o bug: só passa se o formato certo chegar à
    // validação.
    mediaId = 'md-story';
    // O owner_id é obrigatório aqui: a criação de post só aceita mídia do PRÓPRIO dono (auditoria
    // de 2026-08-06), então mídia semeada sem dono cai no default 'owner' e é recusada.
    await env.DB.prepare(
      `insert into media_assets (id, storage_key, public_url, mime_type, size_bytes, width, height, owner_id)
       values (?, 'k-story', 'https://scheduler-media.omangue.co/k-story', 'image/jpeg', 1000, 1440, 2560, (select id from user where email = ?))`
    )
      .bind(mediaId, 'fotografa@exemplo.com')
      .run();
  });

  it('Story com foto 9:16 é aceito na criação — a checagem de proporção de feed não se aplica', async () => {
    const res = await call(
      asUser(user, '/api/posts', {
        method: 'POST',
        body: JSON.stringify({
          body: '',
          scheduled_for: '2026-01-01T12:00:00Z',
          target_account_ids: [accountId],
          media_asset_ids: [mediaId],
          instagram_format: 'story',
        }),
      })
    );
    const bodyText = await res.text();
    expect(res.status, `esperava 201, veio ${res.status}: ${bodyText}`).toBe(201);

    const { id: scheduledPostId } = JSON.parse(bodyText) as { id: string };
    const targets = await targetsOf(scheduledPostId);
    expect(targets).toHaveLength(1);
    // A prova de verdade: o formato ESCOLHIDO foi o que ficou gravado, não o que o fallback
    // adivinharia (imagem sem format → 'post').
    expect(JSON.parse(targets[0].options)).toMatchObject({ format: 'story', as_story: true });
  });

  it('sem o formato, a MESMA foto é recusada — prova que o teste acima depende do format chegar', async () => {
    const res = await call(
      asUser(user, '/api/posts', {
        method: 'POST',
        body: JSON.stringify({
          body: '',
          scheduled_for: '2026-01-01T12:00:00Z',
          target_account_ids: [accountId],
          media_asset_ids: [mediaId],
          // instagram_format ausente de propósito: cai no fallback (imagem → post), e a foto 9:16
          // não é uma proporção válida de feed.
        }),
      })
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('proporção da imagem fora do permitido');
  });

  it('Reel escolhido na criação também é gravado (não só Story)', async () => {
    const videoId = 'md-video';
    await env.DB.prepare(
      `insert into media_assets (id, storage_key, public_url, mime_type, size_bytes, duration_seconds, owner_id)
       values (?, 'k-video', 'https://scheduler-media.omangue.co/k-video', 'video/mp4', 1000, 10, (select id from user where email = ?))`
    )
      .bind(videoId, 'fotografa@exemplo.com')
      .run();

    const res = await call(
      asUser(user, '/api/posts', {
        method: 'POST',
        body: JSON.stringify({
          body: 'legenda',
          scheduled_for: '2026-01-01T12:00:00Z',
          target_account_ids: [accountId],
          media_asset_ids: [videoId],
          instagram_format: 'reel',
        }),
      })
    );
    expect(res.status).toBe(201);
    const { id: scheduledPostId } = (await res.json()) as { id: string };
    const targets = await targetsOf(scheduledPostId);
    expect(JSON.parse(targets[0].options)).toMatchObject({ format: 'reel' });
  });
});
