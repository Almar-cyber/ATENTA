import type { Account, PostTarget } from '../lib/types.js';
import type { Env } from '../lib/env.js';
import { getAccountTokens } from '../lib/tokens.js';
import { fetchWithRetry } from '../lib/http.js';
import { safeParseJson } from '../lib/errors.js';
import type { AccountMetricsSnapshot, MetricsFetcher, PostMetricsSnapshot } from './index.js';

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

interface UserInfoResponse {
  data?: {
    user?: {
      follower_count?: number;
      likes_count?: number;
      video_count?: number;
    };
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
    if (!res.ok) {
      // Log em vez de null mudo: foi esse padrão que escondeu a coleta quebrada do Facebook por
      // semanas (ver metrics/facebook.ts). "Vazio" e "quebrado" precisam ser distinguíveis.
      console.error(`[metrics] tiktok post ${target.external_post_id}: ${res.status} ${(await res.text()).slice(0, 300)}`);
      return null;
    }
    const parsed = safeParseJson(await res.text()) as VideoQueryResponse | undefined;
    const video = parsed?.data?.videos?.[0];
    if (!video) {
      // Caso NORMAL enquanto a auditoria não aprova, não um defeito: post SELF_ONLY não tem
      // `publicaly_available_post_id`, então o adapter guardou o publish_id como external_post_id
      // (ver checkStatus) — e /v2/video/query/ só enxerga vídeo PÚBLICO. Resolve-se sozinho quando
      // a aprovação permitir publicar público: aí o id certo é gravado e a consulta acha.
      console.warn(`[metrics] tiktok: nenhum vídeo público para ${target.external_post_id} (post privado?)`);
      return null;
    }

    return {
      video_views: video.view_count,
      likes: video.like_count,
      comments: video.comment_count,
      shares: video.share_count,
      raw: video,
    };
  },

  /**
   * Métricas da CONTA: quantos seguidores o perfil tem. Exige o escopo `user.info.stats`.
   *
   * Existe pelo mesmo motivo das outras redes: o gráfico de seguidores ao longo do tempo no
   * Insights só tem série se alguém tirar a foto todo dia. Sem isso o TikTok apareceria no painel
   * com métrica de post e um buraco onde as outras redes mostram crescimento de audiência.
   *
   * `likes_count` é o total de curtidas acumuladas do PERFIL (não de um post) e `video_count` o
   * total de vídeos. Nenhum dos dois tem coluna própria em account_metrics, então vão no `raw` —
   * ficam gravados para um gráfico futuro sem custar uma migração agora.
   */
  async fetchAccountMetrics(account: Account, env: Env): Promise<AccountMetricsSnapshot | null> {
    const tokens = await getAccountTokens<TikTokTokens>(env.DB, account.id, env.TOKEN_ENCRYPTION_KEY);
    if (!tokens?.access_token) return null;

    const res = await fetchWithRetry(
      'https://open.tiktokapis.com/v2/user/info/?fields=follower_count,likes_count,video_count',
      { method: 'GET', headers: { Authorization: `Bearer ${tokens.access_token}` } }
    );
    if (!res.ok) {
      // Sem log mudo: foi exatamente esse padrão que escondeu a coleta quebrada do Facebook por
      // semanas (ver src/metrics/facebook.ts). "Vazio" e "quebrado" precisam ser distinguíveis.
      console.error(`[metrics] tiktok conta ${account.display_name}: ${res.status} ${(await res.text()).slice(0, 300)}`);
      return null;
    }
    const parsed = safeParseJson(await res.text()) as UserInfoResponse | undefined;
    const user = parsed?.data?.user;
    if (!user) return null;

    return { followers: user.follower_count, raw: user };
  },
};
