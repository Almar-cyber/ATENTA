import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Crop } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

// Proporções que a API de publicação do Instagram aceita. Fora desta faixa ela recusa o container —
// não existe corte do lado dela, por isso o corte acontece aqui, antes do upload.
export const CROP_PRESETS = [
  { id: '9:16', label: '9:16', hint: 'Vertical cheio — Reel, Story, Short', ratio: 9 / 16 },
  { id: '4:5', label: '4:5', hint: 'Retrato — ocupa mais o feed', ratio: 4 / 5 },
  { id: '1:1', label: '1:1', hint: 'Quadrado', ratio: 1 },
  { id: '1.91:1', label: '1.91:1', hint: 'Paisagem', ratio: 1.91 },
] as const;

// Largura máxima que a Meta serve; acima disso ela reescala sozinha, então não faz sentido subir mais.
const MAX_OUTPUT_WIDTH = 1440;
const FRAME_WIDTH = 300;

// O padrão é o formato escolhido no compositor (Reel → 9:16, post de feed → 4:5): é pra ele que a
// pessoa está recortando. Sem formato definido, cai no preset mais próximo do arquivo original.
function defaultPresetFor(width: number, height: number, targetRatio?: number): string {
  const ratio = targetRatio ?? width / height;
  let bestId: string = CROP_PRESETS[0].id;
  let bestDiff = Infinity;
  for (const p of CROP_PRESETS) {
    const diff = Math.abs(p.ratio - ratio);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestId = p.id;
    }
  }
  return bestId;
}

/**
 * Recorte com arrastar: a imagem entra preenchendo o quadro (sem sobra), e a pessoa escolhe o que
 * fica visível arrastando e/ou aproximando. Devolve um File novo — o original nunca é enviado.
 */
export function MediaCropDialog({
  file,
  targetRatio,
  onCancel,
  onDone,
}: {
  file: File | null;
  /** Proporção do formato escolhido no compositor — vira o preset inicial. */
  targetRatio?: number;
  onCancel: () => void;
  onDone: (cropped: File) => void;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [presetId, setPresetId] = useState<string>('4:5');
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  // Carrega a imagem e escolhe o preset mais próximo do formato original — quem manda uma foto de
  // celular em pé quer 4:5, não quadrado.
  useEffect(() => {
    if (!file) {
      setImg(null);
      return;
    }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      setImg(image);
      setPresetId(defaultPresetFor(image.naturalWidth, image.naturalHeight, targetRatio));
      setZoom(1);
      setOffset({ x: 0, y: 0 });
    };
    image.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file, targetRatio]);

  const ratio = CROP_PRESETS.find((p) => p.id === presetId)?.ratio ?? 4 / 5;
  const frameHeightCap = 340;
  const frameH = Math.min(FRAME_WIDTH / ratio, frameHeightCap);
  const frameW = frameH * ratio;

  // "cover": a menor escala que ainda cobre o quadro inteiro. O zoom multiplica a partir daí, então
  // nunca sobra borda vazia por mais que se arraste.
  const baseScale = img ? Math.max(frameW / img.naturalWidth, frameH / img.naturalHeight) : 1;
  const scale = baseScale * zoom;
  const dispW = img ? img.naturalWidth * scale : 0;
  const dispH = img ? img.naturalHeight * scale : 0;

  const clamp = useMemo(
    () => (x: number, y: number) => ({
      x: Math.min(0, Math.max(frameW - dispW, x)),
      y: Math.min(0, Math.max(frameH - dispH, y)),
    }),
    [dispW, dispH, frameW, frameH]
  );

  // Trocar de proporção ou de zoom pode deixar o recorte fora da imagem — recentra no que sobrou.
  useEffect(() => {
    setOffset((o) => clamp(o.x, o.y));
  }, [clamp]);

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    setOffset(clamp(d.ox + (e.clientX - d.x), d.oy + (e.clientY - d.y)));
  }
  function onPointerUp() {
    drag.current = null;
  }

  function confirm() {
    if (!img || !file) return;
    // Do quadro de volta pros pixels do original: o que está visível é exatamente esta janela.
    const sx = -offset.x / scale;
    const sy = -offset.y / scale;
    const sw = frameW / scale;
    const sh = frameH / scale;

    const outW = Math.min(MAX_OUTPUT_WIDTH, Math.round(sw));
    const outH = Math.round(outW / ratio);
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const name = file.name.replace(/\.[^.]+$/, '') + `-${presetId.replace(':', 'x')}.jpg`;
        onDone(new File([blob], name, { type: 'image/jpeg' }));
      },
      'image/jpeg',
      0.92
    );
  }

  return (
    <Dialog open={!!file} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Crop className="size-4" /> Recortar imagem
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <ToggleGroup type="single" value={presetId} onValueChange={(v) => v && setPresetId(v)} className="justify-start">
            {CROP_PRESETS.map((p) => (
              <ToggleGroupItem key={p.id} value={p.id} title={p.hint}>
                {p.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          <div className="flex justify-center">
            <div
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              style={{ width: frameW, height: frameH }}
              className="relative touch-none overflow-hidden rounded-lg bg-muted select-none cursor-grab active:cursor-grabbing"
            >
              {img && (
                <img
                  src={img.src}
                  alt=""
                  draggable={false}
                  style={{
                    width: dispW,
                    height: dispH,
                    transform: `translate(${offset.x}px, ${offset.y}px)`,
                  }}
                  className="max-w-none origin-top-left"
                />
              )}
              {/* Guias de terços: só orientação visual, não recorta nada. */}
              <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
                {Array.from({ length: 9 }).map((_, i) => (
                  <div key={i} className="border border-white/25" />
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Aproximar</label>
            <Slider value={[zoom]} min={1} max={3} step={0.01} onValueChange={([v]) => setZoom(v)} />
          </div>

          <p className="text-xs text-muted-foreground">
            Arraste a imagem para escolher o que aparece. O arquivo original não é alterado — o post leva só o recorte.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
          <Button onClick={confirm} disabled={!img}>
            Usar este recorte
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
