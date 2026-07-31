import type { Platform } from '@/lib/types';
import { PLATFORM_FORMATS, PLATFORM_LABELS } from '@/lib/platforms';
import { Label } from '@/components/ui/label';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { PlatformIcon } from './PlatformIcon';

/**
 * Escolha do formato dentro da rede (Post / Reel / Story no Instagram, Vídeo / Short no YouTube).
 *
 * Antes o formato era adivinhado do arquivo — anexou vídeo, virava Reel — e não havia como
 * publicar um vídeo no feed nem como saber, antes de publicar, onde a peça ia parar. Agora é uma
 * escolha explícita, e é ela que decide o `media_type` do container no Instagram.
 */
export function FormatPicker({
  platform,
  value,
  onChange,
}: {
  platform: Platform;
  value: string;
  onChange: (id: string) => void;
}) {
  const formats = PLATFORM_FORMATS[platform];
  if (!formats) return null;
  const current = formats.find((f) => f.id === value) ?? formats[0];

  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5">
        <PlatformIcon platform={platform} className="size-3.5" />
        Formato no {PLATFORM_LABELS[platform]}
      </Label>
      <ToggleGroup type="single" value={current.id} onValueChange={(v) => v && onChange(v)} className="justify-start">
        {formats.map((f) => (
          <ToggleGroupItem key={f.id} value={f.id}>
            {f.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <p className="text-xs text-muted-foreground">{current.hint}</p>
    </div>
  );
}
