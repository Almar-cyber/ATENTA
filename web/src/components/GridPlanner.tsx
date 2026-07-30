import { useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import type { Post, Target } from '@/lib/types';
import { isVideoMime } from '@/lib/platforms';
import { fmtDateTime } from '@/lib/format';
import { reschedule } from '@/lib/api';
import { useScheduler } from '@/store';
import { Button } from '@/components/ui/button';
import type { DialogSelection } from './PostDialog';

interface Entry {
  post: Post;
  target: Target;
}

// Instagram posts still in play, newest first (top-left = next to publish, like a real IG profile).
function gridEntries(posts: Post[]): Entry[] {
  const out: Entry[] = [];
  for (const post of posts) {
    for (const target of post.targets) {
      if (target.platform !== 'instagram') continue;
      if (target.status === 'published' || target.status === 'canceled' || target.status === 'failed') continue;
      out.push({ post, target });
    }
  }
  out.sort((a, b) => (a.post.scheduled_for < b.post.scheduled_for ? 1 : -1));
  return out;
}

export function GridPlanner({ posts, onOpen }: { posts: Post[]; onOpen: (s: DialogSelection) => void }) {
  const { reload } = useScheduler();
  const entries = useMemo(() => gridEntries(posts), [posts]);
  const [undo, setUndo] = useState<string[] | null>(null);
  const dragId = useRef<string | null>(null);

  async function sendOrder(orderPostIds: string[], undoSnapshot: string[] | null, okMsg: string) {
    // Grid is newest-first; server assigns the earliest slot to the first id, so send reversed.
    try {
      await reschedule(orderPostIds.slice().reverse());
      setUndo(undoSnapshot);
      await reload();
      toast.success(okMsg);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  function onDrop(toId: string) {
    const fromId = dragId.current;
    dragId.current = null;
    if (!fromId || fromId === toId) return;
    const order = entries.map((e) => e.post.id);
    const from = order.indexOf(fromId);
    const to = order.indexOf(toId);
    if (from === -1 || to === -1) return;
    const before = order.slice();
    order.splice(to, 0, order.splice(from, 1)[0]);
    sendOrder(order, before, 'Ordem atualizada — horários redistribuídos.');
  }

  if (entries.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Nenhum post do Instagram na fila para planejar.</p>;
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <span>Arraste para reordenar — os horários já agendados são redistribuídos na nova ordem.</span>
        <Button size="sm" variant="outline" disabled={!undo} onClick={() => undo && sendOrder(undo, null, 'Ordem anterior restaurada.')}>
          Desfazer
        </Button>
      </div>

      <div className="grid max-w-lg grid-cols-3 gap-1">
        {entries.map(({ post, target }) => {
          const m = target.media[0];
          const video = isVideoMime(m?.mime_type);
          return (
            <motion.div
              layout
              key={post.id}
              draggable
              onDragStart={() => (dragId.current = post.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(post.id)}
              onClick={() => onOpen({ post, target })}
              className="group relative aspect-square cursor-grab overflow-hidden bg-muted active:cursor-grabbing"
            >
              {m?.public_url ? (
                video ? (
                  <video src={m.public_url} muted preload="metadata" className="size-full object-cover" />
                ) : (
                  <img src={m.public_url} alt="" className="size-full object-cover" />
                )
              ) : (
                <div className="grid size-full place-items-center text-lg text-muted-foreground">{target.media.length ? '🖼' : '✍'}</div>
              )}
              {target.status === 'draft' && (
                <span className="absolute left-1 top-1 rounded bg-black/65 px-1.5 py-0.5 text-[9px] font-bold text-white">rascunho</span>
              )}
              {target.media.length > 1 && <span className="absolute right-1 top-1 text-xs text-white drop-shadow">▣</span>}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1 pb-0.5 pt-3 text-center text-[10px] text-white">
                {fmtDateTime(post.scheduled_for)}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
