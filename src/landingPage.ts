// Página pública do produto (a raiz, para quem não está autenticado).
//
// POR QUE EXISTE: o App Review da Meta (e o da Pinterest/TikTok) exige "um site completo que mostre
// o serviço" — e o dashboard fica atrás do gate de senha, então um revisor que abrisse a raiz batia
// num 401 e reprovava sem ver o que o app faz. Esta página descreve o produto sem exigir
// credencial; o painel em si mora em /app pra baixo.
//
// Visual: segue o rascunho do Figma (hero amarelo #FCEC0E, wordmark, headline serifada grande,
// botão branco de borda preta, foto em moldura inclinada). As seções abaixo do hero são nossas —
// o rascunho ainda não as tinha, e o App Review precisa ver o que o produto faz e como trata dados.
//
// Autocontida por design: é buscada direto por crawlers de revisão, então nada de fonte externa ou
// CDN. O wordmark vem do binding ASSETS como data: URI (bypassa o gate, é chamada de binding); a
// foto do hero é servida pelo mesmo binding como arquivo normal.
import type { Env } from './lib/env.js';
import { PLATFORM_GLYPHS } from './lib/platform-glyphs.js';

// Kreon/Francois One (do rascunho) não estão no projeto e exigiriam Google Fonts — o que quebraria
// a autocontenção. Stack serifada nativa aproxima a intenção da headline sem requisição externa.
const SERIF = `'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, 'Times New Roman', serif`;
const SANS = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, Helvetica, Arial, sans-serif`;

const STYLE = `
  :root { --brand: #52277F; --primary: #FCEC0E; --ink: #010101; --muted: #5b5560; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #fff; color: var(--ink); font-family: ${SANS}; line-height: 1.6; }
  img { max-width: 100%; display: block; }

  /* ---- HERO (amarelo, como no rascunho) ---- */
  .hero { background: var(--primary); padding: 3rem 1.5rem 3.5rem; }
  .hero-in {
    max-width: 1100px; margin: 0 auto;
    display: grid; gap: 2.5rem; align-items: center;
    grid-template-columns: 1fr;
  }
  .wordmark { height: 52px; width: auto; margin-bottom: 2rem; }
  h1 {
    font-family: ${SERIF}; font-weight: 400; color: var(--ink);
    font-size: clamp(2.2rem, 6.5vw, 4.2rem); line-height: 0.98; letter-spacing: -0.01em;
    margin: 0 0 1.25rem; max-width: 14ch;
  }
  .sub { font-size: 1.1rem; margin: 0 0 2rem; max-width: 42ch; color: #2b2630; }
  .cta {
    display: inline-block; background: #fff; color: var(--ink); text-decoration: none;
    font-weight: 700; font-size: 1.15rem; padding: 0.75em 1.6em;
    border: 4px solid var(--ink); border-radius: 25px;
  }
  .cta:hover { transform: translate(-2px, -2px); box-shadow: 4px 4px 0 0 var(--ink); }
  /* Moldura inclinada da foto, como no rascunho */
  /* A foto é 1:1 e sem teto de ALTURA ela esticava pra ~1220px, empurrando o hero pra 1344px e
     jogando o CTA pra fora da primeira dobra. max-height é o que segura; a largura acompanha. */
  .shot { position: relative; }
  .shot img {
    width: 100%; max-width: min(420px, 100%); margin-inline: auto; height: auto;
    border-radius: 32px; border: 6px solid var(--ink);
    transform: rotate(-3deg); object-fit: cover; aspect-ratio: 1;
  }
  @media (min-width: 880px) {
    .hero { padding: 4rem 2rem 5rem; }
    .hero-in { grid-template-columns: 1.05fr 0.95fr; gap: 4rem; }
    /* Só no desktop a coluna é larga o bastante pra foto esticar — no mobile a largura já limita. */
    .shot img { max-height: 420px; }
  }

  /* ---- Conteúdo ---- */
  .wrap { max-width: 1000px; margin: 0 auto; padding: 3.5rem 1.5rem; }
  h2 { font-family: ${SERIF}; font-weight: 400; font-size: clamp(1.6rem, 3.5vw, 2.3rem); margin: 0 0 1.5rem; }
  .grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); }
  .card {
    border: 3px solid var(--brand); box-shadow: 5px 5px 0 0 var(--brand);
    border-radius: 20px; padding: 1.5rem; background: #fff;
  }
  .card h3 { margin: 0 0 0.4rem; font-size: 1.05rem; }
  .card p { margin: 0; color: var(--muted); font-size: 0.95rem; }
  .nets { display: flex; flex-wrap: wrap; gap: 0.75rem; margin: 0; padding: 0; list-style: none; }
  .nets li {
    display: flex; align-items: center; gap: 0.55rem;
    background: #fff; border: 3px solid var(--ink); border-radius: 999px;
    padding: 0.5em 1.1em 0.5em 0.75em; font-weight: 600;
  }
  .nets svg { width: 22px; height: 22px; flex: 0 0 22px; }
  ol { padding-left: 1.3rem; margin: 0; }
  ol li { margin-bottom: 0.6rem; }
  .band { background: var(--primary); }
  .band .wrap { padding: 3rem 1.5rem; }
  footer { border-top: 3px solid var(--brand); }
  footer .wrap { padding: 2rem 1.5rem 3rem; color: var(--muted); font-size: 0.92rem; }
  footer a, .band a { color: var(--brand); }
`;

async function logoDataUri(env: Env): Promise<string | null> {
  try {
    const res = await env.ASSETS.fetch(new Request('https://assets.local/atenta-wordmark.png'));
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return `data:image/png;base64,${btoa(bin)}`;
  } catch {
    return null;
  }
}

export async function renderLandingPage(env: Env): Promise<string> {
  const logo = await logoDataUri(env);
  const logoHtml = logo
    ? `<img class="wordmark" src="${logo}" alt="ATENTA!">`
    : `<div class="wordmark"><b style="font-size:2rem;color:var(--brand)">ATENTA!</b></div>`;

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ATENTA! — Gestão de redes sociais</title>
<meta name="description" content="ATENTA! agenda publicações em Instagram, Facebook, YouTube, LinkedIn, Pinterest e TikTok, e mostra como cada post performou.">
<style>${STYLE}</style>
</head>
<body>

<header class="hero">
  <div class="hero-in">
    <div>
      ${logoHtml}
      <h1>Melhor aplicativo de gestão de redes sociais do Brasil!</h1>
      <p class="sub">Agende, publique e acompanhe o resultado dos seus posts em seis redes — sem abrir seis aplicativos diferentes.</p>
      <a class="cta" href="/app">Comece grátis</a>
    </div>
    <div class="shot">
      <img src="/hero.jpg" alt="Duas pessoas olhando o celular, usando redes sociais" width="1200" height="1200">
    </div>
  </div>
</header>

<section class="wrap">
  <h2>O que dá pra fazer</h2>
  <div class="grid">
    <div class="card">
      <h3>Agende de uma vez só</h3>
      <p>Escreva a legenda, escolha as contas e a data. O mesmo conteúdo sai em cada rede no formato certo.</p>
    </div>
    <div class="card">
      <h3>Veja antes de publicar</h3>
      <p>A pré-visualização mostra como o post vai aparecer em cada rede, na proporção real de cada formato.</p>
    </div>
    <div class="card">
      <h3>Planeje o feed</h3>
      <p>A grade do Instagram, arrastável: reorganize a ordem dos agendados e veja como o perfil vai ficar.</p>
    </div>
    <div class="card">
      <h3>Saiba o que deu certo</h3>
      <p>Curtidas, alcance, comentários e seguidores por post e por rede — com destaques do que mais engajou.</p>
    </div>
  </div>
</section>

<section class="band">
  <div class="wrap">
    <h2>Redes disponíveis</h2>
    <ul class="nets">
      ${PLATFORM_GLYPHS.map(
        (n) =>
          `<li><svg viewBox="0 0 24 24" fill="${n.color}" aria-hidden="true"><path d="${n.path}"/></svg>${n.label}</li>`
      ).join('')}
    </ul>
  </div>
</section>

<section class="wrap">
  <h2>Como funciona</h2>
  <ol>
    <li><b>Conecte suas contas.</b> Você autoriza o ATENTA! pela tela de consentimento da própria rede social. Nunca pedimos a sua senha.</li>
    <li><b>Crie o post.</b> Legenda, imagens ou vídeo, formato (post, reel, story) e o horário de publicação.</li>
    <li><b>A publicação sai sozinha.</b> No horário marcado, o ATENTA! publica nas contas escolhidas.</li>
    <li><b>Acompanhe o resultado.</b> As métricas de cada post são coletadas automaticamente e reunidas num painel.</li>
  </ol>
</section>

<section class="wrap">
  <h2>Seus dados</h2>
  <p>
    As autorizações das suas contas ficam guardadas criptografadas e são usadas apenas para publicar
    o conteúdo que você agendou e ler as métricas desses posts. Nunca vendemos nem compartilhamos
    esses dados. Você pode desconectar qualquer conta quando quiser, pela plataforma ou pelas
    configurações da própria rede social.
  </p>
</section>

<footer>
  <div class="wrap">
    <a href="/privacy">Política de Privacidade</a> · <a href="/terms">Termos de Serviço</a><br>
    Criado por Estúdio Mangue (<a href="https://omangue.co">omangue.co</a>) —
    Contato: <a href="mailto:contato@omangue.co">contato@omangue.co</a>
  </div>
</footer>

</body>
</html>`;
}
