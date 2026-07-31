// Matemática de reordenação do planejador de grade. Fica fora do componente porque é a parte que
// pode dar errado silenciosamente (horário de post trocado por engano) e é a única que dá pra
// raciocinar isoladamente.
//
// Regra do planejador: a grade tem duas espécies de peça móvel, e elas se movem de jeitos
// diferentes.
//
// - **Post agendado**: nunca ganha um horário novo. O conjunto de `scheduled_for` dos posts é
//   invariante — arrastar só redistribui esse conjunto entre eles (é o que /api/posts/reschedule
//   faz no servidor). Assim ninguém cria buraco na agenda nem inventa data.
// - **Prévia**: não tem horário de publicação nenhum, só uma posição. Então ela ganha um `sort_at`
//   interpolado entre os posts vizinhos — cabe entre dois agendados sem empurrar nenhum.

const HOUR_MS = 3_600_000;

export interface Movable {
  id: string;
  kind: 'post' | 'preview';
  at: string;
}

export interface OrderPlan {
  /** ids dos posts na nova ordem da grade (mais novo primeiro). */
  postOrder: string[];
  /** id da prévia → novo `sort_at`. */
  previewAt: Record<string, string>;
}

/**
 * Recebe as peças móveis já na ordem desejada (topo da grade primeiro = mais recente) e devolve o
 * que precisa ser gravado: a ordem dos posts e o novo `sort_at` de cada prévia.
 */
export function planGridOrder(movable: Movable[]): OrderPlan {
  const postOrder = movable.filter((m) => m.kind === 'post').map((m) => m.id);

  // Os horários disponíveis são exatamente os que já existem, do mais tarde pro mais cedo — o
  // i-ésimo post da nova ordem fica com o i-ésimo horário.
  const times = movable
    .filter((m) => m.kind === 'post')
    .map((m) => Date.parse(m.at))
    .sort((a, b) => b - a);

  const resolved: Array<{ kind: Movable['kind']; id: string; time: number | null }> = [];
  let taken = 0;
  for (const m of movable) {
    resolved.push({ kind: m.kind, id: m.id, time: m.kind === 'post' ? times[taken++] : null });
  }

  const previewAt: Record<string, string> = {};
  // Cada corrida de prévias entre dois posts (ou entre um post e a ponta da lista) é distribuída
  // uniformemente no intervalo de tempo que sobra entre eles.
  for (let i = 0; i < resolved.length; i++) {
    if (resolved[i].time !== null) continue;
    let end = i;
    while (end + 1 < resolved.length && resolved[end + 1].time === null) end++;
    const count = end - i + 1;

    const above = i > 0 ? (resolved[i - 1].time as number) : null; // mais tarde
    const below = end + 1 < resolved.length ? (resolved[end + 1].time as number) : null; // mais cedo

    let upper: number;
    let lower: number;
    if (above !== null && below !== null) {
      upper = above;
      lower = below;
    } else if (above !== null) {
      upper = above;
      lower = above - (count + 1) * HOUR_MS;
    } else if (below !== null) {
      upper = below + (count + 1) * HOUR_MS;
      lower = below;
    } else {
      // Grade só de prévias: ancora no futuro próximo, sem colidir com nada.
      upper = Date.now() + 24 * HOUR_MS;
      lower = upper - (count + 1) * HOUR_MS;
    }
    // Dois posts no mesmo instante deixariam o intervalo em zero e todas as prévias empatadas —
    // abre espaço à força pra ordem continuar determinística.
    if (upper - lower < count + 1) upper = lower + (count + 1) * 1000;

    const step = (upper - lower) / (count + 1);
    for (let j = 0; j < count; j++) {
      const time = Math.round(upper - (j + 1) * step);
      resolved[i + j].time = time;
      previewAt[resolved[i + j].id] = new Date(time).toISOString();
    }
    i = end;
  }

  return { postOrder, previewAt };
}

/** Move um item de posição dentro da lista, devolvendo uma lista nova. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const out = list.slice();
  out.splice(to, 0, out.splice(from, 1)[0]);
  return out;
}
