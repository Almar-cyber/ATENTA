import { describe, expect, it } from 'vitest';
import { moveItem, planGridOrder } from '../web/src/lib/gridOrder.js';
import type { Movable } from '../web/src/lib/gridOrder.js';

// A matemática de reordenação da grade — e o único arquivo do projeto cujo próprio comentário diz
// que é "a parte que pode dar errado silenciosamente". Até aqui não tinha teste nenhum.
//
// "Silenciosamente" é literal: se um post receber o horário que era de outro, nada estoura. O
// /api/posts/reschedule grava, não há exceção nem log, e só se descobre dias depois quando algo
// publica na hora errada. Os testes abaixo existem pra transformar exatamente esse erro em falha
// barulhenta — e ganharam urgência agora que a lista de ideias multiplica o uso deste caminho.

const t = (iso: string) => Date.parse(iso);

/** Grade lida de cima (mais novo) pra baixo (mais antigo), que é a ordem que a função recebe. */
function post(id: string, at: string): Movable {
  return { id, kind: 'post', at };
}
function ideia(id: string): Movable {
  // A ideia carrega um `at` só porque ele existe no tipo; a função tem que ignorá-lo e interpolar.
  return { id, kind: 'preview', at: '1970-01-01T00:00:00Z' };
}

describe('planGridOrder', () => {
  describe('o invariante: reordenar nunca inventa nem perde horário', () => {
    it('devolve os mesmos posts, na ordem pedida', () => {
      const antes = [post('a', '2026-03-03T12:00:00Z'), post('b', '2026-03-02T12:00:00Z'), post('c', '2026-03-01T12:00:00Z')];
      const depois = moveItem(antes, 2, 0); // 'c' vai pro topo

      const plano = planGridOrder(depois);

      expect(plano.postOrder).toEqual(['c', 'a', 'b']);
      // Nenhum post some nem aparece do nada: é permutação, não criação.
      expect([...plano.postOrder].sort()).toEqual(['a', 'b', 'c']);
    });

    it('uma ideia no meio não consome horário de post nenhum', () => {
      const arranjo = [
        post('a', '2026-03-03T12:00:00Z'),
        ideia('i1'),
        post('b', '2026-03-02T12:00:00Z'),
        post('c', '2026-03-01T12:00:00Z'),
      ];

      const plano = planGridOrder(arranjo);

      // ESTA é a asserção que pega o erro silencioso. Com N+1 peças pra N horários, tratar a ideia
      // como post faz os horários "escorregarem" um lugar — 'b' fica com o de 'c' e 'c' com
      // undefined.
      expect(plano.postOrder).toEqual(['a', 'b', 'c']);

      // O POSITIVO PRIMEIRO, e não é zelo: na primeira versão deste teste só existia o `not
      // .toContain` abaixo, e ele passava com a função sabotada — a ideia ficava sem horário,
      // `Date.parse(undefined)` virava NaN, e "NaN não está na lista" é verdade. Um teste que
      // sobrevive ao próprio bug que ele existe pra pegar não estava testando nada.
      expect(plano.previewAt).toHaveProperty('i1');
      expect(Number.isNaN(t(plano.previewAt.i1))).toBe(false);

      const horariosDosPosts = [t('2026-03-03T12:00:00Z'), t('2026-03-02T12:00:00Z'), t('2026-03-01T12:00:00Z')];
      expect(horariosDosPosts).not.toContain(t(plano.previewAt.i1));
    });
  });

  describe('onde a ideia cai', () => {
    it('entre dois posts, cai estritamente entre eles', () => {
      const plano = planGridOrder([
        post('a', '2026-03-03T12:00:00Z'),
        ideia('i1'),
        post('b', '2026-03-01T12:00:00Z'),
      ]);

      const at = t(plano.previewAt.i1);
      expect(at).toBeLessThan(t('2026-03-03T12:00:00Z'));
      expect(at).toBeGreaterThan(t('2026-03-01T12:00:00Z'));
    });

    it('duas ideias seguidas ficam entre os vizinhos, e na ordem em que foram postas', () => {
      const plano = planGridOrder([
        post('a', '2026-03-03T12:00:00Z'),
        ideia('i1'),
        ideia('i2'),
        post('b', '2026-03-01T12:00:00Z'),
      ]);

      const a1 = t(plano.previewAt.i1);
      const a2 = t(plano.previewAt.i2);
      // Mais alto na grade = mais tarde no tempo, que é como a grade inteira é ordenada.
      expect(a1).toBeGreaterThan(a2);
      expect(a1).toBeLessThan(t('2026-03-03T12:00:00Z'));
      expect(a2).toBeGreaterThan(t('2026-03-01T12:00:00Z'));
    });

    it('no topo da grade, fica depois do post mais recente', () => {
      const plano = planGridOrder([ideia('i1'), post('a', '2026-03-01T12:00:00Z')]);
      expect(t(plano.previewAt.i1)).toBeGreaterThan(t('2026-03-01T12:00:00Z'));
    });

    it('no fim da grade, fica antes do post mais antigo', () => {
      const plano = planGridOrder([post('a', '2026-03-01T12:00:00Z'), ideia('i1')]);
      expect(t(plano.previewAt.i1)).toBeLessThan(t('2026-03-01T12:00:00Z'));
    });

    it('grade só de ideias: ancora no futuro e mantém a ordem', () => {
      const plano = planGridOrder([ideia('i1'), ideia('i2'), ideia('i3')]);

      expect(plano.postOrder).toEqual([]);
      expect(Object.keys(plano.previewAt).sort()).toEqual(['i1', 'i2', 'i3']);
      expect(t(plano.previewAt.i1)).toBeGreaterThan(t(plano.previewAt.i2));
      expect(t(plano.previewAt.i2)).toBeGreaterThan(t(plano.previewAt.i3));
    });
  });

  it('dois posts no mesmo instante ainda deixam a ideia entre eles', () => {
    // Sem a folga forçada, o intervalo entre os vizinhos seria ZERO e as ideias empatariam — a
    // ordem da grade deixaria de ser determinística e o arranjo mudaria sozinho a cada carga.
    const plano = planGridOrder([
      post('a', '2026-03-02T12:00:00Z'),
      ideia('i1'),
      ideia('i2'),
      post('b', '2026-03-02T12:00:00Z'),
    ]);

    expect(t(plano.previewAt.i1)).toBeGreaterThan(t(plano.previewAt.i2));
  });

  it('toda ideia do arranjo recebe um horário — nenhuma fica sem', () => {
    const plano = planGridOrder([
      ideia('topo'),
      post('a', '2026-03-03T12:00:00Z'),
      ideia('meio'),
      post('b', '2026-03-01T12:00:00Z'),
      ideia('fim'),
    ]);

    expect(Object.keys(plano.previewAt).sort()).toEqual(['fim', 'meio', 'topo']);
    for (const iso of Object.values(plano.previewAt)) {
      expect(Number.isNaN(Date.parse(iso))).toBe(false);
    }
  });
});

describe('moveItem', () => {
  it('move sem duplicar nem perder', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
  });

  it('não altera a lista original', () => {
    const original = ['a', 'b', 'c'];
    moveItem(original, 0, 2);
    expect(original).toEqual(['a', 'b', 'c']);
  });
});
