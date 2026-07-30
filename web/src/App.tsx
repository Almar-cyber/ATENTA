import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { SchedulerProvider, useScheduler } from '@/store';
import type { View } from '@/store';
import { PLATFORM_COLORS, PLATFORM_LABELS } from '@/lib/platforms';
import type { Post } from '@/lib/types';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PostComposer } from '@/components/PostComposer';
import type { KeyedPreviewInput } from '@/components/PostComposer';
import { PostPreview } from '@/components/PostPreview';
import { AlertBanner } from '@/components/AlertBanner';
import { ListView } from '@/components/ListView';
import { CalendarView } from '@/components/CalendarView';
import { GridPlanner } from '@/components/GridPlanner';
import { PostDialog } from '@/components/PostDialog';
import type { DialogSelection } from '@/components/PostDialog';

function Header() {
  const { accounts } = useScheduler();
  return (
    <header className="border-b bg-card px-6 py-4">
      <h1 className="text-xl font-semibold tracking-tight">Social Scheduler</h1>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {accounts.map((a) => (
          <span
            key={a.id}
            className={`rounded-full border py-0.5 pl-2 pr-2.5 text-xs ${a.status === 'active' ? 'bg-secondary text-secondary-foreground' : 'bg-muted text-muted-foreground'}`}
            style={{ borderLeft: `3px solid ${PLATFORM_COLORS[a.platform]}` }}
          >
            {PLATFORM_LABELS[a.platform]}: {a.display_name}
          </span>
        ))}
      </div>
    </header>
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
  const { posts, accounts, filters, setFilters } = useScheduler();
  const [view, setView] = useState<View>('list');
  const [selection, setSelection] = useState<DialogSelection | null>(null);
  const [previewItems, setPreviewItems] = useState<KeyedPreviewInput[]>([]);

  const visible = useMemo(() => accountFilter(posts, filters.account), [posts, filters.account]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <AlertBanner
        onSeeFailures={() => {
          setFilters({ status: 'failed' });
          setView('list');
        }}
      />
      <main className="grid items-start gap-5 p-6 lg:grid-cols-[360px_1fr]">
        <PostComposer onPreviewChange={setPreviewItems} />

        <AnimatePresence>
          {previewItems.length > 0 && (
            <motion.section
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="rounded-xl border bg-card p-4 lg:col-span-2"
            >
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pré-visualização</p>
              <div className="flex flex-wrap gap-3">
                {previewItems.map(({ accountId, input }) => (
                  <PostPreview key={accountId} input={input} />
                ))}
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        <section className="rounded-xl border bg-card p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">Posts agendados</h2>
            <div className="flex flex-wrap items-center gap-2">
              <Tabs value={view} onValueChange={(v) => setView(v as View)}>
                <TabsList>
                  <TabsTrigger value="list">Lista</TabsTrigger>
                  <TabsTrigger value="calendar">Calendário</TabsTrigger>
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

          <div className="overflow-x-auto">
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
              {view === 'calendar' && <CalendarView posts={visible} onOpen={setSelection} />}
              {view === 'grid' && <GridPlanner posts={visible} onOpen={setSelection} />}
            </motion.div>
          </div>
        </section>
      </main>

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
