import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ImageIcon, Layers, PenLine } from 'lucide-react';
import { toast } from 'sonner';
import type { Post, Target } from '@/lib/types';
import { isVideoMime } from '@/lib/platforms';
import { fmtDateTime } from '@/lib/format';
import { getAccountFeed, reschedule } from '@/lib/api';
import type { FeedItem } from '@/lib/api';
import { useScheduler } from '@/store';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import type { DialogSelection } from './PostDialog';

interface Entry {
  post: Post;
  target: Target;
}

// Most recent published posts to anchor the grid against — enough to fill several rows of
// context without letting the grid grow unbounded over the account's lifetime.
const MAX_PUBLISHED_ENTRIES = 18;

// Published entries anchor on when they actually went out; everything still in play anchors on
// its (re)schedulable slot.
function effectiveTimestamp({ post, target }: Entry): string {
  return target.status === 'published' ? target.published_at ?? post.scheduled_for : post.scheduled_for;
}

// Instagram tiles for the grid: the real published feed (capped to the most recent
// MAX_PUBLISHED_ENTRIES) plus everything still in play (shown in full, uncapped), so the grid
// shows how a new post will actually sit next to the already-published feed — newest first
// (top-left = next to publish, like a real IG profile).
function gridEntries(posts: Post[]): Entry[] {
  const upcoming: Entry[] = [];
  const published: Entry[] = [];
  for (const post of posts) {
    for (const target of post.targets) {
      if (target.platform !== 'instagram') continue;
      if (target.status === 'canceled' || target.status === 'failed') continue;
      (target.status === 'published' ? published : upcoming).push({ post, target });
    }
  }
  published.sort((a, b) => (effectiveTimestamp(a) < effectiveTimestamp(b) ? 1 : -1));
  const out = upcoming.concat(published.slice(0, MAX_PUBLISHED_ENTRIES));
  out.sort((a, b) => (effectiveTimestamp(a) < effectiveTimestamp(b) ? 1 : -1));
  return out;
}

export function GridPlanner({ posts, onOpen }: { posts: Post[]; onOpen: (s: DialogSelection) => void }) {
  const { reload, accounts } = useScheduler();
  const entries = useMemo(() => gridEntries(posts), [posts]);

  // Feed real do perfil, buscado ao vivo: é o que permite planejar a estética contra o que já
  // existe. Vem depois dos agendados na grade, que é a ordem em que o perfil vai ficar.
  const igAccount = accounts.find((a) => a.platform === 'instagram' && a.status === 'active');
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [feedError, setFeedError] = useState<string | null>(null);
  useEffect(() => {
    if (!igAccount) return;
    let alive = true;
    getAccountFeed(igAccount.id)
      .then((r) => {
        if (!alive) return;
        setFeed(r.items ?? []);
        setFeedError(r.error ?? null);
      })
      .catch((e) => alive && setFeedError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [igAccount?.id]);
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
    // Published posts are fixed anchors, not reorderable: reschedulePosts permutes scheduled_for
    // only among the exact set of ids it's given, so a published post's real, already-elapsed
    // scheduled_for must never enter that set. Excluding published entries here means an attempt
    // to drag one (or drop onto one) naturally no-ops below via a missing index, and every other
    // drag's payload stays free of published ids too.
    const order = entries.filter((e) => e.target.status !== 'published').map((e) => e.post.id);
    const from = order.indexOf(fromId);
    const to = order.indexOf(toId);
    // Silêncio aqui parecia "o arrastar não funciona" — o motivo real é sempre um post publicado
    // na jogada (o horário dele já passou, não dá pra redistribuir). Diz isso em vez de no-op.
    if (from === -1 || to === -1) {
      toast.error('Posts já publicados não entram na reordenação — arraste entre os agendados.');
      return;
    }
    const before = order.slice();
    order.splice(to, 0, order.splice(from, 1)[0]);
    sendOrder(order, before, 'Ordem atualizada — horários redistribuídos.');
  }

  if (entries.length === 0 && feed.length === 0) {
    return <EmptyState>Nenhum post do Instagram na fila para planejar.</EmptyState>;
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <span>Arraste para reordenar — os horários já agendados são redistribuídos na nova ordem.</span>
        <Button size="sm" variant="outline" disabled={!undo} onClick={() => undo && sendOrder(undo, null, 'Ordem anterior restaurada.')}>
          Desfazer
        </Button>
      </div>

      <div className="grid max-w-md grid-cols-3 gap-0.5">
        {entries.map(({ post, target }) => {
          const m = target.media[0];
          const video = isVideoMime(m?.mime_type);
          const published = target.status === 'published';
          return (
            <motion.div
              layout
              key={post.id}
              draggable={published ? undefined : true}
              onDragStart={published ? undefined : () => (dragId.current = post.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(post.id)}
              onClick={() => onOpen({ post, target })}
              className="group relative aspect-[3/4] cursor-grab overflow-hidden bg-muted active:cursor-grabbing"
            >
              {m?.public_url ? (
                video ? (
                  <video src={m.public_url} muted preload="metadata" className="size-full object-cover" />
                ) : (
                  <img src={m.public_url} alt="" className="size-full object-cover" />
                )
              ) : (
                <div className="grid size-full place-items-center text-muted-foreground">
                  {target.media.length ? <ImageIcon className="size-5" /> : <PenLine className="size-5" />}
                </div>
              )}
              {target.status === 'draft' && (
                <span className="absolute left-1 top-1 rounded-md bg-black/60 px-1.5 py-0.5 text-xs font-medium text-white">rascunho</span>
              )}
              {published && (
                <span className="absolute left-1 top-1 rounded-md bg-black/60 px-1.5 py-0.5 text-xs font-medium text-white">publicado</span>
              )}
              {target.media.length > 1 && <Layers className="absolute right-1 top-1 size-3.5 text-white drop-shadow" />}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1 pb-0.5 pt-3 text-center text-xs text-white">
                {fmtDateTime(post.scheduled_for)}
              </div>
            </motion.div>
          );
        })}

        {/* Já publicados no perfil (vindos da API do Instagram) — não arrastáveis: são âncoras. */}
        {feed.map((item) => (
          <a
            key={`feed-${item.id}`}
            href={item.permalink ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            title={item.caption ?? 'Post publicado no Instagram'}
            className="group relative block aspect-[3/4] overflow-hidden bg-muted"
          >
            {item.thumbnail_url ? (
              <img src={item.thumbnail_url} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
            ) : (
              <div className="grid size-full place-items-center text-muted-foreground">
                <ImageIcon className="size-5" />
              </div>
            )}
            <span className="absolute left-1 top-1 rounded-md bg-black/60 px-1.5 py-0.5 text-xs font-medium text-white">
              no perfil
            </span>
          </a>
        ))}
      </div>

      {feedError && (
        <p className="mt-3 text-xs text-muted-foreground">
          Não consegui carregar o feed do Instagram ({feedError}). A grade mostra só os agendados.
        </p>
      )}
    </div>
  );
}
