import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  ChevronRight,
  Clock,
  Eye,
  FileText,
  Heart,
  Link2,
  Plus,
  Send,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import type { FollowerRow, PostMetricRow, ProximoPost, Summary } from '@/lib/api';
import { getFollowers, getMetrics, getSummary } from '@/lib/api';
import { PLATFORM_FORMATS } from '@/lib/platforms';
import { fmtQuando } from '@/lib/format';
import { requestPrefillDate } from '@/lib/composer-bus';
import { useScheduler } from '@/store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ViewHeader } from '@/components/ui/view-header';
import { EmptyState } from '@/components/ui/empty-state';
import { PlatformIcon } from './PlatformIcon';
import { Thumb } from './Thumb';

const nf = new Intl.NumberFormat('pt-BR');
const n = (v: number) => nf.format(v);
const signed = (v: number) => (v > 0 ? `+${nf.format(v)}` : nf.format(v));
const plural = (q: number, um: string, muitos: string) => (q === 1 ? um : muitos);

/**
 * O painel responde "o que precisa de mim agora?", e não "quantos posts eu tenho".
 *
 * A diferença é a razão da tela existir. Um grid de contadores — 4 rascunhos, 7 na fila — é bonito
 * no primeiro dia e vira decoração no terceiro, porque nenhum daqueles números muda uma decisão:
 * você acabou de agendar, já sabe quantos são. Ferramenta de publicação séria (Buffer, Later) por
 * isso mesmo não tem painel de resumo — a fila É a home.
 *
 * O que justifica um painel aqui é uma lacuna concreta: o RASCUNHO é invisível. Ele nasce com uma
 * data que o compositor inventou ("amanhã, 09:00") e some no meio da lista; passado o dia, fica pra
 * trás e ninguém mais o encontra — e rascunho nunca publica sozinho, por mais que a data chegue.
 * Cada linha daqui, portanto, é uma pendência com ação, não uma estatística.
 */

/** De quanto em quanto o painel se atualiza. Igual ao poll do store, pra não divergirem na tela. */
const POLL_MS = 30_000;

/**
 * Card clicável do sistema brutalista: levanta no hover, afunda no clique (web/design.md).
 *
 * A sombra deslocada continua ROXA mesmo na pendência grave. A tinta é o `--brand` em toda
 * superfície do app; trocá-la por vermelho faria o card parecer de outro sistema. A urgência é dita
 * pela borda, pelo fundo e pelo ícone — a mesma linguagem da barra de alerta.
 */
const CARD_BASE =
  'w-full cursor-pointer rounded-xl border-2 shadow-[3px_3px_0_0_var(--brand)] transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[5px_5px_0_0_var(--brand)] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none';

export type PainelDestino =
  | { tipo: 'agenda'; status: string }
  | { tipo: 'conexoes' }
  | { tipo: 'insights' };

export function HomeView({
  onIr,
  onAbrirPost,
}: {
  /** Leva a outra tela, já filtrada quando for o caso. */
  onIr: (destino: PainelDestino) => void;
  /** Abre o detalhe de um destino do bloco "Sai a seguir". */
  onAbrirPost: (postId: string, targetId: string) => void;
}) {
  const { accounts } = useScheduler();
  const [resumo, setResumo] = useState<Summary | null>(null);
  const [metrics, setMetrics] = useState<PostMetricRow[]>([]);
  const [followers, setFollowers] = useState<FollowerRow[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      // As métricas vêm das MESMAS rotas que os Insights consomem, de propósito: se o painel
      // somasse por conta própria no servidor, as duas telas poderiam mostrar alcances diferentes
      // — e duas telas que discordam sobre o próprio número custam mais confiança do que a
      // requisição extra economiza.
      const [s, m, f] = await Promise.all([getSummary(), getMetrics(), getFollowers()]);
      setResumo(s);
      setMetrics(m.metrics);
      setFollowers(f.followers);
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void carregar();
    const t = setInterval(() => void carregar(), POLL_MS);
    return () => clearInterval(t);
  }, [carregar]);

  const desempenho = useMemo(() => {
    const alcance = metrics.reduce((s, m) => s + (m.reach ?? 0), 0);
    const curtidas = metrics.reduce((s, m) => s + (m.likes ?? 0), 0);
    const saldo = followers.reduce((s, f) => s + ((f.followers ?? 0) - (f.followers_first ?? f.followers ?? 0)), 0);
    return { alcance, curtidas, saldo, temSeguidores: followers.some((f) => f.followers != null) };
  }, [metrics, followers]);

  const pendencias = useMemo(() => construirPendencias(resumo, accounts), [resumo, accounts]);

  return (
    <Card className="h-full">
      <ViewHeader title="Painel" description="O que precisa de você, e o que sai a seguir." />
      {/* pb-6 pra a sombra deslocada do último card não ser cortada pelo scroll. */}
      <CardContent className="min-h-0 flex-1 overflow-auto pb-6">
        {erro ? (
          <EmptyState title="Não consegui carregar o painel">{erro}</EmptyState>
        ) : !resumo ? (
          <EmptyState title="Carregando…" />
        ) : (
          /* GRADES DE CARDS, não faixas.
             A primeira versão empilhava linhas de largura total, e numa tela larga cada linha virava
             uma faixa com o texto num canto e o resto vazio — o olho atravessava a tela inteira pra
             ligar as duas pontas de uma informação que cabia num palmo.
             O card quadrado resolve os dois problemas de uma vez: ocupa a largura em colunas e, por
             ser alto, abre espaço pra HIERARQUIA de verdade dentro dele — o número em corpo grande
             como herói, o rótulo abaixo, o detalhe apagado no rodapé. Numa faixa, tudo isso era uma
             linha só de texto do mesmo tamanho.
             O teto de largura existe porque isto é superfície de leitura: sem ele, a grade continua
             esticando e os cards voltam a virar retângulos.
             AS COLUNAS SÃO FIXAS, e a fileira incompleta (três itens numa grade de cinco) fica com
             espaço à direita de propósito. A alternativa testada — casar o número de colunas com o
             número de itens, pra fechar a fileira — piora tudo: com três próximos os cards ficam de
             quase quinhentos pixels e a capa domina a tela inteira, e o card de pendência volta a
             ser a faixa achatada que a grade veio substituir. O módulo constante é o que faz uma
             grade parecer uma grade; sobra à direita lê-se como "são três", não como defeito. */
          <div className="mx-auto w-full max-w-[1500px] space-y-6">
            <Secao titulo="Precisa de você">
              {pendencias.length === 0 ? (
                <EmptyState art="comemorando" size="sm" title="Tudo em dia">
                  Nada esperando por você — o que está na fila sai sozinho no horário marcado.
                </EmptyState>
              ) : (
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  {pendencias.map((p, i) => (
                    <PendenciaCard key={p.id} p={p} i={i} onIr={() => onIr(p.destino)} />
                  ))}
                </div>
              )}
            </Secao>

            <Secao titulo="Sai a seguir">
              {resumo.proximos.length === 0 ? (
                <EmptyState
                  art="comecando"
                  size="sm"
                  title="Nada na fila"
                  action={
                    <Button size="lg" onClick={() => requestPrefillDate(daquiUmaHora())}>
                      <Plus className="size-4" />
                      Agendar post
                    </Button>
                  }
                >
                  O que você agendar aparece aqui, na ordem em que vai sair.
                </EmptyState>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {resumo.proximos.map((p, i) => (
                    <ProximoCard key={p.target_id} p={p} i={i} onAbrir={() => onAbrirPost(p.post_id, p.target_id)} />
                  ))}
                </div>
              )}
            </Secao>

            <Secao titulo="Como foi">
              {/* Sem nenhuma métrica ainda, três zeros dizem "seus posts não renderam nada" — que é
                  falso e desanimador. Uma linha convidando pro Insights é honesta. */}
              {metrics.length === 0 ? (
                <LinhaInsights onIr={() => onIr({ tipo: 'insights' })}>
                  Nenhuma métrica coletada ainda.
                </LinhaInsights>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <Numero icone={<Eye className="size-4" />} rotulo="Alcance" valor={n(desempenho.alcance)} />
                    <Numero icone={<Heart className="size-4" />} rotulo="Curtidas" valor={n(desempenho.curtidas)} />
                    <Numero
                      icone={desempenho.saldo < 0 ? <TrendingDown className="size-4" /> : <TrendingUp className="size-4" />}
                      rotulo="Saldo de seguidores"
                      valor={desempenho.temSeguidores ? signed(desempenho.saldo) : '—'}
                    />
                    <Numero
                      icone={<Send className="size-4" />}
                      rotulo="Publicações"
                      valor={n(resumo.por_status.published ?? metrics.length)}
                    />
                  </div>
                  <LinhaInsights onIr={() => onIr({ tipo: 'insights' })}>
                    Somando tudo o que já foi publicado.
                  </LinhaInsights>
                </div>
              )}
            </Secao>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface Pendencia {
  id: string;
  /** O herói do card. Separado do texto justamente pra poder ser tipografado grande. */
  quantidade: number;
  titulo: string;
  detalhe: string;
  icone: ReactNode;
  /** Vermelho em vez de roxo: reservado pro que já deu errado, não pro que só está parado. */
  grave?: boolean;
  destino: PainelDestino;
}

/**
 * Card de pendência: ícone no topo, número em corpo grande, rótulo, e o detalhe apagado no rodapé.
 *
 * A leitura acontece nessa ordem e em três pesos diferentes — é o que a faixa larga não permitia,
 * onde número, rótulo e detalhe eram todos texto do mesmo tamanho na mesma linha.
 */
function PendenciaCard({ p, i, onIr }: { p: Pendencia; i: number; onIr: () => void }) {
  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, delay: Math.min(i * 0.03, 0.3) }}
      onClick={onIr}
      className={`${CARD_BASE} flex h-full flex-col items-start gap-3 p-4 text-left ${
        p.grave ? 'border-destructive/40 bg-destructive/10' : 'border-brand bg-card'
      }`}
    >
      <span
        className={`grid size-9 shrink-0 place-items-center rounded-full ${
          p.grave ? 'bg-destructive/15 text-destructive' : 'bg-primary text-primary-foreground'
        }`}
      >
        {p.icone}
      </span>
      <span className="mt-auto block w-full leading-none">
        <span className="block text-4xl font-bold tabular-nums">{p.quantidade}</span>
        <span className="mt-1.5 block text-sm font-semibold leading-tight">{p.titulo}</span>
        <span className="mt-1.5 flex items-center gap-1 text-xs leading-tight text-muted-foreground">
          {p.detalhe}
          <ChevronRight className="size-3 shrink-0" />
        </span>
      </span>
    </motion.button>
  );
}

/**
 * As pendências, da mais urgente pra menos.
 *
 * A ordem é deliberada: primeiro o que já quebrou (falha, conta caída), depois o que vai quebrar se
 * ninguém olhar (fila atrasada), e por último o que só está esperando uma decisão (rascunho).
 */
function construirPendencias(resumo: Summary | null, accounts: { status: string }[]): Pendencia[] {
  if (!resumo) return [];
  const out: Pendencia[] = [];
  const s = resumo.por_status;

  // Os textos são curtos de propósito: no card quadrado o rótulo tem duas linhas, não uma faixa
  // inteira, e a contagem já é dita pelo número grande — repeti-la na frase seria dizer duas vezes.
  const falhas = (s.failed ?? 0) + (s.ambiguous ?? 0);
  if (falhas > 0) {
    out.push({
      id: 'falhas',
      quantidade: falhas,
      titulo: plural(falhas, 'publicação falhou', 'publicações falharam'),
      detalhe: 'reativar ou excluir',
      icone: <AlertTriangle className="size-4" />,
      grave: true,
      destino: { tipo: 'agenda', status: 'failed' },
    });
  }

  const reauth = accounts.filter((a) => a.status === 'needs_reauth').length;
  if (reauth > 0) {
    out.push({
      id: 'reauth',
      quantidade: reauth,
      titulo: plural(reauth, 'conta caiu', 'contas caíram'),
      detalhe: 'reconectar',
      icone: <Link2 className="size-4" />,
      grave: true,
      destino: { tipo: 'conexoes' },
    });
  }

  if (resumo.atencao.atrasados > 0) {
    out.push({
      id: 'atrasados',
      quantidade: resumo.atencao.atrasados,
      titulo: plural(resumo.atencao.atrasados, 'devia ter saído', 'deviam ter saído'),
      detalhe: 'na fila, data vencida',
      icone: <Clock className="size-4" />,
      grave: true,
      destino: { tipo: 'agenda', status: 'queued' },
    });
  }

  // Rascunho vencido e rascunho em dia são a MESMA linha em dois tons: se algum ficou pra trás, é
  // isso que precisa ser dito; senão, basta lembrar que os rascunhos existem. Mostrar as duas
  // versões ao mesmo tempo seria contar o mesmo rascunho duas vezes.
  const rascunhos = s.draft ?? 0;
  const vencidos = resumo.atencao.rascunhos_vencidos;
  if (vencidos > 0) {
    out.push({
      id: 'rascunhos-vencidos',
      quantidade: vencidos,
      titulo: plural(vencidos, 'rascunho pra trás', 'rascunhos pra trás'),
      detalhe: 'a data já passou',
      icone: <CalendarClock className="size-4" />,
      destino: { tipo: 'agenda', status: 'draft' },
    });
  } else if (rascunhos > 0) {
    out.push({
      id: 'rascunhos',
      quantidade: rascunhos,
      titulo: plural(rascunhos, 'rascunho esperando', 'rascunhos esperando'),
      detalhe: 'definir data e enviar',
      icone: <FileText className="size-4" />,
      destino: { tipo: 'agenda', status: 'draft' },
    });
  }

  return out;
}

/**
 * Card do que sai a seguir: a CAPA é o herói, ocupando o quadrado inteiro do topo.
 *
 * É o princípio nº 1 do design system aplicado aqui — quem reconhece um post é a imagem, não a
 * legenda. Na versão em faixa a capa era uma miniatura de 44px ao lado do texto, e olhar o painel
 * não dizia o que ia sair, só que algo ia.
 *
 * O horário fica SOBRE a imagem, num selo: é a informação decisiva do card ("falta muito?"), e em
 * cima da capa ela é lida junto com ela, em vez de disputar espaço com a legenda embaixo.
 */
function ProximoCard({ p, i, onAbrir }: { p: ProximoPost; i: number; onAbrir: () => void }) {
  const formato = PLATFORM_FORMATS[p.platform]?.find((f) => f.id === p.formato)?.label;
  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, delay: Math.min(i * 0.03, 0.3) }}
      onClick={onAbrir}
      className={`${CARD_BASE} flex flex-col overflow-hidden border-brand bg-card text-left`}
    >
      <span className="relative block aspect-square w-full overflow-hidden bg-secondary">
        {p.media ? (
          <Thumb media={p.media} fill />
        ) : (
          <span className="grid size-full place-items-center">
            <PlatformIcon platform={p.platform} className="size-8 opacity-40" />
          </span>
        )}
        {/* Selo claro com borda, e não texto solto sobre a foto: a capa pode ser clara ou escura,
            e só o contraste do texto não sobrevive às duas. */}
        <span className="absolute left-1.5 top-1.5 rounded-md border-2 border-brand bg-card px-1.5 py-0.5 text-[11px] font-bold tabular-nums">
          {fmtQuando(p.scheduled_for)}
        </span>
      </span>
      <span className="block min-w-0 p-2.5 leading-snug">
        <span className="block truncate text-sm font-semibold">
          {p.titulo || <span className="text-muted-foreground">sem legenda</span>}
        </span>
        <span className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
          <PlatformIcon platform={p.platform} className="size-3.5 shrink-0" />
          <span className="truncate">{p.account_name}</span>
          {formato && <span className="shrink-0">· {formato}</span>}
        </span>
      </span>
    </motion.button>
  );
}

/** Bloco com título — mesmo formato dos Insights, pro olho reconhecer a divisão nas duas telas. */
function Secao({ titulo, className, children }: { titulo: string; className?: string; children: ReactNode }) {
  return (
    <section className={className}>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</h3>
      {children}
    </section>
  );
}

/**
 * Card estático: número sem hover nenhum, porque não navega — é assim que se distingue de um card
 * clicável num relance (ver web/design.md). Mesma composição do card de pendência.
 *
 * SEM altura mínima: a grade já iguala os cards de uma fileira pela altura do mais alto, então um
 * piso fixo só servia pra criar um vão de ar no meio dos que têm texto curto — foi exatamente o
 * que aconteceu com 13rem. Quem dá presença ao card é o corpo do número, não o espaço vazio.
 */
function Numero({ icone, rotulo, valor }: { icone: ReactNode; rotulo: string; valor: string }) {
  return (
    <div className="flex h-full flex-col items-start gap-3 rounded-xl border-2 border-brand bg-card p-4 shadow-[3px_3px_0_0_var(--brand)]">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-secondary text-accent-foreground">
        {icone}
      </span>
      <span className="mt-auto block leading-none">
        <span className="block text-4xl font-bold tabular-nums">{valor}</span>
        <span className="mt-1.5 block text-sm font-semibold leading-tight">{rotulo}</span>
      </span>
    </div>
  );
}

function LinhaInsights({ children, onIr }: { children: ReactNode; onIr: () => void }) {
  return (
    <button
      type="button"
      onClick={onIr}
      className="flex w-full cursor-pointer items-center gap-2 rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground transition-colors hover:bg-muted/40"
    >
      {children}
      <span className="ml-auto flex shrink-0 items-center gap-1 font-medium text-accent-foreground">
        ver Insights
        <ArrowRight className="size-3.5" />
      </span>
    </button>
  );
}

/** Mesma âncora que o vazio da lista usa: uma hora à frente, no formato do input datetime-local. */
function daquiUmaHora(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
