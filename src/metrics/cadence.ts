// Cadência de coleta de métricas. Métrica nova muda rápido e depois estabiliza, então coletamos
// denso no começo e cada vez mais espaçado — snapshots demais só gastam rate limit à toa. Função
// pura pra ser 100% testável; o poller guarda o resultado em post_targets.next_metrics_at (mesmo
// padrão do next_attempt_at). Ver design-analytics.md §4.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// Depois disso a métrica está praticamente congelada — para de coletar (next_metrics_at = null).
export const COLLECT_HORIZON_MS = 60 * DAY;

/** Intervalo até a próxima coleta, pela idade do post. */
export function collectIntervalMs(ageMs: number): number | null {
  if (ageMs < 0) return HOUR; // publicado "no futuro" (clock skew): trata como recém-saído
  if (ageMs < 6 * HOUR) return HOUR;
  if (ageMs < 48 * HOUR) return 6 * HOUR;
  if (ageMs < 14 * DAY) return DAY;
  if (ageMs < COLLECT_HORIZON_MS) return 7 * DAY;
  return null; // passou o horizonte — não coleta mais
}

/**
 * Instante da PRÓXIMA coleta a partir de agora, ou `null` se o post já passou do horizonte de
 * coleta (aí o poller para de mirar esse destino).
 */
export function nextMetricsAt(publishedAt: Date, now: Date): string | null {
  const interval = collectIntervalMs(now.getTime() - publishedAt.getTime());
  if (interval === null) return null;
  return new Date(now.getTime() + interval).toISOString();
}

/**
 * Cadência de COMENTÁRIO — deliberadamente SEM ladder e SEM horizonte, ao contrário da de métrica
 * acima. Reach e views congelam depois de COLLECT_HORIZON_MS porque não mudam mais; comentário
 * pode chegar em post de meses atrás, e "quem comenta com você" é sobre continuar enxergando esse
 * engajamento tardio. Uma vez por dia é suficiente — comentário não é tão sensível ao tempo quanto
 * a primeira hora de um post novo.
 */
export function nextCommentsAt(now: Date): string {
  return new Date(now.getTime() + DAY).toISOString();
}
