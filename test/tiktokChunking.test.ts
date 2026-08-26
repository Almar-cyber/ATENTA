import { describe, expect, it } from 'vitest';
import { tiktokChunking } from '../src/adapters/tiktok.js';

// REGRESSÃO da PRIMEIRA publicação real deste adapter (2026-08-05). Ele mandava o arquivo inteiro
// como um chunk só (`chunk_size: asset.size_bytes, total_chunk_count: 1`), e um vídeo de 126 MB
// levou 400 "The chunk size is invalid" do /post/publish/video/init/ — o dobro do teto de 64 MB.
//
// Era o risco que o README registrava desde o começo: os nomes e regras deste adapter vieram da
// documentação, nunca de uma chamada real. Estes testes fixam as três regras que a API cobra.

const MB = 1024 * 1024;
const MAX = 64 * MB;

describe('tiktokChunking', () => {
  it('vídeo pequeno vai inteiro, num chunk só', () => {
    // Abaixo do mínimo de 5 MB o chunk pode ser menor que ele: o piso vale por chunk, não pro
    // arquivo. Recusar aqui impediria publicar qualquer vídeo curto.
    expect(tiktokChunking(2 * MB)).toEqual({ chunkSize: 2 * MB, totalChunks: 1 });
    expect(tiktokChunking(5 * MB)).toEqual({ chunkSize: 5 * MB, totalChunks: 1 });
  });

  it('o caso que quebrou: 126 MB não pode virar um chunk de 126 MB', () => {
    const { chunkSize, totalChunks } = tiktokChunking(132_409_342);
    expect(chunkSize).toBeLessThanOrEqual(64 * MB);
    expect(chunkSize).toBeGreaterThanOrEqual(5 * MB);
    expect(totalChunks).toBeGreaterThan(0);
  });

  it('nenhum tamanho de arquivo produz chunk fora da faixa que a API aceita', () => {
    // Varre a faixa realista de vídeo, incluindo as bordas exatas dos limites.
    const tamanhos = [
      1, MB, 5 * MB - 1, 5 * MB, 5 * MB + 1, 63 * MB, 64 * MB, 64 * MB + 1,
      100 * MB, 126 * MB, 128 * MB, 200 * MB, 500 * MB, 4 * 1024 * MB,
    ];
    for (const tamanho of tamanhos) {
      const { chunkSize, totalChunks } = tiktokChunking(tamanho);
      expect(chunkSize, `chunk grande demais para ${tamanho}`).toBeLessThanOrEqual(64 * MB);
      expect(totalChunks, `contagem inválida para ${tamanho}`).toBeGreaterThanOrEqual(1);
      // Só o arquivo abaixo do piso pode ter chunk menor que 5 MB.
      if (tamanho > 5 * MB) {
        expect(chunkSize, `chunk pequeno demais para ${tamanho}`).toBeGreaterThanOrEqual(5 * MB);
      }
    }
  });

  // ESTE é o teste que deveria ter pego o bug, e na primeira versão não pegou: eu asseverei
  // `inicioDoUltimo + (tamanho - inicioDoUltimo) === tamanho`, que é verdadeiro para QUALQUER
  // entrada. Um teste tautológico passa com o código quebrado — e passou: 126 MB seguiram virando
  // um único chunk de 126 MB, e o TikTok recusou de novo em produção.
  //
  // A asserção que faltava é a que a API cobra: o ÚLTIMO chunk também cabe em 64 MB.
  it('NENHUM chunk passa de 64 MB, incluindo o último com o resto', () => {
    for (const tamanho of [6 * MB, 65 * MB, 100 * MB, 126 * MB, 132_409_342, 200 * MB, 500 * MB, 4096 * MB]) {
      const { chunkSize, totalChunks } = tiktokChunking(tamanho);
      const bytesDoUltimo = tamanho - (totalChunks - 1) * chunkSize;

      expect(bytesDoUltimo, `último chunk vazio ou negativo em ${tamanho}`).toBeGreaterThan(0);
      expect(bytesDoUltimo, `ÚLTIMO chunk acima de 64 MB em ${tamanho}`).toBeLessThanOrEqual(MAX);
      expect(chunkSize, `chunk acima de 64 MB em ${tamanho}`).toBeLessThanOrEqual(MAX);
      // E a cobertura, agora escrita de um jeito que pode falhar: a soma real das partes.
      expect((totalChunks - 1) * chunkSize + bytesDoUltimo, `cobertura errada em ${tamanho}`).toBe(tamanho);
    }
  });

  it('o caso exato que quebrou duas vezes: 126,28 MB', () => {
    const { chunkSize, totalChunks } = tiktokChunking(132_409_342);
    // Precisa de mais de um pedaço — a primeira correção devolvia 1 aqui, e era esse o defeito.
    expect(totalChunks).toBeGreaterThan(1);
    expect(chunkSize * totalChunks).toBeLessThanOrEqual(132_409_342);
    expect(132_409_342 - (totalChunks - 1) * chunkSize).toBeLessThanOrEqual(MAX);
  });
});
