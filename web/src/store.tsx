import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Account, Post } from './lib/types';
import { getAccounts, getPosts } from './lib/api';

export type View = 'list' | 'calendar' | 'grid';

export interface Filters {
  status: string;
  platform: string;
  account: string;
}

interface SchedulerState {
  accounts: Account[];
  posts: Post[];
  accountsById: Record<string, Account>;
  loading: boolean;
  filters: Filters;
  setFilters: (f: Partial<Filters>) => void;
  reload: () => Promise<void>;
}

const Ctx = createContext<SchedulerState | null>(null);

export function SchedulerProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFiltersState] = useState<Filters>({ status: '', platform: '', account: '' });

  // Keep the latest server-side filters (status/platform) in a ref so the polling interval reads
  // current values without being re-created each change.
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const reload = useCallback(async () => {
    const f = filtersRef.current;
    const [acc, pst] = await Promise.all([
      getAccounts(),
      getPosts({ status: f.status || undefined, platform: f.platform || undefined }),
    ]);
    setAccounts(acc.accounts);
    setPosts(pst.posts);
    setLoading(false);
  }, []);

  const setFilters = useCallback(
    (patch: Partial<Filters>) => {
      setFiltersState((prev) => ({ ...prev, ...patch }));
    },
    []
  );

  // Reload whenever the server-side filters change (status/platform go into the query).
  useEffect(() => {
    reload().catch((e) => console.error(e));
  }, [reload, filters.status, filters.platform]);

  // Poll every 30s.
  useEffect(() => {
    const id = setInterval(() => reload().catch((e) => console.error(e)), 30000);
    return () => clearInterval(id);
  }, [reload]);

  const accountsById: Record<string, Account> = {};
  for (const a of accounts) accountsById[a.id] = a;

  return (
    <Ctx.Provider value={{ accounts, posts, accountsById, loading, filters, setFilters, reload }}>
      {children}
    </Ctx.Provider>
  );
}

export function useScheduler(): SchedulerState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useScheduler must be used within SchedulerProvider');
  return v;
}
