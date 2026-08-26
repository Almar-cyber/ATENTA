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
import { signupIsOpen } from './lib/env.js';
import type { Env } from './lib/env.js';
import { hashCsp } from './lib/csp.js';
import { PLATFORM_GLYPHS } from './lib/platform-glyphs.js';

// Kreon/Francois One (do rascunho no Figma) exigiriam Google Fonts, o que quebraria a
// autocontenção. Stack serifada nativa aproxima a intenção da headline sem requisição externa.
const SERIF = `'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, 'Times New Roman', serif`;
const SANS = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, Helvetica, Arial, sans-serif`;

const STYLE = `
  :root {
    --brand: #52277F; --primary: #FCEC0E; --ink: #010101; --muted: #5b5560;
    --nav-h: 76px;
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
     Branca com fio roxo o tempo todo, inclusive no topo — a sombra só entra quando o usuário rola,
     como reforço de que a barra saiu do lugar. */
  .nav {
    position: sticky; top: 0; z-index: 50; height: var(--nav-h);
    background: #fff; border-bottom: 3px solid var(--brand);
    transition: box-shadow .25s ease;
  }
  .nav.stuck { box-shadow: 0 4px 14px -10px #000; }
  .nav-in { max-width: var(--page); margin: 0 auto; padding: 0 var(--gutter); height: 100%; display: flex; align-items: center; gap: 1.5rem; }
  .nav img, .nav .mark { height: 40px; width: auto; }
  /* No celular o logo maior come o espaço que o botão precisa pra não quebrar em duas linhas —
     aqui ele volta a um tamanho que sobra folga, e no desktop cresce de novo (media query abaixo). */
  @media (max-width: 859px) {
    .nav img, .nav .mark { height: 28px; }
  }
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
  /* O botão vai pra DIREITA da barra, sempre: o margin-left automático come todo o espaço livre
     entre ele e o que vier antes. */
  .nav-cta { margin-left: auto; display: flex; align-items: center; gap: 1rem; }
  .nav-cta .signin { display: none; color: var(--ink); text-decoration: none; font-weight: 600; font-size: 0.95rem; }
  @media (min-width: 860px) {
    .nav-links { display: flex; }
    .nav-cta .signin { display: inline; }
    /* Só no desktop o menu existe de verdade, e é ELE que passa a empurrar a barra: aí o botão
       larga o próprio automático e senta colado no menu.
       Esta regra estava FORA da media query, e como display:none NÃO tira o elemento do DOM, o
       seletor de irmão adjacente continuava casando no celular: o botão perdia o empurrão pra
       direita e colava no logo, que era o defeito. */
    .nav-links + .nav-cta { margin-left: 0; }
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
  /* Variante amarela. Os CTAs da página são brancos porque quase todos ficam sobre fundo branco, e
     ali o amarelo brigaria com o realce de "hoje"/"mais escolhido". Dentro de um card colorido é o
     contrário: o branco some no lavanda. Variante, e não mudança na base, pra não restilizar os
     outros seis botões da página de tabela. */
  .cta.destaque { background: var(--primary); }
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
    /* 19ch, não 16ch: com 16 a manchete quebrava em quatro linhas e sobrava amarelo vazio à direita
       dentro da própria coluna. Continua tendo teto porque manchete de serifa em linha muito longa
       perde o ritmo de leitura. */
    margin: 0 0 1.1rem; max-width: 19ch;
  }
  .sub { font-size: 1.06rem; margin: 0 0 1.75rem; max-width: 52ch; color: #2b2630; }
  .hero-actions { display: flex; flex-wrap: wrap; gap: 0.85rem; align-items: center; }
  /* Quando os dois botões não cabem lado a lado, eles quebram e ficam desalinhados (larguras
     diferentes). Duas faixas sofrem disso: o celular e o desktop estreito, onde a coluna de texto
     já dividiu espaço com a imagem. Nas duas, cada um ocupa a linha inteira. */
  @media (max-width: 560px), (min-width: 880px) and (max-width: 1100px) {
    .hero-actions .cta { width: 100%; justify-content: center; }
  }
  .nocard { margin: 1rem 0 0; font-size: 0.9rem; font-weight: 600; color: #3b3540; }
  /* A linha do preço quebra na MESMA largura dos botões, em vez de atravessar a coluna inteira.
     Sem número mágico: o bloco encolhe até o conteúdo (fit-content), e a linha de texto é tirada
     desse cálculo com width:0 pra não ser ela a esticar o bloco; o min-width:100% então a estica
     de volta até a largura que os botões definiram. Trocar o rótulo de um botão reajusta os dois.
     Só vale onde os botões ficam LADO A LADO: nas duas faixas em que cada um vira linha cheia
     (ver a regra acima), fit-content e width:100% se mordem e o bloco colapsa. */
  @media (min-width: 561px) and (max-width: 879px), (min-width: 1101px) {
    .cta-bloco { width: fit-content; max-width: 100%; }
    .cta-bloco .nocard { width: 0; min-width: 100%; }
  }
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

  /* ---------- Preços ---------- */
  /* Sem "align-items: start" aqui: o padrão do grid é esticar, e é isso que queremos. Com start,
     cada card fica com a altura do próprio conteúdo, e como o Pro lista um item a mais os dois
     terminavam em alturas diferentes, com o rodapé do gratuito flutuando no meio do outro.
     O "flex: 1" da lista dentro do card é o par disso: empurra botão e observação pro fim, o que
     alinha os dois entre si mesmo com quantidades diferentes de itens. */
  .planos { display: grid; gap: 1.25rem; grid-template-columns: 1fr; margin-top: 2.5rem; }
  @media (min-width: 760px) { .planos { grid-template-columns: 1fr 1fr; gap: 1.75rem; } }
  .plano {
    position: relative; background: #fff; border: 3px solid var(--brand); border-radius: 1.25rem;
    padding: 1.75rem; display: flex; flex-direction: column; gap: 1rem;
  }
  /* O plano pago levanta com a sombra deslocada, o mesmo sinal de "principal" que o painel usa nos
     botões. Sem inventar cor nova: é a tinta roxa que já existe. */
  .plano.destaque { box-shadow: 7px 7px 0 0 var(--brand); }
  .plano .selo {
    position: absolute; top: -0.85rem; left: 1.5rem; background: var(--primary); color: var(--ink);
    border: 2px solid var(--brand); border-radius: 999px; padding: 0.15em 0.8em;
    font-size: 0.75rem; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase;
  }
  .plano h3 { margin: 0; font-size: 1.05rem; letter-spacing: 0.1em; text-transform: uppercase; }
  .plano .preco { margin: 0; display: flex; align-items: baseline; gap: 0.45rem; }
  .plano .preco b { font-size: 2.6rem; line-height: 1; letter-spacing: -0.03em; }
  .plano .preco span { color: var(--muted); font-size: 0.92rem; }
  .plano ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 0.55rem; flex: 1; }
  /* Marcador desenhado em vez de bullet: o disco padrão não combina com o traço do resto da página. */
  .plano li { padding-left: 1.5rem; position: relative; line-height: 1.5; }
  .plano li::before {
    content: ""; position: absolute; left: 0; top: 0.45em; width: 0.7em; height: 0.35em;
    border-left: 3px solid var(--brand); border-bottom: 3px solid var(--brand); transform: rotate(-45deg);
  }
  /* O CTA do plano pago vem AMARELO, não branco como os outros da página. No sistema do painel
     (web/design.md) o amarelo é a cor de ação primária, e aqui existe exatamente uma decisão a
     tomar — os dois botões brancos lado a lado pesavam igual e não diziam qual era qual.
     Referência de uso: o botão amarelo com sombra dura do cafellow.com.br. */
  .plano .cta { justify-content: center; }
  .plano.destaque .cta { background: var(--primary); }
  .plano .obs { margin: 0; font-size: 0.85rem; color: var(--muted); text-align: center; }
  /* Alternador de ciclo. Pílula com dois botões, o ativo em amarelo — mesmo par do "hoje" no
     calendário do painel. */
  .ciclo {
    display: inline-flex; gap: 0.25rem; margin-top: 1.75rem; padding: 0.25rem;
    border: 2px solid var(--brand); border-radius: 999px; background: #fff;
  }
  .ciclo button {
    display: inline-flex; align-items: center; gap: 0.5rem; border: 0; cursor: pointer;
    background: transparent; color: var(--ink); font: inherit; font-weight: 700; font-size: 0.92rem;
    padding: 0.5em 1.1em; border-radius: 999px; transition: background .15s var(--ease);
  }
  .ciclo button:hover { background: #f3eefa; }
  .ciclo button.ativo { background: var(--primary); }
  .ciclo button i { font-style: normal; font-size: 0.72rem; font-weight: 800; color: var(--brand); }
  .ciclo button.ativo i { color: var(--ink); }


  /* ---------- Comparação em altura ---------- */
  /* Centralizado e maior: este bloco é o argumento em imagem, não uma nota lateral da tabela. Na
     largura anterior (34rem encostado à esquerda) ele lia como legenda do que vinha depois. */
  .doses { margin-top: 3.5rem; text-align: center; }
  /* Título dentro de uma pílula (formato do cafellow.com.br): ele deixa de ser rótulo de seção e
     vira parte do desenho, no registro de faixa em vez do h2 em serif que abre cada seção. Nome
     genérico (não "doses-titulo") porque é candidata a reuso em qualquer bloco futuro do mesmo
     registro — já serviu a um segundo bloco (uma vitrine do app navegando) que foi removido por
     ficar repetitivo com os cards de recurso abaixo; a classe ficou pronta pra próxima vez. */
  .pilula-titulo {
    display: inline-block; max-width: 100%; margin: 0 0 2rem; background: #ece5fb;
    border: 3px solid var(--brand); border-radius: 1.2rem; padding: 0.4em 0.85em;
    box-shadow: 5px 5px 0 0 var(--brand);
    font-weight: 800; text-transform: uppercase; letter-spacing: -0.015em; line-height: 1.1;
    font-size: clamp(1.05rem, 3.2vw, 2.05rem); color: var(--brand);
  }
  .doses-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; max-width: 48rem; margin: 0 auto; }
  @media (min-width: 700px) { .doses-grid { gap: 2.5rem; } }
  /* As três pistas têm a MESMA altura e as barras crescem de baixo pra cima: é o alinhamento pela
     base que faz a diferença de altura ser comparável de relance. */
  .dose-pista { height: 12rem; display: flex; align-items: flex-end; background: #f1edfa; border-radius: 1.1rem; overflow: hidden; }
  @media (min-width: 700px) { .dose-pista { height: 17rem; } }
  .dose-barra { width: 100%; background: #cbb8e8; border: 3px solid var(--brand); border-radius: 1.1rem; display: flex; flex-direction: column; overflow: hidden; }
  .dose-barra.nos { background: var(--primary); }
  /* Cada faixa é uma cobrança. Divididas por igual (flex:1) porque as cobranças SÃO iguais: cinco
     marcas na mLabs custam cinco vezes o mesmo valor. O traço só aparece entre elas, nunca no topo,
     senão duplicaria a borda da barra. */
  .dose-barra i { flex: 1; border-top: 3px solid var(--brand); }
  .dose-barra i:first-child { border-top: 0; }
  .doses-legenda { max-width: 40rem; margin: 1.4rem auto 0; font-size: 0.86rem; color: var(--muted); line-height: 1.5; }
  .doses-legenda b { color: var(--ink); }
  .dose p { margin: 0.75rem 0 0; display: flex; flex-direction: column; align-items: center; gap: 0.15rem; font-size: 0.92rem; }
  .dose p b { font-weight: 700; }
  .dose p span { font-weight: 800; font-size: clamp(1.1rem, 2.4vw, 1.4rem); }
  .doses-logo { height: 1.1rem; width: auto; display: block; }

  /* Comparação de modelo de cobrança */
  .compara { margin-top: 2.5rem; }
  .compara h3 { margin: 0 0 1rem; font-size: 1.15rem; }
  /* A tabela ROLA dentro do próprio container em telas estreitas, em vez de deixar a página
     inteira rolar de lado. É a mesma regra do painel (web/design.md): conteúdo largo rola dentro
     da caixa dele, o body nunca. */
  /* Fundo lavanda em vez de branco puro. Ideia vinda do cafellow.com.br (analisado em 06/08/2026):
     eles separam blocos por TOM DE FUNDO, não por linha divisória, e o resultado é uma página que
     respira sem ficar riscada. A cor aqui é o roxo da marca em tom baixo, não a lavanda deles.
     Efeito prático: a comparação descola dos cards de plano, que são brancos, sem precisar de
     título maior nem borda mais grossa. */
  .compara-rolagem { overflow-x: auto; border: 3px solid var(--brand); border-radius: 1.25rem; background: #faf7fd; }
  /* Cresceu de 560px pra caber SEIS colunas (rótulo + 5 marcas). Com menos que isso o número
     quebrava em duas linhas e a curva de preço, que é o argumento inteiro da tabela, virava
     parágrafo. A rolagem lateral do container é o que segura isso no celular. */
  .compara table { width: 100%; border-collapse: collapse; min-width: 720px; text-align: left; }
  .compara th, .compara td { padding: 0.85rem 0.8rem; border-bottom: 2px solid #efeaf5; white-space: nowrap; }
  .compara tbody th { white-space: normal; }
  /* A coluna do NOME fica grudada na rolagem lateral. No celular só cabem duas colunas de valor por
     vez, e sem isso a pessoa rola até "5 marcas" e perde de quem é o número que está lendo.
     Precisa de fundo opaco próprio: sticky pinta por cima, e sem fundo as células passariam por
     baixo do texto. */
  .compara th:first-child { position: sticky; left: 0; z-index: 1; background: #faf7fd; }
  .compara tr.nos th:first-child { background: var(--primary); }
  .compara thead th { font-size: 0.78rem; letter-spacing: 0.08em; text-transform: uppercase; background: #faf7fd; }
  /* A LINHA do ATENTA! recebe o amarelo da marca, cabeçalho incluído: é o realce que faz o olho
     comparar as três linhas de uma vez em vez de ler célula por célula.
     (Antes o amarelo estava na última COLUNA, herdado de uma versão da tabela em que o ATENTA! era
     coluna. Com a virada pra linha, aquilo passou a destacar "3 marcas", que não é o argumento.) */
  .compara tr.nos th, .compara td.sim { background: var(--primary); font-weight: 700; }
  /* A linha do ATENTA! ganha CONTORNO além do amarelo. Só o preenchimento a distinguia das outras,
     e num bloco onde tudo tem a mesma borda de 2px ela lia como "mais uma linha, colorida". O
     traço grosso em cima e embaixo a destaca como conclusão da tabela, não como item dela. */
  .compara tr.nos th, .compara tr.nos td { border-top: 3px solid var(--brand); }
  /* Preço maior só nesta linha: é o número que a pessoa leva embora. */
  .compara tr.nos td.sim { font-size: 1.08rem; }
  .compara tr.nos td.sim i { font-size: 0.68rem; }
  .compara tbody th { font-weight: 700; }
  /* Altura casada com a linha de texto dos outros dois nomes: maior que isso e a linha inteira
     cresce, desalinhando a tabela; menor e o wordmark vira mancha ilegível. */
  .compara-logo { display: block; height: 1.15rem; width: auto; margin-bottom: 0.15rem; }
  /* O modelo de cobrança em linha própria abaixo do nome: é ELE que explica por que o número
     cresce, e sem isso a tabela vira "somos mais baratos" sem argumento. */
  .compara tbody th i { display: block; font-style: normal; font-weight: 500; font-size: 0.78rem; color: var(--muted); }
  /* Ressalva dentro da célula. "Grátis" sozinho prometeria uso ilimitado na primeira marca, que não
     é verdade — o teto de posts do gratuito precisa estar NA célula, não só no rodapé, porque é ali
     que o olho para pra comparar. */
  .compara td i { display: block; font-style: normal; font-weight: 500; font-size: 0.72rem; color: var(--muted); }
  .compara tr.nos td.sim i { color: var(--ink); opacity: 0.7; }
  .compara td { color: var(--muted); }
  .compara tr.nos th, .compara tr.nos th i { color: var(--ink); }
  .compara td.sim { color: var(--ink); }
  .compara tbody tr:last-child th, .compara tbody tr:last-child td { border-bottom: 0; }
  /* DEPOIS da regra de :last-child, de propósito: aquela zera a borda de baixo da última linha, e
     como a linha do ATENTA! É a última, ela vencia por especificidade e a moldura ficava aberta
     embaixo. Vir depois, com a mesma especificidade, é o que resolve sem inflar seletor. */
  .compara tbody tr.nos th, .compara tbody tr.nos td { border-bottom: 3px solid var(--brand); }
  .compara .obs { margin: 0.75rem 0 0; font-size: 0.8rem; color: var(--muted); }

  /* Diferença de funcionalidade. Três cards em grade, não lista corrida: card alto abre espaço pra
     hierarquia dentro dele (o que é, depois por que importa), coisa que numa lista vira tudo texto
     do mesmo tamanho. Mesma regra do painel (web/design.md). */
  .difs { margin-top: 2.5rem; }
  .difs h3 { margin: 0 0 1rem; font-size: 1.15rem; }
  .difs ul { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1rem; margin: 0; padding: 0; list-style: none; }
  .difs li {
    background: #fff; border: 3px solid var(--brand); border-radius: 1.25rem;
    padding: 1.1rem 1.2rem; font-size: 0.9rem; line-height: 1.55; color: var(--muted);
    box-shadow: 5px 5px 0 0 var(--brand);
  }
  .difs li b { display: block; margin-bottom: 0.35rem; color: var(--ink); font-size: 0.98rem; }

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

  /* ---------- Legenda por IA ---------- */
  /* Texto à esquerda, cena à direita. Uma coluna abaixo de 900px, com a cena DEPOIS do texto: quem
     rola no celular precisa saber do que se trata antes de ver a caixa flutuando. */
  .ia-grid { display: grid; grid-template-columns: 1fr; gap: 2.5rem; align-items: center; }
  @media (min-width: 900px) { .ia-grid { grid-template-columns: 1fr 1.05fr; gap: 3.5rem; } }

  /* O texto vira CARD de fundo lavanda, não bloco solto (referência: cafellow.com.br). O ganho não
     é decorativo: solto, ele era só mais um parágrafo numa página de parágrafos, e a cena ao lado
     roubava o olho inteiro. Dentro de uma caixa com peso próprio, os dois viram um par. */
  .ia-texto { background: #ece5fb; border: 3px solid var(--brand); border-radius: 24px; padding: 2rem 1.9rem; }
  @media (min-width: 900px) { .ia-texto { padding: 2.4rem 2.2rem; } }
  /* O título NÃO ganha tratamento próprio: herda o h2 da página (serif, peso 400, caixa baixa).
     A versão anterior era sans em caixa alta, copiada da referência que inspirou o card, e virava
     um segundo sistema tipográfico dentro da mesma página. O que faz este bloco destacar é o card,
     não a fonte. Só o limite de linha muda, porque a coluna aqui é mais estreita que a do resto. */
  .ia-texto h2 { max-width: 18ch; }
  .ia-texto .lede { margin-bottom: 1.4rem; }
  /* Mesmo marcador dos cards de recurso (quadradinho amarelo com contorno roxo), pra lista de
     benefício ler igual em toda a página.
     O peso, porém, é maior que o dos cards: lá a lista é o CORPO do card e divide espaço com um
     título; aqui ela é o resumo do bloco e precisa sobreviver à varredura de quem já leu a frase
     acima. Em cinza-claro e peso normal ela apagava dentro do lavanda. */
  .ia-notas { margin: 0 0 1.7rem; padding: 0; list-style: none; font-size: 0.95rem; }
  .ia-notas li { margin-bottom: 0.55rem; padding-left: 1.35rem; position: relative; font-weight: 700; color: var(--ink); }
  .ia-notas li::before { content: ''; position: absolute; left: 0; top: 0.6em; width: 8px; height: 8px; border-radius: 2px; background: var(--primary); border: 1.5px solid var(--brand); }

  /* A cena. Sem sombra na moldura externa: quem carrega a tinta brutalista aqui é a CAIXA de
     sugestões, e duas sombras empilhadas fariam as duas competirem em vez de a de cima saltar. */
  .ia-cena { position: relative; }
  .ia-campo { border: 3px solid var(--brand); border-radius: 20px; background: #fff; padding: 1.1rem 1.2rem 0.9rem; }
  .ia-campo-topo { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; font-weight: 700; font-size: 0.9rem; margin-bottom: 0.6rem; }
  .ia-botao { border: 2px solid var(--brand); border-radius: 999px; padding: 0.3em 0.8em; font-size: 0.76rem; font-weight: 700; white-space: nowrap; }
  /* Bloco cinza no lugar de um <input> de verdade: é ilustração, e um campo focável convidaria a
     digitar numa caixa que não faz nada. */
  .ia-input { border: 2px solid #e6e0ee; border-radius: 12px; padding: 0.7rem 0.85rem; color: var(--ink); font-size: 0.92rem; min-height: 4.2rem; }
  .ia-contador { font-size: 0.74rem; color: var(--muted); margin-top: 0.45rem; }

  /* A caixa SOBREPÕE o campo, como no app. É o que faz a cena ser reconhecida como um momento de
     uso em vez de dois blocos empilhados. */
  .ia-caixa {
    border: 3px solid var(--brand); border-radius: 18px; background: #fff;
    box-shadow: 8px 8px 0 0 var(--brand);
    padding: 0.7rem; width: min(100%, 24rem);
    display: grid; gap: 0.5rem; position: relative;
    /* No celular a caixa ocupa a largura toda, então ela sobrepõe o campo INTEIRO e não só a
       direita dele. Sobreposição maior aqui cortava o "Instagram: 46/2200" na metade da altura, que
       lê como defeito de renderização. Este valor come só o respiro de baixo do campo. */
    margin: -0.8rem 0 0 auto;
  }
  /* No desktop a caixa é estreita e fica encostada à direita, então o contador continua visível no
     canto esquerdo mesmo com o dobro da sobreposição. */
  @media (min-width: 900px) { .ia-caixa { margin-top: -1.6rem; margin-right: -1.5rem; } }
  .ia-op { border: 2px solid var(--brand); border-radius: 12px; padding: 0.6rem 0.7rem; font-size: 0.82rem; line-height: 1.45; background: #fff; }
  /* A primeira opção recebe o amarelo: numa lista em que tudo tem o mesmo peso, o olho não sabe
     onde pousar (Von Restorff). Aqui ela lê como "a que você escolheria". */
  .ia-op:first-child { background: var(--primary); }
  .ia-rodape { display: grid; gap: 0.2rem; padding: 0.2rem 0.35rem 0.1rem; }
  .ia-tom { font-size: 0.72rem; font-weight: 700; color: var(--brand); }
  .ia-aviso { font-size: 0.7rem; color: var(--muted); line-height: 1.4; }
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
  /* ---------- Faixa "MAIS TEMPO" ---------- */
  /* A faixa é uma tira colorida com filete em cima e embaixo, e o celular VAZA por fora dela. Por
     isso a seção tem margem vertical grande e overflow visível: qualquer recorte aqui mata o efeito
     e a faixa vira um banner comum. */
  /* DOIS tons, não um. Na referência a tira azul atravessa um CAMPO lavanda, e é esse contraste que
     faz ela parecer um recorte de outro plano em vez de um retângulo colorido no meio do branco.
     O campo também dá o respiro onde o objeto vaza: sem ele, o celular invadiria a seção vizinha. */
  /* O respiro de cima (6.5rem) é maior que o vazamento do celular (6.5rem de margem negativa) de
     propósito: assim o objeto fica INTEIRO dentro do campo lavanda. Menos que isso e ele invade a
     seção de cima, o que lê como sobreposição acidental em vez de composição. */
  .faixa-mais { background: #f3f2fb; padding: 6.8rem 0 2.5rem; margin: 4.5rem 0 0; }
  /* Filete de 2px, não 3. Na escala desta tira o traço de 3px fecha a composição e briga com o
     peso do título, que é quem deve mandar aqui. */
  .fm-tira { background: #d8e4f8; border-top: 2px solid var(--ink); border-bottom: 2px solid var(--ink); overflow: visible; }
  .fm-grid { display: grid; grid-template-columns: 1fr; align-items: center; gap: 1.5rem; padding-top: 2rem; padding-bottom: 2rem; }
  @media (min-width: 860px) { .fm-grid { grid-template-columns: 1fr auto; gap: 2rem; padding-top: 0; padding-bottom: 0; min-height: 10.5rem; } }
  /* Caixa alta e peso pesado: é o registro de FAIXA, não de seção. A página continua com o serif
     nos títulos de seção; aqui o texto é elemento gráfico, do mesmo jeito que o rótulo da netband. */
  /* PRETO, não roxo. Na referência a palavra grande é quase preta e quem carrega a cor é a pílula;
     com as duas coloridas elas competem e nenhuma manda. Também bate com o design system, que diz
     texto preto e a tinta roxa só em borda e sombra. */
  .fm-titulo {
    margin: 0 0 0.35rem; display: flex; align-items: center; flex-wrap: wrap; gap: 0.55rem;
    font-weight: 800; text-transform: uppercase; letter-spacing: -0.035em; line-height: 0.92;
    font-size: clamp(2.4rem, 8.5vw, 5rem); color: var(--ink);
  }
  /* O interruptor. Na referência ele é literal: um toggle ligado, dizendo que aquilo está ativo.
     O ponto branco fica à direita porque é a posição de LIGADO — à esquerda leria como desligado,
     que é o oposto do que a frase diz. */
  .fm-pilula {
    display: inline-flex; align-items: center; gap: 0.5em;
    background: var(--brand); color: #fff; border-radius: 999px;
    padding: 0.18em 0.5em 0.18em 0.75em; font-size: 0.62em;
  }
  .fm-pilula::after { content: ''; width: 0.95em; height: 0.95em; border-radius: 50%; background: var(--primary); }
  .fm-sub { margin: 0; font-weight: 700; text-transform: uppercase; letter-spacing: 0.01em; color: var(--ink); font-size: clamp(0.85rem, 2.2vw, 1.15rem); }

  /* O celular. Sobe pra fora da faixa com margem negativa — no desktop, onde há altura pra isso. */
  .fm-fone {
    width: 17rem; justify-self: center; background: #fff;
    border: 4px solid var(--ink); border-radius: 2.2rem; padding: 0.6rem;
    box-shadow: 8px 8px 0 0 var(--brand);
  }
  /* O objeto VAZA PRA CIMA e apoia no filete de baixo, em vez de vazar dos dois lados.
     Foi o erro maior da primeira versão: sobrando igual em cima e embaixo, ele lê como adesivo
     centralizado numa tira. Na referência a mão entra pela direita e termina NO filete inferior, e
     é isso que faz o objeto parecer erguido para dentro da faixa. */
  @media (min-width: 860px) { .fm-fone { align-self: end; margin: -6.5rem 0 0; } }
  .fm-tela { border: 2px solid #e6e0ee; border-radius: 1.4rem; padding: 0.7rem 0.6rem; }
  .fm-topo { display: flex; align-items: center; gap: 0.3rem; font-size: 0.58rem; margin-bottom: 0.45rem; }
  .fm-topo b { margin-right: auto; }
  .fm-topo em, .fm-topo span { border: 1.2px solid var(--brand); border-radius: 999px; font-weight: 700; font-style: normal; }
  .fm-topo em { width: 0.95rem; height: 0.95rem; display: grid; place-items: center; line-height: 1; }
  .fm-topo span { padding: 0.12em 0.5em; }
  .fm-semana, .fm-grade { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; }
  .fm-semana i { font-style: normal; font-size: 0.36rem; font-weight: 700; letter-spacing: 0.04em; color: var(--muted); text-align: center; margin-bottom: 3px; }
  /* Célula ALTA e muito arredondada, com o número no canto de cima. É assim no app, e a proporção
     vertical é o que dá o ritmo de calendário — quadradinho igual lê como tabela. */
  .fm-dia, .fm-vazio { aspect-ratio: 0.62; border-radius: 0.7rem; }
  .fm-dia { border: 1px solid #efeaf5; padding: 3px; display: flex; flex-direction: column; gap: 2px; }
  .fm-dia b { font-size: 0.4rem; font-weight: 700; color: var(--ink); line-height: 1; }
  /* O chip do post: fundo claro com a BARRA da esquerda na cor da rede, igual ao app. O logo em si
     não cabe neste tamanho, e a barra colorida é justamente o que sobrevive: é ela que faz a
     leitura de "o mês está cheio, e de redes diferentes". */
  .fm-dia s { display: block; height: 0.32rem; border-radius: 3px; background: #f4f2f8; border-left: 2px solid currentColor; text-decoration: none; }
  .fm-dia.hoje { background: #fffbe6; border-color: var(--primary); }

  /* ---------- Atendente ---------- */
  /* Nasce invisível E fora do alcance do teclado: só a opacidade zerada deixaria um botão fantasma
     tabulável antes da hora. O visibility resolve os dois. */
  .at-fab {
    position: fixed; right: 1.1rem; bottom: 1.1rem; z-index: 60;
    display: grid; place-items: center; cursor: pointer; padding: 0;
    width: 3.4rem; height: 3.4rem; border-radius: 50%;
    background: var(--primary); color: var(--ink);
    border: 3px solid var(--brand); box-shadow: 4px 4px 0 0 var(--brand);
    opacity: 0; visibility: hidden; transform: translateY(8px);
    transition: opacity .25s var(--ease), transform .25s var(--ease), box-shadow .12s var(--ease);
  }
  .at-fab svg { width: 1.55rem; height: 1.55rem; }
  .at-fab.in { opacity: 1; visibility: visible; transform: none; }
  .at-fab:hover { box-shadow: 6px 6px 0 0 var(--brand); transform: translate(-2px, -2px); }
  .at-painel {
    position: fixed; right: 1rem; bottom: 4.6rem; z-index: 61; width: min(22rem, calc(100vw - 2rem));
    background: #fff; border: 3px solid var(--brand); border-radius: 20px;
    box-shadow: 6px 6px 0 0 var(--brand); display: none; flex-direction: column; overflow: hidden;
  }
  .at-painel.aberto { display: flex; }
  .at-topo { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; padding: 0.8rem 1rem; border-bottom: 2px solid #efeaf5; font-size: 0.95rem; }
  .at-topo button { background: none; border: 0; cursor: pointer; font-size: 1rem; color: var(--muted); line-height: 1; }
  /* Teto de altura pra conversa longa rolar DENTRO do painel, nunca esticá-lo além da tela. */
  .at-conversa { display: grid; gap: 0.5rem; padding: 0.9rem 1rem; max-height: 15rem; overflow-y: auto; }
  .at-bolha { font-size: 0.88rem; line-height: 1.5; padding: 0.55rem 0.75rem; border-radius: 14px; max-width: 90%; }
  .at-bolha.ela { background: #ece5fb; border: 2px solid var(--brand); justify-self: start; }
  .at-bolha.eu { background: var(--primary); border: 2px solid var(--brand); justify-self: end; font-weight: 600; }
  .at-atalhos { display: grid; gap: 0.35rem; justify-items: start; }
  .at-atalho { cursor: pointer; background: #fff; border: 2px solid var(--brand); border-radius: 999px; padding: 0.35em 0.8em; font: inherit; font-size: 0.78rem; text-align: left; }
  .at-atalho:hover { background: var(--primary); }
  .at-linha { display: flex; gap: 0.4rem; padding: 0.7rem 1rem 0.5rem; }
  /* 16px é o piso: abaixo disso o iOS Safari trata o campo como "vai ser difícil de ler" e dá zoom
     automático no toque, empurrando a página inteira e desalinhando o painel do chat. 0.88rem
     (14px) estava sob esse piso. É por isso que este valor é em PX fixo, não rem: rem herdaria de
     qualquer ajuste de tamanho de fonte do navegador e voltaria a ficar abaixo de 16 sem avisar. */
  .at-linha input { flex: 1; min-width: 0; border: 2px solid #e6e0ee; border-radius: 999px; padding: 0.5em 0.9em; font-family: inherit; font-size: 16px; }
  .at-linha input:focus { outline: 2px solid var(--brand); outline-offset: 1px; }
  .at-linha button { cursor: pointer; border: 3px solid var(--brand); background: var(--primary); border-radius: 999px; width: 2.3rem; font: inherit; font-weight: 700; }
  .at-rodape { margin: 0; padding: 0 1rem 0.9rem; font-size: 0.68rem; color: var(--muted); line-height: 1.4; }
  .at-rodape a { color: var(--brand); font-weight: 600; }

  .faq-grid { display: grid; grid-template-columns: 1fr; gap: 2rem; align-items: start; }
  @media (min-width: 980px) { .faq-grid { grid-template-columns: minmax(0, 1fr) 20rem; gap: 3rem; } }
  .faq { display: grid; gap: 0.7rem; }
  .faq-ajuda { background: #ece5fb; border: 3px solid var(--brand); border-radius: 24px; padding: 1.6rem 1.5rem; }
  @media (min-width: 980px) { .faq-ajuda { position: sticky; top: 5.5rem; } }
  .faq-ajuda svg { width: 56px; height: auto; margin-bottom: 0.6rem; }
  .faq-ajuda h3 { font-family: ${SERIF}; font-weight: 400; font-size: 1.35rem; line-height: 1.15; margin: 0 0 0.5rem; }
  .faq-ajuda p { margin: 0 0 1.1rem; font-size: 0.92rem; color: var(--muted); line-height: 1.5; }
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
  /* Barra própria embaixo do grid — e por isso reseta o display: a regra "footer .wrap" é grid de
     três colunas e espremeria esta linha única na primeira delas. (Sem crase em comentário aqui: o
     STYLE inteiro é um template literal, e uma crase solta fecha a string no meio.) */
  footer .legal { border-top: 1px solid rgba(1, 1, 1, 0.12); }
  footer .legal .wrap { display: block; padding: 1.1rem var(--gutter) 1.6rem; font-size: 0.82rem; color: var(--muted); text-align: center; }

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
    /* O personagem FLUTUA depois de entrar. Ele é desenhado no ar (pernas soltas, xícara e balões
       em volta), então parado ele lê como imagem congelada no meio de um pulo; o laço devolve o
       que o próprio desenho promete.
       As duas animações são encadeadas por vírgula em vez de aninhadas: a entrada roda uma vez e a
       flutuação começa quando ela termina (0.26s + 0.75s = 1.01s de atraso). Fundir as duas numa
       keyframe só obrigaria a repetir o fade de entrada a cada volta.
       6s e 10px de amplitude: movimento que se percebe de canto de olho sem competir com a leitura
       do título ao lado, mesma régua do olho que pisca abaixo. */
    @keyframes flutuar {
      0%, 100% { transform: translateY(0) }
      50%      { transform: translateY(-10px) }
    }
    .hero .shot {
      animation: riseShot .75s var(--ease) 260ms both, flutuar 6s ease-in-out 1.01s infinite;
    }

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

    // Alternador mensal/anual. O HTML servido já vem com o MENSAL preenchido, então quem tem JS
    // desligado (e todo crawler que não executa script) lê um preço real em vez de um espaço vazio.
    var ciclo = document.querySelector('.ciclo');
    if (ciclo) {
      var precoPro = document.getElementById('preco-pro');
      var periodoPro = document.getElementById('periodo-pro');
      var obsPro = document.getElementById('obs-pro');
      var TEXTOS = {
        mes: { preco: 'R$ 39', periodo: 'por mês', obs: 'Ou R$ 390 por ano, dois meses grátis.' },
        // No anual mostramos o equivalente MENSAL, que é como se compara com a outra opção, e o
        // valor cheio logo abaixo — a pessoa não pode descobrir os R$ 390 só no checkout.
        ano: { preco: 'R$ 32,50', periodo: 'por mês', obs: 'R$ 390 cobrados uma vez por ano.' },
      };
      ciclo.addEventListener('click', function (e) {
        var alvo = e.target.closest('button[data-ciclo]');
        if (!alvo) return;
        var t = TEXTOS[alvo.getAttribute('data-ciclo')];
        if (!t) return;
        ciclo.querySelectorAll('button').forEach(function (b) { b.classList.toggle('ativo', b === alvo); });
        precoPro.textContent = t.preco;
        periodoPro.textContent = t.periodo;
        obsPro.textContent = t.obs;
      });
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

    // ---- Atendente ----
    //
    // O botão NÃO nasce na tela. Widget de chat que pula em cima de quem acabou de chegar é o
    // padrão que todo mundo aprendeu a fechar sem ler, e queimaria a única chance de ser útil.
    // Ele entra em duas situações, que são as duas em que existe dúvida de verdade:
    //   - 40s na página: quem lê esse tempo está avaliando, não passando;
    //   - passou de 75% da rolagem: leu tudo e ainda não clicou em nada.
    // Uma vez visível, fica.
    var fab = document.getElementById('at-fab');
    var painel = document.getElementById('at-painel');
    if (fab && painel) {
      var apareceu = false;
      function mostrar() {
        if (apareceu) return;
        apareceu = true;
        fab.classList.add('in');
      }
      setTimeout(mostrar, 40000);
      addEventListener('scroll', function () {
        var lido = (scrollY + innerHeight) / document.body.scrollHeight;
        if (lido > 0.75) mostrar();
      }, { passive: true });

      var campo = document.getElementById('at-campo');
      var linha = document.getElementById('at-linha');
      var conversa = document.getElementById('at-conversa');
      var ocupado = false;

      function abrir(v) {
        painel.classList.toggle('aberto', v);
        fab.setAttribute('aria-expanded', v ? 'true' : 'false');
        if (v) campo.focus();
      }
      fab.addEventListener('click', function () { abrir(!painel.classList.contains('aberto')); });
      document.getElementById('at-fechar').addEventListener('click', function () { abrir(false); });
      addEventListener('keydown', function (e) { if (e.key === 'Escape') abrir(false); });

      function bolha(texto, de) {
        var el = document.createElement('div');
        el.className = 'at-bolha ' + de;
        el.textContent = texto;
        conversa.appendChild(el);
        conversa.scrollTop = conversa.scrollHeight;
        return el;
      }

      function perguntar(texto) {
        if (ocupado || !texto.trim()) return;
        ocupado = true;
        // Some com os atalhos assim que a conversa começa: eles existem pra vencer o campo em
        // branco, e depois da primeira pergunta viram ruído.
        var atalhos = document.getElementById('at-atalhos');
        if (atalhos) atalhos.remove();
        bolha(texto, 'eu');
        campo.value = '';
        var esperando = bolha('...', 'ela');
        fetch('/api/atendente', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pergunta: texto })
        })
          .then(function (r) { return r.json(); })
          .then(function (j) {
            esperando.textContent = j.resposta || j.error || 'Não consegui responder agora.';
          })
          .catch(function () {
            esperando.textContent = 'Não consegui responder agora. Manda pra contato@omangue.co.';
          })
          .finally(function () { ocupado = false; conversa.scrollTop = conversa.scrollHeight; });
      }

      // O card da FAQ abre o mesmo atendente. Chama mostrar() antes: quem clica ali pode não ter
      // cumprido nenhum dos dois gatilhos (40s ou 75% de rolagem), e sem isso o painel abriria com
      // o botão que o ancora ainda invisível.
      var faqChat = document.getElementById('faq-chat');
      if (faqChat) faqChat.addEventListener('click', function () { mostrar(); abrir(true); });

      linha.addEventListener('submit', function (e) { e.preventDefault(); perguntar(campo.value); });
      document.querySelectorAll('.at-atalho').forEach(function (b) {
        b.addEventListener('click', function () { perguntar(b.textContent); });
      });
    }
  });
`;

async function logoDataUri(env: Env): Promise<string | null> {
  try {
    const res = await env.ASSETS.fetch(new Request('https://assets.local/atenta-logoetipo.png'));
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
      'Reordenar troca os horários entre si, sem inventar data nova',
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
      'Carrossel, Reel, Story, Short: você escolhe, não é adivinhado',
      'Rascunho pra guardar a ideia antes de marcar a data',
      'Travou na legenda? Três sugestões no tom dos seus posts que renderam',
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
// Exportada porque o atendente da landing (src/lib/atendente.ts) monta o corpus dele a partir DESTA
// constante. Fonte única: uma resposta corrigida aqui já sai corrigida na boca do bot, e não existe
// a situação em que a página diz uma coisa e ele diz outra.
export const FAQ = [
  {
    q: 'Agendar posts pelo ATENTA! prejudica o alcance?',
    a: 'Não. A publicação usa as APIs oficiais de cada rede, a mesma via de qualquer ferramenta aprovada. Para a rede social, um post agendado é um post normal.',
  },
  {
    q: 'Minhas contas ficam seguras?',
    a: 'Você autoriza pela tela de consentimento da própria rede social; nunca pedimos a sua senha. As autorizações ficam guardadas criptografadas e você pode revogar o acesso quando quiser, aqui ou nas configurações da rede.',
  },
  {
    q: 'Preciso colocar cartão para começar?',
    a: 'Não. O plano gratuito é permanente e não pede cartão: uma conta conectada e cinco posts por mês, sem prazo para acabar. Você só paga se quiser passar desses limites, e aí escolhe, ninguém cobra sozinho.',
  },
  {
    q: 'Quais redes posso conectar?',
    a: 'Instagram, Facebook, YouTube, LinkedIn, Pinterest e TikTok. Dá para conectar mais de uma conta da mesma rede e escolher, em cada post, para quais delas ele vai.',
  },
  {
    q: 'O que acontece se eu parar de pagar?',
    a: 'Você volta para o plano gratuito e mantém acesso a tudo que já criou: posts, métricas e contas continuam lá. Só os limites do gratuito voltam a valer.',
  },
];

// Agosto de 2026 no calendário do app: dia 1 cai num sábado, então a primeira linha começa vazia.
// Os dias com post e a rede de cada um são os MESMOS que eu semeei no banco local pra conferir a
// tela de verdade antes de desenhar isto — não é distribuição inventada pra ficar bonita.
const FAIXA_DIAS: Record<number, string> = {
  3: '#E1306C', 4: '#111827', 6: '#0A66C2', 7: '#E1306C', 10: '#1877F2',
  11: '#E1306C', 13: '#FF0000', 14: '#E60023', 17: '#E1306C', 18: '#111827',
  20: '#0A66C2', 21: '#E1306C', 24: '#1877F2', 26: '#E1306C', 28: '#FF0000',
};

/** As 5 semanas do mês, do jeito que a grade do app monta (domingo primeiro). */
function faixaCalendario(): string {
  const celulas: string[] = [];
  // 6 vazias antes do dia 1 (sábado), depois 1..29. Para em 29 de propósito: a sexta linha teria
  // dois dias e uma fileira quase vazia, que num banner lê como grade quebrada.
  for (let i = 0; i < 6; i++) celulas.push('<i class="fm-vazio"></i>');
  for (let d = 1; d <= 29; d++) {
    const cor = FAIXA_DIAS[d];
    const hoje = d === 6 ? ' hoje' : '';
    // A cor da rede vai no `color` e o chip usa currentColor na barra da esquerda, igual ao app:
    // o chip é claro, e quem carrega a identidade da rede é a barrinha lateral.
    celulas.push(
      `<i class="fm-dia${hoje}"><b>${d}</b>${cor ? `<s style="color:${cor}"></s>` : ''}</i>`
    );
  }
  return celulas.join('');
}

/**
 * As faixas dentro da barra de preço: uma por cobrança mensal.
 *
 * É o que faz o desenho EXPLICAR em vez de só comparar. Uma barra mais alta diz "custa mais"; uma
 * barra mais alta dividida em cinco diz "custa mais PORQUE cobra cinco vezes", que é exatamente a
 * diferença de modelo que a tabela conta em texto ("cobra por marca", "cobra por canal").
 */
function cobrancas(n: number): string {
  return Array.from({ length: n }, () => '<i></i>').join('');
}

const ARROW = `<svg class="arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>`;

/**
 * Hashes dos blocos embutidos desta página, pra CSP. São os DOIS blocos servidos abaixo
 * (<style>${STYLE}</style> e <script>${SCRIPT}</script>): a política precisa autorizar exatamente
 * o que vai na resposta, então eles saem das mesmas constantes. Ver src/lib/csp.ts.
 */
export async function hashesDaLanding(): Promise<string[]> {
  return Promise.all([hashCsp(STYLE), hashCsp(SCRIPT)]);
}

export async function renderLandingPage(env: Env): Promise<string> {
  const logo = await logoDataUri(env);
  const mark = (cls: string) =>
    logo ? `<img class="${cls}" src="${logo}" alt="ATENTA!">` : `<b class="${cls}" style="font-size:1.5rem;color:var(--brand)">ATENTA!</b>`;

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ATENTA!: Agende posts e planeje o feed em todas as redes</title>
<meta name="description" content="Agende publicações em Instagram, Facebook, YouTube, LinkedIn, Pinterest e TikTok, planeje como o feed vai ficar e acompanhe o que deu certo. Comece grátis, sem cartão.">
<meta name="theme-color" content="#FCEC0E">
<!-- A landing é renderizada por ESTA função, com o próprio <head> — não herda nada do
     web/index.html do SPA (que só serve /app pra baixo). Faltavam estas três tags aqui, e foi
     exatamente o que a análise do TikTok reprovou: o navegador na landing caía no favicon padrão
     (ou nenhum), divergindo do ícone submetido no formulário. Mesmos três arquivos do SPA, que já
     estavam liberados em LANDING_PUBLIC_ASSETS (src/worker.ts) sem ninguém os referenciar aqui. -->
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="icon" type="image/svg+xml" href="/atenta-icon.svg">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
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
      <a href="#precos">Preços</a>
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
      <!-- Nomear o público continua sendo decisão de posicionamento (ver o cabeçalho deste arquivo),
           mas em uma frase: a versão longa gastava cinco linhas pra dizer o que cabe em duas. -->
      <p class="sub" data-in style="--d:150ms">
        Para social medias, criadores e pequenas marcas. Publique nas seis redes, planeje o feed e
        veja os resultados num lugar só.
      </p>
      <!-- Botões e linha do preço vivem no MESMO bloco porque é o bloco que faz os dois terem a
           mesma largura (ver .cta-bloco no CSS). -->
      <div class="cta-bloco">
      <div class="hero-actions" data-in style="--d:210ms">
        <a class="cta" href="/app">Comece grátis ${ARROW}</a>
        <a class="cta ghost" href="#como-funciona">Ver como funciona</a>
      </div>
      <!-- O limite entra na frase de propósito. "Grátis, sem cartão" sozinho faz a pessoa entender
           "tudo de graça", conectar a segunda conta e bater numa parede: promessa mal calibrada
           numa página que passa por revisão de plataforma. Os números vêm de FREE_LIMITS. -->
      <p class="nocard" data-in style="--d:260ms">Sem cartão. Grátis para sempre: 1 conta e 5 posts por mês.${
        signupIsOpen(env)
          ? ''
          : // Enquanto o App Review não aprova, o cadastro é por convite, e a página precisa dizer
            // isso ANTES do clique. Sem esta frase, "Comece grátis" levava a uma recusa depois de a
            // pessoa já ter preenchido nome, e-mail e senha. Some sozinha quando SIGNUP_MODE virar
            // 'open': a mesma chave governa a landing, a tela de entrar e o portão de verdade.
            ` <b>Hoje o acesso é por convite:</b> entre na lista.`
      }</p>
      </div>
    </div>
    <!-- Personagem 3D recortado, sem a moldura amarela torta que a FOTO precisava.
         A foto flutuava solta no amarelo do hero e por isso pedia um quadro em volta pra se
         apoiar; um PNG com fundo transparente não pede nada, e vaza direto sobre o fundo. É o
         mesmo gesto do celular na faixa "MAIS TEMPO".
         O roxo do moletom e o amarelo dos detalhes já são quase a paleta da marca, então ele entra
         sem recolorir - ao contrário dos 3D pastel, que precisariam. -->
    <div class="shot">
      <picture>
        <source srcset="/heroi-3d.webp" type="image/webp">
        <img src="/heroi-3d.png" alt="Pessoa sentada digitando no notebook, cercada de balões de mensagem" width="1024" height="1024">
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
      <em>como ele vai ficar</em>, no formato certo de cada rede e no lugar certo do seu perfil.
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

<!-- LEGENDA POR IA
     A tela é RECONSTRUÍDA em HTML/CSS, não é print. Três motivos, nesta ordem: print de interface
     envelhece a cada mexida no app e ninguém lembra de trocar (a página passa a mostrar um produto
     que não existe mais); ele borra em tela retina, a não ser que se sirva o dobro de pixels; e o
     texto dentro dele não é lido por buscador nem por leitor de tela, que é metade do motivo de a
     seção existir.
     De quebra, a cena acompanha a marca sozinha: as cores saem das mesmas variáveis do resto da
     página.

     O CONTEÚDO da cena é o argumento, não a moldura: o campo mostra UM RASCUNHO CURTO e as opções
     mostram texto pronto. É isso que explica, sem legenda explicativa, que o campo é o briefing.
     E o rodapé da caixa carrega a frase que diferencia isto de qualquer gerador ("no tom dos seus
     posts que mais engajaram"), junto do aviso de conferir. Vender IA escondendo que é IA seria
     começar a relação mentindo. -->
<section class="sec" id="legenda-ia">
  <div class="wrap">
    <div class="ia-grid">
      <div class="ia-texto">
        <p class="eyebrow" data-reveal>Quando trava na legenda</p>
        <h2 data-reveal style="--d:60ms">Ela escreve parecido com você, não com um robô</h2>
        <!-- UMA frase. A versão anterior tinha um parágrafo de quatro linhas mais três itens
             explicados, e explicava a funcionalidade inteira antes de a pessoa querer saber. A cena
             ao lado já mostra como funciona; aqui só precisa dizer o que se ganha. -->
        <p class="lede" data-reveal style="--d:110ms">
          Escreva uma linha do que quer dizer e receba três opções, no tom dos seus posts que mais
          engajaram.
        </p>
        <ul class="ia-notas" data-reveal style="--d:160ms">
          <li>Você edita ou desfaz com um clique</li>
          <li>Um tom para cada rede</li>
          <li>Incluso no plano, sem comprar créditos</li>
        </ul>
        <!-- Leva pros PREÇOS, não pro cadastro: a linha acima acabou de dizer "incluso no plano", e
             a pergunta que ela cria é "em qual, e quanto custa". Mandar pro cadastro aqui seria
             responder outra coisa. -->
        <a class="cta destaque" href="#precos" data-reveal style="--d:200ms">Conheça os planos ${ARROW}</a>
      </div>

      <!-- A cena. O aria-hidden está aí porque isto é ILUSTRAÇÃO: o texto que importa está no bloco ao lado, e
           deixá-la no fluxo faria o leitor de tela ler uma legenda de exemplo como se fosse
           conteúdo da página. -->
      <div class="ia-cena" data-reveal style="--d:220ms" aria-hidden="true">
        <div class="ia-campo">
          <div class="ia-campo-topo">
            <span>Legenda</span>
            <span class="ia-botao">✨ Sugerir legenda</span>
          </div>
          <div class="ia-input">bastidores da montagem da vitrine nova da loja</div>
          <div class="ia-contador">Instagram: 46/2200</div>
        </div>

        <div class="ia-caixa">
          <div class="ia-op">Tudo pronto para a inauguração da vitrine nova. A equipe trabalhou muito para deixar o espaço aconchegante.</div>
          <div class="ia-op">A montagem foi um processo cuidadoso, detalhe por detalhe. A loja está mais bonita, vem conferir.</div>
          <div class="ia-op">Vitrine nova, loja renovada. Passa aqui pra ver de perto o que a gente preparou.</div>
          <div class="ia-rodape">
            <span class="ia-tom">No tom dos seus posts que mais engajaram</span>
            <span class="ia-aviso">Escrito por IA. Confira nomes, datas e valores antes de agendar.</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- PREÇOS
     A landing não tinha seção de preço: dizia "cresceu, você assina" e nunca dizia quanto. É a
     pergunta que mais leva alguém embora sem responder, e a que mais traz busca orgânica.

     A comparação é de MODELO de cobrança, nunca de concorrente nomeado com valor: preço de terceiro
     muda sem avisar, e uma tabela que envelhece vira o motivo pra não confiar no resto da página.
     O argumento se sustenta sozinho porque a diferença é estrutural, não de centavos. -->
<!-- FAIXA "MAIS TEMPO"
     Formato emprestado do cafellow.com.br: faixa colorida atravessando a página, com filete em cima
     e embaixo, e o objeto VAZANDO por fora dela. O vazamento é o que faz a faixa parecer um recorte
     do mundo em vez de um retângulo com uma foto dentro; sem ele vira banner de anúncio.

     A TELA é reconstruída em CSS, não é print. Aqui isso não custa nada de veracidade: o calendário
     do mês não tem foto nenhuma, só células e um marcador colorido por rede, então o CSS reproduz
     o que a tela mostra de verdade. Os dias com post e a cor de cada um saem da mesma distribuição
     que eu semeei no banco local pra ver a tela funcionando (ver FAIXA_DIAS).

     POR QUE NÃO A TELA DE INSIGHTS, que era a outra candidata: número de desempenho em página de
     venda é lido como resultado prometido. Inventar os números engana; usar os reais publicaria
     conta, legenda e capa de cliente do estúdio numa página aberta. O calendário mostra PLANO, e
     ninguém lê "seis posts agendados" como promessa de engajamento. -->
<section class="faixa-mais">
  <div class="fm-tira">
    <div class="wrap fm-grid">
    <div class="fm-texto" data-reveal>
      <p class="fm-titulo"><span class="fm-pilula">MAIS</span> TEMPO</p>
      <p class="fm-sub">Uma tarde de planejamento, o mês inteiro publicado.</p>
    </div>
    <div class="fm-fone" data-reveal style="--d:120ms" aria-hidden="true">
      <div class="fm-tela">
        <div class="fm-topo"><em>‹</em><b>Agosto de 2026</b><em>›</em><span>Hoje</span></div>
        <div class="fm-semana"><i>DOM</i><i>SEG</i><i>TER</i><i>QUA</i><i>QUI</i><i>SEX</i><i>SÁB</i></div>
        <div class="fm-grade">${faixaCalendario()}</div>
      </div>
    </div>
    </div>
  </div>
</section>

<section class="sec" id="precos">
  <div class="wrap">
    <p class="eyebrow" data-reveal>Quanto custa</p>
    <h2 data-reveal style="--d:60ms">Um preço só, sem contar canais</h2>
    <p class="lede" data-reveal style="--d:110ms">
      A maioria das ferramentas cobra por rede conectada ou por perfil: publicar em cinco lugares
      custa cinco vezes. Aqui você assina uma vez e conecta quantas contas quiser.
    </p>

    <!-- Alternador mensal/anual. O padrão é MENSAL de propósito: abrir no anual mostra um número
         menor que a pessoa não pode pagar por mês, e a descoberta de que são R$ 390 de uma vez vem
         como surpresa ruim no checkout. No anual, o preço exibido é o equivalente MENSAL (é assim
         que se compara com o mensal), e o valor cheio fica logo abaixo, sem letra miúda. -->
    <div class="ciclo" data-reveal style="--d:140ms">
      <button type="button" class="ativo" data-ciclo="mes">Mensal</button>
      <button type="button" data-ciclo="ano">Anual <i>2 meses grátis</i></button>
    </div>

    <div class="planos">
      <div class="plano" data-reveal>
        <h3>Grátis</h3>
        <p class="preco"><b>R$ 0</b><span>para sempre</span></p>
        <ul>
          <li>1 conta conectada</li>
          <li>5 posts por mês</li>
          <li>Grade do feed e pré-visualização</li>
          <li>30 dias de métricas</li>
        </ul>
        <a class="cta ghost" href="/app">Começar grátis</a>
        <p class="obs">Não pede cartão e não expira.</p>
      </div>

      <div class="plano destaque" data-reveal style="--d:80ms">
        <span class="selo">Mais escolhido</span>
        <h3>Pro</h3>
        <p class="preco"><b id="preco-pro">R$ 39</b><span id="periodo-pro">por mês</span></p>
        <ul>
          <li><b>Contas ilimitadas</b>, nas seis redes</li>
          <li><b>Posts ilimitados</b></li>
          <li>Histórico completo de métricas</li>
          <li>Pilares de conteúdo e quem comenta com você</li>
          <li>20 GB de arquivos</li>
        </ul>
        <a class="cta" href="/app">Testar 7 dias grátis</a>
        <p class="obs" id="obs-pro">Ou R$ 390 por ano, dois meses grátis.</p>
      </div>
    </div>

    <p class="lede" data-reveal style="--d:160ms;font-size:0.95rem">
      Sem fidelidade: cancele quando quiser e você volta pro gratuito mantendo tudo que já criou.
    </p>

    <!-- COMPARAÇÃO EM ALTURA (ideia vinda do cafellow.com.br)
         A tabela abaixo é precisa e exige leitura; esta é a versão de dois segundos. O truque é que
         a ALTURA da barra é o próprio preço, então a diferença entra pelo olho antes de qualquer
         número ser lido. Não substitui a tabela: ela mostra UM cenário, a tabela mostra os cinco.

         O CENÁRIO ESTÁ NO TÍTULO de propósito. Comparar em "3 marcas" sem dizer seria escolher a
         coluna em que ganhamos e esconder a de 1 marca, onde perdemos. Dito o cenário, a mesma
         pessoa que confere na tabela encontra o número igual, e a comparação continua defensável.

         A pista de fundo (a barra clara inteira) existe pra dar a escala: sem ela, três barras
         soltas comparam entre si mas não dizem de quanto é o teto. -->
    <div class="doses" data-reveal>
      <!-- O título AFIRMA, não descreve. "Cuidando de 5 marcas, por mês" era rótulo de eixo: dizia
           o cenário e deixava a conclusão por conta de quem lê.
           O "QUASE" não é modéstia, é o número: 149,50 ÷ 39 = 3,83, que não é 4. Escrever "4×"
           seco seria o único dado errado de uma página cujo argumento inteiro é que as contas
           batem quando alguém confere.
           Sem dizer contra quem, a frase é folgada em relação ao Buffer (3,28×). Fica assim porque
           as duas barras com os dois valores estão logo abaixo dela, e a tabela completa logo
           depois: o leitor tem o número exato à mão, não precisa confiar no título.
           O CENÁRIO continua na frase: sem "com 5 marcas" viraria afirmação geral, e na coluna de
           uma marca a tabela logo abaixo mostra o contrário. -->
      <h3 class="pilula-titulo">Com 5 marcas, o ATENTA! custa quase 4× menos</h3>
      <div class="doses-grid">
        <div class="dose">
          <div class="dose-pista"><div class="dose-barra nos" style="height:26%">${cobrancas(1)}</div></div>
          <p><b>${mark('doses-logo')}</b><span>R$ 39</span></p>
        </div>
        <div class="dose">
          <div class="dose-pista"><div class="dose-barra" style="height:86%">${cobrancas(5)}</div></div>
          <p><b>Buffer</b><span>R$ 128</span></p>
        </div>
        <div class="dose">
          <div class="dose-pista"><div class="dose-barra" style="height:100%">${cobrancas(5)}</div></div>
          <p><b>mLabs</b><span>R$ 149,50</span></p>
        </div>
      </div>
      <p class="doses-legenda">
        Cada faixa é uma cobrança: a mLabs cobra por marca, o Buffer por canal.
        <b>Aqui é uma só, não importa quantas contas você conecte.</b>
      </p>
    </div>

    <!-- COMPARAÇÃO COM CONCORRENTES
         Números CONFERIDOS nas páginas oficiais em 06/08/2026, com a data visível na página: preço
         de terceiro muda sem avisar, e a data é o que separa "comparação honesta" de "tabela
         desatualizada". Quando mudar, atualiza-se aqui e na data. Tabela semântica de verdade
         (thead/th/scope) porque é o que o buscador entende e o leitor de tela navega.

         A COLUNA "1 marca" É GRÁTIS, não R$ 39: o rodapé assume um canal por marca, e uma conta
         conectada é exatamente o que o plano gratuito cobre. Enquanto a célula dizia R$ 39 a tabela
         contradizia a própria nota, e cobrava por algo que o produto dá.
         O teto de 5 posts vai DENTRO da célula, não só no rodapé, senão "Grátis" promete ilimitado.

         O rodapé continua admitindo que a mLabs sai mais barata acima desse teto. Isso é de
         propósito: uma tabela em que a própria empresa ganha em tudo não é lida como informação, é
         lida como propaganda, e quem confere um número e vê que bate passa a acreditar no resto.

         O BLOCO "O que muda na prática" (logo abaixo da tabela) já teve um quarto card admitindo
         que não fazemos análise de concorrentes. Ele saiu por decisão de produto. Quem for repor
         algo assim: o valor dele era sustentar a credibilidade DESTA tabela, e o custo era mandar
         quem procura essa funcionalidade direto pro concorrente. O rodapé daqui continua fazendo a
         parte da honestidade, dizendo em que cenário a mLabs sai mais barata. -->
    <div class="compara" data-reveal style="--d:200ms">
      <h3>Quanto custa cuidar de mais de uma marca</h3>
      <div class="compara-rolagem">
        <table>
          <thead>
            <tr>
              <th scope="col">Por mês</th>
              <th scope="col">1 marca</th>
              <th scope="col">2 marcas</th>
              <th scope="col">3 marcas</th>
              <th scope="col">4 marcas</th>
              <th scope="col">5 marcas</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">mLabs <i>cobra por marca</i></th>
              <td>R$ 29,90</td>
              <td>R$ 59,80</td>
              <td>R$ 89,70</td>
              <td>R$ 119,60</td>
              <td>R$ 149,50</td>
            </tr>
            <!-- Em REAIS, não em dólar. Quem lê é brasileiro decidindo quanto vai gastar por mês, e
                 "US$ 25" obriga a fazer a conversão de cabeça bem no momento da comparação. A
                 cotação e a data ficam no rodapé, junto do aviso de que o custo real é MAIOR: quem
                 paga em dólar leva IOF e spread do cartão por cima. -->
            <tr>
              <th scope="row">Buffer <i>cobra por canal</i></th>
              <td>R$ 26</td>
              <td>R$ 51</td>
              <td>R$ 77</td>
              <td>R$ 102</td>
              <td>R$ 128</td>
            </tr>
            <!-- O wordmark entra SÓ na nossa linha, e de propósito.
                 Logo de concorrente não entra por dois motivos: em publicidade comparativa, citar o
                 NOME é uso nominativo e se sustenta sozinho, enquanto reproduzir a marca figurativa
                 é a parte que rende pedido de retirada sem ninguém precisar discutir os preços; e
                 logo alheio numa página nossa dá presença de marca ao concorrente de graça.
                 O efeito colateral é justamente o que se queria: numa coluna onde os outros são
                 texto, o único desenho é o nosso. O alt continua sendo "ATENTA!", então o cabeçalho
                 de linha segue legível para leitor de tela. -->
            <tr class="nos">
              <th scope="row">${mark('compara-logo')} <i>preço fixo</i></th>
              <td class="sim">Grátis <i>até 5 posts/mês</i></td>
              <td class="sim">R$ 39</td>
              <td class="sim">R$ 39</td>
              <td class="sim">R$ 39</td>
              <td class="sim">R$ 39</td>
            </tr>
          </tbody>
        </table>
      </div>
      <!-- Rodapé curto de propósito. A versão anterior tinha cinco linhas e explicava cada premissa
           em prosa; a tabela já é o argumento, e nota de rodapé longa some da leitura inteira.
           Ficou o que muda a conclusão: a base de cada plano, a cotação, e a admissão de onde
           perdemos. -->
      <p class="obs">
        Sites oficiais em 06/08/2026: mLabs no plano anual por marca, Buffer no Essentials por canal,
        convertido a US$ 1 = R$ 5,12 (ainda sem IOF e spread do cartão).
        Acima de 5 posts numa marca só, <b>a mLabs sai mais barata</b>: R$ 29,90 contra R$ 39.
        No gratuito, o Buffer libera 3 canais; a mLabs não tem plano gratuito.
      </p>
    </div>

    <!-- DIFERENÇA DE FUNCIONALIDADE, não só de preço.
         As duas primeiras foram CONFERIDAS em 06/08/2026: a página de funcionalidades da mLabs não
         cita nenhuma das duas, e as ferramentas do mercado tratam comentário como caixa de entrada
         pra responder, não como lista de pessoas rankeada.

         O QUE FICOU DE FORA, e por quê: "pilares de conteúdo com relatório" e "banco de ideias sem
         data" pareciam os destaques óbvios, mas o Buffer tem os dois (tags com relatório por tag em
         todos os planos, e ideias na área de criação). Anunciar como exclusivo quebraria na primeira
         conferida de quem já usa o Buffer, e derrubaria junto a credibilidade da tabela de preço.

         A terceira linha é a que PERDEMOS. Mesma razão do rodapé da tabela: um bloco em que a
         própria empresa ganha em tudo é lido como propaganda. E manda embora agora quem quer IA de
         legenda, em vez de decepcionar depois do cadastro. -->
    <div class="difs" data-reveal style="--d:280ms">
      <h3>O que muda na prática</h3>
      <ul>
        <li>
          <b>Quem comenta com você.</b>
          A lista de quem mais comenta nos seus posts, por conta. As outras ferramentas mostram os
          comentários pra você responder; aqui eles viram um público recorrente, com nome e
          frequência.
        </li>
        <li>
          <b>Arrastar a grade sem inventar data.</b>
          Reordenar o feed troca os horários entre si: o conjunto de datas continua o mesmo, só muda
          qual peça ocupa cada uma. Você decide a estética sem remarcar nada.
        </li>
        <li>
          <b>Legenda sugerida no seu tom.</b>
          Escreva uma linha do que quer dizer e receba três opções. Ela lê os seus posts que mais
          engajaram naquele pilar, então sai parecida com o que já funciona no seu perfil, não com
          texto de robô.
        </li>
      </ul>
    </div>
  </div>
</section>

<section class="sec" id="perguntas">
  <div class="wrap">
    <p class="eyebrow" data-reveal>Antes de começar</p>
    <h2 data-reveal style="--d:60ms">Perguntas frequentes</h2>
    <!-- Duas colunas. A lista tinha teto de 780px numa página de 1200, então sobrava um terço de
         branco à direita que lia como erro de layout. O que entra ali não é enfeite: é a saída pra
         quem NÃO achou a própria pergunta na lista, que é justamente a pessoa que ia embora. -->
    <div class="faq-grid">
      <div class="faq">
        ${FAQ.map(
          (f, i) =>
            `<details data-reveal style="--d:${i * 55}ms"><summary>${f.q}</summary><div class="ans"><div><p>${f.a}</p></div></div></details>`
        ).join('')}
      </div>
      <!-- Gruda no topo enquanto a lista rola: quem abre a quarta pergunta e continua sem resposta
           não precisa voltar ao começo pra achar como perguntar. -->
      <aside class="faq-ajuda" data-reveal style="--d:120ms">
        ${lensSvg()}
        <h3>Não achou a sua?</h3>
        <!-- A frase anterior era "quem lê é uma pessoa, não um formulário". Ela deixou de ser
             verdade no instante em que o botão passou a abrir o atendente, que é IA: prometer
             pessoa e entregar máquina é o tipo de quebra que a pessoa perdoa menos que a própria
             máquina. O caminho humano continua existindo, logo abaixo e dito com todas as letras. -->
        <p>Pergunte aqui e a resposta vem na hora.</p>
        <button class="cta sm destaque" type="button" id="faq-chat">Perguntar agora</button>
      </aside>
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
    <p class="lede" data-reveal style="--d:60ms">O plano gratuito não expira: 1 conta conectada e 5 posts por mês, sem cartão e sem fidelidade. Cresceu, você assina.</p>
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
      <b>ATENTA!</b>: agendamento e planejamento de feed para Instagram, Facebook, YouTube,
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
      </ul>
    </div>
  </div>
  <!-- Razão social e CNPJ ficam nos Termos de Serviço, não aqui: a razão social de um MEI é o nome
       civil completo da pessoa, e o rodapé de toda página o deixaria exposto à toa. A identificação
       do fornecedor que o Decreto 7.962/2013 pede continua cumprida — só num clique de distância.
       O ano sai de new Date() porque a página é montada por requisição: número fixo aqui envelhece
       calado e faz o site parecer abandonado. -->
  <div class="legal">
    <div class="wrap">
      © ${new Date().getFullYear()} <b>ATENTA!</b>. Um produto desenhado e desenvolvido com amor pelo
      <a href="https://omangue.co">Estúdio Mangue</a>.
    </div>
  </div>
</footer>

<!-- ATENDENTE
     Fica fora de <main> e depois do rodapé porque não é conteúdo da página: é uma ajuda que aparece
     por cima. Nasce escondido (sem a classe .in) e o JS o revela por tempo de leitura ou por
     rolagem — ver o bloco "Atendente" em SCRIPT.

     Os ATALHOS existem pra vencer o campo em branco. Um chat que abre com um cursor piscando e nada
     mais transfere pra pessoa o trabalho de descobrir o que dá pra perguntar, e a maioria fecha sem
     escrever. As três são as dúvidas que mais aparecem antes de alguém criar conta. -->
<!-- Botão redondo com balão e interrogação, sem rótulo escrito. O desenho já diz "dúvida" sozinho,
     e a pílula com texto cobria um pedaço grande da tela no celular, justamente por cima dos cards
     de preço. O nome acessível continua existindo no aria-label e no title: quem usa leitor de tela
     ou passa o mouse ouve/lê "Tirar uma dúvida", só não ocupa espaço para quem já entendeu o ícone. -->
<button id="at-fab" class="at-fab" type="button" aria-expanded="false" aria-controls="at-painel"
        aria-label="Tirar uma dúvida" title="Tirar uma dúvida">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M20.6 11.5a8.4 8.4 0 0 1-9 8.4 8.4 8.4 0 0 1-3.8-.9L3.4 20.6l1.6-4.4a8.4 8.4 0 0 1-.9-3.8 8.4 8.4 0 0 1 8.4-9 8.4 8.4 0 0 1 8.1 8.1z"/>
    <path d="M9.9 9.2a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.6-2.5 2.6"/>
    <path d="M12.4 15.7h.01"/>
  </svg>
</button>
<div id="at-painel" class="at-painel" role="dialog" aria-label="Tirar uma dúvida sobre o ATENTA!">
  <div class="at-topo">
    <b>Perguntar sobre o ATENTA!</b>
    <button id="at-fechar" type="button" aria-label="Fechar">✕</button>
  </div>
  <div id="at-conversa" class="at-conversa">
    <div class="at-bolha ela">Oi! Pergunte o que quiser sobre planos, redes ou como funciona.</div>
    <div id="at-atalhos" class="at-atalhos">
      <button class="at-atalho" type="button">Preciso colocar cartão para começar?</button>
      <button class="at-atalho" type="button">Quais redes posso conectar?</button>
      <button class="at-atalho" type="button">Quanto custa o plano pago?</button>
    </div>
  </div>
  <form id="at-linha" class="at-linha">
    <input id="at-campo" type="text" maxlength="400" placeholder="Escreva a sua dúvida" autocomplete="off">
    <button type="submit" aria-label="Enviar">→</button>
  </form>
  <!-- Dizer que é máquina fica; um atendente que se passa por pessoa queima a confiança quando erra.
       O CONVITE PRO E-MAIL saiu: oferecido ali, ele virava a saída fácil pra pergunta que o próprio
       atendente responderia, e cada uma dessas vira um e-mail pra responder na mão. O endereço
       continua aparecendo QUANDO FAZ FALTA — na resposta em que o modelo admite não saber, e no
       rodapé do site, onde é exigência legal. -->
  <p class="at-rodape">Respostas por IA, com base nesta página.</p>
</div>

</body>
</html>`;
}
