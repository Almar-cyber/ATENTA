import type { PostMetricRow } from './api';

// Insights ESTATÍSTICOS (sem IA): puro cálculo sobre as métricas já coletadas. A IA (Gemini) só
// entraria depois pra classificar o TEMA do conteúdo e escrever recomendações — o "melhor
// horário/formato/post" é matemática e não precisa dela. Ver design-analytics.md.

export interface Insight {
  id: string;
  headline: string;
  detail?: string;
  tone: 'good' | 'bad' | 'neutral';
}

export function engagement(m: PostMetricRow): number {
  return (m.likes ?? 0) + (m.comments ?? 0) + (m.shares ?? 0) + (m.saves ?? 0);
}

// Taxa de engajamento: engajamento por pessoa alcançada (feed) ou por view (vídeo). Normaliza a
// comparação entre redes — TikTok tem números brutos muito maiores que um post de feed. `null`
// quando a rede não deu alcance nem views (aí o post fica de fora dos insights de taxa).
export function engagementRate(m: PostMetricRow): number | null {
  const denom = m.reach ?? m.video_views;
  if (!denom || denom <= 0) return null;
  return engagement(m) / denom;
}

const FORMAT_LABEL: Record<string, string> = {
  post: 'Posts', reel: 'Reels', story: 'Stories', video: 'Vídeos', short: 'Shorts',
};
const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const TIME_BUCKETS = [
  { id: 'madrugada', label: 'de madrugada (0h–6h)', from: 0, to: 6 },
  { id: 'manha', label: 'de manhã (6h–12h)', from: 6, to: 12 },
  { id: 'tarde', label: 'à tarde (12h–18h)', from: 12, to: 18 },
  { id: 'noite', label: 'à noite (18h–24h)', from: 18, to: 24 },
];

const pct = (r: number) => `${(r * 100).toFixed(1).replace('.', ',')}%`;

// Média de uma métrica por grupo, só considerando grupos com posts suficientes. Devolve o melhor
// grupo e quantas vezes ele supera a média geral (pra frase "Nx mais").
function bestGroup<K>(
  items: { key: K; rate: number }[],
  minPerGroup: number
): { key: K; avg: number; timesVsRest: number; groups: number } | null {
  const map = new Map<K, number[]>();
  for (const it of items) {
    const arr = map.get(it.key) ?? [];
    arr.push(it.rate);
    map.set(it.key, arr);
  }
  const groups = [...map.entries()]
    .filter(([, v]) => v.length >= minPerGroup)
    .map(([key, v]) => ({ key, avg: v.reduce((a, b) => a + b, 0) / v.length }));
  if (groups.length < 2) return null;
  groups.sort((a, b) => b.avg - a.avg);
  const best = groups[0];
  const rest = groups.slice(1);
  const restAvg = rest.reduce((a, b) => a + b.avg, 0) / rest.length;
  return { key: best.key, avg: best.avg, timesVsRest: restAvg > 0 ? best.avg / restAvg : 1, groups: groups.length };
}

export function computeInsights(rows: PostMetricRow[]): Insight[] {
  const out: Insight[] = [];
  const withRate = rows
    .map((m) => ({ m, rate: engagementRate(m) }))
    .filter((x): x is { m: PostMetricRow; rate: number } => x.rate != null);

  // Melhor e pior post (por taxa) — precisa de ao menos 3 pra a comparação dizer algo.
  if (withRate.length >= 3) {
    const sorted = [...withRate].sort((a, b) => b.rate - a.rate);
    const top = sorted[0];
    const bottom = sorted[sorted.length - 1];
    out.push({
      id: 'best-post',
      headline: `Seu melhor post foi "${(top.m.caption || 'sem legenda').slice(0, 40)}"`,
      detail: `${pct(top.rate)} de engajamento sobre o alcance`,
      tone: 'good',
    });
    if (bottom.rate < top.rate * 0.6) {
      out.push({
        id: 'worst-post',
        headline: `O que menos engajou foi "${(bottom.m.caption || 'sem legenda').slice(0, 40)}"`,
        detail: `${pct(bottom.rate)} — bem abaixo do seu melhor`,
        tone: 'bad',
      });
    }
  }

  // Melhor formato (Reel/Post/Story/...) — ≥2 formatos com ≥2 posts cada, e diferença que valha.
  const byFormat = bestGroup(
    withRate.filter((x) => x.m.format).map((x) => ({ key: x.m.format as string, rate: x.rate })),
    2
  );
  if (byFormat && byFormat.timesVsRest >= 1.3) {
    const label = FORMAT_LABEL[byFormat.key] ?? byFormat.key;
    out.push({
      id: 'best-format',
      headline: `${label} engajam ${byFormat.timesVsRest.toFixed(1).replace('.', ',')}× mais que os outros formatos`,
      detail: 'considere priorizar esse formato',
      tone: 'good',
    });
  }

  // Melhor horário do dia — ≥4 posts no total, ≥2 por faixa.
  if (withRate.length >= 4) {
    const bucketed = withRate
      .filter((x) => x.m.published_at)
      .map((x) => {
        const h = new Date(x.m.published_at as string).getHours();
        const b = TIME_BUCKETS.find((tb) => h >= tb.from && h < tb.to)!;
        return { key: b.id, rate: x.rate };
      });
    const best = bestGroup(bucketed, 2);
    if (best && best.timesVsRest >= 1.25) {
      const bucket = TIME_BUCKETS.find((b) => b.id === best.key)!;
      out.push({
        id: 'best-time',
        headline: `Posts ${bucket.label} engajam ${best.timesVsRest.toFixed(1).replace('.', ',')}× mais`,
        detail: 'o melhor horário do seu perfil',
        tone: 'good',
      });
    }
  }

  // Melhor dia da semana — ≥5 posts, ≥2 por dia.
  if (withRate.length >= 5) {
    const byWeekday = bestGroup(
      withRate
        .filter((x) => x.m.published_at)
        .map((x) => ({ key: new Date(x.m.published_at as string).getDay(), rate: x.rate })),
      2
    );
    if (byWeekday && byWeekday.timesVsRest >= 1.25) {
      out.push({
        id: 'best-weekday',
        headline: `${WEEKDAYS[byWeekday.key].charAt(0).toUpperCase() + WEEKDAYS[byWeekday.key].slice(1)}-feira é seu melhor dia`,
        detail: `${byWeekday.timesVsRest.toFixed(1).replace('.', ',')}× o engajamento dos outros dias`,
        tone: 'good',
      });
    }
  }

  return out;
}
