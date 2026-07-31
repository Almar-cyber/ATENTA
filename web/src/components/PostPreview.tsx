import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Platform, QueuedMedia } from '@/lib/types';
import {
  PLATFORM_CAPTION_LIMITS,
  PLATFORM_COLORS,
  PLATFORM_LABELS,
  PLATFORM_PREVIEW_SHAPE,
  PLATFORM_RECOMMENDED_MEDIA,
  findFormat,
  isVideoMime,
} from '@/lib/platforms';
import { useMediaUrl, videoPosterUrl } from '@/lib/useMediaUrl';
import { PlatformIcon } from './PlatformIcon';

export interface PreviewInput {
  platform: Platform;
  accountName: string;
  caption: string;
  title?: string;
  media: QueuedMedia[];
  /** Formato escolhido no compositor ('post' | 'reel' | 'story' | 'video' | 'short'). É ele que
   *  define a proporção do preview e o rótulo — não o tipo do arquivo. */
  format?: string;
  /** Imagem de capa escolhida no composer. É o que a rede mostra parado no feed, então tem
   *  prioridade sobre o frame do vídeo na pré-visualização. */
  cover?: File;
}

const SHAPE_ASPECT: Record<string, string> = {
  square: '1 / 1',
  story: '9 / 16',
  wide: '16 / 9',
  tall: '3 / 4',
};

function MediaFrame({ item, cover }: { item: QueuedMedia | undefined; cover?: File }) {
  const url = useMediaUrl(item);
  const coverUrl = useMediaUrl(cover ? { key: 'cover', file: cover, name: cover.name, mime_type: cover.type } : undefined);
  const [broken, setBroken] = useState(false);
  const video = isVideoMime(item?.mime_type);

  // Vídeo com capa escolhida: mostra a capa, que é exatamente o que vai aparecer no feed.
  if (video && coverUrl) {
    return <img src={coverUrl} alt="" className="h-full w-full object-cover" />;
  }
  if (!item || !url || broken) {
    return <div className="flex h-full items-center justify-center text-xs text-muted-foreground">{video ? 'vídeo' : item ? 'imagem' : 'sem mídia'}</div>;
  }
  return video ? (
    <video src={videoPosterUrl(url)} muted playsInline preload="metadata" className="h-full w-full object-cover" onError={() => setBroken(true)} />
  ) : (
    <img src={url} alt="" className="h-full w-full object-cover" onError={() => setBroken(true)} />
  );
}

export function PostPreview({ input }: { input: PreviewInput }) {
  const { platform, accountName, caption, title, media, format, cover } = input;
  const color = PLATFORM_COLORS[platform];
  const limit = PLATFORM_CAPTION_LIMITS[platform];
  const over = limit != null && caption.length > limit;
  const shownCaption = useMemo(() => (over ? caption.slice(0, limit) : caption), [over, caption, limit]);
  // Índice do carrossel. Clampado na renderização porque a fila de mídia pode encolher (remover um
  // item) enquanto o índice ainda aponta pro slot antigo.
  const [index, setIndex] = useState(0);
  const safeIndex = Math.min(index, Math.max(0, media.length - 1));
  const current = media[safeIndex];

  // Proporção, rótulo e tamanho ideal vêm do FORMATO escolhido (Reel é 9:16, post de feed é 4:5),
  // não do arquivo — é o formato que decide onde a peça vai parar na rede.
  const spec = findFormat(platform, format);
  const isStory = spec?.id === 'story';
  const label = spec && spec.id !== 'post' && spec.id !== 'video' ? `${PLATFORM_LABELS[platform]} · ${spec.label}` : PLATFORM_LABELS[platform];
  const shape = spec?.shape ?? PLATFORM_PREVIEW_SHAPE[platform];
  const recommended = spec?.recommended ?? PLATFORM_RECOMMENDED_MEDIA[platform];
  const willCrop = useMemo(() => {
    if (!current?.width || !current?.height) return false;
    const fileRatio = current.width / current.height;
    const targetRatio = recommended.width / recommended.height;
    return Math.abs(fileRatio - targetRatio) > 0.02;
  }, [current?.width, current?.height, recommended.width, recommended.height]);

  return (
    // Só borda, sem sombra deslocada: o preview vive dentro de uma coluna com scroll (composer e
    // dialog), e ali a sombra sólida era cortada pelo overflow, aparecendo como um canto quebrado.
    <div className="w-full max-w-[300px] overflow-hidden rounded-2xl border-2 border-foreground bg-card">
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
            {label}
          </div>
        </div>
      </div>

      {media.length > 0 ? (
        <div
          className="group/carousel relative w-full overflow-hidden bg-muted"
          style={{ aspectRatio: SHAPE_ASPECT[shape], maxHeight: 340 }}
        >
          <MediaFrame item={media[safeIndex]} cover={cover} />
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

      <div className="border-t px-3 py-2 text-xs text-muted-foreground">
        <div>
          Ideal: {recommended.width}×{recommended.height}px ({recommended.ratio})
        </div>
        {current?.width && current?.height && (
          <div className={willCrop ? 'text-destructive' : ''}>
            Seu arquivo: {current.width}×{current.height}px{willCrop ? ' — será cortado' : ' ✓'}
          </div>
        )}
      </div>
    </div>
  );
}
