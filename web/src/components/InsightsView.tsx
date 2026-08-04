import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeft, Bookmark, Download, Loader2, ChevronDown, ChevronRight, Clock, ExternalLink, Eye, Heart, Lightbulb, MessageCircle, Play, Share2, TrendingDown, TrendingUp, UserPlus } from 'lucide-react';
import type { FollowerRow, PostMetricRow } from '@/lib/api';
import { getFollowers, getMetrics } from '@/lib/api';
import { insightsParaVisao } from '@/lib/insights';
import type { Platform } from '@/lib/types';
import { PLATFORM_LABELS } from '@/lib/platforms';
import { useScheduler } from '@/store';
import { toast } from 'sonner';
import { fmtDateTime } from '@/lib/format';
import { PlatformIcon } from './PlatformIcon';
import { BestHoursChart } from './BestHoursChart';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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

export function InsightsView({ onBack, onOpenConnections }: { onBack: () => void; onOpenConnections: () => void }) {
  const { accounts, reload } = useScheduler();
  const [importing, setImporting] = useState(false);
  /**
   * Conta em foco. '' = todas.
   *
   * Existe porque os Insights agregavam por REDE, e quem tem dois Instagram via os dois somados num
   * número só — sem jeito de saber qual perfil rendeu o quê, que é justamente a pergunta de quem
   * cuida de mais de uma conta.
   */
  const [conta, setConta] = useState('');
  const [metricsAll, setMetrics] = useState<PostMetricRow[] | null>(null);
  const [followersAll, setFollowers] = useState<FollowerRow[]>([]);
  const [selected, setSelected] = useState<Platform | null>(null);
  const [error, setError] = useState<string | null>(null);

  const carregar = useCallback(
    () =>
      Promise.all([getMetrics(), getFollowers()])
        .then(([m, f]) => {
          setMetrics(m.metrics);
          setFollowers(f.followers);
        })
        .catch((e) => setError(e instanceof Error ? e.message : String(e))),
    []
  );

  useEffect(() => {
    void carregar();
    const t = setInterval(() => void carregar(), 60_000);
    return () => clearInterval(t);
  }, [carregar]);

  // Filtro de conta aplicado na origem: tudo abaixo (agregados, totais, insights, gráfico de
  // horários) deriva daqui, então filtrar num lugar só evita que um bloco escape do filtro.
  const metrics = useMemo(
    () => (conta ? (metricsAll ?? []).filter((m) => m.account_id === conta) : metricsAll),
    [metricsAll, conta]
  );
  const followers = useMemo(
    () => (conta ? followersAll.filter((f) => f.account_id === conta) : followersAll),
    [followersAll, conta]
  );

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
    const reach = (metrics ?? []).reduce((s, m) => s + (m.reach ?? 0), 0);
    const saves = (metrics ?? []).reduce((s, m) => s + (m.saves ?? 0), 0);
    const follows = (metrics ?? []).reduce((s, m) => s + (m.follows ?? 0), 0);
    const profileVisits = (metrics ?? []).reduce((s, m) => s + (m.profile_visits ?? 0), 0);
    return { likes, comments, views, newFollowers, reach, saves, follows, profileVisits };
  }, [byPlatform, followers, metrics]);

  /**
   * Seguidores online por hora, somando as contas.
   *
   * Somar em vez de mostrar uma por uma: a pergunta é "a que horas eu publico", e ela tem uma
   * resposta só. Separar por conta devolveria a decisão pro usuário em vez de respondê-la.
   */
  const onlineFollowers = useMemo(() => {
    const total: Record<string, number> = {};
    let achou = false;
    for (const f of followers) {
      if (!f.online_followers) continue;
      try {
        const porHora = JSON.parse(f.online_followers) as Record<string, number>;
        for (const [hora, valor] of Object.entries(porHora)) {
          total[hora] = (total[hora] ?? 0) + (Number(valor) || 0);
          achou = true;
        }
      } catch {
        /* snapshot corrompido não pode derrubar a tela */
      }
    }
    return achou ? total : null;
  }, [followers]);

  const followersByPlatform = useMemo(() => {
    const map = new Map<Platform, number>();
    for (const f of followers) if (f.followers != null) map.set(f.platform, (map.get(f.platform) ?? 0) + f.followers);
    return map;
  }, [followers]);

  let body: ReactNode;
  if (error) {
    body = <EmptyState title="Não consegui carregar as métricas">{error}</EmptyState>;
  } else if (metrics === null) {
    body = <EmptyState title="Carregando métricas…" />;
  } else if (metrics.length === 0) {
    body = <VazioDeMetricas onOpenConnections={onOpenConnections} />;
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
      <div className="space-y-6">
        <Secao titulo="Alcance e engajamento">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat icon={<Eye className="size-3.5" />} label="Alcance" value={n(totals.reach)} />
            <Stat icon={<Heart className="size-3.5" />} label="Curtidas" value={n(totals.likes)} />
            <Stat icon={<MessageCircle className="size-3.5" />} label="Comentários" value={n(totals.comments)} />
            <Stat icon={<Play className="size-3.5" />} label="Views" value={n(totals.views)} />
          </div>
        </Secao>

        {/* O grupo que faltava: o painel dizia quanto aplaudiram, nunca o que a peça RENDEU. */}
        <Secao titulo="O que isso rendeu">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              icon={<UserPlus className="size-3.5" />}
              label="Seguidores dos posts"
              value={totals.follows > 0 ? signed(totals.follows) : '—'}
              hint={totals.follows > 0 ? 'somados os posts do período' : 'coletando…'}
            />
            <Stat
              icon={<ExternalLink className="size-3.5" />}
              label="Visitas ao perfil"
              value={totals.profileVisits > 0 ? n(totals.profileVisits) : '—'}
              hint={totals.profileVisits > 0 ? 'vindas dos posts' : 'coletando…'}
            />
            <Stat
              icon={<TrendingUp className="size-3.5" />}
              label="Novos seguidores"
              value={followers.some((f) => f.followers != null) ? signed(totals.newFollowers) : '—'}
              hint={followers.some((f) => f.followers != null) ? 'desde o início da coleta' : 'coletando…'}
            />
            <Stat icon={<Bookmark className="size-3.5" />} label="Salvamentos" value={n(totals.saves)} />
          </div>
        </Secao>

        {onlineFollowers && (
          <Secao titulo="Quando publicar">
            <div className="rounded-xl border-2 border-brand bg-card p-4 shadow-[3px_3px_0_0_var(--brand)]">
              <BestHoursChart data={onlineFollowers} />
            </div>
          </Secao>
        )}

        {insightsParaVisao(metrics ?? [], followers, 'geral').length > 0 && (
          <Secao titulo="Destaques">
            <Destaques metrics={metrics ?? []} followers={followers} escopo="geral" />
          </Secao>
        )}

        {best && (
          <Secao titulo="Comparando as redes">
            <div className="grid gap-3 sm:grid-cols-2">
              <Highlight kind="up" agg={best} />
              {worst && <Highlight kind="down" agg={worst} />}
            </div>
          </Secao>
        )}

        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Por rede</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {byPlatform.map((p) => (
              <button
                key={p.platform}
                type="button"
                onClick={() => setSelected(p.platform)}
                className="flex w-full cursor-pointer items-center gap-3 rounded-xl border-2 border-brand bg-card px-4 py-3 text-left shadow-[3px_3px_0_0_var(--brand)] transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[5px_5px_0_0_var(--brand)] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none"
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

  // Traz o que já estava publicado na rede antes do ATENTA!. Roda conta a conta, e é idempotente —
  // clicar duas vezes não duplica nada, só atualiza as métricas.
  async function importHistory() {
    const elegiveis = accounts.filter((a) => a.platform === 'instagram' || a.platform === 'youtube');
    if (elegiveis.length === 0) {
      toast.error('A importação cobre Instagram e YouTube — nenhuma conta dessas está conectada.');
      return;
    }
    setImporting(true);
    // Um toast que se atualiza, em vez de um por conta: a importação percorre conta a conta e leva
    // dezenas de segundos (uma chamada de insights POR POST). Sem isso a tela fica muda o tempo
    // todo e o botão parece travado.
    const aviso = toast.loading('Importando histórico…');
    let importados = 0;
    let semMetrica = 0;
    try {
      for (const [i, conta] of elegiveis.entries()) {
        toast.loading(`Importando ${conta.display_name} (${i + 1} de ${elegiveis.length})…`, { id: aviso });
        const res = await fetch(`/api/accounts/${conta.id}/import-history`, {
          method: 'POST',
          credentials: 'include',
        });
        const json = (await res.json().catch(() => null)) as
          | { error?: string; importados?: number; sem_metrica?: number }
          | null;
        if (!res.ok) {
          toast.error(`${conta.display_name}: ${json?.error ?? 'falhou'}`);
          continue;
        }
        importados += json?.importados ?? 0;
        semMetrica += json?.sem_metrica ?? 0;
      }
      toast.success(
        importados === 0
          ? 'Nada novo para importar — o histórico já está aqui.'
          : `${importados} post(s) importados.` +
            (semMetrica > 0 ? ` ${semMetrica} sem métrica (publicados antes do perfil virar Business).` : ''),
        { id: aviso }
      );
      // Recarrega só os dados, não a página: um location.reload() aqui apagaria o toast que acabou
      // de dizer o resultado.
      await Promise.all([carregar(), reload()]);
    } finally {
      setImporting(false);
    }
  }

  return (
    <Card className="h-full">
      <CardHeader className="flex items-center gap-3 space-y-0">
        <Button variant="ghost" size="icon-sm" onClick={selected ? () => setSelected(null) : onBack} aria-label="Voltar">
          <ArrowLeft className="size-4" />
        </Button>
        <div className="min-w-0">
          <CardTitle>{selected ? PLATFORM_LABELS[selected] : 'Insights'}</CardTitle>
          <p className="text-xs text-muted-foreground">
            {selected ? 'Detalhe dos posts dessa rede.' : 'Como os posts publicados performaram.'}
          </p>
        </div>
        {!selected && (
          <div className="ml-auto flex items-center gap-2">
            {/* Select do design system, e não <select> nativo: o nativo pinta o menu com o widget do
                sistema operacional, que não tem a borda de 2px nem a sombra deslocada das outras
                superfícies flutuantes (ver web/design.md). */}
            {accounts.length > 1 && (
              <Select value={conta || 'all'} onValueChange={(v) => setConta(v === 'all' ? '' : v)}>
                <SelectTrigger className="w-[9.5rem] sm:w-56" aria-label="Filtrar por conta">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as contas</SelectItem>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {PLATFORM_LABELS[a.platform]} — {a.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {/* Enquanto importa, o rótulo aparece SEMPRE — inclusive no celular, onde ele é oculto
                em repouso. Só desabilitar o botão fazia parecer travado: nada girava, nada mudava, e
                a operação leva dezenas de segundos (uma chamada de insights por post). */}
            <Button variant="outline" size="default" disabled={importing} onClick={() => void importHistory()}>
              {importing ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              <span className={importing ? '' : 'hidden sm:inline'}>
                {importing ? 'Importando…' : 'Importar histórico'}
              </span>
            </Button>
          </div>
        )}
      </CardHeader>
      {/* pb-6 pra a sombra deslocada dos cards do último bloco não ser cortada pelo scroll. */}
      <CardContent className="min-h-0 flex-1 overflow-auto pb-6">{body}</CardContent>
    </Card>
  );
}

// Bloco de insights estatísticos (sem IA). Reusado na visão geral (todas as redes) e no detalhe de
// cada rede (só os posts dela) — as guardas de amostra em computeInsights evitam ruído com poucos.
/**
 * Bloco com título. O board tinha cinco grupos de conteúdo empilhados sem separação nenhuma, e o
 * olho não sabia onde um assunto terminava e o outro começava. Um título por grupo resolve mais que
 * qualquer reorganização de cards.
 */
function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</h3>
      {children}
    </section>
  );
}

/**
 * `escopo` decide o que aparece.
 *
 * Na visão geral só entram os insights que continuam verdadeiros somando redes — o resto compara
 * taxa entre peças de redes diferentes, o que é comparação falsa.
 *
 * EXCEÇÃO: quando só UMA rede tem dado, não existe mistura, e esconder os insights dela seria
 * esconder informação correta por causa de um risco que não se materializou. Aí a visão geral mostra
 * tudo — que é o caso de quem está começando, ou de quem publica em uma rede só.
 */
function Destaques({
  metrics,
  followers = [],
  escopo = 'rede',
}: {
  metrics: PostMetricRow[];
  followers?: FollowerRow[];
  escopo?: 'geral' | 'rede';
}) {
  const insights = insightsParaVisao(metrics, followers, escopo);
  if (insights.length === 0) return null;
  return (
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
  );
}

/**
 * Estado vazio dos Insights, ramificado pela CAUSA.
 *
 * A mesma frase servia para situações opostas: quem nunca conectou nada, quem conectou mas nunca
 * publicou, quem publicou e está só esperando a coleta, e quem tem anos de histórico esperando ser
 * importado. Cada um precisa de uma ação diferente — e "os indicadores aparecem conforme os posts
 * publicam" não ajuda nenhum deles.
 *
 * Fica aqui dentro (e não no InsightsView) porque a ramificação é uma decisão de produto com quatro
 * ramos; misturada ao corpo da tela, ela vira um `if` gigante no meio do render.
 */
function VazioDeMetricas({ onOpenConnections }: { onOpenConnections: () => void }) {
  const { accounts, posts } = useScheduler();

  // Só Instagram e YouTube têm importação de histórico implementada.
  const importaveis = accounts.filter((a) => a.platform === 'instagram' || a.platform === 'youtube');
  const publicados = posts.filter((p) => p.targets.some((t) => t.status === 'published')).length;
  const semEscopo = accounts.filter((a) => a.metrics_ready === false);

  // 1. Nada conectado: qualquer outra explicação é sobre um passo que ela ainda não deu.
  if (accounts.length === 0) {
    return (
      <EmptyState
        art="conectar"
        title="Conecte uma rede para ver seus números"
        action={
          <Button size="lg" onClick={onOpenConnections}>
            Ir para Conexões
          </Button>
        }
      >
        Assim que uma conta estiver conectada, o ATENTA! passa a coletar alcance, curtidas e
        comentários de cada post — e a comparar o que funcionou.
      </EmptyState>
    );
  }

  // 2. Conectado, mas sem o escopo de métrica: o problema é permissão, não ausência de dado.
  if (semEscopo.length > 0 && semEscopo.length === accounts.length) {
    return (
      <EmptyState
        art="conectar"
        title="Falta permissão para ler as métricas"
        action={
          <Button size="lg" variant="outline" onClick={onOpenConnections}>
            Reconectar em Conexões
          </Button>
        }
      >
        {semEscopo.map((a) => a.display_name).join(', ')} {semEscopo.length > 1 ? 'foram conectadas' : 'foi conectada'}{' '}
        antes do recurso de indicadores existir. Reconecte em <b>Conexões</b> para liberar o acesso —
        a publicação continua funcionando normalmente enquanto isso.
      </EmptyState>
    );
  }

  // 3. Nada publicado por aqui, mas há conta com histórico na rede: importar é o caminho curto.
  if (publicados === 0 && importaveis.length > 0) {
    return (
      <EmptyState art="comecando" title="Traga o que já está publicado">
        Você ainda não publicou nada pelo ATENTA!, mas dá para importar o histórico de{' '}
        {importaveis.map((a) => a.display_name).join(' e ')} — com as métricas que a rede guarda.
        Use o botão <b>Importar histórico</b> aqui em cima.
      </EmptyState>
    );
  }

  // 4. Publicou: é só a coleta ainda não ter rodado.
  return (
    <EmptyState art="esperando" title="Coletando os primeiros números">
      A varredura roda a cada 10 minutos e busca as métricas de cada post publicado. Os indicadores
      aparecem sozinhos assim que a primeira coleta terminar.
    </EmptyState>
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
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full cursor-pointer items-center gap-3 rounded-xl p-3 text-left transition-colors hover:bg-muted/40">
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
      {insightsParaVisao(metrics, followerRows, 'rede').length > 0 && (
        <Secao titulo="Destaques">
          <Destaques metrics={metrics} followers={followerRows} />
        </Secao>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {metrics.map((m) => (
          <PostCard key={m.target_id} m={m} isVideoNet={isVideoNet} />
        ))}
      </div>
    </div>
  );
}
