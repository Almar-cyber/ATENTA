import type { Platform } from '@/lib/types';
import { PLATFORM_COLORS } from '@/lib/platforms';
import { cn } from '@/lib/utils';
import { PlatformIcon } from './PlatformIcon';

// O indicador de plataforma (quadrado/círculo colorido com o logo da rede) estava reescrito em 5
// lugares com tamanhos, raios e tons diferentes. Centralizado aqui pra todos ficarem iguais.
//
// `solid` = fundo na cor da marca com logo branco (listas, detalhe).
// `tint`  = fundo esmaecido com logo colorido (avatares do header).

const SIZES = {
  sm: { box: 'size-7', icon: 'size-4' },
  md: { box: 'size-8', icon: 'size-4' },
  lg: { box: 'size-9', icon: 'size-5' },
} as const;

export function PlatformAvatar({
  platform,
  size = 'lg',
  shape = 'square',
  tone = 'solid',
  muted = false,
  className,
  title,
}: {
  platform: Platform;
  size?: keyof typeof SIZES;
  shape?: 'square' | 'circle';
  tone?: 'solid' | 'tint';
  muted?: boolean;
  className?: string;
  title?: string;
}) {
  const { box, icon } = SIZES[size];
  const color = PLATFORM_COLORS[platform];
  return (
    <span
      title={title}
      className={cn(
        'grid shrink-0 place-items-center',
        box,
        shape === 'circle' ? 'rounded-full' : 'rounded-md',
        tone === 'solid' && 'text-white',
        muted && 'opacity-40',
        className
      )}
      // A cor de marca é exceção documentada aos tokens (ver design.md).
      style={tone === 'solid' ? { background: color } : { backgroundColor: `${color}1f` }}
    >
      <PlatformIcon platform={platform} className={icon} style={tone === 'tint' ? { color } : undefined} />
    </span>
  );
}
