import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeft, BarChart3, ExternalLink } from 'lucide-react';
import type { PostMetricRow } from '@/lib/api';
import { getMetrics } from '@/lib/api';
import { PLATFORM_LABELS } from '@/lib/platforms';
import { fmtDateTime } from '@/lib/format';
import { PlatformIcon } from './PlatformIcon';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';

const nf = new Intl.NumberFormat('pt-BR');
const n = (v: number | null | undefined) => (v == null ? '—' : nf.format(v));

// Engajamento = soma das interações que a rede reportou (o que for null não conta).
function engagement(m: PostMetricRow): number {
  return (m.likes ?? 0) + (m.comments ?? 0) + (m.shares ?? 0) + (m.saves ?? 0);
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border-2 border-brand bg-card p-4 shadow-[3px_3px_0_0_var(--brand)]">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

// Tela própria (não uma aba da agenda): Insights é analytics do que já publicou, um mundo diferente
// do planejamento/agendamento das abas. Entra pelo botão "Insights" no header, como Conexões.
export function InsightsView({ onBack }: { onBack: () => void }) {
  const [metrics, setMetrics] = useState<PostMetricRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      getMetrics()
        .then((r) => alive && setMetrics(r.metrics))
        .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    load();
    const t = setInterval(load, 60_000); // métrica muda devagar; 1min basta
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const totals = useMemo(() => {
    if (!metrics?.length) return null;
    const reach = metrics.reduce((s, m) => s + (m.reach ?? 0), 0);
    const eng = metrics.reduce((s, m) => s + engagement(m), 0);
    const best = metrics.reduce((a, b) => (engagement(b) > engagement(a) ? b : a));
    return { reach, eng, best, count: metrics.length };
  }, [metrics]);

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
            Os indicadores aparecem conforme os posts publicam e a coleta roda (a cada varredura do
            poller, cadência crescente). <b>YouTube</b> já coleta com o acesso atual; <b>Instagram</b> e{' '}
            <b>Facebook</b> precisam reconectar em Conexões pra liberar o escopo de insights.
          </p>
        </div>
      </EmptyState>
    );
  } else {
    body = (
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Alcance total" value={n(totals!.reach)} hint={`${totals!.count} posts`} />
          <Stat label="Engajamento total" value={n(totals!.eng)} hint="likes + coment. + shares + saves" />
          <Stat label="Melhor post" value={n(engagement(totals!.best))} hint={totals!.best.caption ?? 'sem legenda'} />
        </div>

        <div className="overflow-x-auto rounded-2xl border-2 border-brand shadow-[4px_4px_0_0_var(--brand)]">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-semibold">Post</th>
                <th className="px-3 py-2 text-right font-semibold">Alcance</th>
                <th className="px-3 py-2 text-right font-semibold">Curtidas</th>
                <th className="px-3 py-2 text-right font-semibold">Coment.</th>
                <th className="px-3 py-2 text-right font-semibold">Salvos</th>
                <th className="px-3 py-2 text-right font-semibold">Views</th>
              </tr>
            </thead>
            <tbody>
              {metrics!.map((m) => (
                <tr key={m.target_id} className="border-t">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <PlatformIcon platform={m.platform} className="size-4 shrink-0" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-medium">
                            {m.caption || <span className="text-muted-foreground">sem legenda</span>}
                          </span>
                          {m.external_url && (
                            <a href={m.external_url} target="_blank" rel="noreferrer" className="shrink-0 text-accent-foreground hover:underline">
                              <ExternalLink className="size-3.5" />
                            </a>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {m.account_name} · {PLATFORM_LABELS[m.platform]}
                          {m.published_at ? ` · ${fmtDateTime(m.published_at)}` : ''}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{n(m.reach)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{n(m.likes)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{n(m.comments)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{n(m.saves)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{n(m.video_views)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <BarChart3 className="size-3.5 shrink-0" /> Snapshot mais recente por post. A coleta reagenda
          sozinha (densa no começo, esparsa depois) e para de atualizar posts com mais de 60 dias.
        </p>
      </div>
    );
  }

  return (
    <Card className="h-full">
      <CardHeader className="flex-row items-center gap-3 space-y-0">
        <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label="Voltar">
          <ArrowLeft className="size-4" />
        </Button>
        <div>
          <CardTitle>Insights</CardTitle>
          <p className="text-xs text-muted-foreground">Como os posts publicados performaram.</p>
        </div>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 overflow-auto">{body}</CardContent>
    </Card>
  );
}
