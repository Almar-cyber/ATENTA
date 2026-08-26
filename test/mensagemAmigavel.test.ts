import { describe, expect, it } from 'vitest';
import { mensagemAmigavel } from '../src/lib/errors.js';

// O `last_error` é lido POR UMA PESSOA, no detalhe do post. Antes ia o texto cru da plataforma:
//
//   tiktok: video/init failed: 400 {"error":{"code":"invalid_params",
//   "message":"The chunk size is invalid","log_id":"20260805...F3C"}}
//
// Não dizia o que houve nem o que fazer, e `log_id` só serve pro suporte da plataforma.

describe('mensagemAmigavel', () => {
  it('traduz o erro real que apareceu na tela (TikTok, chunk inválido)', () => {
    const cru =
      'tiktok: video/init failed: 400 {"error":{"code":"invalid_params","message":"The chunk size is invalid","log_id":"202608052306115DEA08F7441478382F3C"}}';
    const texto = mensagemAmigavel(cru);
    expect(texto).toBeTruthy();
    // As três coisas que a versão crua falhava em ser:
    expect(texto).not.toContain('log_id'); // sem id de suporte
    expect(texto).not.toContain('{'); // sem JSON
    expect(texto!.length).toBeLessThan(140); // legível de relance
  });

  it('traduz o bloqueio de permissão da Meta, dizendo que não há o que fazer', () => {
    const texto = mensagemAmigavel('facebook: (#200) Missing Permissions');
    // Este é o caso em que a ação certa é NENHUMA — e não dizer isso faz a pessoa tentar de novo
    // sem parar. A frase precisa deixar claro que o bloqueio é da plataforma.
    expect(texto).toMatch(/permiss/i);
    expect(texto).toMatch(/nada a fazer|depende/i);
  });

  it('token expirado manda reconectar, que é a ação real', () => {
    for (const cru of [
      'instagram: 401 unauthorized',
      'linkedin: OAuthException: invalid_token',
      'youtube: token expired',
    ]) {
      expect(mensagemAmigavel(cru), cru).toMatch(/reconecte/i);
    }
  });

  it('erro DESCONHECIDO devolve null, para o técnico chegar íntegro', () => {
    // A decisão que mais importa neste arquivo. Um genérico do tipo "algo deu errado" apagaria a
    // única pista de um erro que ninguém previu — foi assim que a coleta do Facebook ficou
    // quebrada em silêncio por semanas (ver src/metrics/facebook.ts).
    expect(mensagemAmigavel('pinterest: erro que nunca vimos antes, código 4711')).toBeNull();
    expect(mensagemAmigavel('')).toBeNull();
  });

  it('não confunde erros diferentes: cada um cai na sua tradução', () => {
    const chunk = mensagemAmigavel('The chunk size is invalid');
    const permissao = mensagemAmigavel('(#200) Missing Permissions');
    const limite = mensagemAmigavel('429 rate limit exceeded');
    expect(new Set([chunk, permissao, limite]).size).toBe(3);
  });
});
