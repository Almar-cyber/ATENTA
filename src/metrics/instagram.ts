import type { Account, PostTarget } from '../lib/types.js';
import type { Env } from '../lib/env.js';
import { getAccountTokens } from '../lib/tokens.js';
import { fetchWithRetry } from '../lib/http.js';
import { safeParseJson } from '../lib/errors.js';
import type { MetricsFetcher, PostMetricsSnapshot, AccountMetricsSnapshot } from './index.js';

const GRAPH_VERSION = 'v21.0';

// Métricas de mídia do Instagram. Precisa do escopo `instagram_manage_insights` (adicionado em
// oauth-urls.ts) — sem ele a API devolve erro de permissão, e a coleta apenas pula (null).
// `impressions` foi descontinuada pra mídia nova; pedimos as que valem pro núcleo normalizado.
const MEDIA_METRICS = 'reach,likes,comments,saved,shares,total_interactions';

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

    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${target.external_post_id}/insights?metric=${MEDIA_METRICS}&access_token=${encodeURIComponent(tokens.access_token)}`;
    const res = await fetchWithRetry(url, { method: 'GET' });
    const body = await res.text();
    if (!res.ok) return null; // sem escopo/insight ainda — pula sem derrubar a varredura
    const parsed = safeParseJson(body) as InsightsResponse | undefined;
    if (!parsed?.data) return null;

    return {
      reach: pick(parsed.data, 'reach'),
      likes: pick(parsed.data, 'likes'),
      comments: pick(parsed.data, 'comments'),
      saves: pick(parsed.data, 'saved'),
      shares: pick(parsed.data, 'shares'),
      video_views: pick(parsed.data, 'views') ?? pick(parsed.data, 'plays'),
      raw: parsed.data,
    };
  },

  async fetchAccountMetrics(account: Account, env: Env): Promise<AccountMetricsSnapshot | null> {
    if (!account.external_account_id) return null;
    const tokens = await getAccountTokens<MetaTokens>(env.DB, account.id, env.TOKEN_ENCRYPTION_KEY);
    if (!tokens?.access_token) return null;

    // followers_count é campo do IG user; reach/profile_views vêm de /insights (period=day).
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${account.external_account_id}?fields=followers_count&access_token=${encodeURIComponent(tokens.access_token)}`;
    const res = await fetchWithRetry(url, { method: 'GET' });
    const body = await res.text();
    if (!res.ok) return null;
    const parsed = safeParseJson(body) as { followers_count?: number } | undefined;
    if (!parsed) return null;
    return { followers: parsed.followers_count, raw: parsed };
  },
};
