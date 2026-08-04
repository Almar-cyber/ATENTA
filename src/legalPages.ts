// Standalone Privacy/Terms pages for platform app-review (Pinterest, TikTok, ...), styled with the
// ATENTA! brand (web/design.md) — brutalista: fundo branco, texto preto, tinta roxa (--brand),
// destaque amarelo (--primary). Self-contained (no external requests) since these are fetched
// directly by review crawlers, not through the browser's normal asset loading — the wordmark PNG
// is pulled once from the ASSETS binding (bypasses the dashboard auth gate entirely, since this
// is a direct binding call, not a routed fetch()) and inlined as a data: URI.
import type { Env } from './lib/env.js';

const STYLE = `
  :root { --brand: #52277F; --primary: #FCEC0E; --fg: #111111; --muted: #6b6270; }
  * { box-sizing: border-box; }
  body {
    background: #ffffff;
    color: var(--fg);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, Helvetica, Arial, sans-serif;
    margin: 0;
    line-height: 1.6;
  }
  .wrap { max-width: 720px; margin: 0 auto; padding: 48px 24px 80px; }
  .logo { display: block; height: 48px; width: auto; margin-bottom: 2rem; }
  .card {
    border: 2px solid var(--brand);
    box-shadow: 6px 6px 0 0 var(--brand);
    border-radius: 1rem;
    padding: 2rem;
    background: #ffffff;
  }
  .badge {
    display: inline-block;
    background: var(--primary);
    color: #111111;
    font-weight: 700;
    padding: 0.2em 0.7em;
    border-radius: 999px;
    font-size: 0.8rem;
    margin-bottom: 1rem;
  }
  h1 { font-size: 1.5rem; margin: 0 0 1.5rem; }
  h2 { font-size: 1.05rem; color: var(--brand); margin: 1.75rem 0 0.5rem; }
  p, li { color: var(--fg); }
  ul { margin: 0.25rem 0; padding-left: 1.25rem; }
  .contact { margin-top: 2rem; padding-top: 1.25rem; border-top: 1px solid #e5e0ec; color: var(--muted); }
  a { color: var(--brand); }
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

async function renderLegalPage(env: Env, title: string, badge: string, bodyHtml: string): Promise<string> {
  const logo = await logoDataUri(env);
  const logoHtml = logo ? `<img class="logo" src="${logo}" alt="ATENTA!">` : `<div class="logo">ATENTA!</div>`;
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — ATENTA!</title>
<style>${STYLE}</style>
</head>
<body>
<div class="wrap">
${logoHtml}
<div class="card">
<span class="badge">${badge}</span>
${bodyHtml}
<div class="contact">Criado por Estúdio Mangue (<a href="https://omangue.co">omangue.co</a>) — Contato: <a href="mailto:contato@omangue.co">contato@omangue.co</a></div>
</div>
</div>
</body>
</html>`;
}

// NÃO REMOVA a seção "YouTube" da política de privacidade. Ela não é zelo jurídico opcional: o
// Google EXIGE que app que usa os YouTube API Services declare isso e aponte para os Termos do
// YouTube e para a Política de Privacidade do Google. Sem ela, a verificação do app é reprovada, e
// sem verificação o projeto fica preso no teto vitalício de 100 usuários com a tela de "app não
// verificado" na cara de quem conecta.
//
// ATENÇÃO ao mexer aqui: estas páginas e a landing (src/landingPage.ts) são lidas pelo MESMO
// revisor, na mesma sessão. A versão anterior descrevia o ATENTA! como "ferramenta pessoal,
// operada exclusivamente por ALMAR, sem outros usuários" enquanto a landing vendia plano grátis e
// pago — contradição que reprova submissão. Se o produto mudar de natureza, os dois arquivos mudam
// juntos.

export function renderPrivacyPolicy(env: Env): Promise<string> {
  return renderLegalPage(
    env,
    'Política de Privacidade',
    'Política de Privacidade',
    `<h1>Política de Privacidade do ATENTA!</h1>
<p>O ATENTA! é uma plataforma de agendamento e planejamento de publicações para YouTube, LinkedIn,
Facebook, Instagram, Pinterest e TikTok, operada por <b>Estúdio Mangue</b> (omangue.co). Esta
política explica quais dados tratamos, por quê, e como você exerce seus direitos.</p>

<h2>Dados que tratamos</h2>
<ul>
<li><b>Cadastro:</b> seu e-mail e os dados necessários para manter sua conta e o plano contratado.</li>
<li><b>Contas sociais conectadas:</b> os tokens de acesso/atualização (OAuth) que <i>você</i>
autoriza, mais o identificador e o nome público de cada conta, para exibirmos qual perfil está
conectado.</li>
<li><b>Conteúdo que você agenda:</b> legendas, títulos, imagens e vídeos, além da data e das contas
de destino.</li>
<li><b>Métricas das suas publicações:</b> curtidas, comentários, alcance, visualizações e contagem
de seguidores, lidos das APIs oficiais de cada rede, para montar seus indicadores.</li>
</ul>
<p><b>Nunca pedimos nem armazenamos a senha das suas redes sociais.</b> A autorização acontece na
tela de consentimento da própria plataforma.</p>

<h2>Para que usamos</h2>
<p>Exclusivamente para prestar o serviço que você contratou: publicar o conteúdo que você agendou,
nas contas que você escolheu, no horário que você marcou, e mostrar os resultados dessas
publicações no seu painel. Não usamos seus dados para publicidade, nem para treinar modelos, nem
para qualquer finalidade que você não tenha solicitado.</p>

<h2>Como armazenamos</h2>
<p>Os tokens OAuth são criptografados com <b>AES-256-GCM</b> antes de gravados; a chave existe
apenas como secret do servidor e nunca é devolvida por nenhum endpoint da API. Os dados ficam na
infraestrutura da <b>Cloudflare</b> (banco D1 e armazenamento de arquivos R2), nosso único
subprocessador de infraestrutura. Cada conta só enxerga os próprios dados.</p>

<h2>Com quem compartilhamos</h2>
<ul>
<li><b>Com as redes sociais que você conectou</b> — e só o necessário para publicar: o conteúdo do
post em si.</li>
<li><b>Com a Cloudflare</b>, como infraestrutura de hospedagem e banco de dados.</li>
</ul>
<p>Não vendemos, alugamos nem cedemos seus dados a ninguém, em nenhuma hipótese.</p>

<h2>YouTube</h2>
<p>Para publicar e ler as métricas dos seus vídeos, o ATENTA! usa os <b>YouTube API Services</b>. Ao
conectar sua conta do YouTube, você concorda com os
<a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener">Termos de Serviço do YouTube</a>,
e o tratamento dos seus dados pelo Google segue a
<a href="https://policies.google.com/privacy" target="_blank" rel="noopener">Política de Privacidade do Google</a>.</p>
<p>Você pode revogar o acesso do ATENTA! aos seus dados do YouTube a qualquer momento na
<a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener">página de permissões da sua Conta Google</a>
(Segurança → Apps de terceiros com acesso à conta).</p>

<h2>Por quanto tempo guardamos</h2>
<ul>
<li><b>Tokens:</b> até você desconectar a conta aqui, revogar o acesso nas configurações da rede
social, ou encerrar sua conta no ATENTA!.</li>
<li><b>Arquivos de mídia:</b> apagados automaticamente do nosso armazenamento <b>30 dias após a
publicação</b> — a partir daí o arquivo vive na própria rede social, e é de lá que o painel o
exibe. Mídia de post ainda não publicado não é apagada.</li>
<li><b>Posts e métricas:</b> enquanto sua conta existir, ou até você excluí-los.</li>
</ul>

<h2>Seus direitos (LGPD)</h2>
<p>A Lei Geral de Proteção de Dados (Lei 13.709/2018) garante que você possa confirmar o
tratamento, acessar, corrigir, portar, e pedir a <b>eliminação</b> dos seus dados, além de revogar
consentimento a qualquer momento. No painel você já desconecta contas e exclui posts sozinho; para
apagar tudo, veja <a href="/data-deletion">como excluir seus dados</a> ou escreva para
contato@omangue.co. Respondemos em até 15 dias.</p>

<h2>Alterações</h2>
<p>Se mudarmos algo relevante nesta política, avisamos por e-mail antes de a mudança valer.</p>`
  );
}

export function renderTermsOfService(env: Env): Promise<string> {
  return renderLegalPage(
    env,
    'Termos de Serviço',
    'Termos de Serviço',
    `<h1>Termos de Serviço do ATENTA!</h1>
<p>O ATENTA! é uma plataforma de agendamento e planejamento de publicações para YouTube, LinkedIn,
Facebook, Instagram, Pinterest e TikTok, operada por <b>Estúdio Mangue</b> (omangue.co). Ao criar
uma conta, você concorda com estes termos.</p>

<h2>O que o serviço faz</h2>
<p>Você conecta suas contas de rede social, monta a publicação (legenda, imagens ou vídeo, formato
e data) e o ATENTA! publica no horário marcado, através das APIs oficiais de cada plataforma.
Depois, lê as métricas dessas publicações para montar seus indicadores.</p>

<h2>Sua conta</h2>
<p>Você é responsável por manter suas credenciais em segurança e por tudo que for publicado a
partir da sua conta. Só conecte perfis que você tem autorização para operar.</p>

<h2>Conteúdo</h2>
<p>O conteúdo que você agenda é seu, e você continua sendo o único responsável por ele —
inclusive por respeitar os termos de uso e as políticas de conteúdo de cada rede social, além da
legislação aplicável e de direitos de terceiros. Não reivindicamos propriedade sobre nada do que
você publica. Podemos suspender contas que usem o serviço para spam, fraude ou conteúdo ilegal.</p>

<h2>Planos e pagamento</h2>
<p>O plano gratuito é permanente e não exige cartão, dentro dos limites publicados na página
inicial. Recursos além desses limites dependem de assinatura paga, informada antes da contratação.
Se a assinatura for cancelada ou encerrada, a conta volta ao plano gratuito e o conteúdo já criado
continua acessível — apenas os limites do plano gratuito voltam a valer.</p>

<h2>Cancelamento</h2>
<p>Você pode desconectar suas contas e encerrar a sua a qualquer momento, sem multa nem fidelidade
(veja <a href="/data-deletion">exclusão de dados</a>).</p>

<h2>Limites de responsabilidade</h2>
<p>Fazemos o possível para que cada publicação saia no horário, mas dependemos das APIs das redes
sociais, que podem ficar indisponíveis, mudar regras ou recusar conteúdo por decisão delas. O
serviço é oferecido "como está", sem garantia de disponibilidade ininterrupta, e não respondemos
por lucros cessantes decorrentes de falha de publicação.</p>

<h2>Alterações</h2>
<p>Podemos atualizar estes termos; mudanças relevantes são avisadas por e-mail antes de valer. O
foro é o da comarca do Recife/PE, e aplica-se a legislação brasileira.</p>`
  );
}

// Página EXIGIDA pelo Meta: o campo "Exclusão de dados do usuário" só aceita um callback de
// exclusão (endpoint que a Meta chama) ou uma URL de instruções. Esta é a URL de instruções — sem
// ela o app fica inelegível para submissão, e o valor que estava lá apontava para facebook.com.
export function renderDataDeletion(env: Env): Promise<string> {
  return renderLegalPage(
    env,
    'Exclusão de dados',
    'Exclusão de dados',
    `<h1>Como excluir seus dados do ATENTA!</h1>
<p>Você decide o que fica e o que sai, e não precisa pedir autorização para nada disso.</p>

<h2>1. Desconectar uma rede social</h2>
<p>No painel, abra <b>Conexões</b> e remova a conta. Isso apaga o token de acesso daquela rede do
nosso banco imediatamente. As publicações que já saíram continuam no ar na rede social — quem
controla isso é você, por lá.</p>
<p>Você também pode cortar o acesso pelo lado da plataforma, sem passar por aqui:</p>
<ul>
<li><b>Facebook / Instagram:</b> Configurações → Central de Contas → Aplicativos e sites</li>
<li><b>YouTube (Google):</b> myaccount.google.com → Segurança → Apps de terceiros</li>
<li><b>LinkedIn:</b> Configurações → Privacidade de dados → Serviços de terceiros permitidos</li>
<li><b>Pinterest:</b> Configurações → Segurança → Apps</li>
<li><b>TikTok:</b> Configurações → Segurança → Gerenciar permissões de apps</li>
</ul>

<h2>2. Apagar publicações e mídia</h2>
<p>Cada post agendado pode ser excluído no painel, o que remove também os arquivos ligados a ele.
Arquivos de posts já publicados são apagados automaticamente do nosso armazenamento 30 dias depois
da publicação.</p>

<h2>3. Excluir a conta inteira</h2>
<p>Escreva para <b><a href="mailto:contato@omangue.co">contato@omangue.co</a></b> a partir do e-mail
cadastrado, com o assunto <b>"Excluir minha conta"</b>. Apagamos tudo — cadastro, tokens, posts,
arquivos e métricas — em até <b>15 dias</b>, e confirmamos por e-mail quando terminar. Não é
preciso justificar o pedido.</p>
<p>Se você não tiver mais acesso ao e-mail cadastrado, escreva do endereço que puder e informe
quais contas sociais estavam conectadas, para conseguirmos localizar o cadastro.</p>

<h2>O que não conseguimos apagar</h2>
<p>Publicações que já foram ao ar pertencem à sua conta na rede social e só podem ser removidas lá
— nós não temos permissão para apagar conteúdo do seu perfil.</p>`
  );
}
