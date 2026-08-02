import type { Account, PostTarget } from '../lib/types.js';
import type { Env } from '../lib/env.js';
import { getAccountTokens } from '../lib/tokens.js';
import { fetchWithRetry } from '../lib/http.js';
import { safeParseJson } from '../lib/errors.js';
import type { MetricsFetcher, PostMetricsSnapshot } from './index.js';

interface TikTokTokens {
  access_token: string;
}

interface VideoQueryResponse {
  data?: {
    videos?: Array<{
      id: string;
      view_count?: number;
      like_count?: number;
      comment_count?: number;
      share_count?: number;
    }>;
  };
}

// Métricas do TikTok via /v2/video/query/. Exige o escopo `video.list` (adicionado em
// oauth-urls.ts). Enquanto a auditoria da Content Posting API não aprovar, os posts saem
// SELF_ONLY e a query mesmo assim devolve as métricas deles pra dona da conta.
export const tiktokMetrics: MetricsFetcher = {
  async fetchPostMetrics(target: PostTarget, account: Account, env: Env): Promise<PostMetricsSnapshot | null> {
    if (!target.external_post_id) return null;
    const tokens = await getAccountTokens<TikTokTokens>(env.DB, account.id, env.TOKEN_ENCRYPTION_KEY);
    if (!tokens?.access_token) return null;

    // POST com filtro por id + fields no query string: é o formato documentado pela Content
    // Posting API (não é REST puro, mas é o que a API aceita).
    const url = `https://open.tiktokapis.com/v2/video/query/?fields=id,view_count,like_count,comment_count,share_count`;
    const res = await fetchWithRetry(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ filters: { video_ids: [target.external_post_id] } }),
    });
    if (!res.ok) return null; // sem escopo/aprovação ainda — pula sem derrubar a varredura
    const parsed = safeParseJson(await res.text()) as VideoQueryResponse | undefined;
    const video = parsed?.data?.videos?.[0];
    if (!video) return null;

    return {
      video_views: video.view_count,
      likes: video.like_count,
      comments: video.comment_count,
      shares: video.share_count,
      raw: video,
    };
  },
};
