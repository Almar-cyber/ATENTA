import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

// Arrastar por TOQUE, que é o que o HTML5 drag-and-drop não faz.
//
// O `draggable`/`onDragStart`/`onDrop` do HTML só existe pra ponteiro: navegador de celular não
// emite `dragstart` a partir do dedo, em nenhum deles. A grade do Planejar dizia "arraste para
// reordenar" e, no telefone, não reordenava nada — o dedo só rolava a página.
//
// POR QUE PRESSIONAR E SEGURAR, e não arrastar direto. Pra o navegador não rolar a página junto,
// é preciso `preventDefault()` no `touchmove`. Só que isso não desfaz uma rolagem JÁ começada: uma
// vez que o gesto virou scroll, ele é do navegador. A saída é a mesma das listas reordenáveis do
// próprio sistema: nada acontece enquanto o dedo não fica parado por um instante; passado esse
// instante o item é "pego", e o primeiro `touchmove` seguinte já chega com o preventDefault posto —
// antes de qualquer rolagem existir. Se o dedo se mexer ANTES disso, era rolagem mesmo: cancela e
// deixa o navegador rolar.
//
// A alternativa seria `touch-action: none` nos itens, e ela é pior: mataria a rolagem vertical
// dentro da grade, que ocupa a tela quase inteira no celular.
//
// O ponteiro (mouse/caneta) continua no drag nativo do HTML — este módulo ignora tudo que não é
// toque, então nada muda no desktop.

/** Quanto o dedo precisa ficar parado pra "pegar" o item. */
const ESPERA_MS = 320;
/** Folga de movimento antes disso: acima dela o gesto era rolagem, não intenção de arrastar. */
const TOLERANCIA_PX = 10;

export interface PressDrag {
  /** Vai no elemento que ENVOLVE os itens — é nele que mora o listener não-passivo. */
  containerRef: (el: HTMLElement | null) => void;
  /** Vai em cada item. `movable` false ainda pode receber um item solto em cima. */
  itemProps: (key: string, movable: boolean) => {
    'data-drag-key': string;
    onPointerDown?: (e: ReactPointerEvent) => void;
  };
  /** A peça que está na mão agora (ou null). */
  pegou: string | null;
  /** A peça sob o dedo agora (ou null). */
  sobre: string | null;
  /**
   * Um arraste acabou de terminar neste item — o clique que o navegador dispara logo depois deve
   * ser ignorado, senão soltar a peça abre o detalhe dela.
   */
  consumiuClique: () => boolean;
}

export function usePressDrag(onDrop: (de: string, para: string) => void): PressDrag {
  const [pegou, setPegou] = useState<string | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);

  // Refs porque os handlers de ponteiro leem isto DENTRO de um listener nativo e de callbacks que
  // não re-renderizam: estado do React chegaria velho.
  const pegouRef = useRef<string | null>(null);
  const inicio = useRef<{ x: number; y: number; key: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const arrastou = useRef(false);
  const container = useRef<HTMLElement | null>(null);
  // O callback muda de identidade a cada render (depende da lista de peças). Guardado num ref, o
  // efeito abaixo registra os listeners UMA vez em vez de a cada render.
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  const limpar = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    inicio.current = null;
    pegouRef.current = null;
    setPegou(null);
    setSobre(null);
  }, []);

  // O listener é registrado à mão (e não pelo onTouchMove do React) porque ele precisa ser
  // NÃO-PASSIVO: num listener passivo o preventDefault é ignorado, e o navegador rola a página
  // por baixo do arraste.
  const containerRef = useCallback((el: HTMLElement | null) => {
    container.current = el;
  }, []);

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const naoRole = (e: TouchEvent) => {
      if (pegouRef.current) e.preventDefault();
    };
    el.addEventListener('touchmove', naoRole, { passive: false });
    return () => el.removeEventListener('touchmove', naoRole);
  });

  useEffect(() => {
    const mover = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      const i = inicio.current;
      if (!i) return;
      if (!pegouRef.current) {
        // Ainda na contagem: mexeu demais, era rolagem.
        if (Math.hypot(e.clientX - i.x, e.clientY - i.y) > TOLERANCIA_PX) limpar();
        return;
      }
      // Com o item na mão, quem está embaixo do dedo é quem recebe. `elementFromPoint` porque o
      // toque não gera `pointerover` em outros elementos: o alvo do gesto continua sendo o
      // primeiro, por captura implícita.
      const alvo = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-drag-key]');
      setSobre(alvo?.getAttribute('data-drag-key') ?? null);
    };

    const soltar = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      const de = pegouRef.current;
      const alvo = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-drag-key]');
      const para = alvo?.getAttribute('data-drag-key') ?? null;
      limpar();
      if (de && para && de !== para) {
        arrastou.current = true;
        onDropRef.current(de, para);
      }
    };

    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
    window.addEventListener('pointercancel', limpar);
    return () => {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
      window.removeEventListener('pointercancel', limpar);
    };
  }, [limpar]);

  const itemProps = useCallback(
    (key: string, movable: boolean) => ({
      'data-drag-key': key,
      ...(movable
        ? {
            onPointerDown: (e: ReactPointerEvent) => {
              if (e.pointerType !== 'touch') return;
              inicio.current = { x: e.clientX, y: e.clientY, key };
              timer.current = setTimeout(() => {
                pegouRef.current = key;
                setPegou(key);
                setSobre(key);
                // Confirmação de que a peça foi pega. Sem imagem de arraste como no desktop, é o
                // único sinal físico de que o gesto mudou de significado. Nem todo navegador tem.
                navigator.vibrate?.(10);
              }, ESPERA_MS);
            },
          }
        : {}),
    }),
    []
  );

  const consumiuClique = useCallback(() => {
    if (!arrastou.current) return false;
    arrastou.current = false;
    return true;
  }, []);

  return { containerRef, itemProps, pegou, sobre, consumiuClique };
}
