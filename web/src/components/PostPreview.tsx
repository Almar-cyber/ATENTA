import { useMemo, useState } from 'react';
import type { Platform, QueuedMedia } from '@/lib/types';
import {
  PLATFORM_CAPTION_LIMITS,
  PLATFORM_COLORS,
  PLATFORM_LABELS,
  PLATFORM_PREVIEW_SHAPE,
  isVideoMime,
} from '@/lib/platforms';
import { useMediaUrl } from '@/lib/useMediaUrl';

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

  return (
    <div className="w-full max-w-[300px] overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <div
          className="grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold text-white"
          style={{ background: color }}
        >
          {accountName.charAt(0).toUpperCase()}
        </div>
        <div className="leading-tight">
          <div className="text-[13px] font-semibold">{accountName}</div>
          <div className="text-[11px] text-muted-foreground">{isStory ? `${label} · Story` : label}</div>
        </div>
      </div>

      <div className="relative w-full bg-muted" style={{ aspectRatio: SHAPE_ASPECT[shape] }}>
        <MediaFrame item={media[0]} />
        {media.length > 1 && (
          <>
            <div className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-white">
              1/{media.length}
            </div>
            <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1">
              {media.map((m, i) => (
                <span key={m.key} className={`size-1.5 rounded-full ${i === 0 ? 'bg-white' : 'bg-white/55'}`} />
              ))}
            </div>
          </>
        )}
      </div>

      {platform === 'youtube' && title && <div className="px-3 pt-2.5 text-[13px] font-semibold">{title}</div>}

      {!isStory ? (
        <div className="whitespace-pre-wrap break-words px-3 py-2.5 text-[13px] leading-snug">
          {platform === 'instagram' && <span className="mr-1.5 font-semibold">{accountName}</span>}
          {shownCaption}
        </div>
      ) : caption ? (
        <div className="px-3 py-2.5 text-[11px] text-red-600 dark:text-red-400">
          a legenda não aparece num Story — a API só publica a imagem/vídeo
        </div>
      ) : null}

      {over && (
        <div className="px-3 pb-2.5 text-[11px] text-red-600 dark:text-red-400">
          cortado em {limit} caracteres ({caption.length} escritos)
        </div>
      )}
    </div>
  );
}
