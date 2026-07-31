import { useState } from 'react';
import { ImageIcon, Film } from 'lucide-react';
import type { Media } from '@/lib/types';
import { isVideoMime } from '@/lib/platforms';

// Small media thumbnail with a graceful fallback: if public_url is null or fails to load (e.g. the
// R2 custom domain isn't reachable), show a glyph instead of a broken-image icon.
export function Thumb({ media, size = 32 }: { media: Media; size?: number }) {
  const [broken, setBroken] = useState(false);
  const video = isVideoMime(media.mime_type);
  const style = { width: size, height: size };

  if (!media.public_url || broken) {
    return (
      <span className="grid shrink-0 place-items-center rounded-sm bg-muted text-muted-foreground" style={style}>
        {video ? <Film className="size-4" /> : <ImageIcon className="size-4" />}
      </span>
    );
  }
  const cls = 'shrink-0 rounded-sm object-cover';
  return video ? (
    <video src={media.public_url} muted preload="metadata" className={cls} style={style} onError={() => setBroken(true)} />
  ) : (
    <img src={media.public_url} alt="" className={cls} style={style} onError={() => setBroken(true)} />
  );
}
