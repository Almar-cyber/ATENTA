import type { ReactNode } from 'react';
import { AlertTriangle, CalendarClock, Clock, FileText, Link2 } from 'lucide-react';
import type { Summary } from './api';

/**
 * O que uma pendência faz ao ser clicada — leva a outra tela, já filtrada quando for o caso.
 *
 * Fica aqui (não em `HomeView.tsx`, de onde saiu) porque quem consome isto não é só o Painel: o
 * sino de notificações do cabeçalho (`NotificationsBell`) usa a mesma lista, em toda tela.
 */
export type PainelDestino =
  | { tipo: 'agenda'; status: string }
  | { tipo: 'conexoes' }
  | { tipo: 'insights' };

export interface Pendencia {
  id: string;
  /** O herói do card no Painel; no sino, o número que abre a frase. */
  quantidade: number;
  titulo: string;
  detalhe: string;
  icone: ReactNode;
  /** Vermelho em vez de roxo: reservado pro que já deu errado, não pro que só está parado. É
   *  também o que decide se o sino liga o pontinho — ver NotificationsBell. */
  grave?: boolean;
  destino: PainelDestino;
}

const plural = (q: number, um: string, muitos: string) => (q === 1 ? um : muitos);

/**
 * As pendências, da mais urgente pra menos.
 *
 * A ordem é deliberada: primeiro o que já quebrou (falha, conta caída), depois o que vai quebrar se
 * ninguém olhar (fila atrasada), e por último o que só está esperando uma decisão (rascunho).
 *
 * Único lugar que sabe transformar `Summary` (números crus do servidor) em algo que se clica — o
 * Painel e o sino de notificações reusam esta mesma função, pra nunca discordar sobre o que é
 * pendência.
 */
export function construirPendencias(summary: Summary | null, accounts: { status: string }[]): Pendencia[] {
  if (!summary) return [];
  const out: Pendencia[] = [];
  const s = summary.por_status;

  // Os textos são curtos de propósito: no card quadrado do Painel o rótulo tem duas linhas, não
  // uma faixa inteira, e a contagem já é dita pelo número grande — repeti-la na frase seria dizer
  // duas vezes. No sino, o número entra na frase ("1 publicação falhou").
  const falhas = (s.failed ?? 0) + (s.ambiguous ?? 0);
  if (falhas > 0) {
    out.push({
      id: 'falhas',
      quantidade: falhas,
      titulo: plural(falhas, 'publicação falhou', 'publicações falharam'),
      detalhe: 'reativar ou excluir',
      icone: <AlertTriangle className="size-4" />,
      grave: true,
      destino: { tipo: 'agenda', status: 'failed' },
    });
  }

  const reauth = accounts.filter((a) => a.status === 'needs_reauth').length;
  if (reauth > 0) {
    out.push({
      id: 'reauth',
      quantidade: reauth,
      titulo: plural(reauth, 'conta caiu', 'contas caíram'),
      detalhe: 'reconectar',
      icone: <Link2 className="size-4" />,
      grave: true,
      destino: { tipo: 'conexoes' },
    });
  }

  if (summary.atencao.atrasados > 0) {
    out.push({
      id: 'atrasados',
      quantidade: summary.atencao.atrasados,
      titulo: plural(summary.atencao.atrasados, 'devia ter saído', 'deviam ter saído'),
      detalhe: 'na fila, data vencida',
      icone: <Clock className="size-4" />,
      grave: true,
      destino: { tipo: 'agenda', status: 'queued' },
    });
  }

  // Rascunho vencido e rascunho em dia são a MESMA linha em dois tons: se algum ficou pra trás, é
  // isso que precisa ser dito; senão, basta lembrar que os rascunhos existem. Mostrar as duas
  // versões ao mesmo tempo seria contar o mesmo rascunho duas vezes. Nenhuma das duas é `grave` —
  // um acervo normal de ideias não é alarme, é backlog.
  const rascunhos = s.draft ?? 0;
  const vencidos = summary.atencao.rascunhos_vencidos;
  if (vencidos > 0) {
    out.push({
      id: 'rascunhos-vencidos',
      quantidade: vencidos,
      titulo: plural(vencidos, 'rascunho pra trás', 'rascunhos pra trás'),
      detalhe: 'a data já passou',
      icone: <CalendarClock className="size-4" />,
      destino: { tipo: 'agenda', status: 'draft' },
    });
  } else if (rascunhos > 0) {
    out.push({
      id: 'rascunhos',
      quantidade: rascunhos,
      titulo: plural(rascunhos, 'rascunho esperando', 'rascunhos esperando'),
      detalhe: 'definir data e enviar',
      icone: <FileText className="size-4" />,
      destino: { tipo: 'agenda', status: 'draft' },
    });
  }

  return out;
}
