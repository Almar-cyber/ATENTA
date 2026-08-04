// Coleta de métricas por rede (Fase A, design-analytics.md). Mesma forma dos adapters de publicação:
// um fetcher por plataforma, registrados num mapa; o coletor no poller (src/worker.ts) chama o
// fetcher da rede do destino. Redes sem fetcher (LinkedIn, Pinterest/TikTok pré-auditoria) são
// simplesmente puladas.
//
// Confiança: os endpoints/campos vêm da doc de cada plataforma, não de um teste contra a API real
// (as contas ainda não têm o escopo de insights) — mesma ressalva dos adapters de publish. A lógica
// de orquestração (cadência, quais destinos, gravação do snapshot) é o que está coberto por teste.

import type { Account, Platform, PostTarget } from '../lib/types.js';
import type { Env } from '../lib/env.js';
import { instagramMetrics } from './instagram.js';
import { facebookMetrics } from './facebook.js';
import { youtubeMetrics } from './youtube.js';
import { tiktokMetrics } from './tiktok.js';

/** Núcleo normalizado — o denominador comum entre as redes. `undefined` = a rede não expõe. */
export interface PostMetricsSnapshot {
  impressions?: number;
  reach?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  video_views?: number;
  avg_watch_seconds?: number;
  /** Seguidores que ESTE post trouxe — a resposta pra "qual post me rendeu gente nova". */
  follows?: number;
  /** Quem foi ver o perfil por causa dele. */
  profile_visits?: number;
  /** total_interactions: o engajamento consolidado do jeito que a Meta calcula. */
  interactions?: number;
  /** Corpo bruto da API, pro que é específico da rede (guardado em post_metrics.raw). */
  raw: unknown;
}

export interface AccountMetricsSnapshot {
  followers?: number;
  reach?: number;
  profile_views?: number;
  /** Cliques no link do perfil (bio do Instagram, site da Página). */
  link_clicks?: number;
  /** Seguidores online por hora do dia (chave '0'..'23'). */
  online_followers?: Record<string, number> | null;
  /** Faixa etária, gênero, cidade e país de quem segue. */
  demographics?: Record<string, unknown> | null;
  raw: unknown;
}

export interface MetricsFetcher {
  /** Métricas de um post publicado. `null` = não deu pra coletar agora (sem token, sem id, etc.). */
  fetchPostMetrics(target: PostTarget, account: Account, env: Env): Promise<PostMetricsSnapshot | null>;
  /** Métricas do nível da conta (seguidores, etc.). Opcional. */
  fetchAccountMetrics?(account: Account, env: Env): Promise<AccountMetricsSnapshot | null>;
}

export const metricsFetchers: Partial<Record<Platform, MetricsFetcher>> = {
  instagram: instagramMetrics,
  facebook: facebookMetrics,
  youtube: youtubeMetrics,
  // TikTok só devolve dados quando a auditoria aprovar E a conta reconectar com o escopo
  // video.list (adicionado em oauth-urls.ts). Até lá, o fetch bate em 401 e a coleta pula.
  tiktok: tiktokMetrics,
};

/** Há coletor pra essa rede? (as demais são puladas no poller sem erro.) */
export function hasMetricsFetcher(platform: Platform): boolean {
  return platform in metricsFetchers;
}
