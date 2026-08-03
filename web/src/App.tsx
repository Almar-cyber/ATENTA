import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { BarChart3, CheckCircle2, Link2, LogOut, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { SchedulerProvider, useScheduler } from '@/store';
import type { View } from '@/store';
import { PLATFORM_LABELS } from '@/lib/platforms';
import type { Post } from '@/lib/types';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PostComposer } from '@/components/PostComposer';
import { PlatformAvatar } from '@/components/PlatformAvatar';
import { AlertBanner } from '@/components/AlertBanner';
import { ListView } from '@/components/ListView';
import { WeekView } from '@/components/WeekView';
import { CalendarView } from '@/components/CalendarView';
import { GridPlanner } from '@/components/GridPlanner';
import { InsightsView } from '@/components/InsightsView';
import { ConnectionsView } from '@/components/ConnectionsView';
import { FilterMenu } from '@/components/FilterMenu';
import { PostDialog } from '@/components/PostDialog';
import { AuthView } from '@/components/AuthView';
import { useSession, signOut, type SessionUser } from '@/lib/auth';
import type { DialogSelection } from '@/components/PostDialog';

function Header({
  onNewPost,
  onOpenConnections,
  onOpenInsights,
  user,
  onSignedOut,
}: {
  onNewPost: () => void;
  onOpenConnections: () => void;
  onOpenInsights: () => void;
  user: SessionUser;
  onSignedOut: () => void;
}) {
  const { accounts } = useScheduler();
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 px-3 pb-2 pt-4 sm:gap-4 sm:px-6 sm:pt-6">
      {/* PNG, não SVG: o SVG do wordmark deformava o "A" e o "N" em alguns renderizadores. */}
      <img src="/atenta-wordmark.png" alt="ATENTA!" className="h-10 w-auto" />
      <div className="flex w-full items-center justify-end gap-3 sm:ml-auto sm:w-auto">
        {/* Avatares só no desktop: no mobile eles empurravam o "Novo post" pra quebrar, e a função
            (abrir Conexões) já está no botão ao lado. */}
        <button
          type="button"
          onClick={onOpenConnections}
          className="hidden flex-wrap items-center gap-1.5 rounded-full p-1 transition-colors hover:bg-muted sm:flex"
          title="Gerenciar conexões"
        >
          {accounts.length === 0 ? (
            <span className="px-1.5 text-xs text-muted-foreground">Nenhuma conta conectada</span>
          ) : (
            accounts.map((a) => (
              <PlatformAvatar
                key={a.id}
                platform={a.platform}
                size="md"
                shape="circle"
                tone="tint"
                muted={a.status !== 'active'}
                className="ring-2 ring-card"
                title={`${PLATFORM_LABELS[a.platform]} — ${a.display_name}${a.status !== 'active' ? ' (precisa reautenticar)' : ''}`}
              />
            ))
          )}
        </button>
        {/* Conexões e Insights são navegação secundária: só o ícone no mobile (rótulo hidden sm),
            pra sobrar a linha pro "Novo post" (o CTA primário, esse mantém o rótulo). */}
        <Button size="lg" variant="outline" onClick={onOpenConnections} aria-label="Conexões" className="px-3 sm:px-6">
          <Link2 className="size-4" />
          <span className="hidden sm:inline">Conexões</span>
        </Button>
        <Button size="lg" variant="outline" onClick={onOpenInsights} aria-label="Insights" className="px-3 sm:px-6">
          <BarChart3 className="size-4" />
          <span className="hidden sm:inline">Insights</span>
        </Button>
        <Button size="lg" onClick={onNewPost} className="flex-1 sm:flex-none">
          <Plus className="size-4" />
          Novo post
        </Button>
        {/* Num app multi-conta, saber EM QUAL conta você está deixou de ser detalhe: o mesmo
            navegador pode ter entrado com outro e-mail. Por isso o e-mail aparece no menu, e não
            só um botão "Sair" solto. O menu também afasta o Sair do CTA primário ao lado. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="lg" variant="outline" aria-label="Sua conta" className="px-3">
              <span className="grid size-5 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                {(user.name || user.email).trim().charAt(0).toUpperCase()}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="font-normal">
              <span className="block text-xs text-muted-foreground">Conectado como</span>
              <span className="block truncate font-medium">{user.email}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={async () => {
                try {
                  await signOut();
                } finally {
                  // Mesmo se o servidor recusar, revalidar é o certo: ou a sessão caiu (e a UI
                  // acompanha), ou continua válida (e a pessoa vê que não saiu, em vez de olhar
                  // uma tela de login que ainda tem sessão viva por baixo).
                  onSignedOut();
                }
              }}
            >
              <LogOut className="size-4" />
              Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

// Wide centered modal that keeps its children MOUNTED when closed (toggles opacity/scale rather
// than unmounting), so PostComposer's composer-bus subscriptions stay alive and a "duplicar" /
// "editar" / empty-slot click can open it with the payload already applied. Wide + internally split
// (form | preview) instead of a tall scroll, so nothing gets uncomfortably long.
function ComposerModal({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <div
      className={`fixed inset-0 z-40 flex items-center justify-center p-4 transition-opacity duration-200 ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
    >
      <div aria-hidden onClick={onClose} className="absolute inset-0 bg-foreground/25 backdrop-blur-[2px]" />
      <div
        className={`relative z-10 flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-card border-2 border-brand shadow-[6px_6px_0_0_var(--brand)] transition-transform duration-200 ${open ? 'scale-100' : 'scale-95'}`}
      >
        {children}
      </div>
    </div>
  );
}

function accountFilter(posts: Post[], accountId: string): Post[] {
  if (!accountId) return posts;
  const out: Post[] = [];
  for (const post of posts) {
    const targets = post.targets.filter((t) => t.account_id === accountId);
    if (targets.length) out.push({ ...post, targets });
  }
  return out;
}

function Dashboard({ user, onSignedOut }: { user: SessionUser; onSignedOut: () => void }) {
  const { posts, accounts, filters, setFilters, reload } = useScheduler();
  const [view, setView] = useState<View>('list');
  const [screen, setScreen] = useState<'scheduler' | 'connections' | 'insights'>('scheduler');
  const [selection, setSelection] = useState<DialogSelection | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [justConnected, setJustConnected] = useState(false);

  const openComposer = useCallback(() => setComposerOpen(true), []);
  const closeComposer = useCallback(() => setComposerOpen(false), []);

  // OAuth round-trip: o callback do Worker redireciona pra /?connected=<rede> (ou connect_error).
  // Lê o param no mount, atualiza as contas, abre o modal de sucesso e limpa a URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('connected');
    const err = params.get('connect_error');
    if (connected) {
      setScreen('connections');
      setJustConnected(true);
      reload().catch(() => {});
    } else if (err) {
      setScreen('connections');
      const reason = params.get('reason');
      const missing = reason?.startsWith('missing_') ? reason.slice('missing_'.length) : null;
      toast.error(
        missing
          ? `${err} ainda não está configurado — falta definir o secret ${missing} no Worker (wrangler secret put ${missing}).`
          : 'Não foi possível conectar a conta. Tente de novo.'
      );
    }
    if (connected || err) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [reload]);

  const visible = useMemo(() => accountFilter(posts, filters.account), [posts, filters.account]);

  // h-dvh (dynamic viewport height), não h-screen/100vh: no iOS o 100vh ignora a barra de endereço
  // e fica mais alto que a área visível, sobrando um branco rolável embaixo.
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <Header
        onNewPost={openComposer}
        onOpenConnections={() => setScreen('connections')}
        onOpenInsights={() => setScreen('insights')}
        user={user}
        onSignedOut={onSignedOut}
      />
      <AlertBanner
        onSeeFailures={() => {
          setFilters({ status: 'failed' });
          setView('list');
        }}
      />
      <main className="min-h-0 flex-1 px-3 pb-3 pt-2 sm:px-6 sm:pb-6">
        {screen === 'connections' ? (
          <ConnectionsView onBack={() => setScreen('scheduler')} />
        ) : screen === 'insights' ? (
          <InsightsView onBack={() => setScreen('scheduler')} />
        ) : (
        <section className="flex h-full flex-col rounded-2xl bg-card p-3 border-2 border-brand shadow-[4px_4px_0_0_var(--brand)] sm:p-5">
          <div className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold">Posts agendados</h2>
            {/* Abas à esquerda, Filtros à direita. No mobile a fileira ocupa a largura toda e o
                Filtros vai pro canto (ml-auto); no desktop fica compacto. */}
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <Tabs value={view} onValueChange={(v) => setView(v as View)}>
                <TabsList>
                  <TabsTrigger value="list">Lista</TabsTrigger>
                  <TabsTrigger value="week">Semana</TabsTrigger>
                  <TabsTrigger value="calendar">Mês</TabsTrigger>
                  <TabsTrigger value="grid">Grid IG</TabsTrigger>
                </TabsList>
              </Tabs>
              <div className="ml-auto sm:ml-0">
                <FilterMenu filters={filters} setFilters={setFilters} accounts={accounts} />
              </div>
            </div>
          </div>

          {/* overflow-hidden (não -auto): quem rola é cada view por dentro, com a barra de
              navegação dela fixa. Sem isso, rolar a Semana levava a nav do calendário junto. */}
          <div className="min-h-0 flex-1 overflow-hidden">
            {/* Remount-and-fade on view change (key={view}). No AnimatePresence/exit here on
                purpose: mode="wait" deadlocks when the 30s poll re-creates `visible` mid-exit,
                freezing the old view. Keying the div remounts instantly, then motion plays the
                enter. */}
            <motion.div
              key={view}
              className="h-full min-h-0"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.15 }}
            >
              {view === 'list' && <ListView posts={visible} onOpen={setSelection} />}
              {view === 'week' && <WeekView posts={visible} onOpen={setSelection} />}
              {view === 'calendar' && <CalendarView posts={visible} onOpen={setSelection} />}
              {view === 'grid' && <GridPlanner posts={visible} onOpen={setSelection} />}
            </motion.div>
          </div>
        </section>
        )}
      </main>

      <ComposerModal open={composerOpen} onClose={closeComposer}>
        <PostComposer onRequestOpen={openComposer} onDone={closeComposer} />
      </ComposerModal>

      <Dialog open={justConnected} onOpenChange={(v) => !v && setJustConnected(false)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader className="items-center gap-3 text-center">
            <CheckCircle2 className="size-12 text-green-600" />
            <DialogTitle className="text-lg">Conta conectada com sucesso!</DialogTitle>
          </DialogHeader>
          <div className="mt-2 flex flex-col gap-2">
            <Button
              size="lg"
              onClick={() => {
                setJustConnected(false);
                setScreen('scheduler');
                openComposer();
              }}
            >
              Agendar post
            </Button>
            <Button variant="outline" onClick={() => setJustConnected(false)}>
              Continuar conectando
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <PostDialog selection={selection} onClose={() => setSelection(null)} />
    </div>
  );
}

export default function App() {
  const { session, refresh } = useSession();

  // `loading` renderiza vazio de propósito: mostrar a tela de entrar enquanto a sessão é conferida
  // faria quem já está logado ver um pisca de login a cada refresh. Fundo da marca em vez de
  // branco puro pra troca não dar flash.
  if (session.status === 'loading') return <div className="min-h-dvh bg-background" />;

  if (session.status === 'out') return <AuthView onAuthenticated={() => void refresh()} />;

  // O SchedulerProvider só monta DEPOIS de haver sessão: ele dispara o carregamento de contas e
  // posts no mount, e sem sessão essas chamadas voltariam vazias e ficariam em cache no estado.
  return (
    <SchedulerProvider>
      <Dashboard user={session.user} onSignedOut={() => void refresh()} />
    </SchedulerProvider>
  );
}
