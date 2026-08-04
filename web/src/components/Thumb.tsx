import { useState } from 'react';
import { ImageIcon, Film } from 'lucide-react';
import type { Media } from '@/lib/types';
import { isVideoMime } from '@/lib/platforms';
import { videoPosterUrl } from '@/lib/useMediaUrl';

// Small media thumbnail with a graceful fallback: if public_url is null or fails to load (e.g. the
// R2 custom domain isn't reachable), show a glyph instead of a broken-image icon.
//
// `fill` troca o tamanho fixo em px por "ocupe o quadro do pai". Existe porque o Painel mostra a
// capa do post grande, num quadrado que acompanha a coluna da grade — e duplicar aqui a queda pro
// glyph (que é o motivo deste componente existir) só pra mudar o dimensionamento seria copiar a
// parte difícil pra evitar a fácil.
export function Thumb({ media, size = 32, fill = false }: { media: Media; size?: number; fill?: boolean }) {
  const [broken, setBroken] = useState(false);
  const video = isVideoMime(media.mime_type);
  const style = fill ? undefined : { width: size, height: size };
  const box = fill ? 'size-full' : 'shrink-0';

  if (!media.public_url || broken) {
    return (
      <span className={`grid place-items-center rounded-sm bg-muted text-muted-foreground ${box}`} style={style}>
        {video ? <Film className="size-4" /> : <ImageIcon className="size-4" />}
      </span>
    );
  }
  const cls = `rounded-sm object-cover ${box}`;
  return video ? (
    <video src={videoPosterUrl(media.public_url)} muted preload="metadata" className={cls} style={style} onError={() => setBroken(true)} />
  ) : (
    <img src={media.public_url} alt="" className={cls} style={style} onError={() => setBroken(true)} />
  );
}
