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

export function renderPrivacyPolicy(env: Env): Promise<string> {
  return renderLegalPage(
    env,
    'Política de Privacidade',
    'Política de Privacidade',
    `<h1>ATENTA!</h1>
<p>ATENTA! é uma ferramenta pessoal de agendamento de posts, criada por Estúdio Mangue
(omangue.co) e operada por ALMAR para publicar nas suas próprias contas do YouTube, LinkedIn,
Facebook, Instagram, Pinterest e TikTok. Não é um serviço oferecido a terceiros nem a outros
usuários.</p>

<h2>Dados coletados</h2>
<ul>
<li>Tokens de acesso/atualização (OAuth) das contas conectadas pelo próprio proprietário.</li>
<li>Metadados dos posts agendados (legenda, horário, plataforma de destino).</li>
</ul>

<h2>Como os dados são armazenados</h2>
<p>Os tokens são criptografados (AES-256-GCM) antes de serem salvos num banco de dados privado
(Cloudflare D1), acessível apenas pelo proprietário da ferramenta.</p>

<h2>O que NÃO fazemos</h2>
<ul>
<li>Não compartilhamos, vendemos ou usamos esses dados para publicidade.</li>
<li>Não coletamos dados de nenhum outro usuário ou visitante.</li>
</ul>

<h2>Retenção</h2>
<p>Os tokens ficam armazenados até o proprietário revogar o acesso do app ou remover a conta da
ferramenta.</p>`
  );
}

export function renderTermsOfService(env: Env): Promise<string> {
  return renderLegalPage(
    env,
    'Termos de Serviço',
    'Termos de Serviço',
    `<h1>ATENTA!</h1>
<p>ATENTA! é uma ferramenta pessoal de agendamento de posts, criada por Estúdio Mangue
(omangue.co) e operada exclusivamente por ALMAR para publicar nas suas próprias contas do
YouTube, LinkedIn, Facebook, Instagram, Pinterest e TikTok. Não é um serviço oferecido a
terceiros, não tem outros usuários e não pode ser contratado ou acessado por ninguém além do
proprietário.</p>

<h2>Uso</h2>
<p>A ferramenta agenda e publica conteúdo (texto, imagem e vídeo) nas contas conectadas pelo
próprio proprietário, respeitando os termos de uso e as políticas de conteúdo de cada plataforma
(YouTube, LinkedIn, Facebook, Instagram, Pinterest, TikTok).</p>

<h2>Responsabilidade</h2>
<p>O proprietário é o único responsável pelo conteúdo publicado através da ferramenta. Não há
garantia de disponibilidade contínua do serviço.</p>

<h2>Alterações</h2>
<p>Estes termos podem ser atualizados a qualquer momento, sem aviso prévio, dado que esta é uma
ferramenta de uso pessoal e não comercial.</p>`
  );
}
