import { useState } from 'react';
import { motion } from 'motion/react';
import { Sparkles, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { UsoIA } from './UsoIA';
import { sugerirLegenda } from '@/lib/api';
import type { Platform } from '@/lib/types';

// Sugestão de legenda.
//
// O CAMPO DE LEGENDA É O BRIEFING. Não existe um segundo campo pedindo "descreva o post": a pessoa
// digita uma linha do que quer dizer e aperta gerar. Um campo separado obrigaria a escrever a mesma
// coisa duas vezes, e o rascunho que ela já tem é exatamente o material que o modelo precisa.
//
// Por isso o botão nasce DESABILITADO com o motivo no tooltip, em vez de abrir e reclamar depois
// (princípio 3 de design.md: o aviso diz o que fazer, junto do campo que o causou).

interface Props {
  /** O texto atual do campo. Vira o assunto mandado ao modelo. */
  valor: string;
  /** Aplica a legenda escolhida no campo. */
  onEscolher: (texto: string) => void;
  /** Rede de destino: muda tom e limite de caracteres do prompt. */
  plataforma: Platform | null;
  /** Pilar de conteúdo da peça, quando tem um. Guia os exemplos do histórico. */
  tagId: string | null;
}

/** Quantos caracteres de assunto o servidor exige. Espelhado aqui só pra desabilitar antes. */
const MINIMO = 4;

export function LegendaIA({ valor, onEscolher, plataforma, tagId }: Props) {
  const [aberto, setAberto] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [sugestoes, setSugestoes] = useState<string[]>([]);
  const [usouHistorico, setUsouHistorico] = useState(false);
  const [cota, setCota] = useState<{ restam: number; teto: number } | null>(null);
  // O texto de antes de aplicar. É o que faz "Desfazer" existir: a sugestão SUBSTITUI o rascunho, e
  // sem guardar isto a pessoa perde o que escreveu se não gostar do resultado.
  const [anterior, setAnterior] = useState<string | null>(null);

  const assunto = valor.trim();
  const impedimento = !plataforma
    ? 'Escolha a conta de destino primeiro.'
    : assunto.length < MINIMO
      ? 'Escreva em uma linha sobre o que é o post, depois gere.'
      : // Depois de esgotar, cada clique bateria no mesmo 429. Só dá pra saber isto tendo gerado
        // ao menos uma vez nesta sessão (é a resposta que traz a cota), e é justamente aí que
        // insistir é tentador — a pessoa acabou de ver a última sugestão.
        cota?.restam === 0
        ? 'Acabaram as sugestões de hoje. O contador volta amanhã.'
        : null;

  async function gerar() {
    if (!plataforma) return;
    setCarregando(true);
    try {
      const r = await sugerirLegenda({ assunto, plataforma, tag_id: tagId });
      setSugestoes(r.sugestoes);
      setUsouHistorico(r.usou_historico);
      setCota({ restam: r.restam, teto: r.teto });
    } catch (err) {
      // A mensagem do servidor já é escrita pra pessoa (teto do dia, modelo fora do ar), então vai
      // inteira pro toast em vez de virar um "algo deu errado" genérico.
      toast.error(err instanceof Error ? err.message : 'Não consegui gerar agora.');
      setAberto(false);
    } finally {
      setCarregando(false);
    }
  }

  function abrir(v: boolean) {
    setAberto(v);
    if (v && sugestoes.length === 0) void gerar();
  }

  if (anterior !== null) {
    return (
      <Button
        type="button"
        variant="link"
        size="xs"
        className="h-auto gap-1 p-0"
        onClick={() => {
          onEscolher(anterior);
          setAnterior(null);
        }}
      >
        <Undo2 className="size-3" />
        Desfazer a sugestão
      </Button>
    );
  }

  const gatilho = (
    <Button type="button" variant="outline" size="xs" className="gap-1" disabled={!!impedimento}>
      <Sparkles className="size-3" />
      Sugerir legenda
    </Button>
  );

  if (impedimento) {
    return (
      <Tooltip>
        {/* O span existe porque botão desabilitado não dispara evento de mouse, e sem ele o tooltip
            que EXPLICA o desabilitado nunca apareceria. */}
        <TooltipTrigger asChild>
          <span className="inline-flex">{gatilho}</span>
        </TooltipTrigger>
        <TooltipContent>{impedimento}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Popover open={aberto} onOpenChange={abrir}>
      <PopoverTrigger asChild>{gatilho}</PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2">
        {carregando ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">Escrevendo três opções...</p>
        ) : (
          <div className="space-y-1.5">
            {sugestoes.map((s, i) => (
              <motion.button
                key={i}
                type="button"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04, duration: 0.15 }}
                onClick={() => {
                  setAnterior(valor);
                  onEscolher(s);
                  setAberto(false);
                }}
                className="w-full rounded-lg border-2 border-brand bg-card p-2 text-left text-xs leading-relaxed transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[3px_3px_0_0_var(--brand)]"
              >
                {s}
              </motion.button>
            ))}
            <div className="space-y-1 px-1 pt-1.5">
              <div className="flex items-center justify-between gap-2">
                {/* Dizer que o histórico entrou é o que explica por que a sugestão melhora com o
                    tempo. Sem isso, a pessoa não tem como saber que publicar mais peças ajuda. */}
                <span className="text-[11px] text-muted-foreground">
                  {usouHistorico
                    ? 'No tom dos seus posts que mais engajaram'
                    : 'Escreva mais posts e ela aprende seu tom'}
                </span>
                <Button type="button" variant="link" size="xs" className="h-auto shrink-0 p-0" onClick={() => void gerar()}>
                  Outras
                </Button>
              </div>
              {/* Duas informações que a tela não dava e deveria: que aquilo saiu de uma máquina (e
                  portanto pode errar nome, número e data), e quanto ainda dá pra gerar hoje. A
                  primeira é fixa porque vale sempre; a segunda só aparece perto do fim. */}
              <p className="text-[11px] text-muted-foreground">
                Escrito por IA. Confira nomes, datas e valores antes de agendar.
              </p>
              <UsoIA restam={cota?.restam ?? null} teto={cota?.teto ?? 0} />
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
