import { AlertTriangle } from 'lucide-react';

// Quanto sobrou da cota diária de IA.
//
// POR QUE ISTO EXISTE. O servidor já devolvia `restam` a cada geração e a tela jogava fora, então a
// pessoa só descobria o teto ao esbarrar nele: apertava o botão e levava um erro. Isso é beco sem
// saída (princípio 4 de design.md) por omissão, não por design — a informação existia, só não
// estava na tela.
//
// POR QUE NÃO APARECE SEMPRE. Mostrar "20 de 20" em toda geração transforma uma funcionalidade
// generosa numa funcionalidade medida: a pessoa passa a contar em vez de escrever, e o aviso que
// aparece o tempo todo é o aviso que ninguém lê no dia em que importa (mesmo raciocínio do ponto
// vermelho do NotificationsBell, que só liga em pendência grave). Ele entra quando começa a valer
// como decisão, e só então.
//
// Componente próprio, e não uma linha dentro do LegendaIA, porque a IA não vai parar na legenda: a
// análise de concorrentes é o próximo consumidor da mesma cota, e o segundo lugar que precisar
// disto tem que herdar a mesma régua em vez de reinventar outra.

interface Props {
  /** Quantas gerações sobraram hoje. `null` enquanto nenhuma foi feita nesta sessão. */
  restam: number | null;
  /** Teto do dia, vindo do servidor. É o que dá escala ao número (ancoragem). */
  teto: number;
}

/**
 * A partir de quantas restantes o aviso aparece.
 *
 * Cinco, não três: em três já não dá tempo de mudar de plano dentro da mesma sessão de trabalho.
 * Cinco é o ponto em que a pessoa ainda escolhe entre gerar de novo e escrever na mão.
 */
const LIMIAR = 5;

export function UsoIA({ restam, teto }: Props) {
  if (restam === null || restam > LIMIAR) return null;

  const acabou = restam === 0;

  return (
    <p
      className={`flex items-center gap-1 text-[11px] ${acabou ? 'font-semibold text-destructive' : 'text-muted-foreground'}`}
    >
      {acabou && <AlertTriangle className="size-3 shrink-0" />}
      {acabou
        ? `Acabaram as ${teto} sugestões de hoje. O contador volta amanhã.`
        : `Restam ${restam} de ${teto} sugestões hoje.`}
    </p>
  );
}
