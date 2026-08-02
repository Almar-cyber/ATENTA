import { useRef, useState } from 'react';
import { Crop, ImagePlus, RefreshCw, X, ImageIcon, Film } from 'lucide-react';
import { toast } from 'sonner';
import type { QueuedMedia } from '@/lib/types';
import { ALLOWED_MIME_TYPES, isVideoMime } from '@/lib/platforms';
import { useMediaUrl, videoPosterUrl } from '@/lib/useMediaUrl';

function Tile({
  item,
  index,
  onDragStart,
  onDrop,
  onRemove,
  onReplaceClick,
  onCropClick,
}: {
  item: QueuedMedia;
  index: number;
  onDragStart: () => void;
  onDrop: () => void;
  onRemove: () => void;
  onReplaceClick: () => void;
  onCropClick?: () => void;
}) {
  const url = useMediaUrl(item);
  const [broken, setBroken] = useState(false);
  const video = isVideoMime(item.mime_type);

  return (
    // Sem `layout` do motion aqui de propósito: com muitos arquivos pesados, animar a posição de
    // cada tile a cada reordenação travava o arrastar. A troca de ordem é instantânea.
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      className="group relative aspect-square cursor-grab overflow-hidden rounded-xl border bg-muted active:cursor-grabbing"
    >
      {url && !broken ? (
        video ? (
          <video src={videoPosterUrl(url)} muted preload="metadata" className="size-full object-cover" onError={() => setBroken(true)} />
        ) : (
          <img
            src={url}
            alt=""
            loading="lazy"
            decoding="async"
            className="size-full object-cover"
            onError={() => setBroken(true)}
          />
        )
      ) : (
        <div className="grid size-full place-items-center text-muted-foreground">
          {video ? <Film className="size-5" /> : <ImageIcon className="size-5" />}
        </div>
      )}

      {/* Número no canto INFERIOR: no topo ele colidia com os 3 botões de ação em tiles pequenos
          (mobile), escondendo o de recorte. */}
      <span className="absolute bottom-1 left-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-white">
        {index + 1}
      </span>

      {/* Visíveis sempre (fracos), fortes no hover: escondidas por completo, ninguém achava o
          recorte — que é a única saída quando a foto não cabe na proporção da rede. */}
      <div className="absolute right-1 top-1 flex gap-1 opacity-70 transition-opacity group-hover:opacity-100">
        {/* Qualquer imagem, inclusive a que veio de um post duplicado/editado — nesse caso o
            composer baixa os bytes pela nossa origem antes de abrir o recorte. */}
        {!video && onCropClick && (
          <button
            type="button"
            title="Recortar"
            onClick={onCropClick}
            className="grid size-6 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80"
          >
            <Crop className="size-3.5" />
          </button>
        )}
        <button
          type="button"
          title="Trocar mídia deste slot"
          onClick={onReplaceClick}
          className="grid size-6 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80"
        >
          <RefreshCw className="size-3.5" />
        </button>
        <button
          type="button"
          title="Remover"
          onClick={onRemove}
          className="grid size-6 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

export function MediaQueueGrid({
  items,
  onReorder,
  onRemove,
  onReplace,
  onCrop,
  onAdd,
}: {
  items: QueuedMedia[];
  onReorder: (next: QueuedMedia[]) => void;
  onRemove: (key: string) => void;
  onReplace: (key: string, file: File) => void;
  onCrop?: (key: string) => void;
  /** Abre o seletor de arquivos. Vem como um tile pontilhado no fim da grade — o `<input type=file>`
   *  cru ocupava uma linha inteira do formulário pra fazer a mesma coisa. */
  onAdd?: () => void;
}) {
  const dragKey = useRef<string | null>(null);
  const replaceKey = useRef<string | null>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  function handleDrop(toKey: string) {
    const fromKey = dragKey.current;
    dragKey.current = null;
    if (!fromKey || fromKey === toKey) return;
    const next = items.slice();
    const from = next.findIndex((i) => i.key === fromKey);
    const to = next.findIndex((i) => i.key === toKey);
    if (from === -1 || to === -1) return;
    next.splice(to, 0, next.splice(from, 1)[0]);
    onReorder(next);
  }

  function handleReplaceClick(key: string) {
    replaceKey.current = key;
    replaceInputRef.current?.click();
  }

  function handleReplaceInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    const key = replaceKey.current;
    replaceKey.current = null;
    if (!file || !key) return;
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      toast.error(`Não suportado: ${file.name} (${file.type || 'tipo desconhecido'}). Use JPEG, PNG, MP4 ou MOV.`);
      return;
    }
    onReplace(key, file);
  }

  if (items.length === 0 && !onAdd) return null;

  return (
    // 3 colunas no mobile (tiles maiores, os 3 botões de ação cabem), 4 no desktop.
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      <input
        ref={replaceInputRef}
        type="file"
        hidden
        accept="image/jpeg,image/png,video/mp4,video/quicktime"
        onChange={handleReplaceInputChange}
      />
      {items.map((item, idx) => (
        <Tile
          key={item.key}
          item={item}
          index={idx}
          onDragStart={() => (dragKey.current = item.key)}
          onDrop={() => handleDrop(item.key)}
          onRemove={() => onRemove(item.key)}
          onReplaceClick={() => handleReplaceClick(item.key)}
          onCropClick={onCrop ? () => onCrop(item.key) : undefined}
        />
      ))}
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          title="Adicionar mídia"
          className="grid aspect-square place-items-center rounded-xl border-2 border-dashed border-border bg-muted/40 text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
        >
          <ImagePlus className="size-5" />
        </button>
      )}
    </div>
  );
}
