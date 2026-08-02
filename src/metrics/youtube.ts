import type { Account, PostTarget } from '../lib/types.js';
import type { Env } from '../lib/env.js';
import { getAccountTokens } from '../lib/tokens.js';
import { fetchWithRetry } from '../lib/http.js';
import { safeParseJson } from '../lib/errors.js';
import type { MetricsFetcher, PostMetricsSnapshot } from './index.js';

interface YoutubeTokens {
  access_token: string;
}

interface VideosResponse {
  items?: Array<{ statistics?: { viewCount?: string; likeCount?: string; commentCount?: string } }>;
}

const toInt = (s: string | undefined): number | undefined => {
  if (s === undefined) return undefined;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : undefined;
};

// YouTube básico via Data API. Diferente de IG/FB, NÃO precisa de escopo novo — o `youtube.readonly`
// que já pedimos cobre `videos?part=statistics`. Watch time/retenção (Analytics API) ficam pra
// depois (exigem `yt-analytics.readonly`). O token é mantido fresco pelo stepTokenHealthScan, que
// roda antes da coleta no poller.
export const youtubeMetrics: MetricsFetcher = {
  async fetchPostMetrics(target: PostTarget, account: Account, env: Env): Promise<PostMetricsSnapshot | null> {
    if (!target.external_post_id) return null;
    const tokens = await getAccountTokens<YoutubeTokens>(env.DB, account.id, env.TOKEN_ENCRYPTION_KEY);
    if (!tokens?.access_token) return null;

    const res = await fetchWithRetry(
      `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${encodeURIComponent(target.external_post_id)}`,
      { method: 'GET', headers: { Authorization: `Bearer ${tokens.access_token}` } }
    );
    if (!res.ok) return null;
    const parsed = safeParseJson(await res.text()) as VideosResponse | undefined;
    const stats = parsed?.items?.[0]?.statistics;
    if (!stats) return null;

    return {
      video_views: toInt(stats.viewCount),
      likes: toInt(stats.likeCount),
      comments: toInt(stats.commentCount),
      raw: stats,
    };
  },
};
