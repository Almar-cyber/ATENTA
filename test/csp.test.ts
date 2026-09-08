import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/worker.js';
import { CSP_APP, cspPaginaServida } from '../src/lib/csp.js';

// REGRESSÃO de 08/09/2026: "o que já foi publicado não aparece" no Grid IG.
//
// A grade mostrava um tabuleiro de quadrados cinzas no lugar de todo post antigo. Nada estava
// errado nos dados: a capa desses posts vem do FEED AO VIVO do Instagram (é a única que existe
// depois do purge de 30 dias, e a única que existe SEMPRE pro post importado do histórico), e a
// CSP que entrou em 26/08 listava no img-src só a nossa origem e o R2 — o navegador recusava a
// imagem do CDN da plataforma sem que nada na tela dissesse isso.
//
// Este arquivo existe porque a diretiva é uma STRING: nada no typecheck liga uma linha da política
// a uma <img> do front, e o preço de errar é uma funcionalidade que some sem levantar erro. Cada
// host abaixo tem um consumidor de verdade — se um consumidor sair, tire o host junto.

function imgSrc(policy: string): string {
  const diretiva = policy
    .split(';')
    .map((p) => p.trim())
    .find((p) => p.startsWith('img-src '));
  if (!diretiva) throw new Error(`img-src ausente em: ${policy}`);
  return diretiva;
}

describe('CSP do app', () => {
  it('libera as origens de imagem que a interface realmente usa', () => {
    const src = imgSrc(CSP_APP);
    // Nossa origem, e os data:/blob: do composer (arquivo escolhido e ainda não enviado).
    expect(src).toContain("'self'");
    expect(src).toContain('data:');
    expect(src).toContain('blob:');
    // R2: a capa de tudo que ainda tem cópia nossa (Thumb, PostPreview, fila de mídia).
    expect(src).toContain('https://scheduler-media.omangue.co');
    // Feed ao vivo: GridPlanner (o tile do feed e o feedThumb do post publicado) e InsightsView.
    expect(src).toContain('https://*.cdninstagram.com');
    expect(src).toContain('https://*.fbcdn.net');
    expect(src).toContain('https://*.ytimg.com');
  });

  it('não vira um curinga: img-src continua sendo uma lista', () => {
    // O conserto preguiçoso desse defeito é `img-src *`, que resolve a capa e entrega junto a
    // exfiltração por imagem — uma <img> injetada leva dado no querystring pra qualquer host.
    expect(imgSrc(CSP_APP)).not.toMatch(/(^|\s)\*(\s|$)/);
  });

  it('a política do app chega no SPA, e não só na constante', async () => {
    // O cabeçalho é posto num ponto único de saída (comCabecalhosDeSeguranca). Sem este caso, uma
    // mudança de roteamento poderia servir o SPA por um caminho que não passasse por lá.
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request('https://exemplo.test/app'), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.headers.get('Content-Security-Policy')).toBe(CSP_APP);
  });

  it('a landing tem política própria, e ela NÃO ganha os CDNs de rede social', () => {
    // Ela não mostra feed nenhum — só o wordmark em data URI. Alargar o img-src dela junto seria
    // ampliar de graça a superfície da página mais exposta do produto.
    const src = imgSrc(cspPaginaServida(["'sha256-exemplo'"]));
    expect(src).toContain('data:');
    expect(src).not.toContain('cdninstagram');
  });
});
