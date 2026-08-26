import type { Account, PostTarget } from '../lib/types.js';
import type { Env } from '../lib/env.js';
import { getAccountTokens } from '../lib/tokens.js';
import { fetchWithRetry } from '../lib/http.js';
import { safeParseJson } from '../lib/errors.js';
import type { AccountMetricsSnapshot, MetricsFetcher, PostMetricsSnapshot } from './index.js';

interface YoutubeTokens {
  access_token: string;
}

interface VideosResponse {
  items?: Array<{ statistics?: { viewCount?: string; likeCount?: string; commentCount?: string } }>;
}

interface ChannelsResponse {
  items?: Array<{
    statistics?: {
      subscriberCount?: string;
      viewCount?: string;
      videoCount?: string;
      hiddenSubscriberCount?: boolean;
    };
  }>;
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
    if (!res.ok) {
      // Log em vez de null mudo: foi esse padrão que escondeu a coleta quebrada do Facebook por
      // semanas (ver metrics/facebook.ts). "Vazio" e "quebrado" precisam ser distinguíveis.
      console.error(`[metrics] youtube post ${target.external_post_id}: ${res.status} ${(await res.text()).slice(0, 300)}`);
      return null;
    }
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

  /**
   * Métricas do CANAL: quantos inscritos.
   *
   * Faltava. O YouTube era a única rede com coletor de post e sem coletor de conta, então o gráfico
   * de crescimento de audiência tinha série pro Instagram, Facebook e TikTok, e um buraco aqui —
   * sem erro nenhum, porque o poller simplesmente pula quem não implementa (`if
   * (!fetcher?.fetchAccountMetrics) continue`). Auditoria de 2026-08-06.
   *
   * NÃO exige escopo novo: `channels?part=statistics&mine=true` é coberto pelo `youtube.readonly`
   * que já pedimos, o mesmo do videos?part=statistics acima.
   *
   * `viewCount` (total do canal) e `videoCount` não têm coluna própria em account_metrics, então
   * vão no `raw` — ficam gravados pra um gráfico futuro sem custar uma migração agora.
   */
  async fetchAccountMetrics(account: Account, env: Env): Promise<AccountMetricsSnapshot | null> {
    const tokens = await getAccountTokens<YoutubeTokens>(env.DB, account.id, env.TOKEN_ENCRYPTION_KEY);
    if (!tokens?.access_token) return null;

    const res = await fetchWithRetry(
      'https://www.googleapis.com/youtube/v3/channels?part=statistics&mine=true',
      { method: 'GET', headers: { Authorization: `Bearer ${tokens.access_token}` } }
    );
    if (!res.ok) {
      console.error(`[metrics] youtube canal ${account.display_name}: ${res.status} ${(await res.text()).slice(0, 300)}`);
      return null;
    }
    const parsed = safeParseJson(await res.text()) as ChannelsResponse | undefined;
    const stats = parsed?.items?.[0]?.statistics;
    if (!stats) return null;

    // Canal com contagem de inscritos OCULTA devolve subscriberCount zerado, não ausente. Gravar 0
    // ali desenharia uma queda a pique no gráfico no dia em que a pessoa esconder o número —
    // `undefined` deixa o ponto de fora, que é a leitura honesta de "não sabemos".
    const inscritos = stats.hiddenSubscriberCount ? undefined : toInt(stats.subscriberCount);

    return { followers: inscritos, raw: stats };
  },
};
