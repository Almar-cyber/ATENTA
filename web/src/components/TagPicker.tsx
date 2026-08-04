import { useEffect, useState } from 'react';
import { Check, Loader2, Plus, Tag as TagIcon, X } from 'lucide-react';
import { toast } from 'sonner';
import type { Tag } from '@/lib/api';
import { createTag } from '@/lib/api';
import { proximaCor, tagColor } from '@/lib/tags';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/**
 * Escolher (ou criar na hora) o pilar de conteúdo de uma peça.
 *
 * CRIAR NO MESMO LUGAR DE ESCOLHER é a decisão que faz isto ser usado. Uma tela separada de
 * "gerenciar pilares" transformaria marcar um post em: sair do que você está fazendo, cadastrar,
 * voltar, procurar. Ninguém paga esse preço no meio de agendar um post — e um pilar que ninguém
 * marca não vira insight nenhum.
 *
 * A cor não é perguntada: vem de `proximaCor`, a primeira ainda não usada. Escolher cor é uma
 * decisão a mais num momento em que a pessoa só quer dizer sobre o que é o post; e sortear
 * repetiria tons, deixando dois pilares indistinguíveis justo quando a cor passa a ser útil.
 */
export function TagPicker({
  tags,
  value,
  onChange,
  onCreated,
  size = 'default',
}: {
  tags: Tag[];
  /** Id do pilar atual, ou null. */
  value: string | null;
  onChange: (tagId: string | null) => void;
  /** Avisa que a lista mudou, pra quem carregou recarregar. */
  onCreated?: (tag: Tag) => void;
  size?: 'default' | 'sm';
}) {
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState('');
  const [criando, setCriando] = useState(false);
  const atual = tags.find((t) => t.id === value) ?? null;

  useEffect(() => {
    if (!aberto) setTexto('');
  }, [aberto]);

  const busca = texto.trim().toLowerCase();
  const filtradas = busca ? tags.filter((t) => t.name.toLowerCase().includes(busca)) : tags;
  const jaExiste = tags.some((t) => t.name.trim().toLowerCase() === busca);

  async function criar() {
    const name = texto.trim();
    if (!name || criando) return;
    setCriando(true);
    try {
      // O servidor devolve o pilar existente (200) em vez de erro quando o nome repete ignorando
      // caixa — então digitar "viagem" tendo "Viagem" seleciona o certo em vez de reclamar.
      const nova = await createTag({ name, color: proximaCor(tags) });
      onCreated?.(nova);
      onChange(nova.id);
      setAberto(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setCriando(false);
    }
  }

  const alturaGatilho = size === 'sm' ? 'h-6 text-xs' : 'h-8 text-sm';

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={atual ? `Pilar: ${atual.name}` : 'Escolher pilar de conteúdo'}
          className={`inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-full border-2 px-2.5 font-medium transition-colors ${alturaGatilho} ${
            atual ? 'border-transparent' : 'border-dashed border-border text-muted-foreground hover:border-brand hover:text-foreground'
          }`}
          style={atual ? { backgroundColor: tagColor(atual).bg, color: tagColor(atual).fg } : undefined}
        >
          <TagIcon className="size-3 shrink-0" />
          <span className="truncate">{atual ? atual.name : 'pilar'}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1.5">
        <input
          autoFocus
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              // Enter escolhe o primeiro resultado, ou cria — o gesto é um só nos dois casos.
              if (filtradas.length > 0 && jaExiste) {
                onChange(filtradas[0].id);
                setAberto(false);
              } else {
                void criar();
              }
            }
          }}
          placeholder="Buscar ou criar…"
          className="mb-1.5 h-8 w-full rounded-md border px-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        />

        <div className="max-h-56 overflow-y-auto">
          {value && (
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setAberto(false);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted"
            >
              <X className="size-3.5" />
              Sem pilar
            </button>
          )}
          {filtradas.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                onChange(t.id);
                setAberto(false);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted"
            >
              <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: tagColor(t).bg }} />
              <span className="min-w-0 flex-1 truncate">{t.name}</span>
              {t.id === value && <Check className="size-3.5 shrink-0" />}
            </button>
          ))}

          {busca && !jaExiste && (
            <button
              type="button"
              onClick={() => void criar()}
              disabled={criando}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted disabled:opacity-50"
            >
              {criando ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
              Criar “{texto.trim()}”
            </button>
          )}

          {!busca && tags.length === 0 && (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">
              Escreva para criar seu primeiro pilar — “bastidores”, “produto”, “viagem”.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** O pilar só pra ler: usado na lista, no card e onde não se edita. */
export function TagChip({ tag, size = 'default' }: { tag: { name: string; color: string }; size?: 'default' | 'sm' }) {
  const cor = tagColor(tag);
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 font-medium ${
        size === 'sm' ? 'h-5 text-[11px]' : 'h-6 text-xs'
      }`}
      style={{ backgroundColor: cor.bg, color: cor.fg }}
    >
      <span className="truncate">{tag.name}</span>
    </span>
  );
}
