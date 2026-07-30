import { Fragment, useMemo } from 'react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import type { Post, Target } from '@/lib/types';
import { PLATFORM_COLORS, PLATFORM_LABELS, STATUS_META } from '@/lib/platforms';
import { fmtDateTime, fmtDayHeader, dayKey } from '@/lib/format';
import { cancelTarget, queueTarget } from '@/lib/api';
import { requestPrefill } from '@/lib/composer-bus';
import { useScheduler } from '@/store';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Thumb } from './Thumb';
import type { DialogSelection } from './PostDialog';

export function ListView({ posts, onOpen }: { posts: Post[]; onOpen: (s: DialogSelection) => void }) {
  const { reload } = useScheduler();

  const rows = useMemo(() => {
    const out: Array<{ dayHeader?: string; post: Post; target: Target }> = [];
    let lastDay = '';
    for (const post of posts) {
      const k = dayKey(new Date(post.scheduled_for));
      let headerUsed = false;
      for (const target of post.targets) {
        const entry: { dayHeader?: string; post: Post; target: Target } = { post, target };
        if (!headerUsed && k !== lastDay) {
          entry.dayHeader = fmtDayHeader(post.scheduled_for);
          lastDay = k;
          headerUsed = true;
        }
        out.push(entry);
      }
    }
    return out;
  }, [posts]);

  async function act(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      toast.success(ok);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  if (posts.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Nada por aqui ainda.</p>;
  }

  return (
    <div className="divide-y">
      {rows.map(({ dayHeader, post, target }, i) => (
        <Fragment key={target.id}>
          {dayHeader && (
            <div className="pt-4 pb-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground first:pt-0">
              {dayHeader}
            </div>
          )}
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i * 0.015, 0.3) }}
            className={`flex items-center gap-3 py-2.5 ${target.status === 'failed' || target.status === 'ambiguous' ? 'bg-red-50/60 dark:bg-red-500/5' : ''}`}
          >
            <div className="w-28 shrink-0 text-xs text-muted-foreground">{fmtDateTime(post.scheduled_for)}</div>
            <div className="flex w-24 shrink-0 items-center gap-1.5 text-sm">
              <span className="size-2 rounded-full" style={{ background: PLATFORM_COLORS[target.platform] }} />
              {PLATFORM_LABELS[target.platform]}
            </div>
            <button
              onClick={() => onOpen({ post, target })}
              className="min-w-0 flex-1 truncate text-left text-sm hover:underline"
              title={target.caption_override ?? post.body ?? ''}
            >
              {target.caption_override ?? post.body ?? <span className="text-muted-foreground">(sem legenda)</span>}
            </button>
            <div className="flex w-12 shrink-0 items-center gap-1">
              {target.media.slice(0, 1).map((m) => (
                <Thumb key={m.id} media={m} />
              ))}
              {target.media.length > 1 && <span className="text-[10px] text-muted-foreground">+{target.media.length - 1}</span>}
            </div>
            <Badge className={`${STATUS_META[target.status].className} w-24 shrink-0 justify-center`} variant="secondary">
              {STATUS_META[target.status].label}
            </Badge>
            <div className="flex w-40 shrink-0 justify-end gap-1">
              {target.status === 'draft' && (
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => act(() => queueTarget(target.id), 'Movido para a fila.')}>
                  p/ fila
                </Button>
              )}
              {(target.status === 'draft' || target.status === 'queued') && (
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-red-600" onClick={() => act(() => cancelTarget(target.id), 'Cancelado.')}>
                  Cancelar
                </Button>
              )}
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => requestPrefill({ post, target })}>
                Duplicar
              </Button>
            </div>
          </motion.div>
        </Fragment>
      ))}
    </div>
  );
}
