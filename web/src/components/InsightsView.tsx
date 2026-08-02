import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeft, Bookmark, ChevronDown, ChevronRight, Clock, ExternalLink, Eye, Heart, Lightbulb, MessageCircle, Play, Share2, TrendingDown, TrendingUp, UserPlus } from 'lucide-react';
import type { FollowerRow, PostMetricRow } from '@/lib/api';
import { getFollowers, getMetrics } from '@/lib/api';
import { computeInsights } from '@/lib/insights';
import type { Platform } from '@/lib/types';
import { PLATFORM_LABELS } from '@/lib/platforms';
import { fmtDateTime } from '@/lib/format';
import { PlatformIcon } from './PlatformIcon';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';

const nf = new Intl.NumberFormat('pt-BR');
const n = (v: number | null | undefined) => (v == null ? '—' : nf.format(v));
const signed = (v: number) => (v > 0 ? `+${nf.format(v)}` : nf.format(v));

function engagement(m: PostMetricRow): number {
  return (m.likes ?? 0) + (m.comments ?? 0) + (m.shares ?? 0) + (m.saves ?? 0);
}

interface PlatformAgg {
  platform: Platform;
  posts: number;
  reach: number;
  likes: number;
  comments: number;
  views: number;
  engagement: number;
}

// Card de estatística geral (topo da visão geral).
function Stat({ icon, label, value, hint }: { icon: ReactNode; label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border-2 border-brand bg-card p-4 shadow-[3px_3px_0_0_var(--brand)]">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function InsightsView({ onBack }: { onBack: () => void }) {
  const [metrics, setMetrics] = useState<PostMetricRow[] | null>(null);
  const [followers, setFollowers] = useState<FollowerRow[]>([]);
  const [selected, setSelected] = useState<Platform | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      Promise.all([getMetrics(), getFollowers()])
        .then(([m, f]) => {
          if (!alive) return;
          setMetrics(m.metrics);
          setFollowers(f.followers);
        })
        .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // Agregados por rede (só as que têm post com métrica).
  const byPlatform = useMemo(() => {
    const map = new Map<Platform, PlatformAgg>();
    for (const m of metrics ?? []) {
      const a = map.get(m.platform) ?? { platform: m.platform, posts: 0, reach: 0, likes: 0, comments: 0, views: 0, engagement: 0 };
      a.posts += 1;
      a.reach += m.reach ?? 0;
      a.likes += m.likes ?? 0;
      a.comments += m.comments ?? 0;
      a.views += m.video_views ?? 0;
      a.engagement += engagement(m);
      map.set(m.platform, a);
    }
    return [...map.values()].sort((x, y) => y.engagement - x.engagement);
  }, [metrics]);

  const totals = useMemo(() => {
    const likes = byPlatform.reduce((s, p) => s + p.likes, 0);
    const comments = byPlatform.reduce((s, p) => s + p.comments, 0);
    const views = byPlatform.reduce((s, p) => s + p.views, 0);
    const newFollowers = followers.reduce((s, f) => s + ((f.followers ?? 0) - (f.followers_first ?? f.followers ?? 0)), 0);
    return { likes, comments, views, newFollowers };
  }, [byPlatform, followers]);

  const followersByPlatform = useMemo(() => {
    const map = new Map<Platform, number>();
    for (const f of followers) if (f.followers != null) map.set(f.platform, (map.get(f.platform) ?? 0) + f.followers);
    return map;
  }, [followers]);

  let body: ReactNode;
  if (error) {
    body = <EmptyState>Não consegui carregar as métricas: {error}</EmptyState>;
  } else if (metrics === null) {
    body = <EmptyState>Carregando métricas…</EmptyState>;
  } else if (metrics.length === 0) {
    body = (
      <EmptyState>
        <div className="space-y-2">
          <p className="font-semibold text-foreground">Ainda não há métricas.</p>
          <p>
            Os indicadores aparecem conforme os posts publicam e a coleta roda. <b>YouTube</b> já
            coleta com o acesso atual; <b>Instagram</b> e <b>Facebook</b> precisam reconectar em
            Conexões pra liberar o escopo de insights.
          </p>
        </div>
      </EmptyState>
    );
  } else if (selected) {
    body = (
      <PlatformDetail
        platform={selected}
        metrics={metrics.filter((m) => m.platform === selected)}
        followerRows={followers.filter((f) => f.platform === selected)}
      />
    );
  } else {
    const best = byPlatform[0];
    const worst = byPlatform.length > 1 ? byPlatform[byPlatform.length - 1] : null;
    body = (
      <div className="space-y-5">
        {/* Números gerais */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat icon={<Heart className="size-3.5" />} label="Curtidas" value={n(totals.likes)} />
          <Stat icon={<MessageCircle className="size-3.5" />} label="Comentários" value={n(totals.comments)} />
          <Stat icon={<Play className="size-3.5" />} label="Views" value={n(totals.views)} />
          <Stat
            icon={<UserPlus className="size-3.5" />}
            label="Novos seguidores"
            value={followers.some((f) => f.followers != null) ? signed(totals.newFollowers) : '—'}
            hint={followers.some((f) => f.followers != null) ? 'desde o início da coleta' : 'coletando…'}
          />
        </div>

        {/* Insights estatísticos (sem IA): melhor horário, formato, post, tendência de seguidores... */}
        <Destaques metrics={metrics} followers={followers} />

        {/* Rede que mais/menos performou */}
        {best && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Highlight kind="up" agg={best} />
            {worst && <Highlight kind="down" agg={worst} />}
          </div>
        )}

        {/* Redes — clicáveis pro detalhe */}
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Por rede</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {byPlatform.map((p) => (
              <button
                key={p.platform}
                type="button"
                onClick={() => setSelected(p.platform)}
                className="flex w-full items-center gap-3 rounded-xl border-2 border-brand bg-card px-4 py-3 text-left shadow-[3px_3px_0_0_var(--brand)] transition-transform hover:-translate-y-0.5"
              >
                <PlatformIcon platform={p.platform} className="size-6 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{PLATFORM_LABELS[p.platform]}</div>
                  <div className="text-xs text-muted-foreground">
                    {p.posts} post{p.posts > 1 ? 's' : ''}
                    {followersByPlatform.has(p.platform) ? ` · ${n(followersByPlatform.get(p.platform))} seguidores` : ''}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-bold tabular-nums">{n(p.engagement)}</div>
                  <div className="text-xs text-muted-foreground">engajamento</div>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <Card className="h-full">
      <CardHeader className="flex-row items-center gap-3 space-y-0">
        <Button variant="ghost" size="icon-sm" onClick={selected ? () => setSelected(null) : onBack} aria-label="Voltar">
          <ArrowLeft className="size-4" />
        </Button>
        <div>
          <CardTitle>{selected ? PLATFORM_LABELS[selected] : 'Insights'}</CardTitle>
          <p className="text-xs text-muted-foreground">
            {selected ? 'Detalhe dos posts dessa rede.' : 'Como os posts publicados performaram.'}
          </p>
        </div>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 overflow-auto">{body}</CardContent>
    </Card>
  );
}

// Bloco de insights estatísticos (sem IA). Reusado na visão geral (todas as redes) e no detalhe de
// cada rede (só os posts dela) — as guardas de amostra em computeInsights evitam ruído com poucos.
function Destaques({ metrics, followers = [] }: { metrics: PostMetricRow[]; followers?: FollowerRow[] }) {
  const insights = computeInsights(metrics, followers);
  if (insights.length === 0) return null;
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Destaques</div>
      <div className="grid gap-2 sm:grid-cols-2">
        {insights.map((ins) => (
          <div key={ins.id} className="flex items-start gap-3 rounded-xl border-2 border-brand bg-card p-3 shadow-[3px_3px_0_0_var(--brand)]">
            <div className={`grid size-8 shrink-0 place-items-center rounded-full ${ins.tone === 'bad' ? 'bg-muted text-muted-foreground' : 'bg-primary text-primary-foreground'}`}>
              {ins.tone === 'bad' ? <TrendingDown className="size-4" /> : <Lightbulb className="size-4" />}
            </div>
            <div className="min-w-0 leading-snug">
              <div className="font-semibold">{ins.headline}</div>
              {ins.detail && <div className="text-xs text-muted-foreground">{ins.detail}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Highlight({ kind, agg }: { kind: 'up' | 'down'; agg: PlatformAgg }) {
  const up = kind === 'up';
  return (
    <div className={`flex items-center gap-3 rounded-xl border-2 p-4 ${up ? 'border-brand bg-primary/10' : 'border-border bg-muted/40'}`}>
      <div className={`grid size-9 shrink-0 place-items-center rounded-full ${up ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
        {up ? <TrendingUp className="size-5" /> : <TrendingDown className="size-5" />}
      </div>
      <div className="min-w-0 leading-tight">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {up ? 'Rede que mais performou' : 'Rede que menos performou'}
        </div>
        <div className="mt-1 flex items-center gap-1.5 font-semibold">
          <PlatformIcon platform={agg.platform} className="size-4 shrink-0" />
          {PLATFORM_LABELS[agg.platform]}
        </div>
        <div className="text-sm text-muted-foreground">
          <span className="font-semibold tabular-nums text-foreground">{n(agg.engagement)}</span> de engajamento
        </div>
      </div>
    </div>
  );
}

// Um número de métrica com ícone — quebra na linha no mobile (sem tabela/scroll horizontal).
function Metric({ icon, value, label }: { icon: ReactNode; value: number | null | undefined; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-muted-foreground">{icon}</span>
      <span className="font-semibold tabular-nums">{n(value)}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

// Todas as métricas de um post, na ordem de exibição do detalhe expandido. Só as não-nulas aparecem.
function allMetrics(m: PostMetricRow): { icon: ReactNode; value: number | null; label: string }[] {
  return [
    { icon: <Play className="size-3.5" />, value: m.video_views, label: 'views' },
    { icon: <Eye className="size-3.5" />, value: m.reach, label: 'alcance' },
    { icon: <Eye className="size-3.5" />, value: m.impressions, label: 'impressões' },
    { icon: <Heart className="size-3.5" />, value: m.likes, label: 'curtidas' },
    { icon: <MessageCircle className="size-3.5" />, value: m.comments, label: 'coment.' },
    { icon: <Bookmark className="size-3.5" />, value: m.saves, label: 'salvos' },
    { icon: <Share2 className="size-3.5" />, value: m.shares, label: 'shares' },
    { icon: <Clock className="size-3.5" />, value: m.avg_watch_seconds, label: 'seg. médios' },
  ].filter((x) => x.value != null);
}

// Card de post: resumo (as 2 métricas principais) sempre visível; clicar expande e mostra TODAS as
// métricas coletadas + quando foi o último snapshot. Pensado pro mobile — nada de scroll horizontal.
function PostCard({ m, isVideoNet }: { m: PostMetricRow; isVideoNet: boolean }) {
  const [open, setOpen] = useState(false);
  const primary = isVideoNet
    ? { icon: <Play className="size-3.5" />, value: m.video_views, label: 'views' }
    : { icon: <Eye className="size-3.5" />, value: m.reach, label: 'alcance' };
  const full = allMetrics(m);

  return (
    <div className="rounded-xl border-2 border-brand bg-card shadow-[3px_3px_0_0_var(--brand)]">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 p-3 text-left">
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold leading-snug">
            {m.caption || <span className="text-muted-foreground">sem legenda</span>}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {m.account_name}
            {m.published_at ? ` · ${fmtDateTime(m.published_at)}` : ''}
          </div>
          {/* Resumo: só as duas principais, pra caber sem apertar. */}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <Metric {...primary} />
            <Metric icon={<Heart className="size-3.5" />} value={m.likes} label="curtidas" />
          </div>
        </div>
        <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="space-y-2.5 border-t px-3 pb-3 pt-2.5">
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
            {full.map((x) => (
              <Metric key={x.label} icon={x.icon} value={x.value} label={x.label} />
            ))}
          </div>
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>Atualizado {fmtDateTime(m.fetched_at)}</span>
            {m.external_url && (
              <a href={m.external_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-accent-foreground hover:underline">
                abrir na rede <ExternalLink className="size-3" />
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Nível 2: os posts de uma rede específica, em cards expansíveis (resumo → detalhe).
function PlatformDetail({ platform, metrics, followerRows }: { platform: Platform; metrics: PostMetricRow[]; followerRows: FollowerRow[] }) {
  const isVideoNet = platform === 'youtube' || platform === 'tiktok';
  const followerCount = followerRows.reduce((s, f) => s + (f.followers ?? 0), 0);
  const hasFollowers = followerRows.some((f) => f.followers != null);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Stat icon={<PlatformIcon platform={platform} className="size-3.5" />} label="Posts" value={n(metrics.length)} />
        {hasFollowers && <Stat icon={<UserPlus className="size-3.5" />} label="Seguidores" value={n(followerCount)} />}
      </div>

      {/* Insights só desta rede (melhor post/horário/dia + tendência de seguidores dela). */}
      <Destaques metrics={metrics} followers={followerRows} />

      <div className="grid gap-3 lg:grid-cols-2">
        {metrics.map((m) => (
          <PostCard key={m.target_id} m={m} isVideoNet={isVideoNet} />
        ))}
      </div>
    </div>
  );
}
