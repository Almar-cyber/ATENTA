import { useState } from 'react';
import { Dices, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { SessionUser } from '@/lib/auth';
import type { Avatar } from '@/lib/avatar';
import {
  ACESSORIOS,
  avatarDoUsuario,
  avatarPadrao,
  avatarSorteado,
  BARBAS,
  CABECAS,
  CABELO_COLORIVEL,
  CABELOS,
  EXPRESSOES,
  PELES,
  ROUPAS,
  salvarAvatar,
  useAvatarUri,
} from '@/lib/avatar';

// Personalização do avatar (Open Peeps).
//
// SPLIT, igual ao compositor e ao detalhe do post (web/design.md): o rosto grande à esquerda e os
// controles à direita. A pré-visualização é o herói aqui também — a pessoa decide olhando a cara
// que vai ficar, não lendo o nome das variantes.

/**
 * Um seletor de variante: ‹ nome › com as setas percorrendo a lista.
 *
 * Setas e não uma grade de 48 miniaturas: renderizar 48 SVGs de 9 KB a cada troca travaria o
 * diálogo, e uma lista tão longa violaria a Lei de Miller (web/design.md) sem ajudar a escolher —
 * ninguém decide o cabelo por nome, decide vendo no rosto.
 */
function Seletor({
  rotulo,
  opcoes,
  valor,
  onChange,
  opcional,
}: {
  rotulo: string;
  opcoes: readonly string[];
  valor: string | null;
  onChange: (v: string | null) => void;
  /** Deixa a lista incluir "nenhum" — barba e acessório podem não existir. */
  opcional?: boolean;
}) {
  const lista: (string | null)[] = opcional ? [null, ...opcoes] : [...opcoes];
  const i = Math.max(0, lista.indexOf(valor));
  const anda = (passo: number) => onChange(lista[(i + passo + lista.length) % lista.length]);

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm font-medium">{rotulo}</span>
      <div className="flex items-center gap-1">
        <Button type="button" variant="outline" size="icon" className="size-8" onClick={() => anda(-1)} aria-label={`${rotulo} anterior`}>
          ‹
        </Button>
        <span className="w-8 text-center text-xs tabular-nums text-muted-foreground">
          {i + 1}/{lista.length}
        </span>
        <Button type="button" variant="outline" size="icon" className="size-8" onClick={() => anda(1)} aria-label={`${rotulo} seguinte`}>
          ›
        </Button>
      </div>
    </div>
  );
}

/** Bolinhas de cor. Aqui a grade cabe: são poucas e a cor se decide vendo a cor, não o nome. */
function Cores({
  rotulo,
  opcoes,
  valor,
  onChange,
}: {
  rotulo: string;
  opcoes: readonly string[];
  valor: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm font-medium">{rotulo}</span>
      <div className="flex flex-wrap justify-end gap-1">
        {opcoes.map((cor) => (
          <button
            key={cor}
            type="button"
            onClick={() => onChange(cor)}
            aria-label={cor}
            aria-pressed={valor === cor}
            style={{ background: cor }}
            className={`size-6 rounded-full border-2 transition-transform ${
              valor === cor ? 'border-brand scale-110' : 'border-transparent hover:scale-105'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

export function AvatarDialog({
  user,
  open,
  onClose,
  onSaved,
}: {
  user: SessionUser;
  open: boolean;
  onClose: () => void;
  /** Revalida a sessão — é o que faz o avatar novo aparecer no cabeçalho sem recarregar. */
  onSaved: () => void;
}) {
  const [rascunho, setRascunho] = useState<Avatar>(() => avatarDoUsuario(user));
  const [salvando, setSalvando] = useState(false);
  const uri = useAvatarUri(rascunho, 320);

  const campo = <K extends keyof Avatar>(k: K, v: Avatar[K]) => setRascunho((a) => ({ ...a, [k]: v }));

  const salvar = async () => {
    setSalvando(true);
    try {
      await salvarAvatar(rascunho);
      onSaved();
      toast.success('Avatar atualizado');
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'não foi possível salvar');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Seu avatar</DialogTitle>
        </DialogHeader>

        <div className="grid gap-6 sm:grid-cols-[minmax(0,220px)_1fr]">
          <div className="flex flex-col items-center gap-3">
            <div className="grid aspect-square w-full place-items-center overflow-hidden rounded-2xl border-2 border-brand bg-secondary shadow-[5px_5px_0_0_var(--brand)]">
              {uri ? <img src={uri} alt="" className="h-full w-full object-contain" /> : null}
            </div>
            <div className="flex w-full gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setRascunho(avatarSorteado())}>
                <Dices className="size-4" />
                Sortear
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Voltar ao padrão"
                title="Voltar ao padrão"
                onClick={() => setRascunho(avatarPadrao(user.id))}
              >
                <RotateCcw className="size-4" />
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <Seletor rotulo="Cabelo" opcoes={CABECAS} valor={rascunho.head} onChange={(v) => campo('head', v!)} />
            <Seletor rotulo="Expressão" opcoes={EXPRESSOES} valor={rascunho.expression} onChange={(v) => campo('expression', v!)} />
            <Seletor rotulo="Barba" opcoes={BARBAS} valor={rascunho.facialHair} onChange={(v) => campo('facialHair', v)} opcional />
            <Seletor rotulo="Óculos" opcoes={ACESSORIOS} valor={rascunho.accessories} onChange={(v) => campo('accessories', v)} opcional />
            <Cores rotulo="Pele" opcoes={PELES} valor={rascunho.skin} onChange={(v) => campo('skin', v)} />
            {/* Some quando o cabelo escolhido é só traço (38 dos 48) e não tem o que pintar. Mesmo
                padrão do compositor, onde Título aparece só no YouTube: campo que não faz efeito é
                pior que campo ausente, porque a pessoa clica e conclui que quebrou. */}
            {CABELO_COLORIVEL.includes(rascunho.head) && (
              <Cores rotulo="Cor do cabelo" opcoes={CABELOS} valor={rascunho.hair} onChange={(v) => campo('hair', v)} />
            )}
            <Cores rotulo="Roupa" opcoes={ROUPAS} valor={rascunho.clothing} onChange={(v) => campo('clothing', v)} />
          </div>
        </div>

        <div className="flex justify-end gap-2">
          {/* size="lg" nos DOIS: web/design.md manda o secundário acompanhar a altura do CTA
              primário (h-11) e se diferenciar pelo `variant`, não pelo tamanho. */}
          <Button type="button" size="lg" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" size="lg" onClick={salvar} disabled={salvando}>
            {salvando ? 'Salvando…' : 'Salvar avatar'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
