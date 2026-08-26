import { adapters } from './adapters/index.js';
import { metricsReady, missingMetricsScopes } from './lib/scopes.js';
import { probeInstagramHistory, probeYoutubeHistory } from './metrics/probe.js';
import { importInstagram, importYoutube } from './metrics/backfill.js';
import { nowIso, rowToAccount, rowToMediaAsset } from './lib/db.js';
import { getAccountTokens } from './lib/tokens.js';
import { fetchWithRetry } from './lib/http.js';
import { buildAuthUrl, isOAuthPlatform, OAUTH_CLIENT_ID_ENV } from './lib/oauth-urls.js';
import { encodeState, setStateCookie } from './lib/oauth-state.js';
import { signupIsOpen } from './lib/env.js';
import { AtendenteIndisponivel, MAX_PERGUNTA, responder } from './lib/atendente.js';
import { buscarExemplos, consumirCota, devolverCota, gerarLegenda, SemIA, TETO_DIARIO } from './lib/legenda.js';
import { validarAvatar } from './lib/avatar.js';
import { avisoDeLimite, FREE_LIMITS, limitesValemPara } from './lib/billing.js';
import type { Env } from './lib/env.js';
import type { Account, MediaAsset, Platform, PostTarget } from './lib/types.js';

const PLATFORMS: readonly Platform[] = ['youtube', 'linkedin', 'instagram', 'facebook', 'pinterest', 'tiktok'];
const MAX_POSTS_LIMIT = 300;

// What the platforms actually ingest. Camera RAW (image/x-sony-arw, image/x-canon-cr2, ...) passes
// an `accept="image/*"` filter and uploads fine, but every platform rejects it at publish time —
// so it's refused here instead, where the error is still attached to the file you just picked.
const ALLOWED_MIME_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'video/mp4',
  'video/quicktime',
];

// Cota de armazenamento por dono. O R2 é o único recurso que sai do free tier (10 GB) conforme
// entram usuários — Workers e D1 têm folga de ordens de grandeza.
//
// 5 GB desde 13/08/2026: com 2 GB a conta principal já estava em 1,71 GB e prestes a travar upload
// no meio do uso normal. O purge de 30 dias (stepPurgeOldMedia) é quem devolve espaço, então a cota
// precisa caber o TRÂNSITO de um mês, não o acervo inteiro. Vale lembrar que 5 GB por dono aperta
// no free tier a partir da segunda pessoa que encher — o teto do bucket é 10 GB.
const MEDIA_QUOTA_BYTES = 5 * 1024 * 1024 * 1024;

/** Bytes já ocupados por este dono no R2. */
async function usedBytes(owner: string, env: Env): Promise<number> {
  const row = await env.DB.prepare(`select coalesce(sum(size_bytes), 0) as total from media_assets where owner_id = ?`)
    .bind(owner)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

/** Resposta 413 se este upload estourar a cota do dono; null se cabe. */
async function checkQuota(owner: string, incoming: number, env: Env): Promise<Response | null> {
  const used = await usedBytes(owner, env);
  if (used + incoming <= MEDIA_QUOTA_BYTES) return null;
  const gb = (n: number) => (n / 1024 / 1024 / 1024).toFixed(1).replace('.', ',');
  return jsonResponse(
    {
      // Duas saídas na mesma frase, porque as duas existem de verdade: apagar mídia antiga libera
      // agora, e o purge de 30 dias libera sozinho depois. Diferente do limite de contas e de
      // posts, este não some com o tempo se a pessoa não fizer nada.
      error: avisoDeLimite(
        `Sem espaço: você já usa ${gb(used)} GB dos ${gb(MEDIA_QUOTA_BYTES)} GB disponíveis. ` +
          'Exclua posts antigos com mídia pesada pra liberar espaço.'
      ),
    },
    413
  );
}

/**
 * Os limites do plano gratuito valem pra este dono?
 *
 * Contas anteriores ao corte (ver `LIMITES_DESDE`) ficam de fora — elas já usavam bem acima do
 * anunciado quando o cadastro abriu, e travá-las de uma vez seria incidente, não limite.
 */
async function limitesValem(owner: string, env: Env): Promise<boolean> {
  const row = await env.DB.prepare(`select createdAt from user where id = ?`)
    .bind(owner)
    .first<{ createdAt: string | null }>();
  return limitesValemPara(row?.createdAt);
}

/** Quantos posts este dono criou no mês corrente — o que o teto mensal conta. */
async function postsNoMes(owner: string, env: Env): Promise<number> {
  const row = await env.DB.prepare(
    // O corte é o primeiro dia do mês em UTC, o mesmo fuso em que `created_at` é gravado. Usar o
    // fuso local do Worker faria a virada do mês acontecer em hora diferente da que a pessoa vê.
    `select count(*) as total from scheduled_posts
      where owner_id = ? and created_at >= strftime('%Y-%m-01T00:00:00.000Z', 'now')`
  )
    .bind(owner)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

const MAX_WAITLIST_EMAIL = 254; // limite de e-mail do RFC 5321
const MAX_WAITLIST_NAME = 80;

/**
 * API pública — roda ANTES do gate de sessão em worker.ts, porque quem chama ainda não tem conta.
 * Mantida minúscula de propósito: só o que a landing e a tela de entrar precisam saber antes de
 * existir um dono. Nada aqui lê nem devolve dado de ninguém.
 *
 * Devolve null quando a rota não é pública, e aí o worker segue pro caminho autenticado.
 */
export async function handlePublicApiRequest(request: Request, url: URL, env: Env): Promise<Response | null> {
  const { pathname } = url;

  // Estado do cadastro, pro front decidir entre "criar conta" e "entrar na lista de espera" em vez
  // de descobrir pelo erro depois de a pessoa ter digitado tudo.
  if (pathname === '/api/config' && request.method === 'GET') {
    return jsonResponse({ signup_open: signupIsOpen(env) });
  }

  // Atendente da landing. Público de propósito: quem está decidindo se cria conta ainda não tem
  // sessão, e é justamente essa pessoa que a dúvida faz ir embora.
  if (pathname === '/api/atendente' && request.method === 'POST') {
    return responderDuvida(request, env);
  }

  if (pathname === '/api/waitlist' && request.method === 'POST') {
    // Com o cadastro aberto não existe fila — deixar o endpoint vivo aqui só acumularia linha que
    // ninguém vai convidar, já que a pessoa pode criar conta direto.
    if (signupIsOpen(env)) {
      return jsonResponse({ error: 'O cadastro está aberto. Crie sua conta direto.' }, 400);
    }
    let payload: { email?: string; name?: string };
    try {
      payload = await request.json();
    } catch {
      return jsonResponse({ error: 'JSON inválido' }, 400);
    }
    const email = (payload.email ?? '').trim().toLowerCase();
    // Validação deliberadamente frouxa: aqui o custo de recusar um e-mail válido esquisito é perder
    // um interessado, e o de aceitar um inválido é uma linha morta na fila. Quem confere de verdade
    // é o convite, que só chega se o endereço existir.
    if (!email || email.length > MAX_WAITLIST_EMAIL || !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) {
      return jsonResponse({ error: 'Informe um e-mail válido' }, 400);
    }
    const name = (payload.name ?? '').trim().slice(0, MAX_WAITLIST_NAME) || null;
    // `or ignore`: entrar de novo não duplica nem sobrescreve a data de entrada — quem chegou
    // primeiro continua na frente da fila.
    await env.DB.prepare(`insert or ignore into signup_waitlist (email, name, created_at) values (?, ?, ?)`)
      .bind(email, name, nowIso())
      .run();
    // Mesma resposta pra e-mail novo e repetido: a mensagem não deve revelar quem já está na lista.
    return jsonResponse({ ok: true });
  }

  return null;
}

/**
 * `owner` chega pronto do worker.ts, que já provou a sessão antes de chamar aqui — não há caminho
 * até esta função sem dono autenticado. Daqui pra baixo todo handler recebe `owner` e TODA query
 * filtra por ele.
 */
export async function handleApiRequest(request: Request, url: URL, env: Env, owner: string): Promise<Response> {
  const { pathname } = url;
  const method = request.method;

  if (pathname === '/api/accounts' && method === 'GET') return listAccounts(owner, env);

  // As quatro leituras do poll do dashboard numa resposta só (contas, agenda, pilares e resumo).
  // Existe por economia de requisição: o poll fazia 4 chamadas por ciclo, e requisição é o recurso
  // contado do plano gratuito do Workers. Os filtros de status/plataforma valem como em /api/posts.
  if (pathname === '/api/state' && method === 'GET') return getState(url, owner, env);

  const importMatch = /^\/api\/accounts\/([^/]+)\/import-history$/.exec(pathname);
  if (importMatch && method === 'POST') return importHistory(importMatch[1], owner, env);

  const disconnectMatch = /^\/api\/accounts\/([^/]+)$/.exec(pathname);
  if (disconnectMatch && method === 'DELETE') return disconnectAccount(disconnectMatch[1], owner, env);

  const connectMatch = /^\/api\/connect\/([^/]+)$/.exec(pathname);
  if (connectMatch && method === 'GET') return startConnect(connectMatch[1], url, owner, env);

  if (pathname === '/api/posts' && method === 'GET') return listPosts(url, owner, env);
  if (pathname === '/api/posts' && method === 'POST') return createPost(request, owner, env);
  if (pathname === '/api/posts/reschedule' && method === 'POST') return reschedulePosts(request, owner, env);
  if (pathname === '/api/media' && method === 'POST') return uploadMedia(request, owner, env);

  // Avatar do próprio usuário (o do menu da conta, não o das redes conectadas). Guarda as ESCOLHAS,
  // não uma imagem — ver a migração 0020.
  if (pathname === '/api/profile/avatar' && method === 'PUT') return setProfileAvatar(request, owner, env);
  if (pathname === '/api/profile/avatar' && method === 'DELETE') return removeProfileAvatar(owner, env);
  // Upload em partes: o navegador fatia o arquivo, então nem o limite de corpo da requisição
  // (100MB no plano free) nem a memória do Worker (128MB) são atingidos por vídeos grandes.
  if (pathname === '/api/media/multipart/start' && method === 'POST') return multipartStart(request, owner, env);
  if (pathname === '/api/media/multipart/part' && method === 'PUT') return multipartPart(request, url, owner, env);
  if (pathname === '/api/media/multipart/complete' && method === 'POST') return multipartComplete(request, owner, env);

  // Feed real da conta conectada (busca AO VIVO na API da rede — as URLs de mídia do Instagram
  // expiram em dias, então guardar em cache no D1 renderia links quebrados).
  const feedMatch = /^\/api\/feed\/([^/]+)$/.exec(pathname);
  if (feedMatch && method === 'GET') return getAccountFeed(feedMatch[1], owner, env);

  // "Quem comenta com você" — agregado do que o poller já coletou (post_comments), não busca ao
  // vivo: comentário não expira como URL de mídia, então guardar e agregar é seguro.
  const commentersMatch = /^\/api\/accounts\/([^/]+)\/commenters$/.exec(pathname);
  if (commentersMatch && method === 'GET') return getCommenters(commentersMatch[1], owner, env);

  // Bytes de uma mídia já no R2, servidos pela NOSSA origem. O domínio público do R2 é outro host
  // e sem CORS: uma imagem carregada de lá suja o canvas e o recorte no navegador quebra. Por aqui
  // é same-origin, então dá pra recortar mídia de post duplicado/editado igual a arquivo novo.
  const mediaBytesMatch = /^\/api\/media\/([^/]+)\/bytes$/.exec(pathname);
  if (mediaBytesMatch && method === 'GET') return getMediaBytes(mediaBytesMatch[1], owner, env);

  // Resumo do painel: contagem por status, o que travou, e o que sai a seguir. Vem do servidor
  // porque /api/posts é filtrado e paginado — ver o comentário em getSummary.
  if (pathname === '/api/summary' && method === 'GET') return getSummary(owner, env);

  // Métricas coletadas (Fase A, design-analytics.md): o snapshot mais recente por post publicado.
  if (pathname === '/api/metrics' && method === 'GET') return listMetrics(owner, env);
  // Seguidores por conta (mais recente + primeiro snapshot) — pro "novos seguidores".
  if (pathname === '/api/metrics/followers' && method === 'GET') return listFollowers(owner, env);
  // Série temporal de um destino (todos os snapshots, pro sparkline).
  const metricsSeriesMatch = /^\/api\/metrics\/([^/]+)$/.exec(pathname);
  if (metricsSeriesMatch && method === 'GET') return getMetricsSeries(metricsSeriesMatch[1], owner, env);

  // Sonda TEMPORÁRIA: mede até onde o Instagram devolve métrica de post antigo, pra decidir se o
  // backfill de histórico vale a migração no schema. Some assim que a decisão for tomada.
  const probeMatch = /^\/api\/metrics\/probe\/([^/]+)$/.exec(pathname);
  if (probeMatch && method === 'GET') return runProbe(probeMatch[1], owner, env);

  // Sugestão de legenda pelo Workers AI. POST porque manda o assunto no corpo, e porque cada
  // chamada consome cota — não é uma leitura que dá pra repetir à toa.
  if (pathname === '/api/legenda' && method === 'POST') return sugerirLegenda(request, owner, env);

  // Pilares de conteúdo. Tabela própria, e não texto solto, porque o destino delas é um group by
  // no Insights — ver o comentário na migração 0014.
  if (pathname === '/api/tags' && method === 'GET') return listTags(owner, env);
  if (pathname === '/api/tags' && method === 'POST') return createTag(request, owner, env);
  const tagMatch = /^\/api\/tags\/([^/]+)$/.exec(pathname);
  if (tagMatch && method === 'PATCH') return updateTag(tagMatch[1], request, owner, env);
  if (tagMatch && method === 'DELETE') return deleteTag(tagMatch[1], owner, env);

  // Ideias do planejador de grade (um post que ainda não tem data).
  if (pathname === '/api/grid-previews' && method === 'GET') return listGridPreviews(url, owner, env);
  if (pathname === '/api/grid-previews' && method === 'POST') return createGridPreview(request, owner, env);
  const previewMatch = /^\/api\/grid-previews\/([^/]+)$/.exec(pathname);
  if (previewMatch && method === 'PATCH') return updateGridPreview(previewMatch[1], request, owner, env);
  if (previewMatch && method === 'DELETE') return deleteGridPreview(previewMatch[1], owner, env);

  const cancelMatch = /^\/api\/post-targets\/([^/]+)\/cancel$/.exec(pathname);
  if (cancelMatch && method === 'POST') return cancelTarget(cancelMatch[1], owner, env);

  const queueMatch = /^\/api\/post-targets\/([^/]+)\/queue$/.exec(pathname);
  if (queueMatch && method === 'POST') return queueTarget(queueMatch[1], owner, env);

  // Cancelado/falhou não é fim de linha: reativar devolve pra rascunho (não pra fila — a data
  // original já pode ter passado, e voltar direto pra fila publicaria na hora seguinte).
  const reactivateMatch = /^\/api\/post-targets\/([^/]+)\/reactivate$/.exec(pathname);
  if (reactivateMatch && method === 'POST') return reactivateTarget(reactivateMatch[1], owner, env);

  const deleteTargetMatch = /^\/api\/post-targets\/([^/]+)$/.exec(pathname);
  if (deleteTargetMatch && method === 'DELETE') return deleteTarget(deleteTargetMatch[1], owner, env);

  const updatePostMatch = /^\/api\/posts\/([^/]+)$/.exec(pathname);
  if (updatePostMatch && method === 'PATCH') return updatePost(updatePostMatch[1], request, owner, env);

  return jsonResponse({ error: 'not found' }, 404);
}

/**
 * Desconecta uma conta de rede social: o token sai do banco AGORA.
 *
 * A página /data-deletion promete exatamente isto ("remova a conta… apaga o token de acesso
 * imediatamente"), e é lida pelos revisores das plataformas — promessa que o produto não cumpre é
 * pior que funcionalidade ausente.
 *
 * Duas saídas, conforme o que já passou por esta conta:
 *
 * - Nunca publicou nada: a linha some inteira. Não há o que preservar.
 * - Já tem histórico: o token é apagado e a conta vira 'disabled', mas a LINHA FICA. post_targets
 *   referencia accounts(id) sem cascade, então apagar levaria junto o registro do que já foi
 *   publicado — e some do painel um post que existe de verdade na rede social. O que a promessa
 *   exige é a remoção da credencial, não a do histórico.
 *
 * E recusa enquanto houver post a caminho: desconectar no meio deixaria o poller tentando publicar
 * numa conta sem token, virando falha silenciosa em vez de decisão consciente.
 */
async function disconnectAccount(accountId: string, owner: string, env: Env): Promise<Response> {
  const account = await env.DB.prepare(`select id, display_name from accounts where id = ? and owner_id = ?`)
    .bind(accountId, owner)
    .first<{ id: string; display_name: string }>();
  if (!account) return jsonResponse({ error: 'conta não encontrada' }, 404);

  const pendentes = await env.DB.prepare(
    `select count(*) as n from post_targets
     where account_id = ? and status in ('draft','queued','publishing','processing')`
  )
    .bind(accountId)
    .first<{ n: number }>();
  if ((pendentes?.n ?? 0) > 0) {
    return jsonResponse(
      {
        error:
          `${account.display_name} tem ${pendentes?.n} post(s) ainda por publicar. ` +
          'Cancele ou exclua esses posts antes de desconectar.',
      },
      409
    );
  }

  const historico = await env.DB.prepare(`select count(*) as n from post_targets where account_id = ?`)
    .bind(accountId)
    .first<{ n: number }>();

  if ((historico?.n ?? 0) === 0) {
    await env.DB.prepare(`delete from accounts where id = ? and owner_id = ?`).bind(accountId, owner).run();
    return jsonResponse({ ok: true, removida: true });
  }

  await env.DB.prepare(
    `update accounts set token_ciphertext = null, token_iv = null, access_token_expires_at = null,
     refresh_token_expires_at = null, scope = null, status = 'disabled', updated_at = ?
     where id = ? and owner_id = ?`
  )
    .bind(nowIso(), accountId, owner)
    .run();
  return jsonResponse({ ok: true, removida: false, historico_preservado: historico?.n ?? 0 });
}

/**
 * Importa o histórico já publicado desta conta. Idempotente: rodar de novo não duplica, só atualiza
 * as métricas (o casamento é por account_id + external_post_id).
 */
async function importHistory(accountId: string, owner: string, env: Env): Promise<Response> {
  const row = await env.DB.prepare(`select * from accounts where id = ? and owner_id = ?`)
    .bind(accountId, owner)
    .first();
  if (!row) return jsonResponse({ error: 'conta não encontrada' }, 404);
  const account = rowToAccount(row as never);
  if (account.platform !== 'instagram' && account.platform !== 'youtube') {
    return jsonResponse({ error: `importação de histórico ainda não cobre ${account.platform}` }, 400);
  }
  try {
    const resultado =
      account.platform === 'youtube'
        ? await importYoutube(account, owner, env)
        : await importInstagram(account, owner, env);
    return jsonResponse(resultado);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
}

async function runProbe(accountId: string, owner: string, env: Env): Promise<Response> {
  // Escopado pelo dono como todo o resto: a sonda lê o token de uma conta conectada, e ninguém
  // pode apontá-la para a conta de outra pessoa.
  const row = await env.DB.prepare(`select * from accounts where id = ? and owner_id = ?`)
    .bind(accountId, owner)
    .first();
  if (!row) return jsonResponse({ error: 'conta não encontrada' }, 404);
  const account = rowToAccount(row as never);
  if (account.platform !== 'instagram' && account.platform !== 'youtube') {
    return jsonResponse({ error: 'a sonda hoje cobre Instagram e YouTube' }, 400);
  }
  try {
    return jsonResponse(
      account.platform === 'youtube'
        ? await probeYoutubeHistory(account, env)
        : await probeInstagramHistory(account, env)
    );
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// Início do fluxo de conexão pelo navegador: gera um nonce (guardado num cookie HttpOnly como CSRF),
// monta a URL de consentimento com redirect_uri = <origin>/oauth/callback/:platform e redireciona
// 302 pra plataforma. O botão "Conectar" do SPA só navega pra cá. Meta cobre Instagram + Facebook.
async function startConnect(platform: string, url: URL, owner: string, env: Env): Promise<Response> {
  if (!isOAuthPlatform(platform)) {
    return jsonResponse({ error: `conexão pelo app ainda não suportada para "${platform}"` }, 400);
  }

  // O teto é checado ANTES de mandar pro consentimento, não no callback: autorizar na plataforma e
  // só então ouvir "não deu" seria fazer a pessoa entregar acesso à conta dela à toa, e ainda
  // deixaria o app autorizado lá sem nada aqui.
  if (await limitesValem(owner, env)) {
    const row = await env.DB.prepare(`select count(*) as total from accounts where owner_id = ?`)
      .bind(owner)
      .first<{ total: number }>();
    if ((row?.total ?? 0) >= FREE_LIMITS.connections) {
      return Response.redirect(`${url.origin}/app?connect_error=${platform}&reason=limite_contas`, 302);
    }
  }
  const envVar = OAUTH_CLIENT_ID_ENV[platform];
  const clientId = String(env[envVar as keyof Env] ?? '');
  // Sem o secret, a plataforma recebe client_id vazio e devolve um erro críptico ("client_key")
  // na tela dela. Melhor falhar aqui e explicar o que falta configurar.
  if (!clientId) {
    // /app, não a raiz: a raiz é a landing pública, e cair nela deixava a pessoa numa URL que no
    // primeiro F5 servia a página de vendas em vez do painel (ver connectedRedirect em worker.ts).
    return Response.redirect(`${url.origin}/app?connect_error=${platform}&reason=missing_${envVar}`, 302);
  }
  const nonce = crypto.randomUUID();
  // o dono viaja no state: o callback OAuth roda sem sessão (vem da plataforma) e é ele que
  // decide de quem é a conta recém-conectada.
  const state = encodeState({ n: nonce, o: owner });
  const redirectUri = `${url.origin}/oauth/callback/${platform}`;
  const authUrl = buildAuthUrl(platform, { clientId, redirectUri, state });
  return new Response(null, { status: 302, headers: { Location: authUrl, 'Set-Cookie': setStateCookie(nonce) } });
}

async function listAccounts(owner: string, env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `select id, platform, display_name, status, extra, scope from accounts where owner_id = ? order by platform asc`
  )
    .bind(owner)
    .all<{ id: string; platform: string; display_name: string; status: string; extra: string; scope: string | null }>();

  const accounts = (results ?? []).map((r) => ({
    id: r.id,
    platform: r.platform,
    display_name: r.display_name,
    status: r.status,
    extra: JSON.parse(r.extra || '{}'),
    // Escopo NÃO sai daqui: é detalhe interno e o painel só precisa do veredito. O que sai é se a
    // conta consegue trazer métrica, e o que falta pra ela conseguir.
    metrics_ready: metricsReady(r.platform as Platform, r.scope),
    missing_scopes: missingMetricsScopes(r.platform as Platform, r.scope),
  }));

  return jsonResponse({ accounts });
}

interface PostTargetRow {
  post_id: string;
  title: string | null;
  body: string | null;
  scheduled_for: string;
  created_at: string;
  tag_id: string | null;
  tag_name: string | null;
  tag_color: string | null;
  target_id: string;
  platform: string;
  status: string;
  caption_override: string | null;
  options: string;
  external_url: string | null;
  external_post_id: string | null;
  attempt_count: number;
  last_error: string | null;
  published_at: string | null;
  updated_at: string;
  account_id: string;
  account_name: string;
}

async function listPosts(url: URL, owner: string, env: Env): Promise<Response> {
  const statusFilter = url.searchParams.get('status');
  const platformFilter = url.searchParams.get('platform');
  const limitParam = Number(url.searchParams.get('limit'));
  const limit = Math.min(Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 100, MAX_POSTS_LIMIT);

  // sp.owner_id é a primeira condição SEMPRE — os filtros de status/plataforma são opcionais,
  // o de dono não é.
  const conditions: string[] = ['sp.owner_id = ?'];
  const params: unknown[] = [owner];
  if (statusFilter) {
    conditions.push('pt.status = ?');
    params.push(statusFilter);
  }
  if (platformFilter) {
    conditions.push('pt.platform = ?');
    params.push(platformFilter);
  }
  const where = `where ${conditions.join(' and ')}`;

  const { results } = await env.DB.prepare(
    `select sp.id as post_id, sp.title, sp.body, sp.scheduled_for, sp.created_at,
            sp.tag_id, t.name as tag_name, t.color as tag_color,
            pt.id as target_id, pt.platform, pt.status, pt.caption_override, pt.options,
            pt.external_url, pt.external_post_id, pt.attempt_count, pt.last_error, pt.published_at, pt.updated_at,
            a.id as account_id, a.display_name as account_name
     from post_targets pt
     join scheduled_posts sp on sp.id = pt.scheduled_post_id
     join accounts a on a.id = pt.account_id
     left join tags t on t.id = sp.tag_id
     ${where}
     order by sp.scheduled_for desc
     limit ?`
  )
    .bind(...params, limit)
    .all<PostTargetRow>();

  const rows = results ?? [];
  const mediaByTarget = await getMediaByTargetIds(
    env,
    rows.map((r) => r.target_id)
  );

  const postsById = new Map<
    string,
    {
      id: string;
      title: string | null;
      body: string | null;
      scheduled_for: string;
      created_at: string;
      tag: { id: string; name: string; color: string } | null;
      targets: unknown[];
    }
  >();

  for (const row of rows) {
    if (!postsById.has(row.post_id)) {
      postsById.set(row.post_id, {
        id: row.post_id,
        title: row.title,
        body: row.body,
        scheduled_for: row.scheduled_for,
        created_at: row.created_at,
        // Objeto único (ou null), e não três campos soltos: o cliente ou tem o pilar inteiro ou
        // não tem nenhum, e um `tag_name` sem `tag_id` não significaria nada.
        tag: row.tag_id ? { id: row.tag_id, name: row.tag_name ?? '', color: row.tag_color ?? 'roxo' } : null,
        targets: [],
      });
    }
    postsById.get(row.post_id)!.targets.push({
      id: row.target_id,
      platform: row.platform,
      account_id: row.account_id,
      account_name: row.account_name,
      status: row.status,
      caption_override: row.caption_override,
      options: JSON.parse(row.options || '{}'),
      external_url: row.external_url,
      external_post_id: row.external_post_id,
      attempt_count: row.attempt_count,
      last_error: row.last_error,
      published_at: row.published_at,
      updated_at: row.updated_at,
      media: mediaByTarget.get(row.target_id) ?? [],
    });
  }

  return jsonResponse({ posts: Array.from(postsById.values()) });
}

interface MediaByTargetRow {
  post_target_id: string;
  id: string;
  public_url: string | null;
  mime_type: string;
  storage_key: string;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
}

async function getMediaByTargetIds(env: Env, targetIds: string[]): Promise<Map<string, MediaByTargetRow[]>> {
  const map = new Map<string, MediaByTargetRow[]>();
  if (targetIds.length === 0) return map;

  const placeholders = targetIds.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `select ptm.post_target_id, ma.id, ma.public_url, ma.mime_type, ma.storage_key,
            ma.duration_seconds, ma.width, ma.height
     from post_target_media ptm
     join media_assets ma on ma.id = ptm.media_asset_id
     where ptm.post_target_id in (${placeholders})
     order by ptm.position asc`
  )
    .bind(...targetIds)
    .all<MediaByTargetRow>();

  for (const r of results ?? []) {
    const list = map.get(r.post_target_id) ?? [];
    list.push(r);
    map.set(r.post_target_id, list);
  }
  return map;
}

interface CreatePostBody {
  title?: string;
  body?: string;
  scheduled_for?: string;
  target_account_ids?: string[];
  media_asset_id?: string;
  media_asset_ids?: string[];
  options?: Record<string, unknown>;
  youtube_privacy_status?: string;
  pinterest_board_id?: string;
  tiktok_privacy_level?: string;
  instagram_as_story?: boolean;
  /** 'post' | 'reel' | 'story' — escolhido no compositor. Substitui instagram_as_story, que
   *  continua aceito pra não quebrar chamadas antigas do CLI. */
  instagram_format?: string;
  cover_media_id?: string;
  cover_timestamp_ms?: number;
  save_as?: string;
  /** Pilar de conteúdo. Vive na PEÇA, não no destino: o assunto é do conteúdo, não da rede onde ele
   *  sai — o mesmo post no Instagram e no LinkedIn é sobre a mesma coisa. */
  tag_id?: string | null;
  // Keyed by account_id; overrides the shared `body` for just that one target's caption.
  target_caption_overrides?: Record<string, string>;
}

// Same fields as CreatePostBody minus save_as — an edit never re-decides the initial
// draft/queued split (see updatePost's per-account status logic instead). Every field is
// optional and independently "only touch what's present" — see updatePost.
interface UpdatePostBody {
  title?: string;
  body?: string;
  scheduled_for?: string;
  /** `null` tira o pilar; ausente não mexe. */
  tag_id?: string | null;
  target_account_ids?: string[];
  media_asset_id?: string;
  media_asset_ids?: string[];
  options?: Record<string, unknown>;
  youtube_privacy_status?: string;
  pinterest_board_id?: string;
  tiktok_privacy_level?: string;
  instagram_as_story?: boolean;
  /** 'post' | 'reel' | 'story' — escolhido no compositor. Substitui instagram_as_story, que
   *  continua aceito pra não quebrar chamadas antigas do CLI. */
  instagram_format?: string;
  cover_media_id?: string;
  cover_timestamp_ms?: number;
  target_caption_overrides?: Record<string, string>;
}

interface AccountRow {
  id: string;
  platform: string;
  status: string;
  extra: string;
}

// A target's status only ever starts life as one of these two (an update's newly-added account
// defaults to 'queued', matching what a non-draft createPost call would do) — every other
// PostTargetStatus is reached later, by the poller.
type NewTargetStatus = 'draft' | 'queued';

interface TargetToInsert {
  id: string;
  account: AccountRow;
  status: NewTargetStatus;
  options: Record<string, unknown>;
}

interface ValidateAccountsAndMediaParams {
  accountIds: string[] | undefined;
  mediaAssetId?: string;
  mediaAssetIds?: string[];
  options?: Record<string, unknown>;
  youtubePrivacyStatus?: string;
  pinterestBoardId?: string;
  tiktokPrivacyLevel?: string;
  instagramAsStory?: boolean;
  instagramFormat?: string;
  coverMediaId?: string;
  coverTimestampMs?: number;
  // Legenda canônica e título do post + overrides por conta, pra que o validate() de cada adapter
  // veja a MESMA legenda que o poller vai publicar (o poller resolve override ?? body). Sem isso, a
  // validação rodava com legenda vazia e um guard de "post só-texto precisa de legenda" nunca dispararia.
  body?: string;
  title?: string;
  captionOverrides?: Record<string, string>;
  // createPost uses one status for every target (from save_as); updatePost's full-replace uses a
  // per-account status (from each target's OLD status) — so the caller decides, not this helper.
  getTargetStatus: (accountId: string) => NewTargetStatus;
}

type ValidateAccountsAndMediaResult =
  | { ok: true; media: MediaAsset[]; targets: TargetToInsert[] }
  | { ok: false; response: Response };

// Shared by createPost and updatePost's full-replace branch: validate the target accounts exist
// and are active, validate the requested media exists with no duplicates, then — per target —
// merge platform-specific options and run the adapter's own validate() (skipped for drafts, same
// as createPost always did). Returns either the built target list or the 400 Response to send
// back verbatim; callers must not perform any DB write before checking `ok`.
async function validateAccountsAndMedia(env: Env, owner: string, params: ValidateAccountsAndMediaParams): Promise<ValidateAccountsAndMediaResult> {
  if (!Array.isArray(params.accountIds) || params.accountIds.length === 0) {
    return { ok: false, response: jsonResponse({ error: 'Selecione ao menos uma conta de destino' }, 400) };
  }
  const accountIds = params.accountIds;

  const { results: accountRows } = await env.DB.prepare(
    // `and owner_id = ?` é o que impede agendar um post mirando a conta de OUTRO dono: ids que
    // não são dele simplesmente não voltam, e o length check abaixo recusa a requisição.
    `select id, platform, status, extra from accounts where id in (${accountIds.map(() => '?').join(',')}) and owner_id = ?`
  )
    .bind(...accountIds, owner)
    .all<AccountRow>();
  const accounts = accountRows ?? [];

  if (accounts.length !== accountIds.length) {
    return { ok: false, response: jsonResponse({ error: 'Uma ou mais contas não foram encontradas' }, 400) };
  }
  const inactive = accounts.filter((a) => a.status !== 'active');
  if (inactive.length > 0) {
    return {
      ok: false,
      response: jsonResponse(
        { error: `Conta(s) inativa(s), precisa reautenticar: ${inactive.map((a) => a.platform).join(', ')}` },
        400
      ),
    };
  }

  // media_asset_ids is the carousel-capable form; media_asset_id is kept for single-media callers.
  // Order matters (it becomes post_target_media.position), so each id is fetched in turn rather
  // than with one IN (...) query, whose result order SQLite doesn't guarantee.
  const mediaIds = params.mediaAssetIds?.length ? params.mediaAssetIds : params.mediaAssetId ? [params.mediaAssetId] : [];
  // post_target_media's primary key is (post_target_id, media_asset_id, role), so the same asset
  // can't legally appear twice in one target — reject it here with a readable message instead of
  // letting the insert fail mid-loop.
  if (new Set(mediaIds).size !== mediaIds.length) {
    return { ok: false, response: jsonResponse({ error: 'a mesma mídia foi enviada mais de uma vez no carrossel' }, 400) };
  }
  const media: MediaAsset[] = [];
  for (const mediaId of mediaIds) {
    // `and owner_id = ?` pelo mesmo motivo das contas acima: sem ele, mandar o media_asset_id de
    // OUTRO dono criava o post normalmente (201), e a arte privada dele saía publicada na conta
    // social de quem pediu. media_assets tem owner_id desde a migração 0007; este caminho só nunca
    // passou a usá-lo. Coberto por test/isolation.test.ts.
    const row = await env.DB.prepare(`select * from media_assets where id = ? and owner_id = ?`)
      .bind(mediaId, owner)
      .first<any>();
    if (!row) return { ok: false, response: jsonResponse({ error: `media_asset_id não encontrado: ${mediaId}` }, 400) };
    media.push(rowToMediaAsset(row));
  }

  const ts = nowIso();
  const targets: TargetToInsert[] = [];

  // Reuse each adapter's own validate() so an impossible post (missing required video, missing
  // public_url, ...) is rejected here instead of silently failing at poller time. Drafts skip this
  // entirely — the point of a draft is capturing the idea before media/details are final.
  for (const account of accounts) {
    const platform = account.platform as Platform;
    if (!PLATFORMS.includes(platform)) {
      return { ok: false, response: jsonResponse({ error: `plataforma desconhecida: ${platform}` }, 400) };
    }

    const options: Record<string, unknown> = { ...(params.options ?? {}) };
    if (platform === 'youtube' && params.youtubePrivacyStatus) {
      options.privacyStatus = params.youtubePrivacyStatus;
    }
    if (platform === 'pinterest' && params.pinterestBoardId) {
      options.board_id = params.pinterestBoardId;
    }
    if (platform === 'tiktok' && params.tiktokPrivacyLevel) {
      options.privacy_level = params.tiktokPrivacyLevel;
    }
    if (platform === 'instagram') {
      // O formato define o media_type do container (VIDEO / REELS / STORIES). `as_story` fica
      // gravado junto só pra compatibilidade com o que lê o campo antigo.
      const format = params.instagramFormat ?? (params.instagramAsStory ? 'story' : undefined);
      if (format) {
        options.format = format;
        if (format === 'story') options.as_story = true;
      }
    }
    // Capa do vídeo. YouTube e Instagram aceitam uma IMAGEM própria; o TikTok só deixa escolher um
    // frame do próprio vídeo (timestamp). Guarda os dois e cada adapter usa o que sua API suporta.
    if (params.coverMediaId && (platform === 'youtube' || platform === 'instagram')) {
      options.cover_media_id = params.coverMediaId;
    }
    if (params.coverTimestampMs != null && (platform === 'tiktok' || platform === 'instagram')) {
      options.cover_timestamp_ms = params.coverTimestampMs;
    }

    const status = params.getTargetStatus(account.id);
    if (status !== 'draft') {
      const fakeTarget: PostTarget = {
        id: '',
        scheduled_post_id: '',
        account_id: account.id,
        platform,
        status: 'draft',
        // Mesma resolução do poller (override do destino ?? legenda canônica), pra o validate()
        // enxergar a legenda real. `|| null` normaliza string vazia pra null.
        caption_override: params.captionOverrides?.[account.id] || params.body || null,
        title: params.title ?? null,
        options,
        adapter_state: {},
        external_post_id: null,
        external_url: null,
        attempt_count: 0,
        last_error: null,
        published_at: null,
        updated_at: ts,
      };
      try {
        // Each adapter's own message is already prefixed with its platform name (e.g. "youtube: ...").
        // O validate() do Pinterest lê account.extra.default_board_id, então precisa de uma conta
        // com o extra parseado — não só o AccountRow leve. Os outros adapters ignoram a conta.
        const fakeAccount = { ...account, extra: JSON.parse(account.extra || '{}') } as unknown as Account;
        adapters[platform].validate(fakeTarget, media, fakeAccount);
      } catch (err) {
        return { ok: false, response: jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 400) };
      }
    }

    targets.push({ id: crypto.randomUUID(), account, status, options });
  }

  return { ok: true, media, targets };
}

// Shared by createPost and updatePost's full-replace branch: insert one post_targets row per
// validated target plus its post_target_media rows, in the same two-level loop createPost always
// used. Assumes scheduledPostId already exists as a row in scheduled_posts.
async function insertTargets(
  env: Env,
  scheduledPostId: string,
  targets: TargetToInsert[],
  media: MediaAsset[],
  captionOverrides: Record<string, string> | undefined
): Promise<void> {
  for (const t of targets) {
    await env.DB.prepare(
      `insert into post_targets (id, scheduled_post_id, account_id, platform, status, options, caption_override) values (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        t.id,
        scheduledPostId,
        t.account.id,
        t.account.platform,
        t.status,
        JSON.stringify(t.options),
        captionOverrides?.[t.account.id] ?? null
      )
      .run();

    for (let i = 0; i < media.length; i++) {
      await env.DB.prepare(
        `insert into post_target_media (post_target_id, media_asset_id, position, role) values (?, ?, ?, 'primary')`
      )
        .bind(t.id, media[i].id, i)
        .run();
    }
  }
}

async function createPost(request: Request, owner: string, env: Env): Promise<Response> {
  let payload: CreatePostBody;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: 'JSON inválido' }, 400);
  }

  // Legenda NÃO é obrigatória: Instagram publica sem legenda e Story sequer a exibe. O que não faz
  // sentido é um post vazio — então exige conteúdo: legenda OU mídia.
  const hasMediaOnCreate = (payload.media_asset_ids?.length ?? 0) > 0 || !!payload.media_asset_id;
  if (!payload.body?.trim() && !hasMediaOnCreate) {
    return jsonResponse({ error: 'Escreva uma legenda ou anexe um arquivo' }, 400);
  }
  if (!payload.scheduled_for || Number.isNaN(Date.parse(payload.scheduled_for))) {
    return jsonResponse({ error: 'scheduled_for inválido' }, 400);
  }

  // Teto mensal. Vale pro RASCUNHO também: ele ocupa a mesma linha em `scheduled_posts` e vira post
  // com um clique, então isentá-lo seria só mudar o nome do contorno.
  //
  // 429 e não 403: o teto é temporário por natureza (vira o mês e a pessoa volta a ter espaço), que
  // é exatamente o que "muitas requisições neste período" descreve. 403 diria "você não tem
  // direito", o que não é verdade.
  if (await limitesValem(owner, env)) {
    const usados = await postsNoMes(owner, env);
    if (usados >= FREE_LIMITS.postsPerMonth) {
      return jsonResponse(
        {
          error: avisoDeLimite(
            `Você já agendou ${usados} de ${FREE_LIMITS.postsPerMonth} posts neste mês. O limite se renova no dia 1º.`
          ),
        },
        429
      );
    }
  }

  const targetStatus: NewTargetStatus = payload.save_as === 'draft' ? 'draft' : 'queued';

  const result = await validateAccountsAndMedia(env, owner, {
    accountIds: payload.target_account_ids,
    mediaAssetId: payload.media_asset_id,
    mediaAssetIds: payload.media_asset_ids,
    options: payload.options,
    youtubePrivacyStatus: payload.youtube_privacy_status,
    pinterestBoardId: payload.pinterest_board_id,
    tiktokPrivacyLevel: payload.tiktok_privacy_level,
    instagramAsStory: payload.instagram_as_story,
    // Faltava esta linha — só updatePost a tinha. O compositor manda só `instagram_format` (nunca
    // o `instagram_as_story` antigo), então todo post NOVO com Reel ou Story escolhido caía no
    // fallback de igFormat() (vídeo→Reel, imagem→Post): Story com foto rejeitava por proporção de
    // feed sem motivo, e Story com VÍDEO publicava como Reel em silêncio, sem erro nenhum.
    instagramFormat: payload.instagram_format,
    coverMediaId: payload.cover_media_id,
    coverTimestampMs: payload.cover_timestamp_ms,
    body: payload.body,
    title: payload.title,
    captionOverrides: payload.target_caption_overrides,
    getTargetStatus: () => targetStatus,
  });
  if (!result.ok) return result.response;

  const scheduledPostId = crypto.randomUUID();
  await env.DB.prepare(
    `insert into scheduled_posts (id, title, body, scheduled_for, tag_id, owner_id) values (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      scheduledPostId,
      payload.title ?? null,
      payload.body,
      payload.scheduled_for,
      await resolveTagId(payload.tag_id, owner, env),
      owner
    )
    .run();

  await insertTargets(env, scheduledPostId, result.targets, result.media, payload.target_caption_overrides);

  return jsonResponse({ id: scheduledPostId, target_count: result.targets.length }, 201);
}

async function updatePost(id: string, request: Request, owner: string, env: Env): Promise<Response> {
  let payload: UpdatePostBody;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: 'JSON inválido' }, 400);
  }

  // Pure shape validation before any DB access, same as createPost — and, importantly, before any
  // DB write below, so a bad date can never be discovered only after the full-replace branch has
  // already deleted/inserted post_targets (which would leave the edit half-applied).
  if (payload.scheduled_for !== undefined && (!payload.scheduled_for || Number.isNaN(Date.parse(payload.scheduled_for)))) {
    return jsonResponse({ error: 'scheduled_for inválido' }, 400);
  }
  // Mesma regra do createPost: limpar a legenda é permitido desde que sobre mídia — o que não pode
  // é o post ficar sem nada.
  const hasMediaOnUpdate = (payload.media_asset_ids?.length ?? 0) > 0 || !!payload.media_asset_id;
  if (payload.body !== undefined && !payload.body.trim() && !hasMediaOnUpdate) {
    return jsonResponse({ error: 'Escreva uma legenda ou anexe um arquivo' }, 400);
  }

  const post = await env.DB.prepare(`select id from scheduled_posts where id = ? and owner_id = ?`)
    .bind(id, owner)
    .first<{ id: string }>();
  if (!post) return jsonResponse({ error: 'post não encontrado' }, 404);

  // Guard applies to every PATCH, not just the full-replace branch below: the moment any target
  // moves past 'queued' (publishing/processing/published/failed/canceled/ambiguous) the whole post
  // locks. No partial/per-target editing — real complexity for near-zero benefit in a solo-user app.
  const { results: targetRows } = await env.DB.prepare(`select account_id, status from post_targets where scheduled_post_id = ?`)
    .bind(id)
    .all<{ account_id: string; status: string }>();
  const existingTargets = targetRows ?? [];

  // Editável enquanto nada foi publicado de fato. Cancelado e falhou entram aqui de propósito: é
  // justamente o caso de reaproveitar a peça (mudar a data, corrigir o que quebrou) em vez de
  // refazer do zero. Publicando/processando/publicado seguem trancados.
  const EDITABLE = new Set(['draft', 'queued', 'canceled', 'failed']);
  const locked = existingTargets.some((t) => !EDITABLE.has(t.status));
  if (locked) {
    return jsonResponse({ error: 'não é possível editar: um ou mais destinos já estão publicando/publicados' }, 409);
  }

  // target_account_ids present signals "full replace": the caller is editing accounts/media/
  // options, not just nudging the date, so every target is validated and rebuilt from scratch.
  if (payload.target_account_ids !== undefined) {
    // Um destino que estava cancelado/falho volta como RASCUNHO, nunca direto pra fila: a data
    // que ele carregava já pode ter passado, e aí o poller publicaria no minuto seguinte à edição.
    const oldStatusMap = new Map<string, NewTargetStatus>();
    for (const t of existingTargets) {
      oldStatusMap.set(t.account_id, t.status === 'draft' || t.status === 'queued' ? (t.status as NewTargetStatus) : 'draft');
    }

    const result = await validateAccountsAndMedia(env, owner, {
      accountIds: payload.target_account_ids,
      mediaAssetId: payload.media_asset_id,
      mediaAssetIds: payload.media_asset_ids,
      options: payload.options,
      youtubePrivacyStatus: payload.youtube_privacy_status,
      pinterestBoardId: payload.pinterest_board_id,
      tiktokPrivacyLevel: payload.tiktok_privacy_level,
      instagramAsStory: payload.instagram_as_story,
      instagramFormat: payload.instagram_format,
      coverMediaId: payload.cover_media_id,
      coverTimestampMs: payload.cover_timestamp_ms,
      body: payload.body,
      title: payload.title,
      captionOverrides: payload.target_caption_overrides,
      // An account not previously targeted (newly added during this edit) defaults to 'queued' —
      // matching what a non-draft createPost call would do.
      getTargetStatus: (accountId) => oldStatusMap.get(accountId) ?? 'queued',
    });
    if (!result.ok) return result.response;

    // Cascades to post_target_media (ON DELETE CASCADE — migrations/0001_init.sql), so the fresh
    // insert below starts from a clean slate instead of trying to diff old vs new media rows.
    await env.DB.prepare(`delete from post_targets where scheduled_post_id = ?`).bind(id).run();
    await insertTargets(env, id, result.targets, result.media, payload.target_caption_overrides);
  }

  // D1 bind semantics have no clean "leave this column alone if it wasn't sent" (a plain
  // `set title = coalesce(?, title)` would need a real NULL-vs-absent distinction we don't have),
  // so the SET clause is built dynamically from whichever fields actually showed up in the
  // payload — the same approach listPosts already uses for its WHERE clause.
  const setClauses: string[] = [];
  const setParams: unknown[] = [];
  if (payload.title !== undefined) {
    setClauses.push('title = ?');
    setParams.push(payload.title);
  }
  if (payload.body !== undefined) {
    setClauses.push('body = ?');
    setParams.push(payload.body);
  }
  if (payload.scheduled_for !== undefined) {
    setClauses.push('scheduled_for = ?');
    setParams.push(payload.scheduled_for);
  }
  if (payload.tag_id !== undefined) {
    setClauses.push('tag_id = ?');
    setParams.push(await resolveTagId(payload.tag_id, owner, env));
  }
  if (setClauses.length > 0) {
    setClauses.push('updated_at = ?');
    setParams.push(nowIso());
    await env.DB.prepare(`update scheduled_posts set ${setClauses.join(', ')} where id = ? and owner_id = ?`)
      .bind(...setParams, id, owner)
      .run();
  }

  return jsonResponse({ ok: true });
}

interface RescheduleBody {
  // scheduled_post ids in their NEW visual order; they get the same set of scheduled_for
  // timestamps those posts already had, reassigned so the first id takes the earliest slot, etc.
  // This is how the Instagram grid drag-and-drop reorders posts without inventing new times.
  ordered_post_ids?: string[];
}

async function reschedulePosts(request: Request, owner: string, env: Env): Promise<Response> {
  let payload: RescheduleBody;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: 'JSON inválido' }, 400);
  }
  const ids = payload.ordered_post_ids;
  if (!Array.isArray(ids) || ids.length === 0) {
    return jsonResponse({ error: 'ordered_post_ids é obrigatório' }, 400);
  }

  const placeholders = ids.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `select id, scheduled_for from scheduled_posts where id in (${placeholders}) and owner_id = ?`
  )
    .bind(...ids, owner)
    .all<{ id: string; scheduled_for: string }>();
  const rows = results ?? [];

  if (rows.length !== ids.length) {
    return jsonResponse({ error: 'um ou mais posts não foram encontrados' }, 400);
  }

  // The pool of timestamps is exactly the ones these posts already hold, sorted ascending; the
  // i-th id in the requested order gets the i-th earliest timestamp. So dragging only ever
  // permutes existing slots — it never creates a brand-new time or leaves a gap.
  const slots = rows.map((r) => r.scheduled_for).sort();
  const ts = nowIso();
  for (let i = 0; i < ids.length; i++) {
    await env.DB.prepare(`update scheduled_posts set scheduled_for = ?, updated_at = ? where id = ? and owner_id = ?`)
      .bind(slots[i], ts, ids[i], owner)
      .run();
  }

  return jsonResponse({ ok: true, reordered: ids.length });
}

async function uploadMedia(request: Request, owner: string, env: Env): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonResponse({ error: 'esperado multipart/form-data com um campo "file"' }, 400);
  }

  const file = form.get('file');
  if (!(file instanceof File)) return jsonResponse({ error: 'envie um arquivo no campo "file"' }, 400);

  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return jsonResponse(
      {
        error:
          `formato não suportado em "${file.name}" (${file.type || 'tipo desconhecido'}). ` +
          'As plataformas aceitam JPEG, PNG, MP4 e MOV — RAW de câmera (.ARW, .CR2, .NEF) precisa ser exportado antes.',
      },
      400
    );
  }

  // Cota antes de gravar: recusar depois de subir os bytes desperdiça banda e deixa lixo no R2.
  const overQuota = await checkQuota(owner, file.size, env);
  if (overQuota) return overQuota;

  const id = crypto.randomUUID();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'upload';
  const storageKey = `${id}-${safeName}`;
  const bytes = await file.arrayBuffer();
  const mimeType = file.type || 'application/octet-stream';

  // Client-measured (via <video>/createImageBitmap) — best-effort, so a missing/unparsable
  // value is just left null rather than rejected.
  const durationSeconds = parseOptionalFloat(form.get('duration_seconds'));
  const width = parseOptionalInt(form.get('width'));
  const height = parseOptionalInt(form.get('height'));

  await env.MEDIA.put(storageKey, bytes, { httpMetadata: { contentType: mimeType } });

  const publicUrl = env.MEDIA_PUBLIC_BASE_URL ? `${env.MEDIA_PUBLIC_BASE_URL}/${storageKey}` : null;

  await env.DB.prepare(
    `insert into media_assets (id, storage_key, public_url, mime_type, size_bytes, duration_seconds, width, height, owner_id) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, storageKey, publicUrl, mimeType, bytes.byteLength, durationSeconds, width, height, owner)
    .run();

  return jsonResponse(
    {
      id,
      storage_key: storageKey,
      public_url: publicUrl,
      mime_type: mimeType,
      size_bytes: bytes.byteLength,
      duration_seconds: durationSeconds,
      width,
      height,
    },
    201
  );
}

/**
 * PUT /api/profile/avatar: grava as ESCOLHAS do avatar (Open Peeps) do usuário.
 *
 * Não guarda imagem nenhuma — só o JSON das variantes (~140 bytes), que o navegador transforma em
 * SVG na hora de desenhar. Foi o que substituiu a foto no R2: sem upload, sem cota, sem purge, e
 * com personalização que a foto não dava.
 *
 * Toda variante passa por `validarAvatar` (src/lib/avatar.ts): o campo volta pro navegador dentro
 * de um `<svg>`, então string arbitrária aqui não pode existir.
 */
async function setProfileAvatar(request: Request, owner: string, env: Env): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: 'JSON inválido' }, 400);
  }

  const avatar = validarAvatar(payload);
  if (!avatar) return jsonResponse({ error: 'avatar inválido' }, 400);

  await env.DB.prepare(`update user set avatar = ? where id = ?`).bind(JSON.stringify(avatar), owner).run();
  return jsonResponse({ avatar });
}

/**
 * DELETE /api/profile/avatar: volta pro avatar padrão.
 *
 * Nulo não é "sem rosto": quem não personalizou recebe um peep derivado do próprio id, sempre o
 * mesmo. Por isso remover é uma saída de verdade e não um beco (design.md, princípio 4).
 */
async function removeProfileAvatar(owner: string, env: Env): Promise<Response> {
  await env.DB.prepare(`update user set avatar = null where id = ?`).bind(owner).run();
  return jsonResponse({ ok: true });
}

export interface FeedItem {
  id: string;
  thumbnail_url: string | null;
  permalink: string | null;
  caption: string | null;
  published_at: string | null;
  is_video: boolean;
}

// Busca os posts já publicados na conta, pra o planejador de grade mostrar o feed real ao lado do
// que está agendado. Só Instagram e YouTube: são as redes com escopo de leitura já concedido e
// cujo perfil tem uma estética de grade/lista que valha planejar.
async function getAccountFeed(accountId: string, owner: string, env: Env): Promise<Response> {
  const row = await env.DB.prepare(`select * from accounts where id = ? and owner_id = ?`)
    .bind(accountId, owner)
    .first<any>();
  if (!row) return jsonResponse({ error: 'conta não encontrada' }, 404);
  const account = rowToAccount(row);

  try {
    if (account.platform === 'instagram') return jsonResponse({ items: await fetchInstagramFeed(account, env) });
    if (account.platform === 'youtube') return jsonResponse({ items: await fetchYoutubeFeed(account, env) });
    return jsonResponse({ items: [], unsupported: true });
  } catch (err) {
    // Feed é um extra: se a plataforma recusar, o grid segue mostrando os agendados.
    return jsonResponse({ items: [], error: err instanceof Error ? err.message : String(err) }, 200);
  }
}

/**
 * "Quem comenta com você" — o Instagram não expõe quem deixou de seguir, mas expõe quem comenta,
 * e comentário de verdade é sinal de gente engajada. Agrega sempre por CONSULTA (`group by`), nunca
 * um contador gravado — ver o comentário na migração 0015 pro raciocínio completo do porquê.
 */
async function getCommenters(accountId: string, owner: string, env: Env): Promise<Response> {
  const row = await env.DB.prepare(`select id from accounts where id = ? and owner_id = ?`)
    .bind(accountId, owner)
    .first<{ id: string }>();
  if (!row) return jsonResponse({ error: 'conta não encontrada' }, 404);

  const { results } = await env.DB.prepare(
    `select external_user_id, username, count(*) as comentarios,
            min(created_at) as desde, max(created_at) as ultimo
       from post_comments
      where account_id = ?
      group by external_user_id
      order by comentarios desc
      limit 20`
  )
    .bind(accountId)
    .all<Record<string, unknown>>();

  // O TOTAL vem separado, e não do `length` da lista acima, porque aquela é truncada em 20: numa
  // conta com 102 pessoas, contar as linhas devolvidas diria "20 pessoas comentaram com você" —
  // um número que parece certo e está errado, a pior espécie de erro num painel.
  const total = await env.DB.prepare(
    `select count(distinct external_user_id) as pessoas, count(*) as comentarios
       from post_comments where account_id = ?`
  )
    .bind(accountId)
    .first<{ pessoas: number; comentarios: number }>();

  return jsonResponse({
    commenters: results ?? [],
    total: total ?? { pessoas: 0, comentarios: 0 },
  });
}

async function fetchInstagramFeed(account: Account, env: Env): Promise<FeedItem[]> {
  const tokens = await getAccountTokens<{ access_token: string }>(env.DB, account.id, env.TOKEN_ENCRYPTION_KEY);
  if (!tokens?.access_token || !account.external_account_id) return [];
  const url =
    `https://graph.facebook.com/v21.0/${account.external_account_id}/media` +
    `?fields=id,media_type,media_url,thumbnail_url,permalink,timestamp,caption&limit=24` +
    `&access_token=${encodeURIComponent(tokens.access_token)}`;
  const res = await fetchWithRetry(url);
  if (!res.ok) throw new Error(`instagram feed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as {
    data?: Array<{
      id: string;
      media_type?: string;
      media_url?: string;
      thumbnail_url?: string;
      permalink?: string;
      timestamp?: string;
      caption?: string;
    }>;
  };
  return (json.data ?? []).map((m) => ({
    id: m.id,
    // VIDEO usa thumbnail_url; imagem e carrossel usam media_url.
    thumbnail_url: m.thumbnail_url ?? m.media_url ?? null,
    permalink: m.permalink ?? null,
    caption: m.caption ?? null,
    published_at: m.timestamp ?? null,
    is_video: m.media_type === 'VIDEO',
  }));
}

async function fetchYoutubeFeed(account: Account, env: Env): Promise<FeedItem[]> {
  const tokens = await getAccountTokens<{ access_token: string }>(env.DB, account.id, env.TOKEN_ENCRYPTION_KEY);
  if (!tokens?.access_token) return [];
  const auth = { Authorization: `Bearer ${tokens.access_token}` };

  // O canal guarda os uploads numa playlist própria; é preciso descobri-la antes de listar.
  const chRes = await fetchWithRetry('https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true', {
    headers: auth,
  });
  if (!chRes.ok) throw new Error(`youtube feed: ${chRes.status} ${await chRes.text()}`);
  const chJson = (await chRes.json()) as {
    items?: Array<{ contentDetails?: { relatedPlaylists?: { uploads?: string } } }>;
  };
  const uploads = chJson.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) return [];

  const plRes = await fetchWithRetry(
    `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=24&playlistId=${encodeURIComponent(uploads)}`,
    { headers: auth }
  );
  if (!plRes.ok) throw new Error(`youtube feed: ${plRes.status} ${await plRes.text()}`);
  const plJson = (await plRes.json()) as {
    items?: Array<{
      snippet?: {
        title?: string;
        publishedAt?: string;
        resourceId?: { videoId?: string };
        thumbnails?: Record<string, { url?: string }>;
      };
    }>;
  };
  return (plJson.items ?? []).map((it) => {
    const sn = it.snippet ?? {};
    const videoId = sn.resourceId?.videoId ?? '';
    const thumbs = sn.thumbnails ?? {};
    return {
      id: videoId,
      thumbnail_url: thumbs.high?.url ?? thumbs.medium?.url ?? thumbs.default?.url ?? null,
      permalink: videoId ? `https://youtu.be/${videoId}` : null,
      caption: sn.title ?? null,
      published_at: sn.publishedAt ?? null,
      is_video: true,
    };
  });
}

interface MultipartStartBody {
  name?: string;
  mime_type?: string;
}

async function multipartStart(request: Request, owner: string, env: Env): Promise<Response> {
  let body: MultipartStartBody;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'JSON inválido' }, 400);
  }
  const mimeType = body.mime_type ?? '';
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    return jsonResponse({ error: `formato não suportado (${mimeType || 'tipo desconhecido'})` }, 400);
  }
  const id = crypto.randomUUID();
  const safeName = (body.name ?? 'upload').replace(/[^a-zA-Z0-9._-]/g, '_') || 'upload';
  const storageKey = `${id}-${safeName}`;
  const upload = await env.MEDIA.createMultipartUpload(storageKey, { httpMetadata: { contentType: mimeType } });
  // Registra de quem é o upload: é o que permite ao /part conferir o dono depois. Ver migração 0019.
  await env.DB.prepare(
    `insert into media_uploads (storage_key, upload_id, owner_id, created_at) values (?, ?, ?, ?)`
  )
    .bind(storageKey, upload.uploadId, owner, nowIso())
    .run();
  return jsonResponse({ id, storage_key: storageKey, upload_id: upload.uploadId }, 201);
}

async function multipartPart(request: Request, url: URL, owner: string, env: Env): Promise<Response> {
  const storageKey = url.searchParams.get('key');
  const uploadId = url.searchParams.get('upload_id');
  const partNumber = Number(url.searchParams.get('part'));
  if (!storageKey || !uploadId || !Number.isInteger(partNumber) || partNumber < 1) {
    return jsonResponse({ error: 'parâmetros key/upload_id/part obrigatórios' }, 400);
  }
  if (!request.body) return jsonResponse({ error: 'corpo vazio' }, 400);

  // O par (key, upload_id) precisa ser DESTE dono. Antes disso, esta rota escrevia no bucket sem
  // nada ligando o upload a quem mandava os bytes — o upload_id ser opaco funcionava como senha, e
  // isso não é autorização. Ver migração 0019.
  const dono = await env.DB.prepare(
    `select owner_id from media_uploads where storage_key = ? and upload_id = ? and owner_id = ?`
  )
    .bind(storageKey, uploadId, owner)
    .first<{ owner_id: string }>();
  if (!dono) return jsonResponse({ error: 'upload não encontrado' }, 404);

  const upload = env.MEDIA.resumeMultipartUpload(storageKey, uploadId);
  // O corpo vai direto pro R2 como stream — nada é acumulado na memória do Worker.
  const part = await upload.uploadPart(partNumber, request.body);
  return jsonResponse({ part_number: part.partNumber, etag: part.etag });
}

interface MultipartCompleteBody {
  id?: string;
  storage_key?: string;
  upload_id?: string;
  mime_type?: string;
  size_bytes?: number;
  parts?: Array<{ part_number: number; etag: string }>;
  duration_seconds?: number | null;
  width?: number | null;
  height?: number | null;
}

async function multipartComplete(request: Request, owner: string, env: Env): Promise<Response> {
  let body: MultipartCompleteBody;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'JSON inválido' }, 400);
  }
  const { id, storage_key: storageKey, upload_id: uploadId, parts } = body;
  if (!id || !storageKey || !uploadId || !Array.isArray(parts) || parts.length === 0) {
    return jsonResponse({ error: 'id/storage_key/upload_id/parts obrigatórios' }, 400);
  }

  // Mesma checagem do /part: sem ela, fechar o upload de outro dono gravaria o media_asset em nome
  // de quem chamou, com os bytes de quem subiu. O `delete ... returning` confere e limpa numa
  // instrução só — o registro pendente já cumpriu o papel dele quando o upload fecha.
  const pendente = await env.DB.prepare(
    `delete from media_uploads where storage_key = ? and upload_id = ? and owner_id = ? returning storage_key`
  )
    .bind(storageKey, uploadId, owner)
    .first<{ storage_key: string }>();
  if (!pendente) return jsonResponse({ error: 'upload não encontrado' }, 404);

  const upload = env.MEDIA.resumeMultipartUpload(storageKey, uploadId);
  await upload.complete(parts.map((p) => ({ partNumber: p.part_number, etag: p.etag })));

  const mimeType = body.mime_type || 'application/octet-stream';
  const publicUrl = env.MEDIA_PUBLIC_BASE_URL ? `${env.MEDIA_PUBLIC_BASE_URL}/${storageKey}` : null;

  await env.DB.prepare(
    `insert into media_assets (id, storage_key, public_url, mime_type, size_bytes, duration_seconds, width, height, owner_id) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, storageKey, publicUrl, mimeType, body.size_bytes ?? 0, body.duration_seconds ?? null, body.width ?? null, body.height ?? null, owner)
    .run();

  return jsonResponse(
    {
      id,
      storage_key: storageKey,
      public_url: publicUrl,
      mime_type: mimeType,
      size_bytes: body.size_bytes ?? 0,
      duration_seconds: body.duration_seconds ?? null,
      width: body.width ?? null,
      height: body.height ?? null,
    },
    201
  );
}

async function getMediaBytes(id: string, owner: string, env: Env): Promise<Response> {
  // `and owner_id = ?`: sem ele esta rota servia o arquivo de QUALQUER dono a quem soubesse o id,
  // bastando estar logado. O uuid ser difícil de adivinhar não é controle de acesso — ele aparece
  // em resposta de API, em log e no cliente. Coberto por test/isolation.test.ts.
  const row = await env.DB.prepare(`select storage_key, mime_type from media_assets where id = ? and owner_id = ?`)
    .bind(id, owner)
    .first<{ storage_key: string; mime_type: string }>();
  if (!row) return jsonResponse({ error: 'mídia não encontrada' }, 404);

  const obj = await env.MEDIA.get(row.storage_key);
  if (!obj) return jsonResponse({ error: 'arquivo não está no bucket' }, 404);

  return new Response(obj.body, {
    headers: {
      'Content-Type': row.mime_type || 'application/octet-stream',
      // Imutável: o storage_key carrega o uuid, então o conteúdo daquele endereço nunca muda.
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}

/**
 * Um post na fila só deveria ficar `queued` até a varredura seguinte. Abaixo desta folga, "atrasado"
 * é o cron em andamento — e alarme falso num painel é pior que silêncio, porque ensina a ignorá-lo.
 * O cron roda a cada 10min (wrangler.toml), então 30 significa três varreduras perdidas.
 */
const ATRASO_TOLERADO_MS = 30 * 60_000;

/** Quantos destinos aparecem em "Sai a seguir". Cabe na dobra sem virar uma segunda lista. */
const PROXIMOS_LIMITE = 5;

interface ResumoContagemRow {
  status: PostTarget['status'];
  total: number;
  vencidos: number;
  atrasados: number;
  retentando: number;
}

interface ProximoRow {
  post_id: string;
  target_id: string;
  platform: Platform;
  status: PostTarget['status'];
  account_name: string;
  scheduled_for: string;
  title: string | null;
  body: string | null;
  caption_override: string | null;
  options: string | null;
}

/**
 * GET /api/state: contas + agenda + pilares + resumo numa resposta só, pro poll do dashboard.
 *
 * Composição, não cópia: chama os quatro handlers que já existem e funde os corpos. A regra de
 * cada bloco continua morando num lugar só, e este endpoint não vira uma quinta query paralela
 * que alguém esquece de atualizar quando a original mudar.
 */
async function getState(url: URL, owner: string, env: Env): Promise<Response> {
  const [acc, pst, tgs, sum] = await Promise.all([
    listAccounts(owner, env),
    listPosts(url, owner, env),
    listTags(owner, env),
    getSummary(owner, env),
  ]);
  const [accounts, posts, tags, summary] = await Promise.all([
    acc.json() as Promise<Record<string, unknown>>,
    pst.json() as Promise<Record<string, unknown>>,
    tgs.json() as Promise<Record<string, unknown>>,
    sum.json() as Promise<Record<string, unknown>>,
  ]);
  return jsonResponse({ ...accounts, ...posts, ...tags, summary });
}

/**
 * O resumo do painel: quantos destinos em cada status, o que está travado, e o que sai a seguir.
 *
 * POR QUE NÃO DÁ PRA CALCULAR ISSO NO CLIENTE a partir de `/api/posts`, que ele já carrega:
 *
 * 1. aquela rota é FILTRADA por status/plataforma (é o que alimenta os filtros da Agenda). Um painel
 *    cujos números mudam porque você esqueceu um filtro ligado noutra tela é um bug, não um recorte;
 * 2. ela é limitada a MAX_POSTS_LIMIT. Com histórico importado, "31 publicados" seria o teto da
 *    página, não a verdade — e um número truncado que se parece com um número certo é a pior
 *    espécie de erro, porque ninguém desconfia dele.
 *
 * Conta DESTINOS, não posts: `post_targets` é a unidade real de publicação (design.md §2), e é a
 * mesma unidade que o alerta de falhas e os Insights já contam. Misturar as duas faria o painel
 * discordar do resto do app.
 *
 * O bloco de desempenho ("como foi") NÃO vem daqui de propósito — o cliente soma `/api/metrics` e
 * `/api/metrics/followers`, exatamente como a tela de Insights faz. Somar de novo aqui criaria uma
 * segunda fonte pro mesmo número, e duas telas que discordam sobre o próprio alcance custam mais
 * confiança do que o payload economizado.
 */
async function getSummary(owner: string, env: Env): Promise<Response> {
  const agora = new Date();
  const agoraIso = agora.toISOString();
  const limiteAtraso = new Date(agora.getTime() - ATRASO_TOLERADO_MS).toISOString();

  const [contagens, proximos] = await Promise.all([
    env.DB.prepare(
      `select pt.status as status,
              count(*) as total,
              -- Rascunho com data passada: ficou pra trás de vez. Rascunho NUNCA publica, por mais
              -- que a data chegue (design.md §3), então ninguém vai buscá-lo — é o item mais
              -- invisível do app hoje, e a razão principal deste painel existir.
              sum(case when pt.status = 'draft' and sp.scheduled_for < ? then 1 else 0 end) as vencidos,
              -- Na fila e já passou da folga: a varredura devia ter pegado e não pegou.
              sum(case when pt.status = 'queued' and sp.scheduled_for < ? then 1 else 0 end) as atrasados,
              -- JÁ TENTOU E FALHOU, mas voltou pra fila pro retry. Conta separado porque é o estado
              -- mais enganoso do app: na lista ele é idêntico a um post que só está esperando a
              -- hora, e a mensagem de erro fica escondida no modal de detalhe. Sem isto, a falha só
              -- apareceria depois dos 30min de tolerância de "atrasados", ou quando as tentativas
              -- esgotassem e virasse "failed", o que leva horas.
              -- (Sem crase em comentário aqui: a query é um template literal, e uma crase solta
              -- fecha a string no meio.)
              sum(case when pt.status = 'queued' and pt.attempt_count > 0 then 1 else 0 end) as retentando
         from post_targets pt
         join scheduled_posts sp on sp.id = pt.scheduled_post_id
        where sp.owner_id = ?
        group by pt.status`
    )
      .bind(agoraIso, limiteAtraso, owner)
      .all<ResumoContagemRow>(),

    // Só o que REALMENTE vai sair. Rascunho fica de fora porque não publica: listá-lo aqui seria
    // uma promessa falsa sobre o que vai acontecer — o lugar dele é o bloco de pendências.
    env.DB.prepare(
      `select sp.id as post_id, sp.title, sp.body, sp.scheduled_for,
              pt.id as target_id, pt.platform, pt.status, pt.caption_override, pt.options,
              a.display_name as account_name
         from post_targets pt
         join scheduled_posts sp on sp.id = pt.scheduled_post_id
         join accounts a on a.id = pt.account_id
        where sp.owner_id = ?
          and pt.status in ('queued', 'publishing', 'processing')
          and sp.scheduled_for >= ?
        order by sp.scheduled_for asc
        limit ?`
    )
      .bind(owner, agoraIso, PROXIMOS_LIMITE)
      .all<ProximoRow>(),
  ]);

  const porStatus: Record<string, number> = {};
  let vencidos = 0;
  let atrasados = 0;
  let retentando = 0;
  for (const linha of contagens.results ?? []) {
    porStatus[linha.status] = linha.total;
    vencidos += linha.vencidos ?? 0;
    atrasados += linha.atrasados ?? 0;
    retentando += linha.retentando ?? 0;
  }

  const linhasProximos = proximos.results ?? [];
  const midiaPorDestino = await getMediaByTargetIds(
    env,
    linhasProximos.map((r) => r.target_id)
  );

  return jsonResponse({
    por_status: porStatus,
    atencao: { rascunhos_vencidos: vencidos, atrasados, retentando },
    proximos: linhasProximos.map((r) => ({
      post_id: r.post_id,
      target_id: r.target_id,
      platform: r.platform,
      status: r.status,
      account_name: r.account_name,
      scheduled_for: r.scheduled_for,
      // No YouTube o conteúdo é o título e o corpo vem vazio — mesma queda que o listMetrics faz.
      titulo: r.caption_override?.trim() || r.body?.trim() || r.title || null,
      formato: (JSON.parse(r.options || '{}') as { format?: string }).format ?? null,
      // Só a primeira mídia: é a capa do carrossel, que é o que a miniatura precisa mostrar.
      media: midiaPorDestino.get(r.target_id)?.[0] ?? null,
    })),
  });
}

// Snapshot mais recente de métrica por post publicado (Fase A). Um post sem nenhum snapshot ainda
// (coleta não rodou, ou rede sem coletor) simplesmente não aparece — a lista cresce conforme o
// poller coleta. `m.id = (subquery do último por destino)` pega só o snapshot mais novo de cada um.
async function listMetrics(owner: string, env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `select pt.id as target_id, pt.platform, pt.external_url, pt.external_post_id, pt.published_at,
            a.id as account_id, a.display_name as account_name,
            -- Formato (post/reel/story/video/short) pros insights por formato — vem do options JSON.
            json_extract(pt.options, '$.format') as format,
            -- Duração do vídeo (maior mídia do destino) pro insight de "duração ideal".
            (select max(ma.duration_seconds) from post_target_media ptm
               join media_assets ma on ma.id = ptm.media_asset_id
              where ptm.post_target_id = pt.id) as duration_seconds,
            -- No YouTube o conteúdo é o título (body vazio); cai nele quando não há legenda.
            coalesce(nullif(pt.caption_override, ''), nullif(sp.body, ''), sp.title) as caption,
            -- O pilar de conteúdo: é o que permite o Insights responder "sobre O QUÊ eu rendo mais",
            -- pergunta que ele nunca soube responder — só sabia sobre formato e horário.
            sp.tag_id, tg.name as tag_name, tg.color as tag_color,
            m.fetched_at, m.impressions, m.reach, m.likes, m.comments, m.shares, m.saves,
            m.video_views, m.avg_watch_seconds, m.follows, m.profile_visits, m.interactions
       from post_targets pt
       join accounts a on a.id = pt.account_id
       join scheduled_posts sp on sp.id = pt.scheduled_post_id
       left join tags tg on tg.id = sp.tag_id
       join post_metrics m on m.id = (
         select id from post_metrics where post_target_id = pt.id order by fetched_at desc limit 1
       )
      where pt.status = 'published' and sp.owner_id = ?
      order by pt.published_at desc
      limit 200`
  )
    .bind(owner)
    .all<Record<string, unknown>>();

  return jsonResponse({ metrics: results ?? [] });
}

// Seguidores por conta: o valor mais recente e o primeiro snapshot, pra UI calcular o delta
// ("novos seguidores"). Contas sem nenhum snapshot ainda voltam com followers null.
async function listFollowers(owner: string, env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `select a.id as account_id, a.platform, a.display_name,
            (select followers from account_metrics m where m.account_id = a.id order by m.fetched_at desc limit 1) as followers,
            (select followers from account_metrics m where m.account_id = a.id order by m.fetched_at asc limit 1) as followers_first,
            (select fetched_at from account_metrics m where m.account_id = a.id order by m.fetched_at asc limit 1) as since,
            -- Retrato mais RECENTE que não seja nulo: nem toda coleta traz os dois (a Meta esconde
            -- demografia de perfil pequeno), e pegar só o último snapshot devolveria nulo à toa.
            (select online_followers from account_metrics m where m.account_id = a.id
              and m.online_followers is not null order by m.fetched_at desc limit 1) as online_followers,
            (select demographics from account_metrics m where m.account_id = a.id
              and m.demographics is not null order by m.fetched_at desc limit 1) as demographics
       from accounts a where a.status = 'active' and a.owner_id = ?`
  )
    .bind(owner)
    .all<Record<string, unknown>>();
  return jsonResponse({ followers: results ?? [] });
}

// Todos os snapshots de um destino, do mais antigo pro mais novo (pro gráfico de evolução).
async function getMetricsSeries(targetId: string, owner: string, env: Env): Promise<Response> {
  // post_metrics não tem dono próprio — o escopo vem do post pai do destino.
  const { results } = await env.DB.prepare(
    `select pm.fetched_at, pm.impressions, pm.reach, pm.likes, pm.comments, pm.shares, pm.saves,
            pm.video_views, pm.avg_watch_seconds
       from post_metrics pm
       join post_targets pt on pt.id = pm.post_target_id
       join scheduled_posts sp on sp.id = pt.scheduled_post_id
      where pm.post_target_id = ? and sp.owner_id = ?
      order by pm.fetched_at asc`
  )
    .bind(targetId, owner)
    .all<Record<string, unknown>>();

  return jsonResponse({ series: results ?? [] });
}

// A "prévia" da grade virou IDEIA (migração 0013): além da imagem, ela carrega uma NOTA, e a
// imagem passou a ser opcional — ideia costuma começar em palavras e ganhar arte depois. O nome da
// tabela ficou `grid_previews` de propósito: renomear tabela é churn sem ganho nenhum.
interface GridPreviewRow {
  id: string;
  platform: Platform;
  media_asset_id: string | null;
  note: string | null;
  tag_id: string | null;
  tag_name: string | null;
  tag_color: string | null;
  sort_at: string;
  public_url: string | null;
  mime_type: string | null;
  width: number | null;
  height: number | null;
}

// `left join`: sem ele, a ideia só de texto (sem media_asset_id) simplesmente não voltaria na
// listagem — sumiria da grade e da lista sem erro nenhum.
const GRID_PREVIEW_SELECT = `select p.id, p.platform, p.media_asset_id, p.note, p.sort_at,
       p.tag_id, t.name as tag_name, t.color as tag_color,
       m.public_url, m.mime_type, m.width, m.height
  from grid_previews p
  left join media_assets m on m.id = p.media_asset_id
  left join tags t on t.id = p.tag_id`;

async function listGridPreviews(url: URL, owner: string, env: Env): Promise<Response> {
  const platform = url.searchParams.get('platform');
  if (platform && !PLATFORMS.includes(platform as Platform)) {
    return jsonResponse({ error: `plataforma inválida: ${platform}` }, 400);
  }
  const stmt = platform
    ? env.DB.prepare(`${GRID_PREVIEW_SELECT} where p.owner_id = ? and p.platform = ? order by p.sort_at desc`).bind(owner, platform)
    : env.DB.prepare(`${GRID_PREVIEW_SELECT} where p.owner_id = ? order by p.sort_at desc`).bind(owner);
  const { results } = await stmt.all<GridPreviewRow>();
  return jsonResponse({ previews: results ?? [] });
}

async function createGridPreview(request: Request, owner: string, env: Env): Promise<Response> {
  let payload: { platform?: string; media_asset_id?: string; note?: string; sort_at?: string; tag_id?: string };
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: 'JSON inválido' }, 400);
  }
  const { platform, media_asset_id: mediaAssetId } = payload;
  const note = payload.note?.trim() || null;
  if (!platform || !PLATFORMS.includes(platform as Platform)) {
    return jsonResponse({ error: 'platform obrigatória' }, 400);
  }
  // Um dos dois basta, mas não nenhum: ideia sem imagem e sem texto é uma linha que ninguém
  // consegue identificar depois nem pra apagar. Espelha o `check` da migração 0013 — aqui pra
  // devolver uma frase em vez do erro cru do SQLite.
  if (!mediaAssetId && !note) {
    return jsonResponse({ error: 'escreva a ideia ou anexe uma imagem' }, 400);
  }

  if (mediaAssetId) {
    const asset = await env.DB.prepare(`select id from media_assets where id = ?`).bind(mediaAssetId).first<{ id: string }>();
    if (!asset) return jsonResponse({ error: 'mídia não encontrada' }, 404);
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `insert into grid_previews (id, platform, media_asset_id, note, tag_id, sort_at, owner_id) values (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, platform, mediaAssetId ?? null, note, await resolveTagId(payload.tag_id, owner, env), payload.sort_at || nowIso(), owner)
    .run();

  const row = await env.DB.prepare(`${GRID_PREVIEW_SELECT} where p.id = ? and p.owner_id = ?`)
    .bind(id, owner)
    .first<GridPreviewRow>();
  return jsonResponse(row, 201);
}

/**
 * Atualiza a ideia: a posição na grade (`sort_at`), o texto (`note`) ou a arte (`media_asset_id`).
 *
 * Campo ausente = não mexe. `note: ''` apaga o texto, o que é diferente de não mandar `note` — daí
 * a checagem por `in` em vez de por valor verdadeiro.
 */
async function updateGridPreview(id: string, request: Request, owner: string, env: Env): Promise<Response> {
  let payload: { sort_at?: string; note?: string | null; media_asset_id?: string | null; tag_id?: string | null };
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: 'JSON inválido' }, 400);
  }

  const atual = await env.DB.prepare(`select note, media_asset_id from grid_previews where id = ? and owner_id = ?`)
    .bind(id, owner)
    .first<{ note: string | null; media_asset_id: string | null }>();
  if (!atual) return jsonResponse({ error: 'ideia não encontrada' }, 404);

  const mexeNota = 'note' in payload;
  const mexeMidia = 'media_asset_id' in payload;
  const note = mexeNota ? payload.note?.trim() || null : atual.note;
  const mediaAssetId = mexeMidia ? payload.media_asset_id || null : atual.media_asset_id;

  // Mesma guarda da criação, aplicada ao resultado da edição: dá pra tirar o texto OU a imagem,
  // nunca os dois — senão a ideia vira uma linha invisível.
  if (!note && !mediaAssetId) {
    return jsonResponse({ error: 'a ideia precisa de um texto ou de uma imagem' }, 400);
  }
  if (mexeMidia && mediaAssetId && mediaAssetId !== atual.media_asset_id) {
    const asset = await env.DB.prepare(`select id from media_assets where id = ?`).bind(mediaAssetId).first<{ id: string }>();
    if (!asset) return jsonResponse({ error: 'mídia não encontrada' }, 404);
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  if (payload.sort_at) {
    sets.push('sort_at = ?');
    params.push(payload.sort_at);
  }
  if (mexeNota) {
    sets.push('note = ?');
    params.push(note);
  }
  if (mexeMidia) {
    sets.push('media_asset_id = ?');
    params.push(mediaAssetId);
  }
  // `tag_id: null` tira o pilar; ausente não mexe. Um id que não é do dono cai em null pela
  // resolveTagId — não vaza, e também não grava referência fantasma.
  if ('tag_id' in payload) {
    sets.push('tag_id = ?');
    params.push(await resolveTagId(payload.tag_id, owner, env));
  }
  if (sets.length === 0) return jsonResponse({ error: 'nada para atualizar' }, 400);

  await env.DB.prepare(`update grid_previews set ${sets.join(', ')} where id = ? and owner_id = ?`)
    .bind(...params, id, owner)
    .run();

  const row = await env.DB.prepare(`${GRID_PREVIEW_SELECT} where p.id = ? and p.owner_id = ?`)
    .bind(id, owner)
    .first<GridPreviewRow>();
  return jsonResponse(row);
}

// Só apaga a linha da grade — o media_asset (e o objeto no R2) fica, porque a mesma mídia pode já
// ter sido reaproveitada num post agendado.
async function deleteGridPreview(id: string, owner: string, env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(`delete from grid_previews where id = ? and owner_id = ? returning id`)
    .bind(id, owner)
    .all<{ id: string }>();
  if ((results?.length ?? 0) === 0) return jsonResponse({ error: 'ideia não encontrada' }, 404);
  return jsonResponse({ ok: true });
}

/**
 * TAGS — os pilares de conteúdo.
 *
 * O que justifica uma tabela em vez de um campo de texto está na migração 0014: o destino final
 * delas é um GROUP BY no Insights, e group by sobre texto digitado quebra "Viagem"/"viagem" em
 * pilares diferentes, dividindo a amostra sem que ninguém perceba.
 */

/** Chaves da paleta. Espelha TAG_COLORS em web/src/lib/tags.ts — cor não vai como hex pro banco. */
const TAG_COLORS: readonly string[] = ['roxo', 'verde', 'azul', 'laranja', 'rosa', 'ciano'];

const MAX_TAG_NAME = 24;

/**
 * Responde uma dúvida de quem está na landing.
 *
 * Três defesas, e nenhuma delas é opcional num endpoint sem sessão:
 *  1. limite por IP (binding), que barra o laço de shell de um abusador só;
 *  2. teto global do dia (D1), que barra tráfego distribuído — sem ele, uma enxurrada derruba junto
 *     a sugestão de legenda de quem paga, porque a cota do Workers AI é da conta inteira;
 *  3. tamanho máximo da pergunta, que impede alguém de usar o endpoint como tradutor de graça
 *     colando um texto inteiro dentro dele.
 *
 * A recusa NUNCA é um erro seco: sempre oferece o e-mail. Quem está com dúvida na hora de decidir
 * assinar e leva "erro 429" na cara vai embora, não tenta de novo.
 */
async function responderDuvida(request: Request, env: Env): Promise<Response> {
  const SAIDA = 'Manda a sua dúvida pra contato@omangue.co que a gente responde.';

  const body = (await request.json().catch(() => null)) as { pergunta?: string } | null;
  const pergunta = (body?.pergunta ?? '').trim();
  if (pergunta.length < 3) {
    return jsonResponse({ error: 'Escreva a sua dúvida.' }, 400);
  }
  if (pergunta.length > MAX_PERGUNTA) {
    return jsonResponse(
      { error: `Resuma em até ${MAX_PERGUNTA} caracteres, ou ${SAIDA.toLowerCase()}` },
      400
    );
  }

  // O IP vem do CF-Connecting-IP, que a Cloudflare preenche e o cliente não consegue forjar (o
  // X-Forwarded-For, que seria a escolha óbvia, é cabeçalho de request e qualquer um manda o que
  // quiser nele). Sem IP, cai num balde único: preferível a não limitar nada.
  const ip = request.headers.get('CF-Connecting-IP') ?? 'sem-ip';
  if (env.ATENDENTE_LIMITE) {
    const { success } = await env.ATENDENTE_LIMITE.limit({ key: ip });
    if (!success) {
      return jsonResponse({ error: `Muitas perguntas seguidas. Espere um minuto, ou ${SAIDA.toLowerCase()}` }, 429);
    }
  }

  try {
    const { texto, respondeu } = await responder(env, pergunta);
    // Log do que NÃO soube responder: é o buraco do corpus, e é a única forma de descobrir qual
    // pergunta a landing devia responder e não responde. Sem o IP junto — o que interessa é a
    // pergunta, não quem fez.
    if (!respondeu) console.warn(`[atendente] sem resposta: ${pergunta.slice(0, 200)}`);
    return jsonResponse({ resposta: texto });
  } catch (err) {
    if (err instanceof AtendenteIndisponivel) {
      console.error('[atendente]', err.message);
      return jsonResponse({ resposta: `Não consigo responder agora. ${SAIDA}` });
    }
    throw err;
  }
}

/**
 * Sugere legendas pro assunto que a pessoa descreveu.
 *
 * O que faz isto valer mais que um "gerar texto" genérico é o `buscarExemplos`: o prompt leva as
 * legendas do PRÓPRIO dono que mais engajaram, no mesmo pilar. É por isso que a busca acontece aqui
 * e não no cliente — o histórico e a métrica são dados do servidor, e mandá-los pro navegador só
 * pra ele devolver no corpo seria expor dado sem motivo.
 */
async function sugerirLegenda(request: Request, owner: string, env: Env): Promise<Response> {
  if (!env.AI) {
    return jsonResponse({ error: 'A sugestão de legenda não está disponível neste ambiente.' }, 503);
  }

  const body = (await request.json().catch(() => null)) as {
    assunto?: string;
    plataforma?: Platform;
    tag_id?: string | null;
  } | null;

  const assunto = (body?.assunto ?? '').trim();
  // 4 caracteres: abaixo disso não há assunto, e o modelo inventaria o post inteiro — exatamente o
  // que a regra "não invente fato" no prompt existe pra evitar.
  if (assunto.length < 4) {
    return jsonResponse({ error: 'Escreva em uma linha sobre o que é o post.' }, 400);
  }
  const plataforma = body?.plataforma;
  if (!plataforma || !PLATFORMS.includes(plataforma)) {
    return jsonResponse({ error: 'Escolha a conta de destino antes de gerar a legenda.' }, 400);
  }

  // A cota é consumida ANTES de chamar o modelo. Consumir depois deixaria a chamada cara acontecer
  // e só então descobrir que não podia — que é o gasto que o teto existe pra impedir.
  const restam = await consumirCota(env, owner);
  if (restam === null) {
    return jsonResponse(
      { error: `Você já gerou ${TETO_DIARIO} legendas hoje. O contador volta amanhã.` },
      429
    );
  }

  // O pilar entra pelo NOME, não pelo id: quem lê o prompt é um modelo de linguagem, e "bastidores"
  // diz algo que um uuid não diz. Filtrado por dono pra um id de outra pessoa não vazar nome.
  let pilar: string | undefined;
  if (body?.tag_id) {
    const tag = await env.DB.prepare(`select name from tags where id = ? and owner_id = ?`)
      .bind(body.tag_id, owner)
      .first<{ name: string }>();
    pilar = tag?.name;
  }

  const exemplos = await buscarExemplos(env, owner, plataforma, body?.tag_id ?? null);

  try {
    const sugestoes = await gerarLegenda(env, { assunto, plataforma, pilar, exemplos });
    // `usou_historico` alimenta a dica na tela: sem ela, a pessoa não tem como saber por que a
    // sugestão melhora depois que ela publica algumas peças.
    // O `teto` vai junto do `restam` pra tela poder dizer "restam 3 de 20" em vez de "restam 3".
    // Número solto não tem escala (ancoragem, web/design.md) — e mandar o teto daqui evita o front
    // guardar uma cópia do 20 que envelhece calada no dia em que este número mudar.
    return jsonResponse({ sugestoes, restam, teto: TETO_DIARIO, usou_historico: exemplos.length > 0 });
  } catch (err) {
    // A falha foi nossa, então a cota volta: cobrar da pessoa uma unidade por um erro que não foi
    // dela é o tipo de coisa que ela nota (o contador cai sem legenda nenhuma na tela).
    await devolverCota(env, owner);
    if (err instanceof SemIA) {
      console.error('[legenda]', err.message);
      return jsonResponse({ error: 'Não consegui gerar agora. Tente de novo em alguns segundos.' }, 502);
    }
    throw err;
  }
}

async function listTags(owner: string, env: Env): Promise<Response> {
  // O `uso` é o que permite a tela dizer "este pilar tem 3 peças" antes de você apagá-lo — e
  // ordenar por ele põe na frente o que você realmente usa.
  const { results } = await env.DB.prepare(
    `select t.id, t.name, t.color,
            (select count(*) from scheduled_posts sp where sp.tag_id = t.id) +
            (select count(*) from grid_previews gp where gp.tag_id = t.id) as uso
       from tags t
      where t.owner_id = ?
      order by uso desc, lower(t.name) asc`
  )
    .bind(owner)
    .all<Record<string, unknown>>();
  return jsonResponse({ tags: results ?? [] });
}

async function createTag(request: Request, owner: string, env: Env): Promise<Response> {
  let payload: { name?: string; color?: string };
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: 'JSON inválido' }, 400);
  }
  const name = payload.name?.trim();
  if (!name) return jsonResponse({ error: 'dê um nome ao pilar' }, 400);
  if (name.length > MAX_TAG_NAME) return jsonResponse({ error: `no máximo ${MAX_TAG_NAME} caracteres` }, 400);
  const color = payload.color && TAG_COLORS.includes(payload.color) ? payload.color : TAG_COLORS[0];

  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(`insert into tags (id, owner_id, name, color) values (?, ?, ?, ?)`)
      .bind(id, owner, name, color)
      .run();
  } catch (err) {
    // O índice único é normalizado (lower+trim), então isto pega "Viagem" contra " viagem ". Devolve
    // a que já existe em vez de um erro: quem digitou o mesmo nome queria o mesmo pilar.
    if (String(err).includes('UNIQUE')) {
      const existente = await env.DB.prepare(
        `select id, name, color from tags where owner_id = ? and lower(trim(name)) = lower(trim(?))`
      )
        .bind(owner, name)
        .first<Record<string, unknown>>();
      if (existente) return jsonResponse(existente, 200);
    }
    throw err;
  }
  return jsonResponse({ id, name, color, uso: 0 }, 201);
}

async function updateTag(id: string, request: Request, owner: string, env: Env): Promise<Response> {
  let payload: { name?: string; color?: string };
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: 'JSON inválido' }, 400);
  }
  const sets: string[] = [];
  const params: unknown[] = [];
  if (payload.name !== undefined) {
    const name = payload.name.trim();
    if (!name) return jsonResponse({ error: 'dê um nome ao pilar' }, 400);
    if (name.length > MAX_TAG_NAME) return jsonResponse({ error: `no máximo ${MAX_TAG_NAME} caracteres` }, 400);
    sets.push('name = ?');
    params.push(name);
  }
  if (payload.color !== undefined) {
    if (!TAG_COLORS.includes(payload.color)) return jsonResponse({ error: 'cor inválida' }, 400);
    sets.push('color = ?');
    params.push(payload.color);
  }
  if (sets.length === 0) return jsonResponse({ error: 'nada para atualizar' }, 400);

  try {
    const { results } = await env.DB.prepare(
      `update tags set ${sets.join(', ')} where id = ? and owner_id = ? returning id, name, color`
    )
      .bind(...params, id, owner)
      .all<Record<string, unknown>>();
    if ((results?.length ?? 0) === 0) return jsonResponse({ error: 'pilar não encontrado' }, 404);
    return jsonResponse(results![0]);
  } catch (err) {
    if (String(err).includes('UNIQUE')) return jsonResponse({ error: 'já existe um pilar com esse nome' }, 409);
    throw err;
  }
}

/**
 * Apagar o pilar NÃO apaga as peças dele — o `on delete set null` das duas tabelas as devolve a
 * "sem pilar". Perder um post porque a pessoa arrumou a lista de pilares seria uma troca absurda.
 */
async function deleteTag(id: string, owner: string, env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(`delete from tags where id = ? and owner_id = ? returning id`)
    .bind(id, owner)
    .all<{ id: string }>();
  if ((results?.length ?? 0) === 0) return jsonResponse({ error: 'pilar não encontrado' }, 404);
  return jsonResponse({ ok: true });
}

/**
 * Valida que a tag existe e é deste dono, devolvendo o id ou `null`.
 *
 * Sem esta checagem, mandar o id da tag de outra pessoa gravaria a referência: o post não vazaria,
 * mas apareceria agrupado sob um pilar que o dono não criou nem consegue ver — um fantasma no
 * próprio Insights.
 */
async function resolveTagId(tagId: unknown, owner: string, env: Env): Promise<string | null> {
  if (typeof tagId !== 'string' || !tagId) return null;
  const row = await env.DB.prepare(`select id from tags where id = ? and owner_id = ?`)
    .bind(tagId, owner)
    .first<{ id: string }>();
  return row?.id ?? null;
}

function parseOptionalFloat(value: FormDataEntryValue | null): number | null {
  if (typeof value !== 'string' || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseOptionalInt(value: FormDataEntryValue | null): number | null {
  const n = parseOptionalFloat(value);
  return n === null ? null : Math.round(n);
}

async function cancelTarget(targetId: string, owner: string, env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    // post_targets não tem owner_id — o escopo vem do post pai. Sem esta subquery, um id de
    // destino de OUTRO dono seria cancelado por quem soubesse o uuid.
    `update post_targets set status = 'canceled', updated_at = ? where id = ? and status in ('draft','queued') and scheduled_post_id in (select id from scheduled_posts where owner_id = ?) returning id`
  )
    .bind(nowIso(), targetId, owner)
    .all<{ id: string }>();

  if ((results?.length ?? 0) === 0) {
    return jsonResponse({ error: 'não é possível cancelar: já está publicando/publicado, ou o post não existe' }, 409);
  }
  return jsonResponse({ ok: true });
}

// Cancelado/falhou volta pra rascunho, e não pra fila: a data original pode já ter passado e o
// poller publicaria na próxima varredura. De rascunho, a pessoa escolhe a data e manda pra fila.
async function reactivateTarget(targetId: string, owner: string, env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `update post_targets set status = 'draft', last_error = null, attempt_count = 0, updated_at = ?
       where id = ? and status in ('canceled','failed','ambiguous') and scheduled_post_id in (select id from scheduled_posts where owner_id = ?) returning id`
  )
    .bind(nowIso(), targetId, owner)
    .all<{ id: string }>();

  if ((results?.length ?? 0) === 0) {
    return jsonResponse({ error: 'só dá pra reativar o que foi cancelado ou falhou' }, 409);
  }
  return jsonResponse({ ok: true });
}

// Apaga um destino de vez. Se era o último do post, o post vai junto — senão sobra uma linha em
// scheduled_posts sem destino nenhum, invisível na interface e impossível de limpar depois.
async function deleteTarget(targetId: string, owner: string, env: Env): Promise<Response> {
  // O join com scheduled_posts é o escopo de dono: destino de outro dono não é encontrado (404),
  // e o delete abaixo nunca chega a rodar.
  const row = await env.DB.prepare(
    `select pt.scheduled_post_id, pt.status from post_targets pt
       join scheduled_posts sp on sp.id = pt.scheduled_post_id
      where pt.id = ? and sp.owner_id = ?`
  )
    .bind(targetId, owner)
    .first<{ scheduled_post_id: string; status: string }>();
  if (!row) return jsonResponse({ error: 'destino não encontrado' }, 404);

  // Em voo não dá: o poller já está falando com a plataforma e apagar aqui perderia o rastro do
  // que foi publicado (ou está sendo).
  if (row.status === 'publishing' || row.status === 'processing') {
    return jsonResponse({ error: 'não é possível excluir enquanto está publicando — espere terminar' }, 409);
  }

  // post_target_media tem `on delete cascade` pro destino (0001), então some junto.
  await env.DB.prepare(`delete from post_targets where id = ?`).bind(targetId).run();

  const remaining = await env.DB.prepare(`select count(*) as n from post_targets where scheduled_post_id = ?`)
    .bind(row.scheduled_post_id)
    .first<{ n: number }>();
  const postDeleted = (remaining?.n ?? 0) === 0;
  if (postDeleted) {
    // owner_id redundante aqui (o SELECT acima já provou o dono), mas defesa em profundidade:
    // nenhum DELETE deste arquivo roda sem o dono na cláusula.
    await env.DB.prepare(`delete from scheduled_posts where id = ? and owner_id = ?`)
      .bind(row.scheduled_post_id, owner)
      .run();
  }

  return jsonResponse({ ok: true, post_deleted: postDeleted });
}

async function queueTarget(targetId: string, owner: string, env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `update post_targets set status = 'queued', updated_at = ? where id = ? and status = 'draft' and scheduled_post_id in (select id from scheduled_posts where owner_id = ?) returning id`
  )
    .bind(nowIso(), targetId, owner)
    .all<{ id: string }>();

  if ((results?.length ?? 0) === 0) {
    return jsonResponse({ error: 'não é possível mover para a fila: não está mais em rascunho, ou o post não existe' }, 409);
  }
  return jsonResponse({ ok: true });
}
