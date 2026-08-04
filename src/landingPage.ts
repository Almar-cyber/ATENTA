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
// LINGUAGEM VISUAL: a mesma do painel (web/design.md) — tinta brutalista ROXA (borda de 3px +
// sombra sólida deslocada), amarelo contido nos realces, texto preto, títulos em serifa. Botão e
// card clicável levantam no hover e afundam no clique; card estático não tem hover nenhum, que é
// como se distingue um do outro num relance.
//
// MOVIMENTO: entrada por scroll (fade + 14px de subida, com stagger curto), hero animado no load,
// micro-interação nos alvos clicáveis e FAQ que abre/fecha com altura animada. Regras que valem
// pra tudo aqui: duração curta (120–500ms), ease-out (o movimento desacelera ao chegar, que é o
// que parece físico), deslocamento pequeno (nada "voa" de fora da tela) e **nada anima duas
// vezes** — o observer solta o elemento depois de revelar. Duas travas obrigatórias:
//   1. `prefers-reduced-motion` desliga tudo — movimento é enfeite pra maioria e sintoma pra quem
//      tem sensibilidade vestibular;
//   2. o estado escondido só existe sob a classe `js` (setada por script inline antes da pintura).
//      Sem JS, ou se o script falhar, a página aparece inteira em vez de ficar em branco.
//
// Autocontida: é buscada direto por crawlers de revisão, então nada de fonte externa ou CDN.
import type { Env } from './lib/env.js';
import { PLATFORM_GLYPHS } from './lib/platform-glyphs.js';

// Kreon/Francois One (do rascunho no Figma) exigiriam Google Fonts, o que quebraria a
// autocontenção. Stack serifada nativa aproxima a intenção da headline sem requisição externa.
const SERIF = `'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, 'Times New Roman', serif`;
const SANS = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, Helvetica, Arial, sans-serif`;

const STYLE = `
  :root {
    --brand: #52277F; --primary: #FCEC0E; --ink: #010101; --muted: #5b5560;
    --nav-h: 64px;
    /* Largura da coluna da página. Vive num token porque a barra fixa, as seções e a calha
       esquerda do hero PRECISAM sair do mesmo número — se divergirem, o logo, os títulos e o
       texto do hero deixam de bater na mesma vertical. */
    --page: 1280px;
    --gutter: 1.5rem;
    /* Uma curva só pra tudo que entra: sai rápido, desacelera ao chegar. */
    --ease: cubic-bezier(.2,.7,.3,1);
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  /* Sem overflow no body de propósito: qualquer valor diferente de visible aqui briga com o
     "position: sticky" da barra do topo (hidden vira container de rolagem; clip deu artefato de
     repintura no Chrome). Quem corta o transbordo é o .hero, que é o único que transborda. */
  body { margin: 0; background: #fff; color: var(--ink); font-family: ${SANS}; line-height: 1.6; }
  img { max-width: 100%; display: block; }
  a { color: var(--brand); }
  /* Âncora não pode parar embaixo da barra fixa. */
  section[id] { scroll-margin-top: calc(var(--nav-h) + 12px); }
  :focus-visible { outline: 3px solid var(--brand); outline-offset: 3px; border-radius: 4px; }

  .wrap { max-width: var(--page); margin: 0 auto; padding: 0 var(--gutter); }
  .sec { padding: 4.5rem 0; }
  .eyebrow {
    display: inline-block; margin: 0 0 0.6rem; font-size: 0.78rem; font-weight: 700;
    letter-spacing: 0.12em; text-transform: uppercase; color: var(--brand);
  }
  h2 { font-family: ${SERIF}; font-weight: 400; font-size: clamp(1.7rem, 4vw, 2.5rem); line-height: 1.1; margin: 0 0 0.75rem; max-width: 20ch; }
  .lede { color: var(--muted); margin: 0 0 2.5rem; max-width: 58ch; font-size: 1.02rem; }

  /* ---------- Barra fixa ----------
     Nasce amarela (funde com o hero) e vira branca com fio roxo ao sair dele: o usuário ganha
     logo e CTA em qualquer ponto da rolagem, que antes só existiam no topo e no rodapé. */
  .nav {
    position: sticky; top: 0; z-index: 50; height: var(--nav-h);
    background: var(--primary); border-bottom: 3px solid transparent;
    transition: background .25s ease, border-color .25s ease, box-shadow .25s ease;
  }
  .nav.stuck { background: #fff; border-bottom-color: var(--brand); box-shadow: 0 4px 14px -10px #000; }
  .nav-in { max-width: var(--page); margin: 0 auto; padding: 0 var(--gutter); height: 100%; display: flex; align-items: center; gap: 1.5rem; }
  .nav img, .nav .mark { height: 26px; width: auto; }
  .nav-links { display: none; margin-left: auto; gap: 1.5rem; }
  .nav-links a {
    color: var(--ink); text-decoration: none; font-weight: 600; font-size: 0.95rem;
    position: relative; padding: 0.25rem 0;
  }
  /* Sublinhado que cresce do centro — o feedback de hover mais barato que existe e não desloca
     nada em volta (borda de verdade empurraria o layout). */
  .nav-links a::after {
    content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 2px; background: var(--brand);
    transform: scaleX(0); transition: transform .2s var(--ease);
  }
  .nav-links a:hover::after { transform: scaleX(1); }
  .nav-cta { margin-left: auto; display: flex; align-items: center; gap: 1rem; }
  .nav-links + .nav-cta { margin-left: 0; }
  .nav-cta .signin { display: none; color: var(--ink); text-decoration: none; font-weight: 600; font-size: 0.95rem; }
  @media (min-width: 860px) {
    .nav-links { display: flex; }
    .nav-cta .signin { display: inline; }
  }

  /* ---------- Botões ----------
     Levantar no hover / afundar no clique é o sinal de "isto é clicável" em todo o produto. */
  .cta {
    display: inline-flex; align-items: center; gap: 0.5rem; background: #fff; color: var(--ink);
    text-decoration: none; font-weight: 700; font-size: 1.05rem; padding: 0.72em 1.5em;
    border: 3px solid var(--brand); border-radius: 999px; box-shadow: 5px 5px 0 0 var(--brand);
    transition: transform .12s var(--ease), box-shadow .12s var(--ease), background .12s ease;
  }
  .cta:hover { transform: translate(-2px, -2px); box-shadow: 7px 7px 0 0 var(--brand); }
  .cta:active { transform: translate(3px, 3px); box-shadow: 0 0 0 0 var(--brand); }
  .cta.sm { font-size: 0.92rem; padding: 0.5em 1.1em; box-shadow: 3px 3px 0 0 var(--brand); }
  .cta.sm:hover { box-shadow: 5px 5px 0 0 var(--brand); }
  .cta.ghost { background: transparent; box-shadow: none; }
  .cta.ghost:hover { background: rgba(255,255,255,.55); transform: translate(-2px, -2px); box-shadow: 4px 4px 0 0 var(--brand); }
  .cta .arrow { transition: transform .18s var(--ease); }
  .cta:hover .arrow { transform: translateX(3px); }

  /* ---------- Hero ---------- */
  .hero { background: var(--primary); padding: 3rem 0 4rem; overflow: hidden; }
  .hero-in { display: grid; gap: 2.5rem; align-items: center; grid-template-columns: 1fr; }
  .badge {
    display: inline-flex; align-items: center; gap: 0.5rem; background: #fff; border: 2px solid var(--brand);
    border-radius: 999px; padding: 0.3em 0.9em; font-size: 0.82rem; font-weight: 700; margin: 0 0 1.1rem;
  }
  .badge .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--brand); }
  h1 {
    font-family: ${SERIF}; font-weight: 400; color: var(--ink);
    font-size: clamp(2.15rem, 5.6vw, 3.7rem); line-height: 1.03; letter-spacing: -0.01em;
    margin: 0 0 1.1rem; max-width: 16ch;
  }
  .sub { font-size: 1.06rem; margin: 0 0 1.75rem; max-width: 46ch; color: #2b2630; }
  .hero-actions { display: flex; flex-wrap: wrap; gap: 0.85rem; align-items: center; }
  /* Quando os dois botões não cabem lado a lado, eles quebram e ficam desalinhados (larguras
     diferentes). Duas faixas sofrem disso: o celular e o desktop estreito, onde a coluna de texto
     já dividiu espaço com a imagem. Nas duas, cada um ocupa a linha inteira. */
  @media (max-width: 560px), (min-width: 880px) and (max-width: 1100px) {
    .hero-actions .cta { width: 100%; justify-content: center; }
  }
  .nocard { margin: 1rem 0 0; font-size: 0.9rem; font-weight: 600; color: #3b3540; }
  /* A moldura dupla inclinada faz parte da imagem (exportada do Figma com alpha) — nada de borda
     ou rotação no CSS, que duplicaria o efeito. */
  .shot img { width: 100%; max-width: min(520px, 100%); margin-inline: auto; height: auto; }
  /* No desktop a imagem SAI da coluna da página e avança até a borda direita. A moldura é recortada
     com alpha, então encostar na borda lê como peça flutuando fora do quadro; dentro da coluna
     centralizada ela ficava pequena e sobrava amarelo vazio dos dois lados.
     O hero abre mão do .wrap, mas a calha esquerda é calculada a partir de --page — é isso que
     mantém o texto do hero na mesma vertical do logo e dos títulos das seções.
     A direita tem freio: passando de --bleed-max o sangramento para de crescer, senão em tela
     ultralarga a imagem foge pro canto e a composição fica torta pra direita. */
  @media (min-width: 880px) {
    .hero { padding: 2.5rem 0; --bleed-max: 1660px; }
    .hero-in {
      max-width: none;
      padding-left: max(var(--gutter), calc((100vw - var(--page)) / 2 + var(--gutter)));
      padding-right: max(0px, calc((100vw - var(--bleed-max)) / 2));
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
      gap: 2.5rem;
    }
    .shot img { max-width: none; margin-inline: 0; }
  }

  /* ---------- Faixa de redes ---------- */
  .netband { border-top: 3px solid var(--brand); border-bottom: 3px solid var(--brand); background: #fff; }
  .netband .wrap { padding-top: 1.6rem; padding-bottom: 1.6rem; display: flex; flex-wrap: wrap; align-items: center; gap: 0.7rem 1.5rem; }
  .netband .label { margin: 0; font-weight: 700; font-size: 0.78rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); }
  .nets { display: flex; flex-wrap: wrap; gap: 0.6rem; margin: 0; padding: 0; list-style: none; }
  .nets li {
    display: flex; align-items: center; gap: 0.5rem; background: #fff;
    border: 2px solid var(--ink); border-radius: 999px; padding: 0.38em 0.95em 0.38em 0.68em;
    font-weight: 600; font-size: 0.92rem;
    transition: transform .15s var(--ease), box-shadow .15s var(--ease);
  }
  .nets li:hover { transform: translateY(-2px); box-shadow: 0 3px 0 0 var(--ink); }
  .nets svg { width: 20px; height: 20px; flex: 0 0 20px; }

  /* ---------- Cards de recurso ----------
     2×2 em vez de auto-fit: com quatro cards, o auto-fit deixava um órfão pendurado na segunda
     linha. Card estático não tem hover — é o que o diferencia de um card de navegação. */
  .feat { display: grid; gap: 1.1rem; grid-template-columns: 1fr; }
  @media (min-width: 760px) { .feat { grid-template-columns: 1fr 1fr; gap: 1.4rem; } }
  .card { border: 3px solid var(--brand); box-shadow: 6px 6px 0 0 var(--brand); border-radius: 20px; padding: 1.7rem; background: #fff; }
  /* Selo BRANCO, não amarelo: o olho e a lupa já têm amarelo dentro (íris e lente), e sobre fundo
     amarelo eles sumiriam. Com os quatro no mesmo quadro branco, o amarelo vira o miolo do desenho
     em vez do fundo — e os dois pictogramas de traço não ficam com peso visual diferente dos dois
     desenhos de marca, que era o desequilíbrio de ter só metade com selo. */
  .ico {
    width: 52px; height: 52px; border-radius: 14px; background: #fff; border: 2.5px solid var(--brand);
    display: grid; place-items: center; margin-bottom: 1rem; color: var(--brand);
  }
  .ico svg { width: 24px; height: 24px; }
  .ico .eye { width: 36px; height: 24px; }
  .ico .lens { width: 30px; height: 30px; }

  /* Olho grande da seção de recursos: é o argumento da marca ("repare antes de publicar") dito em
     desenho, no lugar onde o texto faz esse mesmo argumento. */
  .eyemark { width: 84px; height: 56px; margin-bottom: 0.9rem; }
  .card h3 { margin: 0 0 0.7rem; font-size: 1.15rem; }
  .card ul { margin: 0; padding: 0; list-style: none; color: var(--muted); font-size: 0.95rem; }
  .card li { margin-bottom: 0.5rem; padding-left: 1.35rem; position: relative; }
  .card li::before { content: ''; position: absolute; left: 0; top: 0.6em; width: 8px; height: 8px; border-radius: 2px; background: var(--primary); border: 1.5px solid var(--brand); }

  /* ---------- Passos ---------- */
  .band { background: var(--primary); border-top: 3px solid var(--brand); border-bottom: 3px solid var(--brand); }
  .steps { display: grid; gap: 1rem; grid-template-columns: 1fr; margin: 0; padding: 0; list-style: none; counter-reset: s; }
  @media (min-width: 700px) { .steps { grid-template-columns: 1fr 1fr; gap: 1.1rem; } }
  /* Cinco passos numa grade de 3 deixariam um buraco na segunda linha. Base de 6 colunas: os três
     primeiros ocupam 2 cada, os dois últimos 3 cada — as duas linhas fecham cheias. */
  @media (min-width: 1000px) {
    .steps { grid-template-columns: repeat(6, 1fr); }
    .steps li { grid-column: span 2; }
    .steps li:nth-child(4), .steps li:nth-child(5) { grid-column: span 3; }
  }
  .steps li {
    counter-increment: s; background: #fff; border: 3px solid var(--brand); border-radius: 18px;
    padding: 1.4rem; position: relative;
  }
  /* O número virou selo de canto: com o doodle no card, o círculo grande no topo empurrava o
     texto pra baixo e disputava a atenção com o desenho. */
  .steps li::before {
    content: counter(s); position: absolute; top: 0.9rem; right: 0.9rem;
    display: grid; place-items: center; width: 30px; height: 30px;
    border-radius: 50%; border: 2.5px solid var(--brand); font-family: ${SERIF}; font-size: 1rem;
    color: var(--brand); background: #fff;
  }
  .steps b { display: block; margin-bottom: 0.25rem; }
  .steps span { color: var(--muted); font-size: 0.95rem; }
  .steps .doodle { width: 100%; height: 118px; object-fit: contain; margin-bottom: 0.9rem; }

  /* ---------- Bloco de dados ---------- */
  .privacy { border: 3px solid var(--brand); border-radius: 20px; padding: 1.8rem; display: grid; gap: 1.5rem; grid-template-columns: 1fr; }
  @media (min-width: 820px) { .privacy { grid-template-columns: 1.1fr 0.9fr; padding: 2.2rem; } }
  .privacy h2 { margin-bottom: 0.6rem; }
  .privacy p { margin: 0; color: var(--muted); }
  .guarantees { margin: 0; padding: 0; list-style: none; display: grid; gap: 0.6rem; align-content: center; }
  .guarantees li { display: flex; gap: 0.65rem; align-items: flex-start; font-size: 0.95rem; font-weight: 600; }
  .guarantees svg { width: 20px; height: 20px; flex: 0 0 20px; margin-top: 0.15rem; color: var(--brand); }

  /* ---------- FAQ ----------
     A altura é animada por grid-template-rows 0fr→1fr (a única forma de transicionar "auto" sem
     medir em JS). Abrir é CSS puro; fechar precisa de um empurrãozinho de script, porque o
     browser desmonta o conteúdo no mesmo instante em que tira o atributo "open". */
  .faq { display: grid; gap: 0.7rem; max-width: 780px; }
  details { border: 3px solid var(--brand); border-radius: 16px; background: #fff; padding: 0 1.25rem; transition: box-shadow .2s ease; }
  details[open] { box-shadow: 5px 5px 0 0 var(--brand); }
  details summary {
    font-weight: 700; cursor: pointer; list-style: none; padding: 1rem 2rem 1rem 0;
    position: relative; user-select: none;
  }
  details summary::-webkit-details-marker { display: none; }
  details summary::after {
    content: '+'; position: absolute; right: 0; top: 50%; margin-top: -0.72em;
    font-size: 1.35rem; line-height: 1; color: var(--brand);
    transition: transform .25s var(--ease);
  }
  details[open] summary::after { content: '+'; transform: rotate(135deg); }
  details .ans { display: grid; grid-template-rows: 0fr; transition: grid-template-rows .28s var(--ease); }
  details[open] .ans { grid-template-rows: 1fr; }
  details.closing .ans { grid-template-rows: 0fr; }
  details .ans > div { overflow: hidden; }
  details .ans p { margin: 0; padding: 0 0 1.1rem; color: var(--muted); }

  /* ---------- Fechamento ---------- */
  .final { text-align: center; }
  .final h2 { max-width: 18ch; margin-inline: auto; }
  .final .lede { margin-inline: auto; margin-bottom: 2rem; }

  footer { border-top: 3px solid var(--brand); background: #fff; }
  footer .wrap { padding: 2.5rem 1.5rem 3rem; color: var(--muted); font-size: 0.92rem; display: grid; gap: 1.75rem; grid-template-columns: 1fr; }
  @media (min-width: 760px) { footer .wrap { grid-template-columns: 1.4fr 1fr 1fr; } }
  footer .mark-img { height: 28px; width: auto; margin-bottom: 0.75rem; }
  footer h4 { margin: 0 0 0.6rem; font-size: 0.78rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink); }
  footer ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 0.4rem; }
  footer a { text-decoration: none; }
  footer a:hover { text-decoration: underline; }

  /* ---------- Movimento ----------
     O estado escondido vive sob a classe "js" de propósito: sem script (ou se ele quebrar), a
     página renderiza inteira em vez de ficar em branco. "--d" é o atraso do stagger. */
  @media (prefers-reduced-motion: no-preference) {
    .js [data-reveal] {
      opacity: 0; transform: translateY(14px);
      transition: opacity .5s ease var(--d, 0ms), transform .5s var(--ease) var(--d, 0ms);
    }
    .js [data-reveal].in { opacity: 1; transform: none; }

    /* Hero entra no load, sem esperar observer nenhum. */
    @keyframes rise { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }
    @keyframes riseShot { from { opacity: 0; transform: translateY(24px) scale(.97); } to { opacity: 1; transform: none; } }
    .hero [data-in] { animation: rise .6s var(--ease) both; animation-delay: var(--d, 0ms); }
    .hero .shot { animation: riseShot .75s var(--ease) both; animation-delay: 260ms; }

    /* O olho olha em volta. É o único movimento em laço da página, e existe porque é o nome do
       produto virando gesto — não decoração. Ciclo longo (9s) e pausa longa em cada posição:
       movimento de fundo que se percebe de canto de olho não pode competir com a leitura. */
    @keyframes look {
      0%, 20%   { transform: translateX(0) }
      26%, 44%  { transform: translateX(4.5px) }
      50%, 68%  { transform: translateX(-4.5px) }
      74%, 100% { transform: translateX(0) }
    }
    .eye .iris { animation: look 9s var(--ease) infinite; }

    /* A lupa varre. Mesmo raciocínio: gesto pequeno, ciclo longo. */
    @keyframes sweep {
      0%, 100% { transform: translate(0, 0) }
      35%      { transform: translate(3px, -2.5px) }
      70%      { transform: translate(-2.5px, 2px) }
    }
    .lens .scan { animation: sweep 7s ease-in-out infinite; }

    /* Doodle boiando de leve no card. 5px em 6s: some se você olhar direto, dá vida se não olhar. */
    @keyframes bob { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-5px) } }
    .steps .doodle { animation: bob 6s ease-in-out infinite; animation-delay: var(--d, 0ms); }
  }
`;

// Script inline, sem dependência externa (a página é buscada por crawlers de revisão).
const SCRIPT = `
  document.documentElement.classList.add('js');
  var calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

  addEventListener('DOMContentLoaded', function () {
    // Revela uma vez e solta o elemento — reanimar a cada passagem de scroll enjoa e custa CPU.
    var els = document.querySelectorAll('[data-reveal]');
    if (calm || !('IntersectionObserver' in window)) {
      els.forEach(function (el) { el.classList.add('in'); });
    } else {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          e.target.classList.add('in');
          io.unobserve(e.target);
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });
      els.forEach(function (el) { io.observe(el); });
    }

    // Barra branca só depois de sair do hero: dentro dele ela é amarela e some no fundo.
    var nav = document.querySelector('.nav');
    var hero = document.querySelector('.hero');
    if (nav && hero) {
      var sync = function () { nav.classList.toggle('stuck', scrollY > hero.offsetHeight - 80); };
      addEventListener('scroll', sync, { passive: true });
      addEventListener('resize', sync);
      sync();
    }

    // Quem JÁ está logado não deveria ver "Entrar" e "Comece grátis" numa página de vendas. Os
    // rótulos passam a apontar pro painel.
    //
    // POR QUE TROCAR O RÓTULO E NÃO REDIRECIONAR: sequestrar o "/" é justamente o que faz um
    // verificador automático concluir que a página inicial está atrás de login — foi o que a
    // verificação do Google reclamou. Sem sessão nada muda, então crawler nenhum é afetado; a
    // marcação servida é sempre a versão anônima, e o JS só a promove depois de confirmar a sessão.
    fetch('/api/auth/get-session', { credentials: 'include' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.user) return;
        document.querySelectorAll('a[href="/app"]').forEach(function (a) {
          var texto = a.textContent.trim();
          if (texto === 'Entrar') {
            // O "Entrar" da barra fixa (.signin) senta ao lado do botão "Comece grátis" — os dois
            // virariam "Ir para o painel" repetido, lado a lado. Esconde o texto solto; o botão
            // sozinho já leva pro painel. Fora da barra fixa (rodapé) não há botão vizinho, então
            // ali o "Entrar" isolado continua sendo trocado por texto, como antes.
            if (a.classList.contains('signin')) a.style.display = 'none';
            else a.textContent = 'Ir para o painel';
          }
          else if (texto.indexOf('Comece grátis') === 0) {
            a.innerHTML = a.innerHTML.replace('Comece grátis', 'Ir para o painel');
          }
        });
        document.querySelectorAll('.nocard').forEach(function (p) {
          p.textContent = 'Você já está conectada.';
        });
      })
      .catch(function () { /* sem sessão ou rede fora: a página anônima já está correta */ });

    // Fechar o <details> com altura animada. Abrir é CSS puro (o conteúdo já está montado);
    // fechar precisa segurar o 'open' até a transição terminar, senão o conteúdo some antes.
    document.querySelectorAll('details').forEach(function (d) {
      d.addEventListener('click', function (ev) {
        if (calm || !d.open || !ev.target.closest('summary')) return;
        ev.preventDefault();
        d.classList.add('closing');
        setTimeout(function () { d.open = false; d.classList.remove('closing'); }, 260);
      });
    });
  });
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

// Ícones de traço (24×24, mesma linguagem dos Lucide do painel), inline pra não puxar biblioteca.
const ICONS: Record<string, string> = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4Z"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
};

const icon = (name: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

// ---- Motivos da marca: o olho e a lupa ----
//
// O nome é ATENTA! — o produto é sobre REPARAR nas coisas (ver o post antes de sair, ver o feed
// antes de publicar, ver o que funcionou). Um olho e uma lupa dizem isso sem legenda, e são a
// única ilustração aqui desenhada pra marca em vez de emprestada.
//
// O olho já foi tentado dentro do ponto de exclamação do logo e saiu de lá por ilegibilidade no
// tamanho pequeno. Aqui ele tem espaço — é ilustração, não letra.
//
// Inline (não <img>) porque a íris se move por CSS, e `<img>` não roda folha de estilo nossa.
const eyeSvg = (cls = '') => `
  <svg class="eye ${cls}" viewBox="0 0 48 32" fill="none" aria-hidden="true">
    <path d="M2 16Q24 0 46 16" stroke="var(--brand)" stroke-width="3" stroke-linecap="round"/>
    <path d="M2 16Q24 32 46 16" stroke="var(--brand)" stroke-width="3" stroke-linecap="round"/>
    <g class="iris">
      <circle cx="24" cy="16" r="8.5" fill="var(--primary)" stroke="var(--brand)" stroke-width="3"/>
      <circle cx="24" cy="16" r="3.4" fill="var(--brand)"/>
    </g>
    <path d="M24 3.2V0M36.5 6.4 38 3.7M11.5 6.4 10 3.7" stroke="var(--brand)" stroke-width="2.4" stroke-linecap="round"/>
  </svg>`;

const lensSvg = () => `
  <svg class="lens" viewBox="0 0 48 48" fill="none" aria-hidden="true">
    <g class="scan">
      <circle cx="20" cy="20" r="14.5" fill="var(--primary)" stroke="var(--brand)" stroke-width="3.4"/>
      <path d="M13.5 14.5A9 9 0 0 1 20.5 10.5" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>
    </g>
    <path d="m30.5 30.5 13 13" stroke="var(--brand)" stroke-width="5" stroke-linecap="round"/>
  </svg>`;

// Promessa + 3 bullets de RESULTADO. O padrão do mercado é nunca listar recurso técnico solto.
const FEATURES = [
  {
    ico: 'grid',
    h: 'Planeje como o feed vai ficar',
    li: [
      'Arraste os posts na grade e veja o perfil antes de publicar',
      'Reordenar troca os horários entre si — sem inventar data nova',
      'Jogue uma imagem solta na grade só pra testar a capa',
    ],
  },
  {
    ico: 'eye',
    h: 'Veja o post exato antes de sair',

    li: [
      'A pré-visualização usa a proporção real de cada formato',
      'Avisa quando a legenda passa do limite da rede',
      'Recorte na medida certa quando a foto não couber',
    ],
  },
  {
    ico: 'send',
    h: 'Agende uma vez, publique em todas',
    li: [
      'Uma legenda, várias contas, cada rede no formato dela',
      'Carrossel, Reel, Story, Short — você escolhe, não é adivinhado',
      'Rascunho pra guardar a ideia antes de marcar a data',
    ],
  },
  {
    ico: 'lens',
    h: 'Descubra o que funcionou',
    li: [
      'Curtidas, alcance, comentários e seguidores por post',
      'Qual rede performou melhor e qual ficou pra trás',
      'Melhor horário, melhor formato e melhor dia do seu perfil',
    ],
  },
];

// Doodles do Open Doodles (CC0), recoloridos pro par roxo/amarelo — ver web/doodles-license.md.
// Cada um foi escolhido pelo gesto do passo: abrir a caixa (começar), sentar e montar, olhar a tela,
// flutuar (sai sozinha) e comemorar.
const STEPS = [
  ['unboxing', 'Conecte suas contas.', 'Você autoriza pela tela de consentimento da própria rede social. Nunca pedimos a sua senha.'],
  ['sitting-reading', 'Monte o post.', 'Legenda, imagens ou vídeo, o formato (post, reel, story) e a data.'],
  ['selfie', 'Confira como vai ficar.', 'A pré-visualização mostra a peça na proporção real; a grade mostra o feed inteiro.'],
  ['levitate', 'A publicação sai sozinha.', 'No horário marcado, o ATENTA! publica nas contas escolhidas.'],
  ['dancing', 'Acompanhe o resultado.', 'As métricas de cada post chegam automaticamente no painel.'],
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
    a: 'Não. O plano gratuito é permanente e não pede cartão: uma conta conectada e dez posts por mês, sem prazo para acabar. Você só paga se quiser passar desses limites — e aí escolhe, ninguém cobra sozinho.',
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

const ARROW = `<svg class="arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>`;

export async function renderLandingPage(env: Env): Promise<string> {
  const logo = await logoDataUri(env);
  const mark = (cls: string) =>
    logo ? `<img class="${cls}" src="${logo}" alt="ATENTA!">` : `<b class="${cls}" style="font-size:1.5rem;color:var(--brand)">ATENTA!</b>`;

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ATENTA! — Agende posts e planeje o feed em todas as redes</title>
<meta name="description" content="Agende publicações em Instagram, Facebook, YouTube, LinkedIn, Pinterest e TikTok, planeje como o feed vai ficar e acompanhe o que deu certo. Comece grátis, sem cartão.">
<meta name="theme-color" content="#FCEC0E">
<style>${STYLE}</style>
<script>${SCRIPT}</script>
</head>
<body>

<nav class="nav">
  <div class="nav-in">
    <a href="/" aria-label="ATENTA!">${mark('mark')}</a>
    <div class="nav-links">
      <a href="#recursos">Recursos</a>
      <a href="#como-funciona">Como funciona</a>
      <a href="#perguntas">Perguntas</a>
    </div>
    <div class="nav-cta">
      <a class="signin" href="/app">Entrar</a>
      <a class="cta sm" href="/app">Comece grátis</a>
    </div>
  </div>
</nav>

<header class="hero">
  <div class="wrap hero-in">
    <div>
      <p class="badge" data-in style="--d:40ms"><span class="dot"></span>Grátis para começar · 6 redes</p>
      <h1 data-in style="--d:90ms">Agende seus posts e veja o feed antes de publicar</h1>
      <p class="sub" data-in style="--d:150ms">
        Para social medias, criadores e pequenas marcas que precisam publicar em várias redes,
        manter o feed bonito e saber o que deu certo — sem abrir seis aplicativos diferentes.
      </p>
      <div class="hero-actions" data-in style="--d:210ms">
        <a class="cta" href="/app">Comece grátis ${ARROW}</a>
        <a class="cta ghost" href="#como-funciona">Ver como funciona</a>
      </div>
      <!-- O limite entra na frase de propósito. "Grátis, sem cartão" sozinho faz a pessoa entender
           "tudo de graça", conectar a segunda conta e bater numa parede — promessa mal calibrada
           numa página que passa por revisão de plataforma. Os números vêm de FREE_LIMITS. -->
      <p class="nocard" data-in style="--d:260ms">Não pedimos cartão. O plano gratuito não expira: 1 conta conectada e 10 posts por mês.</p>
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
    <p class="label" data-reveal>Publique em</p>
    <ul class="nets">
      ${PLATFORM_GLYPHS.map(
        (n, i) =>
          `<li data-reveal style="--d:${i * 45}ms"><svg viewBox="0 0 24 24" fill="${n.color}" aria-hidden="true"><path d="${n.path}"/></svg>${n.label}</li>`
      ).join('')}
    </ul>
  </div>
</section>

<section class="sec" id="recursos">
  <div class="wrap">
    <div data-reveal>${eyeSvg('eyemark')}</div>
    <p class="eyebrow" data-reveal style="--d:40ms">Por que o ATENTA!</p>
    <h2 data-reveal style="--d:60ms">O feed é o seu cartão de visita</h2>
    <p class="lede" data-reveal style="--d:110ms">
      A maioria das ferramentas mostra <em>quando</em> o post sai. O ATENTA! mostra também
      <em>como ele vai ficar</em> — no formato certo de cada rede e no lugar certo do seu perfil.
    </p>
    <div class="feat">
      ${FEATURES.map((f, i) => {
        const glyph = f.ico === 'eye' ? eyeSvg() : f.ico === 'lens' ? lensSvg() : icon(f.ico);
        return `<div class="card" data-reveal style="--d:${i * 80}ms"><div class="ico">${glyph}</div><h3>${f.h}</h3><ul>${f.li
          .map((x) => `<li>${x}</li>`)
          .join('')}</ul></div>`;
      }).join('')}
    </div>
  </div>
</section>

<section class="band sec" id="como-funciona">
  <div class="wrap">
    <p class="eyebrow" data-reveal>Do zero ao publicado</p>
    <h2 data-reveal style="--d:60ms">Como funciona</h2>
    <p class="lede" data-reveal style="--d:110ms; color:#3b3540">
      Cinco passos, uma vez só. Depois disso é abrir, montar o post e deixar sair no horário.
    </p>
    <ol class="steps">
      ${STEPS.map(
        ([doodle, b, s], i) =>
          `<li data-reveal style="--d:${i * 70}ms"><img class="doodle" src="/doodles/${doodle}.svg" alt="" loading="lazy" width="200" height="150"><b>${b}</b><span>${s}</span></li>`
      ).join('')}
    </ol>
  </div>
</section>

<section class="sec" id="perguntas">
  <div class="wrap">
    <p class="eyebrow" data-reveal>Antes de começar</p>
    <h2 data-reveal style="--d:60ms">Perguntas frequentes</h2>
    <div class="faq">
      ${FAQ.map(
        (f, i) =>
          `<details data-reveal style="--d:${i * 55}ms"><summary>${f.q}</summary><div class="ans"><div><p>${f.a}</p></div></div></details>`
      ).join('')}
    </div>
  </div>
</section>

<section class="sec" style="padding-top:0">
  <div class="wrap">
    <div class="privacy" data-reveal>
      <div>
        <p class="eyebrow">Seus dados</p>
        <h2>Você autoriza, e pode desautorizar quando quiser</h2>
        <p>
          As autorizações das suas contas ficam guardadas criptografadas e são usadas apenas para
          publicar o conteúdo que você agendou e ler as métricas desses posts.
        </p>
      </div>
      <ul class="guarantees">
        <li>${icon('shield')}<span>Nunca pedimos a senha da sua rede social</span></li>
        <li>${icon('shield')}<span>Nunca vendemos nem compartilhamos seus dados</span></li>
        <li>${icon('shield')}<span>Desconecte pela plataforma ou pela própria rede</span></li>
      </ul>
    </div>
  </div>
</section>

<section class="band sec">
  <div class="wrap final">
    <h2 data-reveal>Comece a planejar seu feed hoje</h2>
    <p class="lede" data-reveal style="--d:60ms">O plano gratuito não expira: 1 conta conectada e 10 posts por mês, sem cartão e sem fidelidade. Cresceu, você assina.</p>
    <a class="cta" href="/app" data-reveal style="--d:120ms">Comece grátis ${ARROW}</a>
  </div>
</section>

<footer>
  <div class="wrap">
    <div>
      ${mark('mark-img')}
      <!-- O nome em TEXTO, não só no wordmark: a verificação do Google reclamou que "o nome do app
           não corresponde ao da página inicial", e o logo é PNG — verificador automático não lê nome
           dentro de imagem. -->
      <b>ATENTA!</b> — agendamento e planejamento de feed para Instagram, Facebook, YouTube,
      LinkedIn, Pinterest e TikTok.
    </div>
    <div>
      <h4>Produto</h4>
      <ul>
        <li><a href="#recursos">Recursos</a></li>
        <li><a href="#como-funciona">Como funciona</a></li>
        <li><a href="#perguntas">Perguntas frequentes</a></li>
        <li><a href="/app">Entrar</a></li>
      </ul>
    </div>
    <div>
      <h4>Legal e contato</h4>
      <ul>
        <li><a href="/privacy">Política de Privacidade</a></li>
        <li><a href="/terms">Termos de Serviço</a></li>
        <li><a href="/data-deletion">Excluir meus dados</a></li>
        <li><a href="mailto:contato@omangue.co">contato@omangue.co</a></li>
        <li>Estúdio Mangue — <a href="https://omangue.co">omangue.co</a></li>
      </ul>
    </div>
  </div>
</footer>

</body>
</html>`;
}
