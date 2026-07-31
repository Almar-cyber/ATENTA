import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { CheckCircle2, Link2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { SchedulerProvider, useScheduler } from '@/store';
import type { View } from '@/store';
import { PLATFORM_LABELS } from '@/lib/platforms';
import type { Post } from '@/lib/types';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PostComposer } from '@/components/PostComposer';
import { PlatformAvatar } from '@/components/PlatformAvatar';
import { AlertBanner } from '@/components/AlertBanner';
import { ListView } from '@/components/ListView';
import { WeekView } from '@/components/WeekView';
import { CalendarView } from '@/components/CalendarView';
import { GridPlanner } from '@/components/GridPlanner';
import { ConnectionsView } from '@/components/ConnectionsView';
import { PostDialog } from '@/components/PostDialog';
import type { DialogSelection } from '@/components/PostDialog';

function Header({ onNewPost, onOpenConnections }: { onNewPost: () => void; onOpenConnections: () => void }) {
  const { accounts } = useScheduler();
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 px-6 pb-2 pt-6">
      <h1 className="text-3xl font-bold tracking-tight">Social Scheduler</h1>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onOpenConnections}
          className="flex flex-wrap items-center gap-1.5 rounded-full p-1 transition-colors hover:bg-muted"
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
        <Button size="lg" variant="outline" onClick={onOpenConnections}>
          <Link2 className="size-4" />
          Conexões
        </Button>
        <Button size="lg" onClick={onNewPost}>
          <Plus className="size-4" />
          Novo post
        </Button>
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
        className={`relative z-10 flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-card shadow-soft-lg ring-1 ring-foreground/10 transition-transform duration-200 ${open ? 'scale-100' : 'scale-95'}`}
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

function Dashboard() {
  const { posts, accounts, filters, setFilters, reload } = useScheduler();
  const [view, setView] = useState<View>('list');
  const [screen, setScreen] = useState<'scheduler' | 'connections'>('scheduler');
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

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <Header onNewPost={openComposer} onOpenConnections={() => setScreen('connections')} />
      <AlertBanner
        onSeeFailures={() => {
          setFilters({ status: 'failed' });
          setView('list');
        }}
      />
      <main className="min-h-0 flex-1 px-6 pb-6 pt-2">
        {screen === 'connections' ? (
          <ConnectionsView onBack={() => setScreen('scheduler')} />
        ) : (
        <section className="flex h-full flex-col rounded-2xl bg-card p-5 shadow-soft ring-1 ring-foreground/5">
          <div className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold">Posts agendados</h2>
            <div className="flex flex-wrap items-center gap-2">
              <Tabs value={view} onValueChange={(v) => setView(v as View)}>
                <TabsList>
                  <TabsTrigger value="list">Lista</TabsTrigger>
                  <TabsTrigger value="week">Semana</TabsTrigger>
                  <TabsTrigger value="calendar">Mês</TabsTrigger>
                  <TabsTrigger value="grid">Grid IG</TabsTrigger>
                </TabsList>
              </Tabs>
              <FilterSelect
                value={filters.status || 'all'}
                onChange={(v) => setFilters({ status: v === 'all' ? '' : v })}
                width="w-36"
                options={[
                  ['all', 'todos os status'],
                  ['draft', 'Rascunho'],
                  ['queued', 'Na fila'],
                  ['publishing', 'Publicando'],
                  ['processing', 'Processando'],
                  ['published', 'Publicado'],
                  ['failed', 'Falhou'],
                  ['canceled', 'Cancelado'],
                  ['ambiguous', 'Indefinido'],
                ]}
              />
              <FilterSelect
                value={filters.platform || 'all'}
                onChange={(v) => setFilters({ platform: v === 'all' ? '' : v })}
                width="w-40"
                options={[['all', 'todas as plataformas'], ...Object.entries(PLATFORM_LABELS)]}
              />
              <FilterSelect
                value={filters.account || 'all'}
                onChange={(v) => setFilters({ account: v === 'all' ? '' : v })}
                width="w-44"
                options={[['all', 'todas as contas'], ...accounts.map((a) => [a.id, `${PLATFORM_LABELS[a.platform]} — ${a.display_name}`] as [string, string])]}
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {/* Remount-and-fade on view change (key={view}). No AnimatePresence/exit here on
                purpose: mode="wait" deadlocks when the 30s poll re-creates `visible` mid-exit,
                freezing the old view. Keying the div remounts instantly, then motion plays the
                enter. */}
            <motion.div
              key={view}
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

function FilterSelect({
  value,
  onChange,
  options,
  width,
}: {
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
  width: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={width} size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([v, label]) => (
          <SelectItem key={v} value={v}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default function App() {
  return (
    <SchedulerProvider>
      <Dashboard />
    </SchedulerProvider>
  );
}
