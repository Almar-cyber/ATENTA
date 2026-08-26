// Content-Security-Policy.
//
// A auditoria de 2026-08-06 apontou a ausência dela como a última lacuna de cabeçalho. Ficou de
// fora naquele momento porque a landing serve <style> e <script> EMBUTIDOS, e uma CSP restritiva
// precisa autorizar cada um deles nominalmente — meia-boca quebra a página.
//
// POR QUE HASH E NÃO NONCE. Os dois resolvem. O nonce exigiria gerar um valor por requisição e
// enfiá-lo em cada tag, mudando a assinatura das quatro funções de render. O hash não toca em
// nenhuma: os blocos embutidos são constantes de módulo, então o SHA-256 deles é fixo e pode ser
// calculado uma vez por isolate. De quebra é mais forte — um nonce que vaze por uma injeção em
// outro ponto da página pode ser reaproveitado pelo atacante; um hash, não: ele só autoriza
// aquele conteúdo exato.
//
// CONSEQUÊNCIA A NÃO ESQUECER: mudar uma vírgula do STYLE ou do SCRIPT muda o hash. Como ele é
// calculado a partir da MESMA string que é servida, isso se ajusta sozinho — mas se algum dia o
// conteúdo embutido passar a ser montado por requisição (interpolando dado dinâmico), o hash deixa
// de ser estável e aí o caminho passa a ser o nonce.

/** Cache por isolate: o digest é o mesmo enquanto o código não mudar. */
const cache = new Map<string, string>();

/** `'sha256-...'` no formato que a CSP espera, pronto pra entrar numa diretiva. */
export async function hashCsp(conteudo: string): Promise<string> {
  const emCache = cache.get(conteudo);
  if (emCache) return emCache;

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(conteudo));
  // btoa precisa de string binária; String.fromCharCode(...) direto estoura a pilha em entrada
  // grande (o STYLE tem alguns milhares de bytes), daí o loop.
  let binario = '';
  const bytes = new Uint8Array(digest);
  for (const b of bytes) binario += String.fromCharCode(b);
  const valor = `'sha256-${btoa(binario)}'`;

  cache.set(conteudo, valor);
  return valor;
}

/**
 * Política das páginas que NÓS renderizamos (landing e páginas legais).
 *
 * `default-src 'none'` como base e cada permissão declarada explicitamente: é o oposto de listar o
 * que é proibido, e o que garante que uma diretiva esquecida negue em vez de liberar.
 */
export function cspPaginaServida(hashes: string[]): string {
  return [
    "default-src 'none'",
    `script-src ${hashes.join(' ')}`,
    `style-src ${hashes.join(' ')}`,
    // ATRIBUTO style="" é governado por style-src-attr, que na AUSÊNCIA dele herda o style-src
    // acima — e um hash nunca casa com atributo, então TODO style inline morria. Foi o que
    // aconteceu ao publicar a primeira versão desta política: as barras da comparação de preço
    // (style="height:26%") viraram um risco de 6px, e os atrasos de animação (style="--d:200ms")
    // pararam junto. A página não reclamou; só ficou errada.
    //
    // Declarar style-src-attr separadamente libera o atributo e MANTÉM o <style> preso ao hash,
    // que é onde mora o risco de verdade: bloco de CSS injetado consegue redesenhar a página
    // inteira, atributo em um elemento não.
    "style-src-attr 'unsafe-inline'",
    // data: por causa do wordmark, que é embutido como data URI pra não custar uma requisição.
    "img-src 'self' data:",
    // A landing chama /api/auth/get-session e /api/atendente, ambos na própria origem.
    "connect-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    "base-uri 'none'",
  ].join('; ');
}

/**
 * Política do SPA e do resto (assets, respostas de API).
 *
 * `script-src 'self'` sem 'unsafe-inline': o index.html do build tem UM script externo e nenhum
 * embutido, então script injetado por XSS não executa. É a diretiva que carrega o valor real aqui.
 *
 * `style-src` com 'unsafe-inline' é concessão consciente: React e motion injetam estilo em runtime,
 * e sem isso a interface quebra. Estilo embutido dá para exfiltrar dado em cenários exóticos, mas o
 * ganho de bloquear script não depende disso.
 */
export const CSP_APP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  // blob: pro preview de arquivo ainda não enviado (useMediaUrl cria object URL); o domínio do R2
  // é de onde vêm as capas do que já subiu.
  "img-src 'self' data: blob: https://scheduler-media.omangue.co",
  "media-src 'self' blob: https://scheduler-media.omangue.co",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  "base-uri 'none'",
].join('; ');
