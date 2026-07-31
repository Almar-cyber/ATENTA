import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Platform, QueuedMedia } from '@/lib/types';
import {
  PLATFORM_CAPTION_LIMITS,
  PLATFORM_COLORS,
  PLATFORM_LABELS,
  PLATFORM_PREVIEW_SHAPE,
  isVideoMime,
} from '@/lib/platforms';
import { useMediaUrl } from '@/lib/useMediaUrl';
import { PlatformIcon } from './PlatformIcon';

export interface PreviewInput {
  platform: Platform;
  accountName: string;
  caption: string;
  title?: string;
  media: QueuedMedia[];
  isStory?: boolean;
}

const SHAPE_ASPECT: Record<string, string> = {
  square: '1 / 1',
  story: '9 / 16',
  wide: '16 / 9',
  tall: '3 / 4',
};

function MediaFrame({ item }: { item: QueuedMedia | undefined }) {
  const url = useMediaUrl(item);
  const [broken, setBroken] = useState(false);
  const video = isVideoMime(item?.mime_type);

  if (!item || !url || broken) {
    return <div className="flex h-full items-center justify-center text-xs text-muted-foreground">{video ? 'vídeo' : item ? 'imagem' : 'sem mídia'}</div>;
  }
  return video ? (
    <video src={url} muted playsInline preload="metadata" className="h-full w-full object-cover" onError={() => setBroken(true)} />
  ) : (
    <img src={url} alt="" className="h-full w-full object-cover" onError={() => setBroken(true)} />
  );
}

export function PostPreview({ input }: { input: PreviewInput }) {
  const { platform, accountName, caption, title, media, isStory } = input;
  const label = PLATFORM_LABELS[platform];
  const color = PLATFORM_COLORS[platform];
  const shape = isStory ? 'story' : PLATFORM_PREVIEW_SHAPE[platform];
  const limit = PLATFORM_CAPTION_LIMITS[platform];
  const over = limit != null && caption.length > limit;
  const shownCaption = useMemo(() => (over ? caption.slice(0, limit) : caption), [over, caption, limit]);
  // Índice do carrossel. Clampado na renderização porque a fila de mídia pode encolher (remover um
  // item) enquanto o índice ainda aponta pro slot antigo.
  const [index, setIndex] = useState(0);
  const safeIndex = Math.min(index, Math.max(0, media.length - 1));

  return (
    <div className="w-full max-w-[300px] overflow-hidden rounded-2xl bg-card shadow-soft ring-1 ring-foreground/5">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <div
          className="grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold text-white"
          style={{ background: color }}
        >
          {accountName.charAt(0).toUpperCase()}
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold">{accountName}</div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <PlatformIcon platform={platform} className="size-3 shrink-0" style={{ color }} />
            {isStory ? `${label} · Story` : label}
          </div>
        </div>
      </div>

      {media.length > 0 ? (
        <div
          className="group/carousel relative w-full overflow-hidden bg-muted"
          style={{ aspectRatio: SHAPE_ASPECT[shape], maxHeight: 340 }}
        >
          <MediaFrame item={media[safeIndex]} />
          {media.length > 1 && (
            <>
              <div className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white">
                {safeIndex + 1}/{media.length}
              </div>

              {/* Navegação do carrossel: dá pra conferir cada arquivo sem sair da pré-visualização. */}
              {safeIndex > 0 && (
                <button
                  type="button"
                  aria-label="Anterior"
                  onClick={() => setIndex(safeIndex - 1)}
                  className="absolute left-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white opacity-0 transition-opacity hover:bg-black/70 group-hover/carousel:opacity-100"
                >
                  <ChevronLeft className="size-4" />
                </button>
              )}
              {safeIndex < media.length - 1 && (
                <button
                  type="button"
                  aria-label="Próximo"
                  onClick={() => setIndex(safeIndex + 1)}
                  className="absolute right-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white opacity-0 transition-opacity hover:bg-black/70 group-hover/carousel:opacity-100"
                >
                  <ChevronRight className="size-4" />
                </button>
              )}

              <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1">
                {media.map((m, i) => (
                  <button
                    key={m.key}
                    type="button"
                    aria-label={`Ir para o item ${i + 1}`}
                    onClick={() => setIndex(i)}
                    className={`size-1.5 rounded-full transition-colors ${i === safeIndex ? 'bg-white' : 'bg-white/55 hover:bg-white/80'}`}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="flex h-24 items-center justify-center border-y bg-muted/50 text-xs text-muted-foreground">
          sem mídia
        </div>
      )}

      {platform === 'youtube' && title && <div className="px-3 pt-2.5 text-sm font-semibold">{title}</div>}

      {!isStory ? (
        <div className="whitespace-pre-wrap break-words px-3 py-2.5 text-sm leading-snug">
          {platform === 'instagram' && <span className="mr-1.5 font-semibold">{accountName}</span>}
          {shownCaption}
        </div>
      ) : caption ? (
        <div className="px-3 py-2.5 text-xs text-destructive">
          a legenda não aparece num Story — a API só publica a imagem/vídeo
        </div>
      ) : null}

      {over && (
        <div className="px-3 pb-2.5 text-xs text-destructive">
          cortado em {limit} caracteres ({caption.length} escritos)
        </div>
      )}
    </div>
  );
}
