// Importação do histórico: traz posts que já estavam na rede social antes do ATENTA!.
//
// A DECISÃO DE MODELAGEM. A tentação era guardar métrica de post antigo numa estrutura à parte,
// tornando post_metrics.post_target_id anulável. Isso exigiria migração, e pior: criaria duas
// espécies de "post publicado" que toda consulta daí pra frente teria que unir — listMetrics, a
// lista, o Grid, os insights.
//
// Em vez disso, o post importado vira um post NORMAL do sistema: scheduled_posts + post_targets com
// status 'published'. Não é gambiarra — ele É um post publicado, e registrá-lo como tal é o que há
// de mais fiel. Zero migração, e tudo que já lê post_targets passa a enxergá-lo de graça.
//
// O que o distingue é `options.imported = true`, pra UI poder dizer "veio da rede, não saiu daqui" e
// pro poller nunca confundi-lo com algo a publicar (ele já nasce 'published').
//
// IDEMPOTÊNCIA: reimportar não duplica. O casamento é por (account_id, external_post_id) — se o
// post já existe, seja porque foi publicado por nós ou porque uma importação anterior o trouxe, só
// as métricas são atualizadas.
import { nowIso } from '../lib/db.js';
import { getAccountTokens } from '../lib/tokens.js';
import { fetchWithRetry } from '../lib/http.js';
import { MEDIA_METRIC_LADDER } from './instagram.js';
import type { Env } from '../lib/env.js';
import type { Account } from '../lib/types.js';

const GRAPH = 'https://graph.facebook.com/v21.0';
const YT = 'https://www.googleapis.com/youtube/v3';
const MAX_PAGES = 12;

export interface ResultadoImportacao {
  conta: string;
  encontrados_na_rede: number;
  ja_existiam: number;
  importados: number;
  com_metrica: number;
  sem_metrica: number;
  mais_antigo_importado: string | null;
}

/** Um post publicado, do jeito que a rede o descreve. */
export interface PostExterno {
  external_id: string;
  publicado_em: string;
  legenda: string;
  url: string | null;
  formato: string | null;
  metricas: Metricas | null;
}

export interface Metricas {
  follows?: number | null;
  profile_visits?: number | null;
  interactions?: number | null;
  impressions?: number | null;
  reach?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  saves?: number | null;
  video_views?: number | null;
  raw: unknown;
}

/**
 * Grava (ou atualiza) os posts externos como posts publicados do dono, com suas métricas.
 *
 * Compartilhado entre as redes de propósito: o que muda de uma pra outra é COMO buscar; o que fazer
 * com o resultado é idêntico, e duplicar essa parte é como as duas implementações divergiriam.
 */
export async function gravar(
  posts: PostExterno[],
  account: Account,
  owner: string,
  env: Env
): Promise<ResultadoImportacao> {
  let jaExistiam = 0;
  let importados = 0;
  let comMetrica = 0;
  const agora = nowIso();
  let maisAntigo: string | null = null;

  for (const post of posts) {
    // O destino pode já existir por dois caminhos: publicamos por aqui, ou uma importação anterior
    // já o trouxe. Nos dois casos o certo é reaproveitar, nunca criar um segundo.
    const existente = await env.DB.prepare(
      `select id from post_targets where account_id = ? and external_post_id = ?`
    )
      .bind(account.id, post.external_id)
      .first<{ id: string }>();

    let targetId = existente?.id;

    if (!targetId) {
      const postId = crypto.randomUUID();
      targetId = crypto.randomUUID();
      await env.DB.prepare(
        `insert into scheduled_posts (id, title, body, scheduled_for, owner_id) values (?, '', ?, ?, ?)`
      )
        .bind(postId, post.legenda, post.publicado_em, owner)
        .run();
      await env.DB.prepare(
        `insert into post_targets
           (id, scheduled_post_id, account_id, platform, status, published_at, external_post_id,
            external_url, options, adapter_state)
         values (?, ?, ?, ?, 'published', ?, ?, ?, ?, '{}')`
      )
        .bind(
          targetId,
          postId,
          account.id,
          account.platform,
          post.publicado_em,
          post.external_id,
          post.url,
          JSON.stringify({ imported: true, format: post.formato })
        )
        .run();
      importados++;
      if (!maisAntigo || post.publicado_em < maisAntigo) maisAntigo = post.publicado_em;
    } else {
      jaExistiam++;
    }

    if (post.metricas) {
      comMetrica++;
      const m = post.metricas;
      await env.DB.prepare(
        `insert into post_metrics
           (id, post_target_id, external_post_id, platform, fetched_at,
            impressions, reach, likes, comments, shares, saves, video_views,
            follows, profile_visits, interactions, raw)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          crypto.randomUUID(),
          targetId,
          post.external_id,
          account.platform,
          agora,
          m.impressions ?? null,
          m.reach ?? null,
          m.likes ?? null,
          m.comments ?? null,
          m.shares ?? null,
          m.saves ?? null,
          m.video_views ?? null,
          m.follows ?? null,
          m.profile_visits ?? null,
          m.interactions ?? null,
          JSON.stringify(m.raw ?? {})
        )
        .run();
    }
  }

  return {
    conta: account.display_name,
    encontrados_na_rede: posts.length,
    ja_existiam: jaExistiam,
    importados,
    com_metrica: comMetrica,
    sem_metrica: posts.length - comMetrica,
    mais_antigo_importado: maisAntigo,
  };
}

// ---------------------------------------------------------------------------
// Instagram
// ---------------------------------------------------------------------------

export async function importInstagram(account: Account, owner: string, env: Env): Promise<ResultadoImportacao> {
  const tokens = await getAccountTokens<{ access_token: string }>(env.DB, account.id, env.TOKEN_ENCRYPTION_KEY);
  if (!tokens?.access_token || !account.external_account_id) throw new Error('conta do Instagram sem token');
  const token = tokens.access_token;

  const brutos: Array<{
    id: string;
    timestamp?: string;
    caption?: string;
    permalink?: string;
    media_type?: string;
  }> = [];
  let next: string | null =
    `${GRAPH}/${account.external_account_id}/media` +
    `?fields=id,timestamp,caption,permalink,media_type&limit=50&access_token=${encodeURIComponent(token)}`;
  let paginas = 0;
  while (next && paginas < MAX_PAGES) {
    const res = await fetchWithRetry(next);
    if (!res.ok) throw new Error(`listagem: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { data?: typeof brutos; paging?: { next?: string } };
    brutos.push(...(json.data ?? []));
    next = json.paging?.next ?? null;
    paginas++;
  }

  const posts: PostExterno[] = [];
  for (const bruto of brutos) {
    posts.push({
      external_id: bruto.id,
      publicado_em: bruto.timestamp ?? nowIso(),
      legenda: bruto.caption ?? '',
      url: bruto.permalink ?? null,
      formato: mapearFormatoIg(bruto.media_type),
      // Post anterior à conversão do perfil pra Business não tem insight NENHUM — o dado nunca foi
      // gerado. Ele entra assim mesmo, sem métrica: a peça existiu e conta na história do feed.
      metricas: await lerInsightsIg(bruto.id, token),
    });
  }
  return gravar(posts, account, owner, env);
}

function mapearFormatoIg(tipo: string | undefined): string | null {
  if (tipo === 'VIDEO') return 'reel';
  if (tipo === 'CAROUSEL_ALBUM' || tipo === 'IMAGE') return 'post';
  return null;
}

async function lerInsightsIg(mediaId: string, token: string): Promise<Metricas | null> {
  try {
    const res = await fetchWithRetry(
      `${GRAPH}/${mediaId}/insights?metric=reach,saved,likes,comments,shares&access_token=${encodeURIComponent(token)}`
    );
    const json = (await res.json()) as {
      data?: Array<{ name: string; values?: Array<{ value: number }> }>;
      error?: unknown;
    };
    if (!res.ok || json.error || !json.data?.length) return null;
    const por = Object.fromEntries(json.data.map((m) => [m.name, m.values?.[0]?.value ?? 0]));
    return {
      reach: por.reach ?? null,
      saves: por.saved ?? null,
      likes: por.likes ?? null,
      comments: por.comments ?? null,
      shares: por.shares ?? null,
      video_views: por.views ?? null,
      follows: por.follows ?? null,
      profile_visits: por.profile_visits ?? null,
      interactions: por.total_interactions ?? null,
      raw: json.data,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// YouTube — sem o portão do Instagram: `statistics` acompanha todo vídeo desde sempre.
// ---------------------------------------------------------------------------

export async function importYoutube(account: Account, owner: string, env: Env): Promise<ResultadoImportacao> {
  const tokens = await getAccountTokens<{ access_token: string }>(env.DB, account.id, env.TOKEN_ENCRYPTION_KEY);
  if (!tokens?.access_token) throw new Error('conta do YouTube sem token');
  const auth = { Authorization: `Bearer ${tokens.access_token}` };

  const canalRes = await fetchWithRetry(`${YT}/channels?part=contentDetails&mine=true`, { headers: auth });
  if (!canalRes.ok) throw new Error(`canal: ${canalRes.status} ${await canalRes.text()}`);
  const canal = (await canalRes.json()) as {
    items?: Array<{ contentDetails?: { relatedPlaylists?: { uploads?: string } } }>;
  };
  const uploads = canal.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) throw new Error('canal sem playlist de uploads');

  const videos = new Map<string, { publicado: string; titulo: string }>();
  let pageToken: string | undefined;
  let paginas = 0;
  do {
    const res = await fetchWithRetry(
      `${YT}/playlistItems?part=snippet,contentDetails&maxResults=50&playlistId=${uploads}` +
        (pageToken ? `&pageToken=${pageToken}` : ''),
      { headers: auth }
    );
    if (!res.ok) throw new Error(`uploads: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as {
      items?: Array<{
        snippet?: { title?: string };
        contentDetails?: { videoId?: string; videoPublishedAt?: string };
      }>;
      nextPageToken?: string;
    };
    for (const item of json.items ?? []) {
      const id = item.contentDetails?.videoId;
      if (!id) continue;
      videos.set(id, {
        publicado: item.contentDetails?.videoPublishedAt ?? nowIso(),
        titulo: item.snippet?.title ?? '',
      });
    }
    pageToken = json.nextPageToken;
    paginas++;
  } while (pageToken && paginas < MAX_PAGES);

  const posts: PostExterno[] = [];
  const ids = [...videos.keys()];
  // 50 por chamada é o teto da API — e também o que evita uma requisição por vídeo.
  for (let i = 0; i < ids.length; i += 50) {
    const lote = ids.slice(i, i + 50);
    const res = await fetchWithRetry(`${YT}/videos?part=statistics&id=${lote.join(',')}`, { headers: auth });
    const json = res.ok
      ? ((await res.json()) as { items?: Array<{ id: string; statistics?: Record<string, string> }> })
      : { items: [] };
    const stats = new Map((json.items ?? []).map((v) => [v.id, v.statistics]));
    for (const id of lote) {
      const meta = videos.get(id)!;
      const s = stats.get(id);
      posts.push({
        external_id: id,
        publicado_em: meta.publicado,
        legenda: meta.titulo,
        url: `https://www.youtube.com/watch?v=${id}`,
        formato: 'video',
        metricas: s
          ? {
              video_views: Number(s.viewCount) || 0,
              likes: Number(s.likeCount) || 0,
              comments: Number(s.commentCount) || 0,
              raw: s,
            }
          : null,
      });
    }
  }
  return gravar(posts, account, owner, env);
}
