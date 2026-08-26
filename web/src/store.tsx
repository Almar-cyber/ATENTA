import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Account, Post } from './lib/types';
import type { Summary, Tag } from './lib/api';
import { getState } from './lib/api';

export type View = 'list' | 'week' | 'calendar' | 'grid';

export interface Filters {
  status: string;
  platform: string;
  account: string;
}

interface SchedulerState {
  accounts: Account[];
  posts: Post[];
  /** Pilares de conteúdo. No store porque três telas precisam da MESMA lista — compositor, ideias
   *  e Insights —, e cada uma buscando a sua deixaria uma delas sem ver o pilar recém-criado. */
  tags: Tag[];
  /** As mesmas contagens que o Painel mostra em "Precisa de você". No store pela mesma razão que
   *  as tags estão: o sino de notificações do cabeçalho precisa da MESMA leitura, em toda tela — se
   *  ele buscasse por conta própria, ele e o Painel poderiam discordar por uma fração de segundo. */
  summary: Summary | null;
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
  const [tags, setTags] = useState<Tag[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFiltersState] = useState<Filters>({ status: '', platform: '', account: '' });

  // Keep the latest server-side filters (status/platform) in a ref so the polling interval reads
  // current values without being re-created each change.
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const reload = useCallback(async () => {
    const f = filtersRef.current;
    // Uma requisição, não quatro: /api/state devolve contas+agenda+pilares+resumo juntos. O poll
    // é quem mais consome requisição do Worker, e requisição é o recurso contado do plano grátis.
    const s = await getState({ status: f.status || undefined, platform: f.platform || undefined });
    setAccounts(s.accounts);
    setPosts(s.posts);
    setTags(s.tags);
    setSummary(s.summary);
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

  // Poll a cada 60s, e só com a aba visível. Ferramenta de agendamento vive em aba de fundo, e
  // era de lá que vinha a maior parte das requisições: uma aba esquecida por 8h gerava milhares
  // sem ninguém olhando. Ao voltar pra aba, recarrega na hora em vez de esperar o próximo ciclo,
  // então quem está olhando nunca vê dado mais velho que 60s.
  useEffect(() => {
    const tick = () => {
      if (!document.hidden) reload().catch((e) => console.error(e));
    };
    const id = setInterval(tick, 60000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [reload]);

  const accountsById: Record<string, Account> = {};
  for (const a of accounts) accountsById[a.id] = a;

  return (
    <Ctx.Provider value={{ accounts, posts, tags, summary, accountsById, loading, filters, setFilters, reload }}>
      {children}
    </Ctx.Provider>
  );
}

export function useScheduler(): SchedulerState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useScheduler must be used within SchedulerProvider');
  return v;
}
