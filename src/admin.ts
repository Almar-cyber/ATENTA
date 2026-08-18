// Phone-first posting surface, served by the Worker itself.
//
// Everything else in this project assumes a terminal: `enqueue` creates the rows, and attaching
// media means `wrangler r2 object put` plus two hand-written INSERTs. That makes the scheduler
// unusable from a phone, which is where the videos actually are. These three routes do the same
// work over HTTP so the whole loop — pick a file, write a caption, choose when — fits in a form.
//
// GET  /admin                     login screen, or the form plus accounts and queue
// POST /admin/login               password in, session cookie out
// PUT  /admin/media               raw upload, streamed straight into R2
// POST /admin/enqueue             JSON, creates the post and its targets
// GET  /admin/connect/:platform   redirect into that platform's consent screen
//
// Auth is a single shared secret (ADMIN_TOKEN), because the Worker URL is public and the routes
// below write to the database and spend platform quota. Give it once as ?key=..., and it moves to
// an HttpOnly cookie so it stops travelling in URLs and browser history.
import { nowIso } from './lib/db.js';
import type { Env } from './lib/env.js';
import type { Platform } from './lib/types.js';

const COOKIE_NAME = 'sched_admin';
const COOKIE_MAX_AGE_DAYS = 90;
const QUEUE_ROWS = 15;

// Cloudflare caps a Worker request body at 100MB on the free plan. The upload is a plain PUT of
// the file's bytes (no multipart), so this is the real ceiling for a video posted from the phone.
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

const BASE_STYLE = `<style>
  :root { color-scheme: light dark; --line: #8883; }
  * { box-sizing: border-box; }
  body { font: 16px/1.5 system-ui, sans-serif; margin: 0; padding: 16px; max-width: 640px; margin-inline: auto; }
  h1 { font-size: 1.25rem; margin: 0 0 16px; }
  h2 { font-size: 1rem; margin: 28px 0 8px; }
  label { display: block; margin: 14px 0 4px; font-weight: 600; }
  input, textarea, select, button { font: inherit; width: 100%; padding: 12px; border-radius: 10px;
    border: 1px solid var(--line); background: transparent; color: inherit; }
  textarea { min-height: 96px; resize: vertical; }
  .pick { display: flex; align-items: center; gap: 10px; font-weight: 400; margin: 0 0 8px;
    padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; }
  .pick input { width: auto; }
  button { margin-top: 20px; padding: 16px; font-weight: 700; border: 0; background: #2563eb; color: #fff; }
  button:disabled { opacity: .5; }
  #out { margin-top: 14px; padding: 12px; border-radius: 10px; white-space: pre-wrap; display: none; }
  #out.ok { display: block; background: #16a34a22; }
  #out.err { display: block; background: #dc262622; }
  table { width: 100%; border-collapse: collapse; font-size: .85rem; margin-top: 8px; }
  td, th { text-align: left; padding: 6px 4px; border-bottom: 1px solid var(--line); }
  .s-failed { color: #dc2626; } .s-published { color: #16a34a; }
  .hint { font-size: .8rem; opacity: .7; font-weight: 400; margin-top: 4px; }
  .mini { width: auto; margin: 0; padding: 8px 14px; font-size: .85rem; border-radius: 8px; }
  code { font-size: .78rem; word-break: break-all; }
</style>`;

export async function handleAdmin(request: Request, url: URL, env: Env): Promise<Response> {
  if (!env.ADMIN_TOKEN) {
    return new Response('ADMIN_TOKEN não configurado — rode: wrangler secret put ADMIN_TOKEN', { status: 503 });
  }

  const provided = presentedToken(request, url);
  const authed = !!provided && safeEqual(provided, env.ADMIN_TOKEN);

  // The page itself answers with a login screen; the data routes stay a flat 401, which keeps
  // "no key" and "wrong key" indistinguishable to anything that isn't a person at a form.
  if (!authed) {
    if (request.method === 'POST' && url.pathname === '/admin/login') return handleLogin(request, env);
    if (request.method === 'GET' && url.pathname === '/admin') return renderLogin();
    return new Response('não autorizado', { status: 401 });
  }

  // A key that arrived in the query string is moved into a cookie and stripped from the URL, so a
  // bookmark, a screenshot, or the browser history never carries the secret.
  if (url.searchParams.has('key') && url.pathname === '/admin') {
    return new Response(null, {
      status: 302,
      headers: { Location: '/admin', 'Set-Cookie': authCookie(env.ADMIN_TOKEN) },
    });
  }

  if (request.method === 'GET' && url.pathname === '/admin') {
    return renderPage(url, env);
  }
  if (request.method === 'PUT' && url.pathname === '/admin/media') {
    return handleUpload(request, url, env);
  }
  if (request.method === 'POST' && url.pathname === '/admin/enqueue') {
    return handleEnqueue(request, env);
  }
  if (request.method === 'POST' && url.pathname === '/admin/login') {
    return new Response(null, { status: 302, headers: { Location: '/admin' } });
  }
  const connect = /^\/admin\/connect\/(linkedin|meta|pinterest|tiktok)$/.exec(url.pathname);
  if (request.method === 'GET' && connect) {
    return startConnect(connect[1] as ConnectablePlatform, url, env);
  }
  return new Response('não encontrado', { status: 404 });
}

type ConnectablePlatform = 'linkedin' | 'meta' | 'pinterest' | 'tiktok';

// Same consent URLs the src/cli/*-auth-url.ts scripts print, built here instead so connecting an
// account is a button rather than a terminal. The Worker already owns the other half of this
// handshake (handleOAuthCallback in worker.ts), so only the outbound redirect was missing.
//
// YouTube is deliberately absent: its credential is a Desktop-app client using a loopback
// redirect, which a phone browser cannot serve. It stays on `npm run youtube-auth`.
function consentUrl(platform: ConnectablePlatform, displayName: string, redirectBase: string, env: Env): string {
  const redirectUri = `${redirectBase}/oauth/callback/${platform}`;
  const state = Buffer.from(JSON.stringify({ displayName })).toString('base64url');

  if (platform === 'linkedin') {
    const url = new URL('https://www.linkedin.com/oauth/v2/authorization');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', env.LINKEDIN_CLIENT_ID);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('scope', 'openid profile w_member_social');
    return url.toString();
  }
  if (platform === 'meta') {
    const url = new URL('https://www.facebook.com/v21.0/dialog/oauth');
    url.searchParams.set('client_id', env.META_APP_ID);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set(
      'scope',
      'pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish,business_management'
    );
    return url.toString();
  }
  if (platform === 'pinterest') {
    const url = new URL('https://www.pinterest.com/oauth/');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', env.PINTEREST_CLIENT_ID);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('scope', 'boards:read,pins:read,pins:write');
    return url.toString();
  }
  const url = new URL('https://www.tiktok.com/v2/auth/authorize/');
  url.searchParams.set('client_key', env.TIKTOK_CLIENT_KEY);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'user.info.basic,video.publish,video.upload');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  return url.toString();
}

// The redirect_uri has to match what's registered in each platform's console byte for byte, and
// this Worker answers on more than one hostname. OAUTH_REDIRECT_BASE pins it; without it we use
// whichever host the browser is on, which is right whenever that's the registered one.
function redirectBase(url: URL, env: Env): string {
  return (env.OAUTH_REDIRECT_BASE ?? url.origin).replace(/\/$/, '');
}

function startConnect(platform: ConnectablePlatform, url: URL, env: Env): Response {
  const displayName = (url.searchParams.get('name') ?? '').trim();
  if (!displayName) return new Response('faltou o nome da conta', { status: 400 });

  const credential = { linkedin: env.LINKEDIN_CLIENT_ID, meta: env.META_APP_ID, pinterest: env.PINTEREST_CLIENT_ID, tiktok: env.TIKTOK_CLIENT_KEY }[platform];
  if (!credential) {
    return new Response(`credencial de ${platform} não configurada no Worker`, { status: 503 });
  }

  return new Response(null, { status: 302, headers: { Location: consentUrl(platform, displayName, redirectBase(url, env), env) } });
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  const form = await request.formData();
  const password = String(form.get('password') ?? '');
  if (!safeEqual(password, env.ADMIN_TOKEN)) return renderLogin('Senha incorreta.');
  return new Response(null, { status: 302, headers: { Location: '/admin', 'Set-Cookie': authCookie(env.ADMIN_TOKEN) } });
}

function renderLogin(error?: string): Response {
  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Entrar</title>${BASE_STYLE}</head>
<body>
<h1>Agendador</h1>
${error ? `<div id="out" class="err" style="display:block">${esc(error)}</div>` : ''}
<form method="post" action="/admin/login">
  <label for="password">Senha</label>
  <input type="password" id="password" name="password" autocomplete="current-password" autofocus>
  <button type="submit">Entrar</button>
</form>
</body></html>`;
  // 401 on a wrong password, 200 on the first visit — the browser shouldn't cache either.
  return new Response(html, {
    status: error ? 401 : 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function presentedToken(request: Request, url: URL): string | null {
  const fromQuery = url.searchParams.get('key');
  if (fromQuery) return fromQuery;
  const fromHeader = request.headers.get('x-admin-key');
  if (fromHeader) return fromHeader;
  const cookies = request.headers.get('cookie') ?? '';
  const match = new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`).exec(cookies);
  return match ? decodeURIComponent(match[1]) : null;
}

function authCookie(token: string): string {
  const attrs = `Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE_DAYS * 86400}`;
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; ${attrs}`;
}

/** Compares in time independent of where the first difference falls. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Streams the body into R2 rather than buffering it: `request.body` is piped through, so a 90MB
// video never has to fit in the isolate's memory at once.
async function handleUpload(request: Request, url: URL, env: Env): Promise<Response> {
  const filename = url.searchParams.get('filename') ?? 'upload.bin';
  const contentType = request.headers.get('content-type') || guessMimeType(filename);
  const declaredLength = Number(request.headers.get('content-length') ?? '0');

  if (!request.body) return json({ error: 'corpo vazio' }, 400);
  if (!declaredLength) return json({ error: 'content-length ausente' }, 411);
  if (declaredLength > MAX_UPLOAD_BYTES) {
    return json({ error: `arquivo de ${mb(declaredLength)}MB passa do limite de ${mb(MAX_UPLOAD_BYTES)}MB` }, 413);
  }

  const id = crypto.randomUUID();
  const storageKey = `${id}${extensionOf(filename)}`;
  const object = await env.MEDIA.put(storageKey, request.body, { httpMetadata: { contentType } });

  // R2 reports the bytes it actually stored. TikTok's video/init declares the size up front and
  // rejects a mismatch, so the stored size is the only one worth recording.
  const size = object?.size ?? declaredLength;

  // Only set when a public R2 domain exists: Instagram, Facebook and Pinterest fetch media by URL,
  // while YouTube, LinkedIn and TikTok receive the bytes directly and never need it.
  const publicUrl = env.MEDIA_PUBLIC_BASE ? `${env.MEDIA_PUBLIC_BASE.replace(/\/$/, '')}/${storageKey}` : null;

  await env.DB.prepare(
    `insert into media_assets (id, storage_key, public_url, mime_type, size_bytes) values (?, ?, ?, ?, ?)`
  )
    .bind(id, storageKey, publicUrl, contentType, size)
    .run();

  return json({ media_id: id, size_bytes: size, mime_type: contentType });
}

interface EnqueueBody {
  account_ids?: string[];
  media_id?: string | null;
  caption?: string;
  title?: string | null;
  scheduled_for?: string | null;
  options?: Record<string, unknown>;
}

async function handleEnqueue(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as EnqueueBody | null;
  if (!body) return json({ error: 'json inválido' }, 400);

  const accountIds = (body.account_ids ?? []).filter(Boolean);
  if (accountIds.length === 0) return json({ error: 'escolha pelo menos uma conta' }, 400);

  const placeholders = accountIds.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `select id, platform from accounts where id in (${placeholders}) and status = 'active'`
  )
    .bind(...accountIds)
    .all<{ id: string; platform: Platform }>();
  const accounts = results ?? [];
  if (accounts.length !== accountIds.length) {
    return json({ error: 'alguma conta não existe ou está inativa' }, 400);
  }

  // Empty means now. The poller picks it up on the next tick, which is at most a minute away.
  const scheduledFor = body.scheduled_for ? new Date(body.scheduled_for) : new Date();
  if (Number.isNaN(scheduledFor.getTime())) return json({ error: 'data inválida' }, 400);

  const postId = crypto.randomUUID();
  const caption = body.caption?.trim() || null;
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(`insert into scheduled_posts (id, title, body, scheduled_for) values (?, ?, ?, ?)`).bind(
      postId,
      body.title?.trim() || null,
      caption,
      scheduledFor.toISOString()
    ),
  ];

  const optionsJson = JSON.stringify(body.options ?? {});
  for (const account of accounts) {
    const targetId = crypto.randomUUID();
    statements.push(
      env.DB.prepare(
        `insert into post_targets (id, scheduled_post_id, account_id, platform, status, options) values (?, ?, ?, ?, 'queued', ?)`
      ).bind(targetId, postId, account.id, account.platform, optionsJson)
    );
    if (body.media_id) {
      statements.push(
        env.DB.prepare(`insert into post_target_media (post_target_id, media_asset_id) values (?, ?)`).bind(
          targetId,
          body.media_id
        )
      );
    }
  }

  // One batch, so a half-created post — targets without their media, say — can't survive a failure
  // partway through and get claimed by the poller in that state.
  await env.DB.batch(statements);

  return json({ post_id: postId, targets: accounts.length, scheduled_for: scheduledFor.toISOString() });
}

async function renderPage(url: URL, env: Env): Promise<Response> {
  const { results: accounts } = await env.DB.prepare(
    `select id, platform, display_name from accounts where status = 'active' order by platform`
  ).all<{ id: string; platform: string; display_name: string }>();

  const { results: queue } = await env.DB.prepare(
    `select sp.scheduled_for, pt.platform, pt.status, pt.last_error, pt.external_url
     from post_targets pt
     join scheduled_posts sp on sp.id = pt.scheduled_post_id
     order by sp.scheduled_for desc
     limit ?`
  )
    .bind(QUEUE_ROWS)
    .all<{ scheduled_for: string; platform: string; status: string; last_error: string | null; external_url: string | null }>();

  const accountBoxes = (accounts ?? [])
    .map(
      (a) => `<label class="pick">
        <input type="checkbox" name="account" value="${esc(a.id)}" data-platform="${esc(a.platform)}">
        <span><b>${esc(a.platform)}</b> ${esc(a.display_name)}</span>
      </label>`
    )
    .join('');

  const queueRows = (queue ?? [])
    .map(
      (r) => `<tr>
        <td>${esc(r.scheduled_for.replace('T', ' ').slice(0, 16))}</td>
        <td>${esc(r.platform)}</td>
        <td class="s-${esc(r.status)}">${esc(r.status)}</td>
        <td>${r.external_url ? `<a href="${esc(r.external_url)}">ver</a>` : esc(truncate(r.last_error ?? '', 60))}</td>
      </tr>`
    )
    .join('');

  const connected = new Set((accounts ?? []).map((a) => a.platform));
  const base = redirectBase(url, env);
  const connectRows = (['tiktok', 'linkedin', 'meta', 'pinterest'] as ConnectablePlatform[])
    .map((platform) => {
      const label = platform === 'meta' ? 'facebook + instagram' : platform;
      const already = platform === 'meta' ? connected.has('facebook') || connected.has('instagram') : connected.has(platform);
      return `<div class="pick">
        <span style="flex:1">${esc(label)}${already ? ' <b>· conectado</b>' : ''}</span>
        <button type="button" class="mini" data-connect="${esc(platform)}">${already ? 'reconectar' : 'conectar'}</button>
      </div>`;
    })
    .join('');

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agendar post</title>
${BASE_STYLE}
</head>
<body>
<h1>Agendar post</h1>

<form id="f">
  <label>Vídeo ou imagem</label>
  <input type="file" id="file" accept="video/*,image/*">
  <div class="hint">Até ${mb(MAX_UPLOAD_BYTES)}MB. TikTok e YouTube exigem vídeo.</div>

  <label>Legenda</label>
  <textarea id="caption" placeholder="Escreva a legenda..."></textarea>

  <label>Quando</label>
  <input type="datetime-local" id="when">
  <div class="hint">Vazio = agora. O post sai em até 1 minuto.</div>

  <label>Contas</label>
  ${accountBoxes || '<div class="hint">Nenhuma conta conectada ainda.</div>'}

  <label>Privacidade no TikTok</label>
  <select id="privacy">
    <option value="">Padrão da conta (público)</option>
    <option value="SELF_ONLY">Só eu (teste)</option>
    <option value="MUTUAL_FOLLOW_FRIENDS">Amigos</option>
    <option value="PUBLIC_TO_EVERYONE">Público</option>
  </select>

  <button type="submit" id="go">Agendar</button>
  <div id="out"></div>
</form>

<h2>Contas</h2>
<div class="hint" style="margin-bottom:8px">Conectar abre o login da plataforma. Depois de autorizar, volte para esta página.</div>
${connectRows}
<div class="hint">redirect_uri usado: <code>${esc(base)}/oauth/callback/&lt;plataforma&gt;</code> — precisa estar registrado igual no painel de cada plataforma. YouTube é o único que continua pelo terminal (<code>npm run youtube-auth</code>), porque a credencial dele exige redirect local.</div>

<h2>Fila</h2>
<table>
  <tr><th>quando</th><th>onde</th><th>status</th><th></th></tr>
  ${queueRows || '<tr><td colspan="4">vazio</td></tr>'}
</table>

<script>
const $ = (id) => document.getElementById(id);
const out = $('out');
function say(msg, ok) { out.textContent = msg; out.className = ok ? 'ok' : 'err'; }

document.querySelectorAll('[data-connect]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const platform = btn.dataset.connect;
    const name = prompt('Nome para essa conta (só pra você identificar):');
    if (!name) return;
    // Full navigation, not fetch: the platform's consent screen has to open in the browser.
    location.href = '/admin/connect/' + platform + '?name=' + encodeURIComponent(name);
  });
});

$('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const accounts = [...document.querySelectorAll('input[name=account]:checked')];
  if (!accounts.length) return say('Escolha pelo menos uma conta.', false);

  const file = $('file').files[0];
  const needsMedia = accounts.some(a => ['tiktok','youtube','instagram','pinterest'].includes(a.dataset.platform));
  if (needsMedia && !file) return say('Essas plataformas exigem um arquivo.', false);

  $('go').disabled = true;
  try {
    let mediaId = null;
    if (file) {
      say('Enviando ' + Math.round(file.size / 1048576) + 'MB...', true);
      const up = await fetch('/admin/media?filename=' + encodeURIComponent(file.name), {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      const upJson = await up.json();
      if (!up.ok) throw new Error(upJson.error || 'falha no upload');
      mediaId = upJson.media_id;
    }

    const privacy = $('privacy').value;
    const res = await fetch('/admin/enqueue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account_ids: accounts.map(a => a.value),
        media_id: mediaId,
        caption: $('caption').value,
        // datetime-local has no timezone; new Date() reads it as this phone's local time and
        // toISOString converts to the UTC the scheduler stores.
        scheduled_for: $('when').value ? new Date($('when').value).toISOString() : null,
        options: privacy ? { privacy_level: privacy } : {},
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'falha ao agendar');
    say('Agendado para ' + json.scheduled_for + ' em ' + json.targets + ' conta(s). Recarregue para ver na fila.', true);
    $('f').reset();
  } catch (err) {
    say('Erro: ' + err.message, false);
  } finally {
    $('go').disabled = false;
  }
});
</script>
</body>
</html>`;

  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function mb(bytes: number): number {
  return Math.round(bytes / 1048576);
}

function extensionOf(filename: string): string {
  const match = /\.[a-z0-9]{1,8}$/i.exec(filename);
  return match ? match[0].toLowerCase() : '';
}

function guessMimeType(filename: string): string {
  const ext = extensionOf(filename);
  const table: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
  };
  return table[ext] ?? 'application/octet-stream';
}
