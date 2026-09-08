import type { ReactNode } from 'react';
import { AlertTriangle, CalendarClock, Clock, FileText, FlaskConical, Link2, RotateCcw } from 'lucide-react';
import type { Summary } from './api';
import type { Platform } from './types';
import { PLATFORM_LABELS } from './platforms';

/**
 * O que uma pendência faz ao ser clicada — leva a outra tela, já filtrada quando for o caso.
 *
 * Fica aqui (não em `HomeView.tsx`, de onde saiu) porque quem consome isto não é só o Painel: o
 * sino de notificações do cabeçalho (`NotificationsBell`) usa a mesma lista, em toda tela.
 */
export type PainelDestino =
  | { tipo: 'agenda'; status: string }
  | { tipo: 'conexoes' }
  | { tipo: 'insights' }
  // Abre UM post direto, em vez de uma tela filtrada. Existe pro Reel de teste: filtrar a Agenda
  // por "published" devolveria tudo que já saiu, e o teste sumiria no meio.
  | { tipo: 'post'; post_id: string; target_id: string };

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
 * "YouTube", "YouTube e Instagram", "YouTube, Instagram e TikTok".
 *
 * Nomes REPETIDOS somem (duas contas do mesmo Instagram viram "Instagram", não "Instagram e
 * Instagram"), e acima de três a lista para de crescer: o card tem uma linha, e a partir daí a
 * quantidade já diz mais que a enumeração.
 */
function listar(nomes: string[]): string {
  const unicos = [...new Set(nomes)];
  if (unicos.length > 3) return `${unicos.length} redes`;
  if (unicos.length === 1) return unicos[0];
  return `${unicos.slice(0, -1).join(', ')} e ${unicos[unicos.length - 1]}`;
}

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
export function construirPendencias(
  summary: Summary | null,
  // `platform` entra junto porque o aviso de conta caída diz QUAL rede caiu, não só quantas.
  accounts: { status: string; platform: Platform }[]
): Pendencia[] {
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

  // Já tentou publicar e falhou, mas segue na fila pro retry automático. Entra ANTES de "conta
  // caiu" e de "atrasados" porque é o único estado do app que engana: na lista é idêntico a um post
  // que só está esperando a hora, e o erro fica escondido no detalhe. Sem esta linha, a pessoa só
  // ficaria sabendo 30min depois (quando vira "atrasado") ou horas depois (quando as tentativas
  // esgotam e vira "falhou").
  const retentando = summary.atencao.retentando ?? 0;
  if (retentando > 0) {
    out.push({
      id: 'retentando',
      quantidade: retentando,
      titulo: plural(retentando, 'publicação falhou e vai tentar de novo', 'publicações falharam e vão tentar de novo'),
      detalhe: 'ver o motivo',
      icone: <RotateCcw className="size-4" />,
      grave: true,
      destino: { tipo: 'agenda', status: 'queued' },
    });
  }

  const caidas = accounts.filter((a) => a.status === 'needs_reauth');
  if (caidas.length > 0) {
    out.push({
      id: 'reauth',
      quantidade: caidas.length,
      // Diz QUAL rede caiu, não só quantas. "1 conta caiu" obriga a abrir Conexões pra descobrir o
      // que já dava pra ler aqui — e é justamente a informação que decide se você larga o que está
      // fazendo agora (o Instagram que publica hoje) ou deixa pra depois (o Pinterest parado).
      titulo: `${plural(caidas.length, 'conta', 'contas')} do ${listar(caidas.map((a) => PLATFORM_LABELS[a.platform]))} ${plural(caidas.length, 'caiu', 'caíram')}`,
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

  // Reel de teste esperando decisão. Não é `grave`: nada quebrou — o post está no ar, rendendo com
  // não-seguidores. É uma janela de oportunidade, e a régua do sino diz que só falha, conta caída
  // e fila atrasada acendem o ponto vermelho.
  const testes = summary.atencao.testes_para_decidir ?? 0;
  if (testes > 0 && summary.teste_a_decidir) {
    out.push({
      id: 'testes-para-decidir',
      quantidade: testes,
      titulo: plural(testes, 'Reel de teste rodou', 'Reels de teste rodaram'),
      // Diz o que fazer, e onde — o passo final é no app do Instagram, não aqui, e esconder isso
      // faria a pessoa procurar no ATENTA um botão que não pode existir (princípio 3 do design.md).
      detalhe: 'decidir no app do Instagram',
      icone: <FlaskConical className="size-4" />,
      destino: {
        tipo: 'post',
        post_id: summary.teste_a_decidir.post_id,
        target_id: summary.teste_a_decidir.target_id,
      },
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
