import { adapters } from './adapters/index.js';
import { handleApiRequest } from './api.js';
import { renderPrivacyPolicy, renderTermsOfService } from './legalPages.js';
import { nowIso, rowToAccount, rowToMediaAsset, rowToPostTarget } from './lib/db.js';
import { checkDashboardAuth } from './lib/auth.js';
import { encryptJSON } from './lib/crypto.js';
import { fetchWithRetry } from './lib/http.js';
import { notify } from './lib/notify.js';
import { metricsFetchers } from './metrics/index.js';
import { nextMetricsAt } from './metrics/cadence.js';
import type { PostMetricsSnapshot } from './metrics/index.js';
import { OAUTH_STATE_COOKIE, clearStateCookie, decodeState, getCookie } from './lib/oauth-state.js';
import { SINGLE_OPERATOR } from './lib/identity.js';
import type { Env } from './lib/env.js';
import type { Account, ErrorClass, MediaAsset, PlatformAdapter, Platform, PostTarget, PublishResult } from './lib/types.js';

const CLAIM_BATCH_SIZE = 5;
const PROCESSING_RECHECK_BATCH_SIZE = 10;
const PUBLISHING_STALE_MINUTES = 30;
const PROCESSING_TIMEOUT_HOURS = 6;
const MAX_ATTEMPTS = 5;

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runPoller(env));
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // NOTA: forçar HTTPS fica no toggle "Always Use HTTPS" da zona (SSL/TLS → Edge Certificates no
    // dashboard), não aqui. Tentar redirecionar no Worker pegava o `wrangler dev` junto — ele
    // apresenta o host como atenta.omangue.co (por causa da rota custom), então não dá pra
    // distinguir dev de produção pelo host, e o redirect quebrava o desenvolvimento local.

    // Unauthenticated: these are cross-site redirects landing here straight from each platform's
    // consent screen, not a browser tab that's already presented dashboard credentials.
    const oauthMatch = /^\/oauth\/callback\/(linkedin|meta|pinterest|tiktok|youtube)$/.exec(url.pathname);
    if (oauthMatch) {
      return handleOAuthCallback(oauthMatch[1] as OAuthCallbackPlatform, request, url, env);
    }

    // Unauthenticated: platform app-review processes (Pinterest, TikTok, ...) fetch this
    // directly, with no way to present dashboard credentials. Accepts an optional trailing
    // segment (e.g. /privacy/almar) — some app-review forms require the company/app name to
    // literally appear in the URL to prove ownership; the suffix is otherwise ignored.
    if (/^\/privacy(\/.*)?$/.test(url.pathname)) {
      return new Response(await renderPrivacyPolicy(env), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
    if (/^\/terms(\/.*)?$/.test(url.pathname)) {
      return new Response(await renderTermsOfService(env), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    const authError = checkDashboardAuth(request, env);
    if (authError) return authError;

    if (url.pathname.startsWith('/api/')) {
      return handleApiRequest(request, url, env);
    }

    // Everything else is the React SPA (web/ → dist/), served by the assets binding. With
    // not_found_handling = "single-page-application", unknown paths return index.html.
    return env.ASSETS.fetch(request);
  },
};

// Cron entrypoint. NOTE: unlike the original GitHub Actions design, Cron Triggers have no
// built-in "run failed" email — failures here only show up in `wrangler tail` / the dashboard
// Logs tab. TODO (Phase 1+): push failures to a free webhook (e.g. a Discord/ntfy.sh URL) if you
// want push alerting instead of checking logs manually.
async function runPoller(env: Env): Promise<void> {
  await stepTokenHealthScan(env);
  await stepClaimAndPublishDue(env);
  await stepRecheckProcessing(env);
  await stepSweeps(env);
  // Coleta de métricas é estritamente secundária à publicação: qualquer erro dela (schema, rede,
  // etc.) fica contido aqui e nunca derruba as etapas de publish acima.
  try {
    await stepCollectMetrics(env);
    await stepCollectAccountMetrics(env);
  } catch (err) {
    console.error('[metrics] coleta falhou:', err);
  }
  // Também secundária: limpar mídia velha nunca pode impedir uma publicação.
  try {
    await stepPurgeOldMedia(env);
  } catch (err) {
    console.error('[purge] limpeza de mídia falhou:', err);
  }
}

// Mídia de post publicado só ocupa espaço: o arquivo já está na rede social, e é de lá que a
// grade/preview do publicado carrega. Sem esta limpeza o R2 cresce pra sempre e o free tier (10 GB)
// vira o teto de usuários; com ela, o storage estabiliza no que foi publicado nos últimos dias.
//
// Os metadados (mime, dimensões, duração) FICAM — só o objeto no R2 e o public_url somem, então a
// listagem continua funcionando e o Thumb cai no glyph de fallback.
const MEDIA_RETENTION_DAYS = 30;
const PURGE_BATCH = 20;

async function stepPurgeOldMedia(env: Env): Promise<void> {
  const cutoff = new Date(Date.now() - MEDIA_RETENTION_DAYS * 24 * 3_600_000).toISOString();
  const { results } = await env.DB.prepare(
    // Só mídia cujos destinos TODOS já publicaram há mais que a retenção — se o mesmo arquivo ainda
    // está em algum post não publicado (ou numa prévia da grade), ele continua sendo necessário.
    `select ma.id, ma.storage_key from media_assets ma
      where ma.public_url is not null
        and exists (
          select 1 from post_target_media ptm
            join post_targets pt on pt.id = ptm.post_target_id
           where ptm.media_asset_id = ma.id and pt.status = 'published' and pt.published_at < ?
        )
        and not exists (
          select 1 from post_target_media ptm2
            join post_targets pt2 on pt2.id = ptm2.post_target_id
           where ptm2.media_asset_id = ma.id and (pt2.status != 'published' or pt2.published_at >= ?)
        )
        and not exists (select 1 from grid_previews gp where gp.media_asset_id = ma.id)
      limit ?`
  )
    .bind(cutoff, cutoff, PURGE_BATCH)
    .all<{ id: string; storage_key: string }>();

  for (const row of results ?? []) {
    try {
      await env.MEDIA.delete(row.storage_key);
      // public_url = null é o que marca "já foi limpa" e tira a linha da próxima varredura.
      await env.DB.prepare(`update media_assets set public_url = null where id = ?`).bind(row.id).run();
    } catch (err) {
      console.error(`[purge] ${row.storage_key}:`, err);
    }
  }
}

// Sentinela que remove um destino da fila de coleta pra sempre (rede sem coletor, sem published_at,
// ou passado o horizonte). É uma data absurdamente futura, então nunca volta a ser `<= agora`.
const METRICS_NEVER = '9999-12-31T00:00:00.000Z';
const METRICS_COLLECT_BATCH = 10;

// Step 4 — coleta de métricas dos posts publicados (Fase A, design-analytics.md). Aditivo e
// tolerante: erro de coleta nunca derruba a varredura (mesma regra do notify). A cadência (quão
// espaçado é o próximo snapshot) vem de metrics/cadence.ts pela idade do post.
async function stepCollectMetrics(env: Env): Promise<void> {
  const now = nowIso();
  const { results } = await env.DB.prepare(
    `select pt.* from post_targets pt
     join accounts a on a.id = pt.account_id
     where pt.status = 'published' and a.status = 'active'
       and (pt.next_metrics_at is null or pt.next_metrics_at <= ?)
     order by pt.next_metrics_at asc
     limit ?`
  )
    .bind(now, METRICS_COLLECT_BATCH)
    .all<any>();

  for (const row of results ?? []) {
    const target = rowToPostTarget(row);
    const fetcher = metricsFetchers[target.platform];
    if (!fetcher || !target.published_at) {
      await setNextMetricsAt(env, target.id, METRICS_NEVER);
      continue;
    }
    const account = await getAccount(env, target.account_id);
    if (!account) {
      await setNextMetricsAt(env, target.id, METRICS_NEVER);
      continue;
    }

    try {
      const snap = await fetcher.fetchPostMetrics(target, account, env);
      if (snap) await insertPostMetrics(env, target, snap);
    } catch (err) {
      console.error(`[metrics] ${target.platform}/${target.id} falhou:`, err);
    }

    const next = nextMetricsAt(new Date(target.published_at), new Date(now));
    await setNextMetricsAt(env, target.id, next ?? METRICS_NEVER);
  }
}

async function setNextMetricsAt(env: Env, targetId: string, at: string): Promise<void> {
  await env.DB.prepare(`update post_targets set next_metrics_at = ? where id = ?`).bind(at, targetId).run();
}

// Seguidores mudam devagar — 1 snapshot por dia por conta basta pra ver a tendência de "novos
// seguidores". Coleta se não há snapshot de conta nas últimas ~20h.
const ACCOUNT_METRICS_INTERVAL_HOURS = 20;

async function stepCollectAccountMetrics(env: Env): Promise<void> {
  const cutoff = new Date(Date.now() - ACCOUNT_METRICS_INTERVAL_HOURS * 3_600_000).toISOString();
  const { results } = await env.DB.prepare(
    `select * from accounts a where a.status = 'active'
       and not exists (select 1 from account_metrics m where m.account_id = a.id and m.fetched_at > ?)`
  )
    .bind(cutoff)
    .all<any>();

  for (const row of results ?? []) {
    const account = rowToAccount(row);
    const fetcher = metricsFetchers[account.platform];
    if (!fetcher?.fetchAccountMetrics) continue;
    try {
      const snap = await fetcher.fetchAccountMetrics(account, env);
      if (snap) {
        await env.DB.prepare(
          `insert into account_metrics (id, account_id, fetched_at, followers, reach, profile_views, raw)
           values (?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(
            crypto.randomUUID(),
            account.id,
            nowIso(),
            snap.followers ?? null,
            snap.reach ?? null,
            snap.profile_views ?? null,
            JSON.stringify(snap.raw ?? {})
          )
          .run();
      }
    } catch (err) {
      console.error(`[metrics] conta ${account.platform}/${account.id} falhou:`, err);
    }
  }
}

async function insertPostMetrics(env: Env, target: PostTarget, snap: PostMetricsSnapshot): Promise<void> {
  await env.DB.prepare(
    `insert into post_metrics
       (id, post_target_id, external_post_id, platform, fetched_at,
        impressions, reach, likes, comments, shares, saves, video_views, avg_watch_seconds, raw)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      target.id,
      target.external_post_id ?? '',
      target.platform,
      nowIso(),
      snap.impressions ?? null,
      snap.reach ?? null,
      snap.likes ?? null,
      snap.comments ?? null,
      snap.shares ?? null,
      snap.saves ?? null,
      snap.video_views ?? null,
      snap.avg_watch_seconds ?? null,
      JSON.stringify(snap.raw ?? {})
    )
    .run();
}

// Step 0 — unconditional token-health scan. Runs every invocation, independent of whether
// anything is due, so a quiet platform can't silently sail past its refresh window.
async function stepTokenHealthScan(env: Env): Promise<void> {
  const { results } = await env.DB.prepare(`select * from accounts where status = 'active'`).all<any>();
  for (const row of results ?? []) {
    const account = rowToAccount(row);
    const adapter = adapters[account.platform];
    if (!adapter.needsRefresh(account)) continue;
    try {
      await adapter.ensureFreshToken(account, env);
    } catch (err) {
      console.error(`[token-refresh] ${account.platform}/${account.display_name} failed:`, err);
      await env.DB.prepare(`update accounts set status = 'needs_reauth', updated_at = ? where id = ?`)
        .bind(nowIso(), account.id)
        .run();
      await notify(
        env,
        `🔑 ${account.platform} (${account.display_name}) precisa de reauth — rode o CLI de auth dessa plataforma. Nada será publicado nela até lá.`
      );
    }
  }
}

// Step 1 — claim and publish due posts. Atomic claim via UPDATE ... WHERE status='queued'
// RETURNING id, so two overlapping runs never double-publish.
async function stepClaimAndPublishDue(env: Env): Promise<void> {
  const { results } = await env.DB.prepare(
    // sp.body/sp.title entram no SELECT pra rowToPostTarget resolver a legenda e o título — o
    // adapter só lê target.caption_override/target.title, e a legenda canônica mora em sp.body.
    // next_attempt_at é o backoff de retry (migração 0004): null até o destino falhar a 1ª vez.
    `select pt.*, sp.body, sp.title from post_targets pt
     join accounts a on a.id = pt.account_id
     join scheduled_posts sp on sp.id = pt.scheduled_post_id
     where pt.status = 'queued' and sp.scheduled_for <= ? and a.status = 'active'
       and (pt.next_attempt_at is null or pt.next_attempt_at <= ?)
     order by sp.scheduled_for asc
     limit ?`
  )
    .bind(nowIso(), nowIso(), CLAIM_BATCH_SIZE)
    .all<any>();

  for (const row of results ?? []) {
    const target = rowToPostTarget(row);
    const claimed = await claim(env, target.id, 'queued', 'publishing');
    if (!claimed) continue; // another run already grabbed it

    const account = await getAccount(env, target.account_id);
    if (!account) throw new Error(`account not found: ${target.account_id}`);
    const media = await getMediaForTarget(env, target.id);

    const adapter = adapters[target.platform];
    try {
      try {
        adapter.validate(target, media, account);
      } catch (err) {
        // validate() só olha o target, a mídia e a conta — sem rede, sem relógio. Dadas as mesmas
        // linhas, falha igual toda vez; mandar isso pela escada de retry queimaria as 5 tentativas
        // em 75min pra chegar ao mesmo veredito. Corrigir exige editar o post (ou configurar o
        // domínio do R2) e reenfileirar — por isso é permanente, não retryable.
        await handleFailure(env, target, 'permanent', err instanceof Error ? err.message : String(err));
        continue;
      }
      const result = await adapter.publish(target, media, account, env);
      await applyPublishResult(env, target, result);
    } catch (err) {
      await handlePublishError(env, target, adapter, err);
    }
  }
}

// Step 2 — recheck anything left processing. Processing rows must be actively re-queried here,
// not just assumed to be "picked up again by the next run."
async function stepRecheckProcessing(env: Env): Promise<void> {
  const { results } = await env.DB.prepare(
    // Mesma resolução de legenda/título da query de claim: um retry no meio do processamento
    // recria containers (Instagram), então o target ainda precisa da legenda resolvida aqui também.
    `select pt.*, sp.body, sp.title from post_targets pt
     join accounts a on a.id = pt.account_id
     join scheduled_posts sp on sp.id = pt.scheduled_post_id
     where pt.status = 'processing' and a.status = 'active'
     order by pt.updated_at asc
     limit ?`
  )
    .bind(PROCESSING_RECHECK_BATCH_SIZE)
    .all<any>();

  for (const row of results ?? []) {
    const target = rowToPostTarget(row);
    const account = await getAccount(env, target.account_id);
    if (!account) continue;
    const adapter = adapters[target.platform];
    try {
      const result = await adapter.checkStatus(target, account, env);
      await applyPublishResult(env, target, result);
    } catch (err) {
      await handlePublishError(env, target, adapter, err);
    }
  }
}

// Step 3 — two sweeps: crashed-mid-publish, and processing that never resolves.
async function stepSweeps(env: Env): Promise<void> {
  const publishingCutoff = new Date(Date.now() - PUBLISHING_STALE_MINUTES * 60_000).toISOString();
  await env.DB.prepare(`update post_targets set status = 'queued', updated_at = ? where status = 'publishing' and updated_at < ?`)
    .bind(nowIso(), publishingCutoff)
    .run();

  const processingCutoff = new Date(Date.now() - PROCESSING_TIMEOUT_HOURS * 3_600_000).toISOString();
  const { results: timedOut } = await env.DB.prepare(
    `update post_targets set status = 'failed', last_error = 'timed out waiting on platform processing', updated_at = ?
     where status = 'processing' and updated_at < ? returning platform`
  )
    .bind(nowIso(), processingCutoff)
    .all<{ platform: string }>();

  if (timedOut?.length) {
    const platforms = timedOut.map((r) => r.platform).join(', ');
    await notify(env, `❌ ${timedOut.length} post(s) desistiram esperando o processamento da plataforma: ${platforms}`);
  }
}

async function claim(env: Env, id: string, fromStatus: string, toStatus: string): Promise<boolean> {
  const { results } = await env.DB.prepare(
    `update post_targets set status = ?, updated_at = ? where id = ? and status = ? returning id`
  )
    .bind(toStatus, nowIso(), id, fromStatus)
    .all<{ id: string }>();
  return (results?.length ?? 0) > 0;
}

async function getAccount(env: Env, accountId: string): Promise<Account | null> {
  const row = await env.DB.prepare(`select * from accounts where id = ?`).bind(accountId).first<any>();
  return row ? rowToAccount(row) : null;
}

async function getMediaForTarget(env: Env, postTargetId: string): Promise<MediaAsset[]> {
  const { results } = await env.DB.prepare(
    `select ma.* from post_target_media ptm
     join media_assets ma on ma.id = ptm.media_asset_id
     where ptm.post_target_id = ?
     order by ptm.position asc`
  )
    .bind(postTargetId)
    .all<any>();
  return (results ?? []).map(rowToMediaAsset);
}

async function applyPublishResult(env: Env, target: PostTarget, result: PublishResult): Promise<void> {
  const ts = nowIso();

  if (result.state === 'published') {
    await env.DB.prepare(
      `update post_targets set status = 'published', external_post_id = ?, external_url = ?, published_at = ?, updated_at = ? where id = ?`
    )
      .bind(result.externalId, result.externalUrl ?? null, ts, ts, target.id)
      .run();
    return;
  }

  if (result.state === 'processing') {
    // updated_at só é carimbado na transição PARA processing, nunca num recheck que a encontra
    // ainda processando. O sweep de 6h mede a idade por essa coluna — bumpá-la a cada 10min
    // empurraria o prazo pra sempre e o sweep nunca dispararia justamente no caso que ele existe
    // pra pegar (um container que travou no processamento da plataforma).
    await env.DB.prepare(
      `update post_targets set status = 'processing', adapter_state = ?,
         updated_at = case when status = 'processing' then updated_at else ? end
       where id = ?`
    )
      .bind(JSON.stringify(result.adapterState ?? target.adapter_state), ts, target.id)
      .run();
    return;
  }

  await handleFailure(env, target, result.class, result.message);
}

async function handlePublishError(env: Env, target: PostTarget, adapter: PlatformAdapter, err: unknown): Promise<void> {
  const errorClass = adapter.classifyError(err);
  const message = err instanceof Error ? err.message : String(err);
  await handleFailure(env, target, errorClass, message);
}

// Error classification (architecture doc): each class maps to a distinct poller action.
async function handleFailure(env: Env, target: PostTarget, errorClass: ErrorClass, message: string): Promise<void> {
  const ts = nowIso();

  if (errorClass === 'auth') {
    // Flip the account directly rather than relying on Step 0 to catch it next run: some
    // adapters (e.g. Meta page tokens, which don't track an expiry) never trip needsRefresh()
    // on their own, so a publish-time auth error is the only signal that ever arrives. Without
    // this, the target would requeue forever against a token that's already dead (auth errors
    // don't increment attempt_count, by design, since they aren't the target's fault).
    await env.DB.prepare(`update accounts set status = 'needs_reauth', updated_at = ? where id = ?`)
      .bind(ts, target.account_id)
      .run();
    await env.DB.prepare(
      `update post_targets set status = 'queued', last_error = ?, next_attempt_at = null, updated_at = ? where id = ?`
    )
      .bind(message, ts, target.id)
      .run();
    await notify(env, `🔑 ${target.platform} precisa de reauth (falha na publicação): ${message}`);
    return;
  }

  if (errorClass === 'ambiguous') {
    await env.DB.prepare(`update post_targets set status = 'ambiguous', last_error = ?, updated_at = ? where id = ?`)
      .bind(message, ts, target.id)
      .run();
    await notify(env, `⚠️ ${target.platform}: publicação AMBÍGUA, confira na plataforma se saiu. ${message}`);
    return;
  }

  if (errorClass === 'permanent') {
    await env.DB.prepare(`update post_targets set status = 'failed', last_error = ?, updated_at = ? where id = ?`)
      .bind(message, ts, target.id)
      .run();
    await notify(env, `❌ ${target.platform}: falhou definitivamente. ${message}`);
    return;
  }

  // retryable or quota
  const attemptCount = target.attempt_count + 1;
  if (attemptCount >= MAX_ATTEMPTS) {
    await env.DB.prepare(`update post_targets set status = 'failed', last_error = ?, attempt_count = ?, updated_at = ? where id = ?`)
      .bind(message, attemptCount, ts, target.id)
      .run();
    await notify(env, `❌ ${target.platform}: desistiu após ${attemptCount} tentativas. ${message}`);
    return;
  }

  // O backoff vai em post_targets.next_attempt_at (migração 0004), NÃO em scheduled_posts.scheduled_for:
  // scheduled_for é o horário que você escolheu e é compartilhado por todos os destinos do post, então
  // atrasar um destino que falhou ali empurraria os irmãos junto. A versão anterior escrevia numa
  // coluna post_targets.scheduled_for que nunca existiu — o UPDATE estourava dentro do handler de
  // falha e o retry nunca rodava.
  // TODO (per adapter, Phase 1+): use the platform's real quota-reset boundary instead of a flat 24h.
  const delayMs = errorClass === 'quota' ? 24 * 3_600_000 : 15 * 60_000;
  const nextAttemptAt = new Date(Date.now() + delayMs).toISOString();
  await env.DB.prepare(
    `update post_targets set status = 'queued', last_error = ?, attempt_count = ?, next_attempt_at = ?, updated_at = ? where id = ?`
  )
    .bind(message, attemptCount, nextAttemptAt, ts, target.id)
    .run();
}

// OAuth callback — LinkedIn, Meta, Pinterest, TikTok only (their dev consoles require a
// registered HTTPS redirect_uri with no loopback exception). YouTube uses the local loopback
// flow instead (see adapters/youtube.ts + cli/youtube-auth.ts), so it never hits this Worker.
type OAuthCallbackPlatform = 'linkedin' | 'meta' | 'pinterest' | 'tiktok' | 'youtube';

// Campos que cada provedor usa pra reportar recusa no redirect (OAuth 2.0 padrão + os próprios do
// TikTok e da Meta). É daqui que sai o motivo quando a autorização falha.
const OAUTH_ERROR_FIELDS = ['error', 'error_description', 'error_reason', 'error_code', 'errCode', 'log_id'] as const;

/** Resumo legível de uma recusa reportada pelo provedor, ou null se não houver. */
function describeProviderError(platform: string, url: URL): string | null {
  const detail = OAUTH_ERROR_FIELDS.map((field) => {
    const value = url.searchParams.get(field);
    return value ? `${field}=${value}` : null;
  })
    .filter((entry) => entry !== null)
    .join(' | ');
  return detail ? `${platform} recusou a autorização: ${detail}` : null;
}

/** A query com o `code` redigido — é uma credencial de curta duração e não pode ir pra tela nem log. */
function safeQuery(url: URL): string {
  const params = new URLSearchParams(url.search);
  if (params.has('code')) params.set('code', '<redacted>');
  return params.toString() || '(nenhum)';
}

async function handleOAuthCallback(platform: OAuthCallbackPlatform, request: Request, url: URL, env: Env): Promise<Response> {
  // Checa uma recusa reportada pelo provedor ANTES de procurar o ?code=. Ao recusar a autorização,
  // todos esses provedores redirecionam de volta com o motivo na query e SEM code — responder um
  // "missing ?code=" seco jogava fora a única explicação disponível, que era exatamente o que
  // deixava a falha do TikTok impossível de diagnosticar.
  const providerError = describeProviderError(platform, url);
  if (providerError) {
    console.error(`[oauth/${platform}] ${providerError}`);
    return new Response(providerError, { status: 400 });
  }

  const code = url.searchParams.get('code');
  if (!code) {
    // Sem code e sem erro reconhecido: despeja o que chegou, pra um nome de parâmetro inesperado
    // não se esconder do mesmo jeito.
    return new Response(
      `${platform}: callback sem ?code= e sem erro reconhecido. Parâmetros recebidos: ${safeQuery(url)}`,
      { status: 400 }
    );
  }

  // Sem isto, qualquer exceção aqui vira a página "Error 1101 — Worker threw exception" da
  // Cloudflare, que não diz nada e ainda por cima aparece DEPOIS do consentimento, quando a pessoa
  // já autorizou. Devolve o motivo.
  try {
    if (platform === 'linkedin') return await handleLinkedinCallback(code, request, url, env);
    if (platform === 'meta') return await handleMetaCallback(code, request, url, env);
    if (platform === 'pinterest') return await handlePinterestCallback(code, request, url, env);
    if (platform === 'tiktok') return await handleTiktokCallback(code, request, url, env);
    if (platform === 'youtube') return await handleYoutubeCallback(code, request, url, env);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`oauth callback ${platform} falhou:`, detail);
    return new Response(`Falha ao conectar ${platform}: ${detail}`, {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  return new Response(`${platform} OAuth callback not implemented yet — see phased roadmap`, { status: 501 });
}

// Valida o `state`. Fluxo pelo navegador (endpoint /api/connect) manda `{ n: nonce }` e um cookie
// oauth_state igual — comparamos os dois (CSRF). Fluxo antigo do CLI manda `{ displayName }` sem
// cookie — aceito e usado como nome de fallback. Retorna o nome de fallback, ou uma Response de erro.
function checkState(request: Request, url: URL): { fallbackName?: string; owner?: string } | Response {
  const parsed = decodeState(url.searchParams.get('state'));
  if (parsed.n) {
    const cookie = getCookie(request, OAUTH_STATE_COOKIE);
    if (!cookie || cookie !== parsed.n) return new Response('state inválido (csrf)', { status: 400 });
    // `o` é o dono que iniciou a conexão (gravado por /api/connect). O callback vem da plataforma,
    // sem sessão nossa — é o state que diz de quem é a conta que está sendo conectada.
    return { owner: parsed.o };
  }
  if (parsed.displayName) return { fallbackName: parsed.displayName };
  return new Response('missing ?state=', { status: 400 });
}

// Sucesso: volta pro SPA (`/?connected=<plataforma>`), que abre o modal de "conta conectada".
// Limpa o cookie de state de quebra.
function connectedRedirect(url: URL, platform: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: `${url.origin}/?connected=${encodeURIComponent(platform)}`, 'Set-Cookie': clearStateCookie() },
  });
}

// O nome é puxado do próprio LinkedIn (userinfo.name); o `state` só carrega o nonce de CSRF (fluxo
// pelo app) ou um displayName de fallback (fluxo antigo do CLI).
async function handleLinkedinCallback(code: string, request: Request, url: URL, env: Env): Promise<Response> {
  const checked = checkState(request, url);
  if (checked instanceof Response) return checked;

  // Must match the redirect_uri used to request `code` exactly (LinkedIn requires an exact match).
  const redirectUri = `${url.origin}${url.pathname}`;

  const tokenRes = await fetchWithRetry('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: env.LINKEDIN_CLIENT_ID,
      client_secret: env.LINKEDIN_CLIENT_SECRET,
      redirect_uri: redirectUri,
    }),
  });
  if (!tokenRes.ok) {
    return new Response(`linkedin token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`, { status: 502 });
  }
  const tokenJson = (await tokenRes.json()) as { access_token: string; expires_in: number };

  const userinfoRes = await fetchWithRetry('https://api.linkedin.com/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  if (!userinfoRes.ok) return new Response(`linkedin userinfo failed: ${userinfoRes.status}`, { status: 502 });
  const userinfo = (await userinfoRes.json()) as { sub: string; name?: string };
  const memberUrn = `urn:li:person:${userinfo.sub}`;
  const displayName = userinfo.name || checked.fallbackName || 'LinkedIn';

  const { ciphertext, iv } = await encryptJSON(
    { access_token: tokenJson.access_token, member_urn: memberUrn },
    env.TOKEN_ENCRYPTION_KEY
  );
  const expiresAt = new Date(Date.now() + tokenJson.expires_in * 1000).toISOString();
  await upsertAccount(env, 'linkedin', displayName, memberUrn, ciphertext, iv, nowIso(), {}, expiresAt, checked.owner ?? SINGLE_OPERATOR);

  return connectedRedirect(url, 'linkedin');
}

const GRAPH_VERSION = 'v21.0';

// Conecta TODAS as Pages que o usuário autorizou no consentimento (ele escolhe quais lá) — assim
// dá pra ter, por ex., dois Instagrams. Cada Page vira uma linha 'facebook' e, se tiver Instagram
// Business vinculado, uma linha 'instagram', ambas com o token da própria Page. Nomes puxados da
// API (page.name para o Facebook, username para o Instagram).
async function handleMetaCallback(code: string, request: Request, url: URL, env: Env): Promise<Response> {
  const checked = checkState(request, url);
  if (checked instanceof Response) return checked;

  const redirectUri = `${url.origin}${url.pathname}`;

  const shortLivedRes = await fetchWithRetry(
    `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token?` +
      new URLSearchParams({
        client_id: env.META_APP_ID,
        client_secret: env.META_APP_SECRET,
        redirect_uri: redirectUri,
        code,
      })
  );
  if (!shortLivedRes.ok) {
    return new Response(`meta token exchange failed: ${shortLivedRes.status} ${await shortLivedRes.text()}`, { status: 502 });
  }
  const shortLived = (await shortLivedRes.json()) as { access_token: string };

  const longLivedRes = await fetchWithRetry(
    `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token?` +
      new URLSearchParams({
        grant_type: 'fb_exchange_token',
        client_id: env.META_APP_ID,
        client_secret: env.META_APP_SECRET,
        fb_exchange_token: shortLived.access_token,
      })
  );
  if (!longLivedRes.ok) {
    return new Response(`meta long-lived exchange failed: ${longLivedRes.status} ${await longLivedRes.text()}`, { status: 502 });
  }
  const longLived = (await longLivedRes.json()) as { access_token: string };

  const pagesRes = await fetchWithRetry(
    `https://graph.facebook.com/${GRAPH_VERSION}/me/accounts?access_token=${encodeURIComponent(longLived.access_token)}`
  );
  if (!pagesRes.ok) return new Response(`meta /me/accounts failed: ${pagesRes.status} ${await pagesRes.text()}`, { status: 502 });
  const pagesJson = (await pagesRes.json()) as { data: Array<{ id: string; name: string; access_token: string }> };
  if (pagesJson.data.length === 0) {
    return new Response('nenhuma Page encontrada — confirme que você é admin de uma Page do Facebook', { status: 400 });
  }

  const ts = nowIso();
  for (const page of pagesJson.data) {
    const { ciphertext, iv } = await encryptJSON({ access_token: page.access_token }, env.TOKEN_ENCRYPTION_KEY);
    await upsertAccount(env, 'facebook', page.name, page.id, ciphertext, iv, ts, {}, null, checked.owner ?? SINGLE_OPERATOR);

    const igRes = await fetchWithRetry(
      `https://graph.facebook.com/${GRAPH_VERSION}/${page.id}?fields=instagram_business_account{username}&access_token=${encodeURIComponent(page.access_token)}`
    );
    const igJson = igRes.ok ? ((await igRes.json()) as { instagram_business_account?: { id: string; username?: string } }) : {};
    const ig = igJson.instagram_business_account;
    if (ig?.id) {
      await upsertAccount(env, 'instagram', ig.username || page.name, ig.id, ciphertext, iv, ts, {}, null, checked.owner ?? SINGLE_OPERATOR);
    }
  }

  return connectedRedirect(url, 'meta');
}

// Chaveia por (platform, external_account_id) — várias contas por rede convivem, mas reconectar a
// MESMA conta (mesmo external id) atualiza a linha em vez de duplicar. `access_token_expires_at`
// entra aqui em vez de um UPDATE separado por plataforma (que não servia mais no mundo multi-conta).
async function upsertAccount(
  env: Env,
  platform: Platform,
  displayName: string,
  externalAccountId: string,
  ciphertext: string,
  iv: string,
  ts: string,
  extra: Record<string, unknown> = {},
  expiresAt: string | null = null,
  owner: string = SINGLE_OPERATOR
): Promise<void> {
  // O `and owner_id = ?` mantém contas de donos diferentes separadas mesmo quando é a MESMA conta
  // da rede (duas pessoas podem conectar o mesmo Instagram nas suas próprias áreas).
  const existing =
    (await env.DB.prepare(`select id from accounts where platform = ? and external_account_id = ? and owner_id = ?`)
      .bind(platform, externalAccountId, owner)
      .first<{ id: string }>()) ??
    // Linha antiga criada por CLI, que gravava a conta sem o external id (o YouTube via
    // `npm run youtube-auth` é assim). É a MESMA conta — adota a linha e preenche o id, em vez de
    // tentar inserir uma segunda, que esbarraria no `unique(platform)` de 0001 e derrubava o
    // callback com exceção não tratada (Cloudflare 1101) no meio do fluxo de consentimento.
    (await env.DB.prepare(`select id from accounts where platform = ? and external_account_id is null and owner_id = ?`)
      .bind(platform, owner)
      .first<{ id: string }>());
  const extraJson = JSON.stringify(extra);
  if (existing) {
    await env.DB.prepare(
      `update accounts set display_name = ?, token_ciphertext = ?, token_iv = ?, extra = ?, access_token_expires_at = ?, status = 'active', updated_at = ? where id = ?`
    )
      .bind(displayName, ciphertext, iv, extraJson, expiresAt, ts, existing.id)
      .run();
  } else {
    await env.DB.prepare(
      `insert into accounts (id, platform, display_name, external_account_id, status, token_ciphertext, token_iv, extra, access_token_expires_at, owner_id) values (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`
    )
      .bind(crypto.randomUUID(), platform, displayName, externalAccountId, ciphertext, iv, extraJson, expiresAt, owner)
      .run();
  }
}

// Nome + external id puxados de /v5/user_account (username). Auto-seleciona o primeiro board em
// extra.default_board_id (um post ainda pode sobrescrever com options.board_id).
async function handlePinterestCallback(code: string, request: Request, url: URL, env: Env): Promise<Response> {
  const checked = checkState(request, url);
  if (checked instanceof Response) return checked;

  const redirectUri = `${url.origin}${url.pathname}`;
  const basicAuth = `Basic ${Buffer.from(`${env.PINTEREST_CLIENT_ID}:${env.PINTEREST_CLIENT_SECRET}`).toString('base64')}`;

  const tokenRes = await fetchWithRetry('https://api.pinterest.com/v5/oauth/token', {
    method: 'POST',
    headers: { Authorization: basicAuth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
  });
  if (!tokenRes.ok) return new Response(`pinterest token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`, { status: 502 });
  const tokenJson = (await tokenRes.json()) as { access_token: string; refresh_token: string; expires_in: number };

  const userRes = await fetchWithRetry('https://api.pinterest.com/v5/user_account', {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  const userJson = userRes.ok ? ((await userRes.json()) as { username?: string }) : {};
  const username = userJson.username || checked.fallbackName || 'Pinterest';

  const boardsRes = await fetchWithRetry('https://api.pinterest.com/v5/boards', {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  const boardsJson = boardsRes.ok ? ((await boardsRes.json()) as { items: Array<{ id: string; name: string }> }) : { items: [] };
  const defaultBoard = boardsJson.items[0];

  const { ciphertext, iv } = await encryptJSON(
    { access_token: tokenJson.access_token, refresh_token: tokenJson.refresh_token },
    env.TOKEN_ENCRYPTION_KEY
  );
  const expiresAt = new Date(Date.now() + tokenJson.expires_in * 1000).toISOString();

  await upsertAccount(
    env,
    'pinterest',
    username,
    username, // external id = username (único no Pinterest)
    ciphertext,
    iv,
    nowIso(),
    defaultBoard ? { default_board_id: defaultBoard.id } : {},
    expiresAt,
    checked.owner ?? SINGLE_OPERATOR
  );

  return connectedRedirect(url, 'pinterest');
}

// Nome puxado de /v2/user/info/ (display_name); external id = open_id do token.
async function handleTiktokCallback(code: string, request: Request, url: URL, env: Env): Promise<Response> {
  const checked = checkState(request, url);
  if (checked instanceof Response) return checked;

  const redirectUri = `${url.origin}${url.pathname}`;

  const tokenRes = await fetchWithRetry('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: env.TIKTOK_CLIENT_KEY,
      client_secret: env.TIKTOK_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });
  if (!tokenRes.ok) return new Response(`tiktok token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`, { status: 502 });
  const tokenJson = (await tokenRes.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    open_id: string;
  };

  const infoRes = await fetchWithRetry('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name', {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  const infoJson = infoRes.ok ? ((await infoRes.json()) as { data?: { user?: { display_name?: string } } }) : {};
  const displayName = infoJson.data?.user?.display_name || checked.fallbackName || 'TikTok';

  const { ciphertext, iv } = await encryptJSON(
    { access_token: tokenJson.access_token, refresh_token: tokenJson.refresh_token },
    env.TOKEN_ENCRYPTION_KEY
  );
  const expiresAt = new Date(Date.now() + tokenJson.expires_in * 1000).toISOString();
  await upsertAccount(env, 'tiktok', displayName, tokenJson.open_id, ciphertext, iv, nowIso(), {}, expiresAt, checked.owner ?? SINGLE_OPERATOR);

  return connectedRedirect(url, 'tiktok');
}

// YouTube pelo navegador. O CLI (cli/youtube-auth.ts) usa credencial "Desktop app" com redirect
// loopback, que só funciona na máquina do dono; aqui o app é do tipo "Web application" e o redirect
// aponta pro próprio Worker, igual às outras redes. Grava o mesmo formato de token que o adapter
// espera ({access_token, refresh_token}) e puxa o nome do canal da API.
async function handleYoutubeCallback(code: string, request: Request, url: URL, env: Env): Promise<Response> {
  const checked = checkState(request, url);
  if (checked instanceof Response) return checked;

  const redirectUri = `${url.origin}${url.pathname}`;

  const tokenRes = await fetchWithRetry('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.YOUTUBE_CLIENT_ID,
      client_secret: env.YOUTUBE_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });
  if (!tokenRes.ok) {
    return new Response(`youtube token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`, { status: 502 });
  }
  const tokenJson = (await tokenRes.json()) as { access_token: string; refresh_token?: string; expires_in: number };

  // Sem refresh_token o poller não consegue renovar e a conta morre em 1h. Acontece quando essa
  // conta Google já autorizou o app antes — o jeito é revogar e reconectar.
  if (!tokenJson.refresh_token) {
    return new Response(
      'O Google não devolveu refresh_token. Revogue o acesso em https://myaccount.google.com/permissions e conecte de novo.',
      { status: 400 }
    );
  }

  // Nome e id do canal (o escopo youtube.readonly cobre esta chamada).
  const chRes = await fetchWithRetry('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  const chJson = chRes.ok
    ? ((await chRes.json()) as { items?: Array<{ id: string; snippet?: { title?: string } }> })
    : {};
  const channel = chJson.items?.[0];
  const displayName = channel?.snippet?.title || checked.fallbackName || 'YouTube';

  const { ciphertext, iv } = await encryptJSON(
    { access_token: tokenJson.access_token, refresh_token: tokenJson.refresh_token },
    env.TOKEN_ENCRYPTION_KEY
  );
  const expiresAt = new Date(Date.now() + tokenJson.expires_in * 1000).toISOString();
  await upsertAccount(env, 'youtube', displayName, channel?.id ?? '', ciphertext, iv, nowIso(), {}, expiresAt, checked.owner ?? SINGLE_OPERATOR);

  return connectedRedirect(url, 'youtube');
}
