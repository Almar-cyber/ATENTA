import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Bell, ChevronRight } from 'lucide-react';
import { useScheduler } from '@/store';
import { construirPendencias } from '@/lib/pendencias';
import type { PainelDestino } from '@/lib/pendencias';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';

/**
 * O sino de notificações — substitui a faixa vermelha que ficava sempre visível empurrando o
 * conteúdo. Mesma pergunta do bloco "Precisa de você" do Painel (`HomeView.tsx`), mesma resposta
 * (`construirPendencias`, `@/lib/pendencias`) — só que num espaço de ícone, em toda tela, e fechado
 * até alguém abrir.
 *
 * FICA SEMPRE VISÍVEL, inclusive no Painel: ao contrário da faixa antiga (que escondia lá porque o
 * bloco "Precisa de você" já dizia a mesma coisa em voz alta), o sino não disputa espaço com nada —
 * é só um ícone no canto, e um sino que desaparece numa tela e aparece na outra confundiria mais
 * do que ajudaria.
 */
export function NotificationsBell({ onIr }: { onIr: (destino: PainelDestino) => void }) {
  const { summary, accounts } = useScheduler();
  const [open, setOpen] = useState(false);
  const pendencias = construirPendencias(summary, accounts);

  // Só pendência GRAVE (falha, conta caída, fila atrasada) liga o ponto. Rascunho esperando é
  // acervo normal, não alarme — a mesma regra de "alarme falso é pior que silêncio" que já existe
  // pra tolerância de atraso da fila (src/api.ts). Um ponto vermelho ligado o tempo todo por causa
  // de ideias acumuladas treina a ignorá-lo, que é o dia em que ele para de servir pra alguma coisa.
  const alerta = pendencias.some((p) => p.grave);

  // Balança de tempos em tempos enquanto houver algo grave e o popover estiver fechado — pra além
  // do ponto vermelho (fácil de não notar num ícone pequeno), o MOVIMENTO chama o olho sem precisar
  // de som nem de texto. Para de balançar assim que abre: quem já está olhando não precisa de aviso.
  const [balancar, setBalancar] = useState(0);
  useEffect(() => {
    if (!alerta || open) return;
    // Balança na hora que a pendência grave aparece (inclusive ao carregar a página com uma já
    // esperando), e depois se repete a cada 12s — frequente o bastante pra não passar despercebido
    // num app que fica minimizado numa aba, raro o bastante pra não parecer um apito histérico.
    setBalancar((k) => k + 1);
    const id = setInterval(() => setBalancar((k) => k + 1), 12_000);
    return () => clearInterval(id);
  }, [alerta, open]);

  function ir(destino: PainelDestino) {
    setOpen(false);
    onIr(destino);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="lg" variant="outline" aria-label="Notificações" className="relative px-3">
          {/* `key={balancar}` força remontar a cada rodada — o mesmo truque de remount-and-fade
              que a troca de view usa em App.tsx — e a animação toca de novo do zero. Sem isso,
              mudar só o `animate` não re-dispara uma sequência de keyframes já concluída.
              transformOrigin no topo: gira como um sino pendurado, não como uma roda. */}
          <motion.span
            key={balancar}
            className="block"
            style={{ transformOrigin: '50% 0%' }}
            initial={{ rotate: 0 }}
            animate={alerta ? { rotate: [0, -18, 14, -10, 6, -3, 0] } : { rotate: 0 }}
            transition={{ duration: 0.6, ease: 'easeInOut' }}
          >
            <Bell className="size-4" />
          </motion.span>
          {alerta && (
            <span
              aria-hidden
              className="absolute right-2 top-2 size-2 rounded-full bg-destructive ring-2 ring-card"
            />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <PopoverHeader>
          <PopoverTitle>Notificações</PopoverTitle>
        </PopoverHeader>
        {pendencias.length === 0 ? (
          <p className="px-1 py-2 text-sm text-muted-foreground">
            Tudo em dia — nada esperando por você.
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {pendencias.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => ir(p.destino)}
                className="flex w-full cursor-pointer items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-muted"
              >
                <span
                  className={`grid size-8 shrink-0 place-items-center rounded-full ${
                    p.grave ? 'bg-destructive/15 text-destructive' : 'bg-primary text-primary-foreground'
                  }`}
                >
                  {p.icone}
                </span>
                <span className="min-w-0 flex-1 leading-snug">
                  <span className="block text-sm font-semibold">
                    {p.quantidade} {p.titulo}
                  </span>
                  <span className="block text-xs text-muted-foreground">{p.detalhe}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
