import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { motion } from 'motion/react';
import { CalendarPlus, ImagePlus, ImageIcon, Layers, Loader2, PenLine, X } from 'lucide-react';
import { toast } from 'sonner';
import type { GridPreview, Post, Target } from '@/lib/types';
import { ALLOWED_MIME_TYPES, isVideoMime } from '@/lib/platforms';
import { fmtDateTime } from '@/lib/format';
import { readMediaMetadata } from '@/lib/mediaMetadata';
import { requestPrefillMedia } from '@/lib/composer-bus';
import {
  createGridPreview,
  deleteGridPreview,
  getAccountFeed,
  getGridPreviews,
  reschedule,
  updateGridPreview,
  uploadMedia,
} from '@/lib/api';
import type { FeedItem } from '@/lib/api';
import { videoPosterUrl } from '@/lib/useMediaUrl';
import { planGridOrder, moveItem } from '@/lib/gridOrder';
import type { Movable } from '@/lib/gridOrder';
import { useScheduler } from '@/store';
import { Button } from '@/components/ui/button';
import type { DialogSelection } from './PostDialog';

const HOUR_MS = 3_600_000;

// Most recent published posts to anchor the grid against — enough to fill several rows of
// context without letting the grid grow unbounded over the account's lifetime.
const MAX_PUBLISHED_ENTRIES = 18;

// As três espécies de peça da grade. Só `post` (não publicado) e `preview` se movem; publicado —
// nosso registro ou o que veio do feed real — é âncora.
type Tile =
  | { kind: 'post'; key: string; domainId: string; at: string; movable: boolean; post: Post; target: Target }
  | { kind: 'feed'; key: string; domainId: string; at: string; movable: false; item: FeedItem }
  | { kind: 'preview'; key: string; domainId: string; at: string; movable: true; preview: GridPreview };

// Published entries anchor on when they actually went out; everything still in play anchors on
// its (re)schedulable slot.
function postTimestamp(post: Post, target: Target): string {
  return target.status === 'published' ? target.published_at ?? post.scheduled_for : post.scheduled_for;
}

// Monta a grade inteira numa lista só, ordenada pelo mesmo eixo de tempo: agendados (futuro) no
// topo, publicados e prévias no meio do caminho conforme a posição de cada um — que é como o
// perfil vai realmente ficar, mais novo no canto superior esquerdo.
function buildTiles(posts: Post[], feed: FeedItem[], previews: GridPreview[]): Tile[] {
  const upcoming: Tile[] = [];
  const published: Tile[] = [];
  const publishedExternalIds = new Set<string>();

  for (const post of posts) {
    for (const target of post.targets) {
      if (target.platform !== 'instagram') continue;
      if (target.status === 'canceled' || target.status === 'failed') continue;
      const isPublished = target.status === 'published';
      if (isPublished && target.external_post_id) publishedExternalIds.add(target.external_post_id);
      const tile: Tile = {
        kind: 'post',
        key: `post:${post.id}`,
        domainId: post.id,
        at: postTimestamp(post, target),
        movable: !isPublished,
        post,
        target,
      };
      (isPublished ? published : upcoming).push(tile);
    }
  }
  published.sort((a, b) => (a.at < b.at ? 1 : -1));

  const feedTiles: Tile[] = feed
    // O que publicamos daqui volta no feed da API também — fica com o nosso registro, que é
    // clicável e sabe a data agendada, em vez de aparecer duas vezes na grade.
    .filter((item) => !publishedExternalIds.has(item.id))
    .map((item) => ({
      kind: 'feed' as const,
      key: `feed:${item.id}`,
      domainId: item.id,
      at: item.published_at ?? '',
      movable: false as const,
      item,
    }));

  const previewTiles: Tile[] = previews.map((preview) => ({
    kind: 'preview' as const,
    key: `preview:${preview.id}`,
    domainId: preview.id,
    at: preview.sort_at,
    movable: true as const,
    preview,
  }));

  const all = upcoming.concat(published.slice(0, MAX_PUBLISHED_ENTRIES), feedTiles, previewTiles);
  all.sort((a, b) => (a.at < b.at ? 1 : -1));
  return all;
}

export function GridPlanner({ posts, onOpen }: { posts: Post[]; onOpen: (s: DialogSelection) => void }) {
  const { reload, accounts } = useScheduler();

  // Feed real do perfil, buscado ao vivo: é o que permite planejar a estética contra o que já
  // existe. As URLs de mídia do Instagram expiram, então nada disso é cacheado.
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

  const [previews, setPreviews] = useState<GridPreview[]>([]);
  const refreshPreviews = useCallback(async () => {
    const r = await getGridPreviews('instagram');
    setPreviews(r.previews ?? []);
  }, []);
  useEffect(() => {
    refreshPreviews().catch((e) => console.error(e));
  }, [refreshPreviews]);

  const [adding, setAdding] = useState(false);
  const [undo, setUndo] = useState<Movable[] | null>(null);
  const dragKey = useRef<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const tiles = useMemo(() => buildTiles(posts, feed, previews), [posts, feed, previews]);
  const movableTiles = useMemo(() => tiles.filter((t) => t.movable), [tiles]);
  const movable: Movable[] = useMemo(
    () => movableTiles.map((t) => ({ id: t.domainId, kind: t.kind === 'preview' ? 'preview' : 'post', at: t.at })),
    [movableTiles]
  );

  // Grava um arranjo novo: os posts só permutam entre si os horários que já tinham (é o servidor
  // que faz isso, em /api/posts/reschedule); as prévias, que não têm horário de publicação, só
  // recebem um `sort_at` interpolado entre os vizinhos.
  async function applyArrangement(next: Movable[], snapshot: Movable[] | null, okMsg: string) {
    const plan = planGridOrder(next);
    const currentSortAt = new Map(previews.map((p) => [p.id, p.sort_at]));
    const changedPreviews = Object.entries(plan.previewAt).filter(([id, at]) => currentSortAt.get(id) !== at);
    try {
      // A grade é mais-novo-primeiro e o servidor dá o horário mais cedo ao primeiro id — daí o reverse.
      if (plan.postOrder.length > 1) await reschedule(plan.postOrder.slice().reverse());
      await Promise.all(changedPreviews.map(([id, at]) => updateGridPreview(id, at)));
      setUndo(snapshot);
      await Promise.all([reload(), refreshPreviews()]);
      toast.success(okMsg);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  function onDrop(toKey: string) {
    const fromKey = dragKey.current;
    dragKey.current = null;
    if (!fromKey || fromKey === toKey) return;
    const from = movableTiles.findIndex((t) => t.key === fromKey);
    const to = movableTiles.findIndex((t) => t.key === toKey);
    // Silêncio aqui parecia "o arrastar não funciona" — o motivo real é sempre uma peça publicada
    // na jogada (o horário dela já passou, não dá pra redistribuir). Diz isso em vez de no-op.
    if (from === -1 || to === -1) {
      toast.error('O que já foi publicado é âncora e não muda de lugar — arraste entre agendados e prévias.');
      return;
    }
    applyArrangement(moveItem(movable, from, to), movable, 'Ordem atualizada.');
  }

  async function onAddPreviews(files: FileList | null) {
    if (!files?.length) return;
    const accepted = Array.from(files).filter((f) => ALLOWED_MIME_TYPES.includes(f.type));
    const rejected = Array.from(files).filter((f) => !ALLOWED_MIME_TYPES.includes(f.type));
    if (rejected.length) {
      toast.error(`Formato não suportado: ${rejected.map((f) => f.name).join(', ')} — use JPEG, PNG, MP4 ou MOV.`);
    }
    if (!accepted.length) return;

    // Entra no topo da grade (mais novo primeiro), sem encostar em horário de post nenhum.
    const topAt = tiles.length ? Date.parse(tiles[0].at) : Date.now();
    const base = Math.max(topAt, Date.now()) + HOUR_MS;

    setAdding(true);
    try {
      for (let i = 0; i < accepted.length; i++) {
        const file = accepted[i];
        const meta = await readMediaMetadata(file);
        const uploaded = await uploadMedia(file, meta);
        await createGridPreview({
          platform: 'instagram',
          media_asset_id: uploaded.id,
          sort_at: new Date(base + (accepted.length - i) * HOUR_MS).toISOString(),
        });
      }
      await refreshPreviews();
      toast.success(accepted.length > 1 ? `${accepted.length} prévias na grade.` : 'Prévia na grade.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function onRemovePreview(preview: GridPreview) {
    try {
      await deleteGridPreview(preview.id);
      await refreshPreviews();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  function onSchedulePreview(preview: GridPreview) {
    requestPrefillMedia({
      assetId: preview.media_asset_id,
      name: 'prévia',
      mime_type: preview.mime_type,
      public_url: preview.public_url,
      width: preview.width ?? undefined,
      height: preview.height ?? undefined,
    });
  }

  const dragProps = (tile: Tile) =>
    tile.movable
      ? {
          draggable: true,
          onDragStart: () => (dragKey.current = tile.key),
          onDragOver: (e: DragEvent) => e.preventDefault(),
          onDrop: () => onDrop(tile.key),
        }
      : { onDragOver: (e: React.DragEvent) => e.preventDefault(), onDrop: () => onDrop(tile.key) };

  return (
    <div className="h-full overflow-y-auto pb-2">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={adding} onClick={() => fileRef.current?.click()}>
          {adding ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
          Adicionar prévia
        </Button>
        <Button size="sm" variant="ghost" disabled={!undo} onClick={() => undo && applyArrangement(undo, null, 'Ordem anterior restaurada.')}>
          Desfazer
        </Button>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept={ALLOWED_MIME_TYPES.join(',')}
          className="hidden"
          onChange={(e) => onAddPreviews(e.target.files)}
        />
      </div>

      <p className="mb-3 max-w-md text-xs text-muted-foreground">
        Arraste para reordenar: os posts agendados só trocam entre si os horários que já têm; as prévias entram no meio
        sem ocupar horário nenhum. A grade do perfil corta tudo em 3:4 — no feed, o post mantém a proporção original.
      </p>

      <div className="grid max-w-md grid-cols-3 gap-0.5">
        {tiles.map((tile) => {
          if (tile.kind === 'preview') {
            const { preview } = tile;
            return (
              <motion.div
                layout
                key={tile.key}
                {...dragProps(tile)}
                className="group relative aspect-[3/4] cursor-grab overflow-hidden border-2 border-dashed border-brand bg-muted active:cursor-grabbing"
              >
                {preview.public_url ? (
                  isVideoMime(preview.mime_type) ? (
                    <video src={videoPosterUrl(preview.public_url)} muted preload="metadata" className="size-full object-cover" />
                  ) : (
                    <img src={preview.public_url} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
                  )
                ) : (
                  <div className="grid size-full place-items-center text-muted-foreground">
                    <ImageIcon className="size-5" />
                  </div>
                )}
                <span className="absolute left-1 top-1 rounded-md bg-primary px-1.5 py-0.5 text-xs font-medium text-primary-foreground">
                  prévia
                </span>
                <div className="absolute inset-x-0 bottom-0 flex justify-center gap-1 bg-gradient-to-t from-black/70 to-transparent px-1 pb-1 pt-4 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    title="Agendar esta mídia"
                    onClick={() => onSchedulePreview(preview)}
                    className="rounded-md bg-white/90 p-1 text-foreground hover:bg-white"
                  >
                    <CalendarPlus className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    title="Remover prévia"
                    onClick={() => onRemovePreview(preview)}
                    className="rounded-md bg-white/90 p-1 text-foreground hover:bg-white"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              </motion.div>
            );
          }

          if (tile.kind === 'feed') {
            const { item } = tile;
            return (
              <motion.a
                layout
                key={tile.key}
                href={item.permalink ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
                title={item.caption ?? 'Post publicado no Instagram'}
                {...dragProps(tile)}
                className="relative block aspect-[3/4] overflow-hidden bg-muted"
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
              </motion.a>
            );
          }

          const { post, target } = tile;
          const m = target.media[0];
          const published = target.status === 'published';
          return (
            <motion.div
              layout
              key={tile.key}
              {...dragProps(tile)}
              onClick={() => onOpen({ post, target })}
              className={`group relative aspect-[3/4] overflow-hidden bg-muted ${
                published ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'
              }`}
            >
              {m?.public_url ? (
                isVideoMime(m.mime_type) ? (
                  <video src={videoPosterUrl(m.public_url)} muted preload="metadata" className="size-full object-cover" />
                ) : (
                  <img src={m.public_url} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
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

        {/* Fica sempre no fim: ponto de entrada visível mesmo com a grade vazia. */}
        <button
          type="button"
          disabled={adding}
          onClick={() => fileRef.current?.click()}
          className="grid aspect-[3/4] place-items-center border-2 border-dashed border-border bg-muted/40 text-muted-foreground transition-colors hover:border-brand hover:text-foreground disabled:opacity-50"
        >
          {adding ? <Loader2 className="size-5 animate-spin" /> : <ImagePlus className="size-5" />}
        </button>
      </div>

      {feedError && (
        <p className="mt-3 max-w-md text-xs text-muted-foreground">
          Não consegui carregar o feed do Instagram ({feedError}). A grade mostra só os agendados e as prévias.
        </p>
      )}
    </div>
  );
}
