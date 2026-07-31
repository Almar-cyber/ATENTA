import { Fragment, useMemo } from 'react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import type { Post, Target } from '@/lib/types';
import { PLATFORM_LABELS, STATUS_META } from '@/lib/platforms';
import { fmtDateTime, fmtDayHeader, dayKey } from '@/lib/format';
import { cancelTarget, queueTarget } from '@/lib/api';
import { requestPrefill } from '@/lib/composer-bus';
import { useScheduler } from '@/store';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Thumb } from './Thumb';
import { EmptyState } from '@/components/ui/empty-state';
import { PlatformAvatar } from './PlatformAvatar';
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
    return <EmptyState>Nada por aqui ainda.</EmptyState>;
  }

  return (
    <div className="space-y-4">
      {rows.map(({ dayHeader, post, target }, i) => (
        <Fragment key={target.id}>
          {dayHeader && (
            <div className={`text-sm font-semibold text-foreground ${i === 0 ? '' : 'pt-2'}`}>{dayHeader}</div>
          )}
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i * 0.015, 0.3) }}
            className={`group/row flex items-center gap-3 rounded-lg px-3 py-3 transition-colors ${target.status === 'failed' || target.status === 'ambiguous' ? 'bg-destructive/10 hover:bg-destructive/15' : 'bg-muted/60 hover:bg-muted'}`}
          >
            <PlatformAvatar platform={target.platform} />
            <div className="min-w-0 flex-1">
              <button
                onClick={() => onOpen({ post, target })}
                className="block max-w-full truncate text-left text-sm font-medium hover:underline"
                title={target.caption_override ?? post.body ?? ''}
              >
                {target.caption_override ?? post.body ?? <span className="text-muted-foreground">(sem legenda)</span>}
              </button>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {fmtDateTime(post.scheduled_for)} · {PLATFORM_LABELS[target.platform]}
              </div>
            </div>
            <div className="flex w-12 shrink-0 items-center gap-1">
              {target.media.slice(0, 1).map((m) => (
                <Thumb key={m.id} media={m} />
              ))}
              {target.media.length > 1 && <span className="text-xs text-muted-foreground">+{target.media.length - 1}</span>}
            </div>
            <Badge className={`${STATUS_META[target.status].className} shrink-0`} variant="secondary">
              {STATUS_META[target.status].label}
            </Badge>
            {/* Ações são terciárias: ficam discretas e só ganham cor no hover da linha. Antes o
                "Cancelar" (destrutivo, raro) era o elemento mais pesado da linha e o "Duplicar"
                (comum) quase sumia — hierarquia invertida. */}
            <div className="flex shrink-0 justify-end gap-1 opacity-60 transition-opacity group-hover/row:opacity-100">
              {target.status === 'draft' && (
                <Button size="sm" variant="ghost" onClick={() => act(() => queueTarget(target.id), 'Movido para a fila.')}>
                  p/ fila
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => requestPrefill({ post, target })}>
                Duplicar
              </Button>
              {(target.status === 'draft' || target.status === 'queued') && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => act(() => cancelTarget(target.id), 'Cancelado.')}
                >
                  Cancelar
                </Button>
              )}
            </div>
          </motion.div>
        </Fragment>
      ))}
    </div>
  );
}
