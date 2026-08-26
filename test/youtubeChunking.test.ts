import { describe, expect, it } from 'vitest';
import { youtubeChunks } from '../src/adapters/youtube.js';

// O fatiamento do upload do YouTube.
//
// Existe porque um vídeo real de 126 MB derrubou a publicação com "Network connection lost": o
// adapter mandava o arquivo inteiro num PUT só. A correção foi partir em pedaços, e é aritmética de
// faixa — o tipo de código que erra por um byte e só aparece num vídeo cortado, muito depois.
//
// A regra do Google que dita tudo aqui: todo pedaço, MENOS O ÚLTIMO, tem que ser múltiplo de
// 256 KB. É o que impede reusar o `tiktokChunking`, que divide em partes iguais.

const KB = 1024;
const MB = 1024 * KB;
const GRADE = 256 * KB;

/** O tamanho de um pedaço, a partir dos índices inclusivos que o Content-Range usa. */
const tamanho = (p: { inicio: number; fim: number }) => p.fim - p.inicio + 1;

describe('youtubeChunks', () => {
  it('arquivo menor que um pedaço vai inteiro, numa parte só', () => {
    const partes = youtubeChunks(5 * MB);
    expect(partes).toEqual([{ inicio: 0, fim: 5 * MB - 1 }]);
  });

  it('cobre o arquivo inteiro, sem buraco e sem sobreposição', () => {
    const total = 126 * MB + 12345; // o tamanho da falha real, com resto quebrado
    const partes = youtubeChunks(total);

    expect(partes[0].inicio).toBe(0);
    expect(partes[partes.length - 1].fim).toBe(total - 1);
    // Cada pedaço começa exatamente onde o anterior terminou: sem byte pulado nem repetido.
    for (let i = 1; i < partes.length; i++) {
      expect(partes[i].inicio).toBe(partes[i - 1].fim + 1);
    }
    expect(partes.reduce((s, p) => s + tamanho(p), 0)).toBe(total);
  });

  it('todo pedaço menos o último é múltiplo de 256 KB — a regra do Google', () => {
    for (const total of [20 * MB, 126 * MB + 12345, 700 * MB - 1]) {
      const partes = youtubeChunks(total);
      for (const p of partes.slice(0, -1)) {
        expect(tamanho(p) % GRADE).toBe(0);
      }
    }
  });

  it('nenhum pedaço passa do teto — é o teto que evita a conexão longa demais', () => {
    for (const total of [126 * MB, 1024 * MB]) {
      for (const p of youtubeChunks(total)) {
        expect(tamanho(p)).toBeLessThanOrEqual(16 * MB);
        expect(tamanho(p)).toBeGreaterThan(0);
      }
    }
  });

  it('tamanho exatamente múltiplo do pedaço não gera uma parte vazia no fim', () => {
    const partes = youtubeChunks(32 * MB); // 2 pedaços exatos de 16 MB
    expect(partes).toHaveLength(2);
    expect(tamanho(partes[1])).toBe(16 * MB);
  });

  it('arquivo vazio não gera pedaço nenhum', () => {
    expect(youtubeChunks(0)).toEqual([]);
  });

  it('o vídeo que falhou (126 MB) vira 8 pedaços, não 1', () => {
    const partes = youtubeChunks(126.3 * MB);
    expect(partes.length).toBe(8);
  });
});
