import type { FollowerRow, PostMetricRow } from './api';

// Insights ESTATÍSTICOS (sem IA): puro cálculo sobre as métricas já coletadas. A IA (Gemini) só
// entraria depois pra classificar o TEMA do conteúdo e escrever recomendações — o "melhor
// horário/formato/post" é matemática e não precisa dela. Ver design-analytics.md.

export interface Insight {
  id: string;
  headline: string;
  detail?: string;
  tone: 'good' | 'bad' | 'neutral';
  /**
   * Onde este insight faz sentido.
   *
   * 'geral' = continua verdadeiro somando redes diferentes. 'rede' = só dentro de uma.
   *
   * A distinção não é organização, é HONESTIDADE. "Seu melhor post" comparando um carrossel do
   * Instagram com um vídeo do YouTube não significa nada: são públicos, formatos e denominadores
   * diferentes, e a taxa normalizada esconde isso em vez de resolver. Já "você ganha N seguidores
   * por semana" é uma soma, e soma atravessa rede sem mentir.
   */
  escopo: 'geral' | 'rede';
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
const DURATION_BUCKETS = [
  { id: 's', label: 'curtos (até 15s)', from: 0, to: 15 },
  { id: 'm', label: 'de 15–30s', from: 15, to: 30 },
  { id: 'l', label: 'de 30–60s', from: 30, to: 60 },
  { id: 'xl', label: 'longos (1min+)', from: 60, to: Infinity },
];
const times = (r: number) => r.toFixed(1).replace('.', ',');

/**
 * Amostra mínima pra um grupo "contar" numa comparação.
 *
 * Existe porque três vídeos sem engajamento não deveriam calar quatorze posts que têm — foi assim
 * que a tela ficou com um título de seção e nada embaixo. Vale tanto pra decidir se uma REDE tem
 * amostra quanto pra decidir se um ASSUNTO entra na comparação.
 */
const MIN_POSTS_PARA_CONTAR = 3;

const pct = (r: number) => `${(r * 100).toFixed(1).replace('.', ',')}%`;
const nfmt = new Intl.NumberFormat('pt-BR');
const fmt = (v: number) => nfmt.format(v);

// Crescimento de seguidores por semana desde o primeiro snapshot. Precisa de ≥1 semana de coleta
// (antes disso a taxa é ruído). Soma as contas passadas — todas na visão geral, só as da rede no
// detalhe dela.
function computeFollowerTrend(followers: FollowerRow[]): Insight | null {
  const valid = followers.filter((f) => f.followers != null && f.followers_first != null && f.since);
  if (valid.length === 0) return null;
  const gain = valid.reduce((s, f) => s + ((f.followers as number) - (f.followers_first as number)), 0);
  if (gain === 0) return null;
  const earliest = Math.min(...valid.map((f) => new Date(f.since as string).getTime()));
  const weeks = (Date.now() - earliest) / (7 * 24 * 3_600_000);
  if (weeks < 1) return null;
  const perWeek = Math.round(gain / weeks);
  if (perWeek === 0) return null;
  return {
    id: 'follower-trend',
      escopo: 'geral',
    headline: perWeek > 0 ? `Você ganha ~${fmt(perWeek)} seguidores por semana` : `Você perde ~${fmt(Math.abs(perWeek))} seguidores por semana`,
    detail: `${gain > 0 ? '+' : ''}${fmt(gain)} desde o início da coleta`,
    tone: perWeek > 0 ? 'good' : 'bad',
  };
}

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

export function computeInsights(rows: PostMetricRow[], followers: FollowerRow[] = []): Insight[] {
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
      escopo: 'rede',
      headline: `Seu melhor post foi "${(top.m.caption || 'sem legenda').slice(0, 40)}"`,
      detail: `${pct(top.rate)} de engajamento sobre o alcance`,
      tone: 'good',
    });
    if (bottom.rate < top.rate * 0.6) {
      out.push({
        id: 'worst-post',
      escopo: 'rede',
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
      escopo: 'rede',
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
      escopo: 'geral',
        headline: `Posts ${bucket.label} engajam ${best.timesVsRest.toFixed(1).replace('.', ',')}× mais`,
        detail: 'o melhor horário do seu perfil',
        tone: 'good',
      });
    }
  }

  // Duração ideal do vídeo — só posts com duração (vídeo), ≥4 no total, ≥2 por faixa.
  const withDuration = withRate.filter((x) => x.m.duration_seconds != null && x.m.duration_seconds > 0);
  if (withDuration.length >= 4) {
    const best = bestGroup(
      withDuration.map((x) => {
        const d = x.m.duration_seconds as number;
        return { key: DURATION_BUCKETS.find((b) => d >= b.from && d < b.to)!.id, rate: x.rate };
      }),
      2
    );
    if (best && best.timesVsRest >= 1.25) {
      const bucket = DURATION_BUCKETS.find((b) => b.id === best.key)!;
      out.push({
        id: 'best-duration',
      escopo: 'rede',
        headline: `Vídeos ${bucket.label} engajam ${times(best.timesVsRest)}× mais`,
        detail: 'a duração que mais rende no seu perfil',
        tone: 'good',
      });
    }
  }

  // Legenda: com pergunta vs sem, e com hashtag vs sem — emite o sinal mais forte (≥4 posts, ≥2/lado).
  if (withRate.length >= 4) {
    const captionTests: { label: string; has: (c: string) => boolean }[] = [
      { label: 'com pergunta', has: (c) => c.includes('?') },
      { label: 'com hashtag', has: (c) => c.includes('#') },
      { label: 'com emoji', has: (c) => /\p{Extended_Pictographic}/u.test(c) },
    ];
    let strongest: { label: string; times: number } | null = null;
    for (const t of captionTests) {
      const g = bestGroup(
        withRate.map((x) => ({ key: t.has(x.m.caption ?? ''), rate: x.rate })),
        2
      );
      // só interessa quando o lado "com" é o melhor (a dica acionável é adicionar, não remover).
      if (g && g.key === true && g.timesVsRest >= 1.3 && (!strongest || g.timesVsRest > strongest.times)) {
        strongest = { label: t.label, times: g.timesVsRest };
      }
    }
    if (strongest) {
      out.push({
        id: 'caption',
      escopo: 'geral',
        headline: `Legendas ${strongest.label} engajam ${times(strongest.times)}× mais`,
        detail: 'vale testar isso mais vezes',
        tone: 'good',
      });
    }
  }

  /**
   * Melhor ASSUNTO (pilar de conteúdo).
   *
   * É a pergunta que este arquivo nunca soube responder: ele sabia dizer qual formato e qual horário
   * rendem, nunca sobre O QUÊ. A anotação anterior dizia que isso exigiria IA pra classificar o tema
   * — não exige: quem marca o pilar é a própria pessoa, e aí vira o mesmo `bestGroup` dos outros.
   *
   * Escopo 'rede' pelo mesmo motivo do "melhor post": a taxa de um vídeo do YouTube e a de um post
   * de feed não disputam a mesma coisa, e somá-las por assunto esconderia isso em vez de resolver.
   * Com uma rede só de amostra, `insightsParaVisao` já libera.
   */
  const comTag = withRate.filter((x) => x.m.tag_id && x.m.tag_name);
  if (comTag.length >= 4) {
    const porAssunto = bestGroup(
      comTag.map((x) => ({ key: x.m.tag_name as string, rate: x.rate })),
      2
    );
    if (porAssunto && porAssunto.timesVsRest >= 1.25) {
      out.push({
        id: 'best-tag',
        escopo: 'rede',
        headline: `Seus posts de ${porAssunto.key} engajam ${times(porAssunto.timesVsRest)}× mais`,
        detail: `comparando ${porAssunto.groups} assuntos com amostra suficiente`,
        tone: 'good',
      });
    }
  }

  // Tendência de seguidores: crescimento por semana desde o primeiro snapshot da conta.
  const followerTrend = computeFollowerTrend(followers);
  if (followerTrend) out.push(followerTrend);

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
      escopo: 'geral',
        headline: `${WEEKDAYS[byWeekday.key].charAt(0).toUpperCase() + WEEKDAYS[byWeekday.key].slice(1)}-feira é seu melhor dia`,
        detail: `${byWeekday.timesVsRest.toFixed(1).replace('.', ',')}× o engajamento dos outros dias`,
        tone: 'good',
      });
    }
  }

  return out;
}


/**
 * Os insights que cabem numa visão.
 *
 * Na visão geral entram os de escopo 'geral'. Os de 'rede' comparam peças dentro do vocabulário de
 * uma rede ("qual post", "qual formato") e viram comparação falsa quando somados — um carrossel do
 * Instagram e um vídeo do YouTube não disputam a mesma coisa.
 *
 * EXCEÇÃO: com uma rede só não há mistura, e esconder informação correta por causa de um risco que
 * não se materializou seria pior. Aí a visão geral mostra tudo.
 *
 * "Uma rede só" é medido por rede com AMOSTRA, não por rede com qualquer linha: três vídeos sem
 * engajamento não deveriam calar quatorze posts que têm — foi assim que a tela ficou com um título
 * de seção e nada embaixo.
 */


export interface ResumoDeAssunto {
  id: string;
  nome: string;
  cor: string;
  posts: number;
  /** Taxa média de engajamento. `null` quando nenhum post do assunto trouxe alcance nem views. */
  taxa: number | null;
  engajamento: number;
}

/**
 * Desempenho por assunto, do melhor pro pior.
 *
 * Fica de fora quem tem menos de `MIN_POSTS_PARA_CONTAR` posts: com um post só, a "média" é aquele
 * post, e pôr isso lado a lado com um assunto de dez peças convida à conclusão errada — o topo da
 * lista seria sempre o assunto mais novo, não o melhor.
 *
 * `null` no lugar da lista quando sobra menos de dois assuntos: uma comparação com um item só não é
 * comparação, e a seção inteira não deve aparecer.
 */
export function desempenhoPorAssunto(metrics: PostMetricRow[]): ResumoDeAssunto[] | null {
  const mapa = new Map<string, { nome: string; cor: string; taxas: number[]; engajamento: number; posts: number }>();
  for (const m of metrics) {
    if (!m.tag_id || !m.tag_name) continue;
    const atual = mapa.get(m.tag_id) ?? {
      nome: m.tag_name,
      cor: m.tag_color ?? 'roxo',
      taxas: [],
      engajamento: 0,
      posts: 0,
    };
    atual.posts += 1;
    atual.engajamento += engagement(m);
    const taxa = engagementRate(m);
    if (taxa != null) atual.taxas.push(taxa);
    mapa.set(m.tag_id, atual);
  }

  const linhas = [...mapa.entries()]
    .filter(([, v]) => v.posts >= MIN_POSTS_PARA_CONTAR)
    .map(([id, v]) => ({
      id,
      nome: v.nome,
      cor: v.cor,
      posts: v.posts,
      engajamento: v.engajamento,
      taxa: v.taxas.length ? v.taxas.reduce((a, b) => a + b, 0) / v.taxas.length : null,
    }));

  if (linhas.length < 2) return null;
  linhas.sort((a, b) => (b.taxa ?? -1) - (a.taxa ?? -1));
  return linhas;
}

export function insightsParaVisao(
  metrics: PostMetricRow[],
  followers: FollowerRow[],
  visao: 'geral' | 'rede'
): Insight[] {
  const todos = computeInsights(metrics, followers);
  if (visao === 'rede') return todos;

  const porRede = new Map<string, number>();
  for (const m of metrics) porRede.set(m.platform, (porRede.get(m.platform) ?? 0) + 1);
  const redesComAmostra = [...porRede.values()].filter((n) => n >= MIN_POSTS_PARA_CONTAR).length;

  return redesComAmostra > 1 ? todos.filter((i) => i.escopo === 'geral') : todos;
}
