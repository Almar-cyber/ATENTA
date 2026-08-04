import { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CalendarPlus, ImageIcon, ImagePlus, Loader2, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import type { GridPreview } from '@/lib/types';
import { ALLOWED_MIME_TYPES, isVideoMime } from '@/lib/platforms';
import { createGridPreview, updateGridPreview, uploadMedia } from '@/lib/api';
import { readMediaMetadata } from '@/lib/mediaMetadata';
import { videoPosterUrl } from '@/lib/useMediaUrl';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

/**
 * A lista de IDEIAS ao lado da grade.
 *
 * POR QUE ELA EXISTE: quem cuida de um perfil se planeja antes de postar, e até aqui não havia onde
 * guardar "quero postar isso" sem já comprometer uma data. O rascunho não servia — o compositor
 * inventa uma data ("amanhã, 09:00") e a peça some no meio da agenda.
 *
 * POR QUE AQUI: o Grid IG usava um terço da largura e deixava dois terços em branco. E é olhando a
 * grade que se decide o que entra no feed, então a lista de candidatas pertence a esta tela.
 *
 * A ideia é o que a tabela ainda chama de `grid_preview` — só que agora com texto e com a imagem
 * opcional (migração 0013).
 */

/** Uma hora, pra empilhar ideias novas no topo sem empatar o `sort_at`. */
const HOUR_MS = 3_600_000;

export function IdeaSidebar({
  ideias,
  onRefresh,
  onAgendar,
  onRemover,
  className,
}: {
  ideias: GridPreview[];
  onRefresh: () => Promise<void>;
  onAgendar: (ideia: GridPreview) => void;
  onRemover: (ideia: GridPreview) => void;
  className?: string;
}) {
  const [texto, setTexto] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [anexando, setAnexando] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /** Qual ideia está esperando arte — o input de arquivo é um só, compartilhado. */
  const alvoDaArte = useRef<string | null>(null);

  async function criar() {
    const nota = texto.trim();
    if (!nota || salvando) return;
    setSalvando(true);
    try {
      // Mais nova no topo: uma ideia recém-escrita é a que você está pensando agora.
      const topo = ideias.length ? Math.max(...ideias.map((i) => Date.parse(i.sort_at))) : Date.now();
      await createGridPreview({
        platform: 'instagram',
        note: nota,
        sort_at: new Date(topo + HOUR_MS).toISOString(),
      });
      setTexto('');
      await onRefresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSalvando(false);
    }
  }

  async function anexarArte(files: FileList | null) {
    const file = files?.[0];
    const id = alvoDaArte.current;
    alvoDaArte.current = null;
    if (fileRef.current) fileRef.current.value = '';
    if (!file || !id) return;
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      toast.error('Formato não aceito. Use JPEG, PNG, MP4 ou MOV.');
      return;
    }
    setAnexando(id);
    try {
      const meta = await readMediaMetadata(file);
      const enviada = await uploadMedia(file, meta);
      await updateGridPreview(id, { media_asset_id: enviada.id });
      await onRefresh();
      toast.success('Arte anexada — a ideia já aparece na grade.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setAnexando(null);
    }
  }

  return (
    <div className={className}>
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ideias</h3>
        {ideias.length > 0 && <span className="text-xs tabular-nums text-muted-foreground">{ideias.length}</span>}
      </div>

      {/* Campo rápido: escrever e dar Enter é o gesto inteiro. Qualquer coisa a mais (escolher
          conta, data, formato) já é o compositor, e é justamente o que trava o "ir anotando". */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void criar();
        }}
        className="mb-3 flex gap-2"
      >
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="O que você quer postar?"
          aria-label="Nova ideia"
          className="h-9 min-w-0 flex-1 rounded-lg border-2 border-brand bg-card px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <Button type="submit" size="default" disabled={!texto.trim() || salvando} aria-label="Adicionar ideia">
          {salvando ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
        </Button>
      </form>

      <input
        ref={fileRef}
        type="file"
        accept={ALLOWED_MIME_TYPES.join(',')}
        className="hidden"
        onChange={(e) => void anexarArte(e.target.files)}
      />

      {ideias.length === 0 ? (
        <EmptyState art="comecando" size="sm" title="Nenhuma ideia ainda">
          Anote aqui o que você quer postar, sem precisar decidir a data. Quando a arte existir, a
          ideia aparece na grade — e o <b>Agendar</b> a transforma em post.
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          <AnimatePresence initial={false}>
            {ideias.map((ideia) => (
              <motion.li
                key={ideia.id}
                layout
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
                className="group flex items-center gap-2.5 rounded-xl border-2 border-brand bg-card p-2 shadow-[3px_3px_0_0_var(--brand)]"
              >
                <Capa ideia={ideia} carregando={anexando === ideia.id} />
                <span className="min-w-0 flex-1 text-sm leading-snug">
                  {ideia.note ? (
                    <span className="line-clamp-2">{ideia.note}</span>
                  ) : (
                    <span className="text-muted-foreground">sem descrição</span>
                  )}
                  {!ideia.media_asset_id && (
                    <button
                      type="button"
                      onClick={() => {
                        alvoDaArte.current = ideia.id;
                        fileRef.current?.click();
                      }}
                      className="mt-0.5 flex items-center gap-1 text-xs text-accent-foreground hover:underline"
                    >
                      <ImagePlus className="size-3" />
                      anexar arte
                    </button>
                  )}
                </span>
                {/* Ações sempre visíveis, não no hover: no celular não existe hover, e esconder a
                    única saída de uma peça atrás de um gesto que não acontece é um beco sem saída. */}
                <span className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    title="Agendar: vira post"
                    aria-label="Agendar esta ideia"
                    onClick={() => onAgendar(ideia)}
                    className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <CalendarPlus className="size-4" />
                  </button>
                  <button
                    type="button"
                    title="Remover ideia"
                    aria-label="Remover esta ideia"
                    onClick={() => onRemover(ideia)}
                    className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                  >
                    <X className="size-4" />
                  </button>
                </span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}

/** Miniatura da ideia. Sem arte ainda, um quadro pontilhado — que é o convite pra anexar uma. */
function Capa({ ideia, carregando }: { ideia: GridPreview; carregando: boolean }) {
  const box = 'grid size-11 shrink-0 place-items-center overflow-hidden rounded-lg';
  if (carregando) {
    return (
      <span className={`${box} border-2 border-dashed border-brand bg-muted text-muted-foreground`}>
        <Loader2 className="size-4 animate-spin" />
      </span>
    );
  }
  if (!ideia.public_url) {
    return (
      <span className={`${box} border-2 border-dashed border-border bg-muted/40 text-muted-foreground`}>
        <ImageIcon className="size-4" />
      </span>
    );
  }
  return isVideoMime(ideia.mime_type ?? '') ? (
    <video src={videoPosterUrl(ideia.public_url)} muted preload="metadata" className={`${box} object-cover`} />
  ) : (
    <img src={ideia.public_url} alt="" loading="lazy" className={`${box} object-cover`} />
  );
}
