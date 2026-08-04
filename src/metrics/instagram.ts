import type { Account, PostTarget } from '../lib/types.js';
import type { Env } from '../lib/env.js';
import { getAccountTokens } from '../lib/tokens.js';
import { fetchWithRetry } from '../lib/http.js';
import { safeParseJson } from '../lib/errors.js';
import type { MetricsFetcher, PostMetricsSnapshot, AccountMetricsSnapshot } from './index.js';

const GRAPH_VERSION = 'v21.0';

// Métricas de mídia do Instagram. Precisa do escopo `instagram_manage_insights` — sem ele a API
// devolve erro de permissão e a coleta pula (null), que foi o defeito silencioso que deixou o
// post_metrics zerado por semanas (ver src/lib/scopes.ts).
//
// `views`, `follows` e `profile_visits` são o que faz o painel sair de "quantos curtiram" pra "o que
// esse post rendeu": quantos seguidores ele trouxe e quantos foram ver o perfil por causa dele.
//
// ESCADA, não uma lista só: o vocabulário de insights do Instagram muda por tipo de mídia e por
// época, e UM nome inválido derruba a chamada INTEIRA com "(#100) Invalid parameter" — mesmo que
// todas as outras métricas do pedido estivessem disponíveis. Sem descer degraus, adicionar uma
// métrica nova quebraria a coleta das antigas em silêncio, que é exatamente o tipo de falha muda que
// este arquivo já produziu uma vez.
/**
 * Reel e Story falam outro dialeto.
 *
 * `ig_reels_avg_watch_time` não existe em foto; `navigation` (avanços, voltas, saídas) e `replies`
 * só existem em Story. Pedir tudo junto derruba a chamada inteira com "(#100) Invalid parameter",
 * então cada formato tem a própria escada — e todas caem na escada de feed no último degrau, que é
 * o denominador comum.
 */
export const REEL_METRIC_LADDER = [
  'reach,likes,comments,saved,shares,total_interactions,views,ig_reels_avg_watch_time,ig_reels_video_view_total_time,clips_replays_count',
  'reach,likes,comments,saved,shares,views,ig_reels_avg_watch_time',
  'reach,likes,comments,saved,shares,views',
];

export const STORY_METRIC_LADDER = [
  'reach,views,replies,navigation,profile_visits,follows',
  'reach,views,replies,navigation',
  'reach,replies',
  'reach',
];

export const MEDIA_METRIC_LADDER = [
  'reach,likes,comments,saved,shares,total_interactions,views,follows,profile_visits',
  'reach,likes,comments,saved,shares,total_interactions,views',
  'reach,likes,comments,saved,shares,total_interactions',
  'reach,likes,comments,saved,shares',
  'reach',
];

interface MetaTokens {
  access_token: string;
}

interface InsightsResponse {
  data?: Array<{ name: string; values?: Array<{ value?: number }> }>;
  error?: unknown;
}

function pick(data: InsightsResponse['data'], name: string): number | undefined {
  const v = data?.find((d) => d.name === name)?.values?.[0]?.value;
  return typeof v === 'number' ? v : undefined;
}

export const instagramMetrics: MetricsFetcher = {
  async fetchPostMetrics(target: PostTarget, account: Account, env: Env): Promise<PostMetricsSnapshot | null> {
    if (!target.external_post_id) return null;
    const tokens = await getAccountTokens<MetaTokens>(env.DB, account.id, env.TOKEN_ENCRYPTION_KEY);
    if (!tokens?.access_token) return null;

    // O formato escolhido no compositor decide o dialeto. Post antigo (sem `format` gravado) cai
    // na escada de feed, que é o comportamento de antes.
    const formato = (target.options as { format?: string } | undefined)?.format;
    const escada =
      formato === 'reel'
        ? [...REEL_METRIC_LADDER, ...MEDIA_METRIC_LADDER]
        : formato === 'story'
          ? [...STORY_METRIC_LADDER, ...MEDIA_METRIC_LADDER]
          : MEDIA_METRIC_LADDER;

    for (const metrics of escada) {
      const url = `https://graph.facebook.com/${GRAPH_VERSION}/${target.external_post_id}/insights?metric=${metrics}&access_token=${encodeURIComponent(tokens.access_token)}`;
      const res = await fetchWithRetry(url, { method: 'GET' });
      const body = await res.text();
      if (!res.ok) continue; // desce um degrau — pode ser só uma métrica indisponível pra esta mídia
      const parsed = safeParseJson(body) as InsightsResponse | undefined;
      if (!parsed?.data?.length) continue;

      return {
        reach: pick(parsed.data, 'reach'),
        likes: pick(parsed.data, 'likes'),
        comments: pick(parsed.data, 'comments'),
        saves: pick(parsed.data, 'saved'),
        shares: pick(parsed.data, 'shares'),
        video_views: pick(parsed.data, 'views') ?? pick(parsed.data, 'plays'),
        follows: pick(parsed.data, 'follows'),
        profile_visits: pick(parsed.data, 'profile_visits'),
        interactions: pick(parsed.data, 'total_interactions'),
        // Reel: a API dá em MILISSEGUNDOS; a coluna é em segundos.
        avg_watch_seconds: (() => {
          const ms = pick(parsed.data, 'ig_reels_avg_watch_time');
          return ms === undefined ? undefined : ms / 1000;
        })(),
        raw: parsed.data,
      };
    }
    // Nenhum degrau respondeu: post anterior à conversão do perfil pra Business (o dado nunca foi
    // gerado) ou falta de escopo. Nos dois casos, pular é o certo — não há o que gravar.
    return null;
  },

  async fetchAccountMetrics(account: Account, env: Env): Promise<AccountMetricsSnapshot | null> {
    if (!account.external_account_id) return null;
    const tokens = await getAccountTokens<MetaTokens>(env.DB, account.id, env.TOKEN_ENCRYPTION_KEY);
    if (!tokens?.access_token) return null;

    const token = encodeURIComponent(tokens.access_token);
    const base = `https://graph.facebook.com/${GRAPH_VERSION}/${account.external_account_id}`;

    const res = await fetchWithRetry(`${base}?fields=followers_count&access_token=${token}`, { method: 'GET' });
    const body = await res.text();
    if (!res.ok) return null;
    const parsed = safeParseJson(body) as { followers_count?: number } | undefined;
    if (!parsed) return null;

    // As duas abaixo são independentes e OPCIONAIS: cada uma falha por conta própria (conta nova
    // demais, público pequeno demais — a Meta esconde demografia de perfil com menos de 100
    // seguidores) sem levar junto a contagem de seguidores, que é o dado que nunca pode faltar.
    const [online, demo, diarias] = await Promise.all([
      fetchOnlineFollowers(base, token),
      fetchDemographics(base, token),
      fetchDailyAccountInsights(base, token),
    ]);

    return {
      followers: parsed.followers_count,
      reach: diarias?.reach,
      profile_views: diarias?.profile_views,
      link_clicks: diarias?.website_clicks,
      online_followers: online,
      demographics: demo,
      raw: parsed,
    };
  },
};

/**
 * Seguidores online por hora do dia.
 *
 * É o dado que transforma "terça-feira foi seu melhor dia" — conclusão tirada da amostra pequena e
 * enviesada dos posts que a pessoa já fez — em "seu público está online terça às 19h", que é
 * comportamento de audiência e não coincidência do que se tentou até agora.
 */
async function fetchOnlineFollowers(base: string, token: string): Promise<Record<string, number> | null> {
  try {
    const res = await fetchWithRetry(`${base}/insights?metric=online_followers&period=lifetime&access_token=${token}`);
    if (!res.ok) return null;
    const json = safeParseJson(await res.text()) as
      | { data?: Array<{ values?: Array<{ value?: Record<string, number> }> }> }
      | undefined;
    // A Meta devolve uma série; o último ponto é o retrato mais recente.
    const valores = json?.data?.[0]?.values;
    const ultimo = valores?.[valores.length - 1]?.value;
    return ultimo && Object.keys(ultimo).length > 0 ? ultimo : null;
  } catch {
    return null;
  }
}

/**
 * Quem segue o perfil: faixa etária, gênero, cidade e país.
 *
 * A Meta trocou o nome dessas métricas ao longo do tempo (audience_* virou follower_demographics com
 * breakdown). Tentamos o vocabulário novo e caímos no antigo — sem isso, a chamada quebraria de um
 * lado ou do outro conforme a versão da API que estiver valendo.
 */
async function fetchDemographics(base: string, token: string): Promise<Record<string, unknown> | null> {
  const tentativas = [
    `${base}/insights?metric=follower_demographics&period=lifetime&metric_type=total_value&breakdown=age,gender&access_token=${token}`,
    `${base}/insights?metric=audience_gender_age,audience_city,audience_country&period=lifetime&access_token=${token}`,
  ];
  for (const url of tentativas) {
    try {
      const res = await fetchWithRetry(url);
      if (!res.ok) continue;
      const json = safeParseJson(await res.text()) as { data?: unknown[] } | undefined;
      if (json?.data?.length) return json as Record<string, unknown>;
    } catch {
      /* tenta o próximo vocabulário */
    }
  }
  return null;
}

/**
 * Alcance, visitas ao perfil e cliques no link — do dia.
 *
 * As colunas `reach` e `profile_views` de account_metrics existiam desde a primeira migração de
 * métricas e nunca foram preenchidas: o coletor só buscava followers_count. `website_clicks` é o
 * que fecha o ciclo — alcance diz quantos viram, engajamento quantos reagiram, e o clique quantos
 * SAÍRAM da rede pra ir aonde a pessoa queria.
 */
async function fetchDailyAccountInsights(
  base: string,
  token: string
): Promise<{ reach?: number; profile_views?: number; website_clicks?: number } | null> {
  // Escada aqui também: a Meta aposentou métricas de conta ao longo do tempo (impressions saiu,
  // views entrou), e um nome inválido derruba o pedido inteiro.
  for (const metric of ['reach,profile_views,website_clicks', 'reach,profile_views', 'reach']) {
    try {
      const res = await fetchWithRetry(`${base}/insights?metric=${metric}&period=day&access_token=${token}`);
      if (!res.ok) continue;
      const json = safeParseJson(await res.text()) as InsightsResponse | undefined;
      if (!json?.data?.length) continue;
      return {
        reach: pick(json.data, 'reach'),
        profile_views: pick(json.data, 'profile_views'),
        website_clicks: pick(json.data, 'website_clicks'),
      };
    } catch {
      /* próximo degrau */
    }
  }
  return null;
}
