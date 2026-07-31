import { useState } from 'react';
import { AlertTriangle, ImageIcon, Layers, PenLine } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Post, Target } from '@/lib/types';
import { PLATFORM_LABELS, STATUS_META, findFormat, isVideoMime } from '@/lib/platforms';
import { fmtDateTime } from '@/lib/format';
import { videoPosterUrl } from '@/lib/useMediaUrl';
import { Badge } from '@/components/ui/badge';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { PlatformAvatar } from './PlatformAvatar';

const SHAPE_ASPECT: Record<string, string> = {
  square: '1 / 1',
  story: '9 / 16',
  wide: '16 / 9',
  tall: '3 / 4',
};

/**
 * Cartão que aparece ao passar o mouse num chip do calendário.
 *
 * O chip cabe só o nome da conta, então antes o resto era um `title=` do navegador — texto puro,
 * lento e sem a única informação que importa pra reconhecer o post: a imagem. Aqui a peça aparece
 * na proporção do formato em que vai ser publicada, com legenda e conta, sem precisar abrir nada.
 */
export function PostHoverCard({ post, target, children }: { post: Post; target: Target; children: ReactNode }) {
  const [broken, setBroken] = useState(false);
  const media = target.media[0];
  const video = isVideoMime(media?.mime_type);
  const format = findFormat(target.platform, target.options?.format as string | undefined);
  const aspect = SHAPE_ASPECT[format?.shape ?? 'square'];
  const status = STATUS_META[target.status];
  const caption = target.caption_override ?? post.body ?? '';
  const heading = post.title || caption;

  return (
    <HoverCard openDelay={220} closeDelay={80}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent side="right" align="start" className="w-64 overflow-hidden p-0">
        <div className="relative w-full bg-muted" style={{ aspectRatio: aspect, maxHeight: 260 }}>
          {media?.public_url && !broken ? (
            video ? (
              <video
                src={videoPosterUrl(media.public_url)}
                muted
                preload="metadata"
                className="size-full object-cover"
                onError={() => setBroken(true)}
              />
            ) : (
              <img
                src={media.public_url}
                alt=""
                loading="lazy"
                decoding="async"
                className="size-full object-cover"
                onError={() => setBroken(true)}
              />
            )
          ) : (
            <div className="grid size-full place-items-center text-muted-foreground">
              {target.media.length ? <ImageIcon className="size-6" /> : <PenLine className="size-6" />}
            </div>
          )}

          {target.media.length > 1 && <Layers className="absolute right-2 top-2 size-4 text-white drop-shadow" />}
          {format && format.id !== 'post' && format.id !== 'video' && (
            <span className="absolute left-2 top-2 rounded-md bg-black/65 px-1.5 py-0.5 text-[11px] font-medium text-white">
              {format.label}
            </span>
          )}
        </div>

        <div className="space-y-2 p-3">
          {heading ? (
            <p className="line-clamp-2 text-sm font-semibold leading-snug">{heading}</p>
          ) : (
            <p className="text-sm font-semibold text-muted-foreground">Sem legenda</p>
          )}

          <div className="flex items-center gap-2">
            <PlatformAvatar platform={target.platform} size="sm" />
            <div className="min-w-0 leading-tight">
              <div className="truncate text-sm text-muted-foreground">{target.account_name}</div>
              <div className="text-xs text-muted-foreground">{PLATFORM_LABELS[target.platform]}</div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 border-t pt-2">
            <span className="text-xs text-muted-foreground">{fmtDateTime(post.scheduled_for)}</span>
            <Badge variant="secondary" className={status.className}>
              {status.label}
            </Badge>
          </div>

          {target.status === 'failed' && target.last_error && (
            <p className="flex items-start gap-1.5 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" />
              <span className="line-clamp-2">{target.last_error}</span>
            </p>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
