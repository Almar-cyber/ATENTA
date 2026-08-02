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
  /** Corpo bruto da API, pro que é específico da rede (guardado em post_metrics.raw). */
  raw: unknown;
}

export interface AccountMetricsSnapshot {
  followers?: number;
  reach?: number;
  profile_views?: number;
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
};

/** Há coletor pra essa rede? (as demais são puladas no poller sem erro.) */
export function hasMetricsFetcher(platform: Platform): boolean {
  return platform in metricsFetchers;
}
