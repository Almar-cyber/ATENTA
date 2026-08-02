import type { Account, PostTarget } from '../lib/types.js';
import type { Env } from '../lib/env.js';
import { getAccountTokens } from '../lib/tokens.js';
import { fetchWithRetry } from '../lib/http.js';
import { safeParseJson } from '../lib/errors.js';
import type { MetricsFetcher, PostMetricsSnapshot } from './index.js';

const GRAPH_VERSION = 'v21.0';

interface MetaTokens {
  access_token: string;
}

interface PostFields {
  likes?: { summary?: { total_count?: number } };
  comments?: { summary?: { total_count?: number } };
  shares?: { count?: number };
}

interface InsightsResponse {
  data?: Array<{ name: string; values?: Array<{ value?: number }> }>;
}

// Facebook: engajamento (likes/comments/shares) sai dos campos do próprio post; alcance/impressões
// vêm de /insights, que exige `read_insights` (adicionado em oauth-urls.ts). Duas chamadas, e a de
// insights é tolerante — se o escopo ainda não foi concedido, ainda voltamos likes/comments/shares.
export const facebookMetrics: MetricsFetcher = {
  async fetchPostMetrics(target: PostTarget, account: Account, env: Env): Promise<PostMetricsSnapshot | null> {
    if (!target.external_post_id) return null;
    const tokens = await getAccountTokens<MetaTokens>(env.DB, account.id, env.TOKEN_ENCRYPTION_KEY);
    if (!tokens?.access_token) return null;
    const token = encodeURIComponent(tokens.access_token);
    const id = target.external_post_id;

    const fieldsRes = await fetchWithRetry(
      `https://graph.facebook.com/${GRAPH_VERSION}/${id}?fields=likes.summary(true),comments.summary(true),shares&access_token=${token}`,
      { method: 'GET' }
    );
    const fieldsBody = await fieldsRes.text();
    if (!fieldsRes.ok) return null;
    const fields = safeParseJson(fieldsBody) as PostFields | undefined;
    if (!fields) return null;

    const snapshot: PostMetricsSnapshot = {
      likes: fields.likes?.summary?.total_count,
      comments: fields.comments?.summary?.total_count,
      shares: fields.shares?.count,
      raw: { fields },
    };

    // Insights são opcionais: falha de escopo não invalida o snapshot de engajamento acima.
    try {
      const insRes = await fetchWithRetry(
        `https://graph.facebook.com/${GRAPH_VERSION}/${id}/insights?metric=post_impressions,post_impressions_unique&access_token=${token}`,
        { method: 'GET' }
      );
      if (insRes.ok) {
        const ins = safeParseJson(await insRes.text()) as InsightsResponse | undefined;
        const pick = (n: string) => ins?.data?.find((d) => d.name === n)?.values?.[0]?.value;
        snapshot.impressions = typeof pick('post_impressions') === 'number' ? (pick('post_impressions') as number) : undefined;
        snapshot.reach = typeof pick('post_impressions_unique') === 'number' ? (pick('post_impressions_unique') as number) : undefined;
        (snapshot.raw as { insights?: unknown }).insights = ins?.data;
      }
    } catch {
      // segue só com os campos do post
    }

    return snapshot;
  },
};
