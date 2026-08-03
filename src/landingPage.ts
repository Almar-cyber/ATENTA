// Página pública do produto (a raiz, para quem não está autenticado).
//
// POR QUE EXISTE: o App Review da Meta (e o da Pinterest/TikTok) exige "um site completo que mostre
// o serviço" — e o painel fica atrás do gate de senha, então um revisor batia em 401 e reprovava
// sem ver o que o app faz. O painel continua protegido, em /app.
//
// ESTRUTURA: segue os padrões do mercado BR (reportei.com/flux e mlabs.com.br, analisados em
// 02/08/2026) — um único CTA repetido com "grátis" no rótulo, "não pedimos cartão" colado nele,
// subheadline que nomeia o público e as redes, feature como promessa + 3 bullets de RESULTADO (não
// de recurso), e FAQ tratando as objeções reais do mercado (alcance, segurança da conta, cartão).
//
// ÂNGULO: os dois concorrentes vendem para AGÊNCIA (aprovação de cliente, multi-marca, franquia).
// Ninguém vende para quem se importa com a ESTÉTICA DO FEED — que é onde o Grid arrastável e a
// pré-visualização fiel por formato são diferencial real deste produto. É esse o ângulo daqui.
//
// SEM PROVA SOCIAL INVENTADA: não temos "+150 mil clientes" como a mLabs, e número falso numa
// página que passa por revisão de plataforma é risco à toa. A prova aqui é o mecanismo — descrever
// com precisão o que o produto faz.
//
// Autocontida: é buscada direto por crawlers de revisão, então nada de fonte externa ou CDN.
import type { Env } from './lib/env.js';
import { PLATFORM_GLYPHS } from './lib/platform-glyphs.js';

// Kreon/Francois One (do rascunho no Figma) exigiriam Google Fonts, o que quebraria a
// autocontenção. Stack serifada nativa aproxima a intenção da headline sem requisição externa.
const SERIF = `'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, 'Times New Roman', serif`;
const SANS = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, Helvetica, Arial, sans-serif`;

const STYLE = `
  :root { --brand: #52277F; --primary: #FCEC0E; --ink: #010101; --muted: #5b5560; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #fff; color: var(--ink); font-family: ${SANS}; line-height: 1.6; }
  img { max-width: 100%; display: block; }
  a { color: var(--brand); }

  .hero { background: var(--primary); padding: 2.5rem 1.5rem 3.5rem; }
  .hero-in { max-width: 1100px; margin: 0 auto; display: grid; gap: 2.5rem; align-items: center; grid-template-columns: 1fr; }
  .wordmark { height: 48px; width: auto; margin-bottom: 2rem; }
  h1 {
    font-family: ${SERIF}; font-weight: 400; color: var(--ink);
    font-size: clamp(2.1rem, 6vw, 3.8rem); line-height: 1.02; letter-spacing: -0.01em;
    margin: 0 0 1.1rem; max-width: 16ch;
  }
  .sub { font-size: 1.05rem; margin: 0 0 1.75rem; max-width: 46ch; color: #2b2630; }
  .cta {
    display: inline-block; background: #fff; color: var(--ink); text-decoration: none;
    font-weight: 700; font-size: 1.1rem; padding: 0.75em 1.6em;
    border: 4px solid var(--ink); border-radius: 25px;
  }
  .cta:hover { transform: translate(-2px, -2px); box-shadow: 4px 4px 0 0 var(--ink); }
  .nocard { margin: 0.85rem 0 0; font-size: 0.9rem; font-weight: 600; color: #3b3540; }
  /* A moldura dupla inclinada faz parte da imagem (exportada do Figma com alpha) — nada de borda
     ou rotação no CSS, que duplicaria o efeito. */
  .shot { position: relative; }
  .shot img { width: 100%; max-width: min(520px, 100%); margin-inline: auto; height: auto; }
  @media (min-width: 880px) {
    .hero { padding: 3.5rem 2rem 4.5rem; }
    .hero-in { grid-template-columns: 1.05fr 0.95fr; gap: 4rem; }
    .shot img { max-width: 520px; }
  }

  .wrap { max-width: 1000px; margin: 0 auto; padding: 3.5rem 1.5rem; }
  h2 { font-family: ${SERIF}; font-weight: 400; font-size: clamp(1.55rem, 3.5vw, 2.2rem); margin: 0 0 0.75rem; }
  .lede { color: var(--muted); margin: 0 0 2rem; max-width: 60ch; }

  /* Faixa de redes logo abaixo do hero: sinal imediato de cobertura, como Flux e mLabs fazem. */
  .netband { border-bottom: 3px solid var(--brand); }
  .netband .wrap { padding: 1.75rem 1.5rem; }
  .netband p { margin: 0 0 0.9rem; font-weight: 600; font-size: 0.85rem; letter-spacing: 0.05em; text-transform: uppercase; color: var(--muted); }
  .nets { display: flex; flex-wrap: wrap; gap: 0.75rem; margin: 0; padding: 0; list-style: none; }
  .nets li {
    display: flex; align-items: center; gap: 0.55rem; background: #fff;
    border: 3px solid var(--ink); border-radius: 999px; padding: 0.45em 1.1em 0.45em 0.75em; font-weight: 600;
  }
  .nets svg { width: 22px; height: 22px; flex: 0 0 22px; }

  .feat { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
  .card { border: 3px solid var(--brand); box-shadow: 5px 5px 0 0 var(--brand); border-radius: 20px; padding: 1.6rem; background: #fff; }
  .card h3 { margin: 0 0 0.6rem; font-size: 1.1rem; }
  .card ul { margin: 0; padding-left: 1.1rem; color: var(--muted); font-size: 0.95rem; }
  .card li { margin-bottom: 0.35rem; }

  ol.steps { padding-left: 1.3rem; margin: 0; max-width: 70ch; }
  ol.steps li { margin-bottom: 0.7rem; }

  .band { background: var(--primary); }

  details { border: 3px solid var(--ink); border-radius: 16px; background: #fff; padding: 1rem 1.25rem; margin-bottom: 0.75rem; }
  details summary { font-weight: 700; cursor: pointer; list-style: none; }
  details summary::-webkit-details-marker { display: none; }
  details summary::after { content: '+'; float: right; }
  details[open] summary::after { content: '−'; }
  details p { margin: 0.75rem 0 0; color: var(--muted); }

  .final { text-align: center; }
  .final h2 { max-width: 22ch; margin-inline: auto; }
  .final .lede { margin-inline: auto; }

  footer { border-top: 3px solid var(--brand); }
  footer .wrap { padding: 2rem 1.5rem 3rem; color: var(--muted); font-size: 0.92rem; }
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

// Promessa + 3 bullets de RESULTADO. O padrão do mercado é nunca listar recurso técnico solto.
const FEATURES = [
  {
    h: 'Planeje como o feed vai ficar',
    li: [
      'Arraste os posts na grade e veja o perfil antes de publicar',
      'Reordenar troca os horários entre si — sem inventar data nova',
      'Jogue uma imagem solta na grade só pra testar a capa',
    ],
  },
  {
    h: 'Veja o post exato antes de sair',
    li: [
      'A pré-visualização usa a proporção real de cada formato',
      'Avisa quando a legenda passa do limite da rede',
      'Recorte na medida certa quando a foto não couber',
    ],
  },
  {
    h: 'Agende uma vez, publique em todas',
    li: [
      'Uma legenda, várias contas, cada rede no formato dela',
      'Carrossel, Reel, Story, Short — você escolhe, não é adivinhado',
      'Rascunho pra guardar a ideia antes de marcar a data',
    ],
  },
  {
    h: 'Descubra o que funcionou',
    li: [
      'Curtidas, alcance, comentários e seguidores por post',
      'Qual rede performou melhor e qual ficou pra trás',
      'Melhor horário, melhor formato e melhor dia do seu perfil',
    ],
  },
];

// As duas primeiras são as objeções específicas do mercado BR que a mLabs trata no FAQ dela:
// medo de perder alcance e medo de perder a conta por app de terceiro.
const FAQ = [
  {
    q: 'Agendar posts pelo ATENTA! prejudica o alcance?',
    a: 'Não. A publicação usa as APIs oficiais de cada rede — a mesma via de qualquer ferramenta aprovada. Para a rede social, um post agendado é um post normal.',
  },
  {
    q: 'Minhas contas ficam seguras?',
    a: 'Você autoriza pela tela de consentimento da própria rede social; nunca pedimos a sua senha. As autorizações ficam guardadas criptografadas e você pode revogar o acesso quando quiser, aqui ou nas configurações da rede.',
  },
  {
    q: 'Preciso colocar cartão para começar?',
    a: 'Não. O plano gratuito é permanente e não pede cartão: uma conta conectada e dez posts por mês, sem prazo para acabar.',
  },
  {
    q: 'Quais redes posso conectar?',
    a: 'Instagram, Facebook, YouTube, LinkedIn, Pinterest e TikTok. Dá para conectar mais de uma conta da mesma rede e escolher, em cada post, para quais delas ele vai.',
  },
  {
    q: 'O que acontece se eu parar de pagar?',
    a: 'Você volta para o plano gratuito e mantém acesso a tudo que já criou — posts, métricas e contas continuam lá. Só os limites do gratuito voltam a valer.',
  },
];

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
<title>ATENTA! — Agende posts e planeje o feed em todas as redes</title>
<meta name="description" content="Agende publicações em Instagram, Facebook, YouTube, LinkedIn, Pinterest e TikTok, planeje como o feed vai ficar e acompanhe o que deu certo. Comece grátis, sem cartão.">
<style>${STYLE}</style>
</head>
<body>

<header class="hero">
  <div class="hero-in">
    <div>
      ${logoHtml}
      <h1>Agende seus posts e veja o feed antes de publicar</h1>
      <p class="sub">
        Para social medias, criadores e pequenas marcas que precisam publicar em várias redes,
        manter o feed bonito e saber o que deu certo — sem abrir seis aplicativos diferentes.
      </p>
      <a class="cta" href="/app">Comece grátis</a>
      <p class="nocard">Não pedimos cartão. O plano gratuito não expira.</p>
    </div>
    <div class="shot">
      <picture>
        <source srcset="/hero.webp" type="image/webp">
        <img src="/hero.png" alt="Duas pessoas sorrindo olhando o celular" width="1000" height="849">
      </picture>
    </div>
  </div>
</header>

<section class="netband">
  <div class="wrap">
    <p>Publique em</p>
    <ul class="nets">
      ${PLATFORM_GLYPHS.map(
        (n) => `<li><svg viewBox="0 0 24 24" fill="${n.color}" aria-hidden="true"><path d="${n.path}"/></svg>${n.label}</li>`
      ).join('')}
    </ul>
  </div>
</section>

<section class="wrap">
  <h2>O feed é o seu cartão de visita</h2>
  <p class="lede">
    A maioria das ferramentas mostra <em>quando</em> o post sai. O ATENTA! mostra também
    <em>como ele vai ficar</em> — no formato certo de cada rede e no lugar certo do seu perfil.
  </p>
  <div class="feat">
    ${FEATURES.map(
      (f) => `<div class="card"><h3>${f.h}</h3><ul>${f.li.map((x) => `<li>${x}</li>`).join('')}</ul></div>`
    ).join('')}
  </div>
</section>

<section class="band">
  <div class="wrap">
    <h2>Como funciona</h2>
    <ol class="steps">
      <li><b>Conecte suas contas.</b> Você autoriza pela tela de consentimento da própria rede social. Nunca pedimos a sua senha.</li>
      <li><b>Monte o post.</b> Legenda, imagens ou vídeo, o formato (post, reel, story) e a data.</li>
      <li><b>Confira como vai ficar.</b> A pré-visualização mostra a peça na proporção real; a grade mostra o feed inteiro.</li>
      <li><b>A publicação sai sozinha.</b> No horário marcado, o ATENTA! publica nas contas escolhidas.</li>
      <li><b>Acompanhe o resultado.</b> As métricas de cada post chegam automaticamente no painel.</li>
    </ol>
  </div>
</section>

<section class="wrap">
  <h2>Perguntas frequentes</h2>
  ${FAQ.map((f) => `<details><summary>${f.q}</summary><p>${f.a}</p></details>`).join('')}
</section>

<section class="wrap">
  <h2>Seus dados</h2>
  <p class="lede">
    As autorizações das suas contas ficam guardadas criptografadas e são usadas apenas para publicar
    o conteúdo que você agendou e ler as métricas desses posts. Nunca vendemos nem compartilhamos
    esses dados. Você pode desconectar qualquer conta quando quiser, pela plataforma ou pelas
    configurações da própria rede social.
  </p>
</section>

<section class="band">
  <div class="wrap final">
    <h2>Comece a planejar seu feed hoje</h2>
    <p class="lede">Grátis para sempre no plano inicial. Sem cartão, sem fidelidade.</p>
    <a class="cta" href="/app">Comece grátis</a>
  </div>
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
