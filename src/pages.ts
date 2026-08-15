// Public HTML pages served by the Worker's fetch() handler.
//
// The privacy policy exists because every platform's app review asks for a publicly reachable
// policy URL, and Google's OAuth verification for the sensitive `youtube.upload` scope explicitly
// requires the policy to describe the data protection mechanisms applied to that data — encryption
// in transit and at rest, key handling, access control, retention and deletion. Keep this page in
// sync with the code it describes: if token storage, scopes, or retention change, change this too.

export const APP_NAME = 'social-scheduler';
// Contact channel published in the policy (§6 deletion requests, §11 contact) and on the home
// page. Platform reviews expect a reachable address here — keep it one that's actually monitored.
export const CONTACT_EMAIL = 'contato@omangue.co';
export const POLICY_LAST_UPDATED = '2026-08-15';

const STYLE = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0 auto; padding: 2.5rem 1.25rem 6rem; max-width: 46rem;
    font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #1a1a1a; background: #fff;
  }
  h1 { font-size: 1.75rem; line-height: 1.25; margin: 0 0 .35rem; }
  h2 { font-size: 1.2rem; margin: 2.25rem 0 .6rem; }
  h3 { font-size: 1rem; margin: 1.5rem 0 .4rem; }
  p, li { margin: .6rem 0; }
  ul { padding-left: 1.25rem; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .875em;
         background: rgba(127,127,127,.16); padding: .1em .35em; border-radius: 3px; }
  a { color: #0b57d0; }
  .meta { color: #5f6368; font-size: .9rem; margin: 0 0 1.5rem; }
  .lang { border-top: 1px solid rgba(127,127,127,.35); margin-top: 3.5rem; padding-top: .5rem; }
  table { border-collapse: collapse; width: 100%; margin: .8rem 0; font-size: .93rem; display: block; overflow-x: auto; }
  th, td { border: 1px solid rgba(127,127,127,.35); padding: .45rem .6rem; text-align: left; vertical-align: top; }
  @media (prefers-color-scheme: dark) {
    body { color: #e8eaed; background: #16181c; }
    .meta { color: #9aa0a6; }
    a { color: #8ab4f8; }
  }
`;

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${STYLE}</style>
</head>
<body>
${body}
</body>
</html>`;
}

export function homePage(): string {
  return page(
    `${APP_NAME}`,
    `<h1>${APP_NAME}</h1>
<p class="meta">Personal social media post scheduler.</p>
<p>
  ${APP_NAME} is a single-user tool that publishes posts the operator has written and scheduled in
  advance to their own social media accounts on YouTube, LinkedIn, Instagram, Facebook, Pinterest
  and TikTok. It has no sign-up, no public interface and no users other than its operator.
</p>
<p>
  Automated endpoints on this domain: <code>/oauth/callback/&lt;platform&gt;</code>, which receives
  the OAuth redirect when the operator connects one of their own accounts.
</p>
<p><a href="/privacy">Privacy Policy</a> &middot; <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></p>`
  );
}

export function privacyPage(): string {
  return page(
    `Privacy Policy — ${APP_NAME}`,
    `<h1>Privacy Policy</h1>
<p class="meta">${APP_NAME} &middot; Last updated: ${POLICY_LAST_UPDATED}</p>

<h2>1. Who this policy covers</h2>
<p>
  ${APP_NAME} ("the app") is a personal, single-user scheduling tool. It publishes posts that its
  operator has written in advance to that operator's own social media accounts. It offers no
  sign-up, has no end users other than the operator, and does not collect data from visitors to
  this site. This policy describes what data the app handles, how it is protected, how long it is
  kept, and how access can be revoked. Privacy questions and requests are handled through the
  contact address in section 11.
</p>

<h2>2. Data the app accesses and why</h2>
<p>
  The app accesses only what is needed to publish a post on the operator's behalf. It requests the
  narrowest scope each platform offers for that purpose, and it never requests read access to
  audience data, analytics, contacts, messages, or viewing history.
</p>
<table>
  <tr><th>Platform</th><th>Scopes requested</th><th>Purpose</th></tr>
  <tr>
    <td>YouTube (Google)</td>
    <td><code>https://www.googleapis.com/auth/youtube.upload</code></td>
    <td>Upload a video the operator has scheduled to the operator's own channel. This is an
        upload-only scope: it grants no ability to read channel analytics, subscriber lists,
        comments, watch history, or any other viewer data.</td>
  </tr>
  <tr>
    <td>LinkedIn</td>
    <td><code>openid</code>, <code>profile</code>, <code>w_member_social</code></td>
    <td>Identify which member the post belongs to and publish it.</td>
  </tr>
  <tr>
    <td>Facebook / Instagram (Meta)</td>
    <td><code>pages_show_list</code>, <code>pages_read_engagement</code>,
        <code>pages_manage_posts</code>, <code>instagram_basic</code>,
        <code>instagram_content_publish</code>, <code>business_management</code></td>
    <td>Publish to the operator's own Facebook Page and linked Instagram Business account.</td>
  </tr>
  <tr>
    <td>Pinterest</td>
    <td><code>boards:read</code>, <code>pins:read</code>, <code>pins:write</code></td>
    <td>List the operator's boards to pick a destination and create Pins.</td>
  </tr>
  <tr>
    <td>TikTok</td>
    <td><code>user.info.basic</code>, <code>video.upload</code>, <code>video.publish</code></td>
    <td>Upload and publish a video to the operator's own account.</td>
  </tr>
</table>

<h3>What is actually stored</h3>
<ul>
  <li><strong>OAuth credentials</strong> — the access token and, where the platform issues one, the
      refresh token, plus the token expiry timestamp. These are the sensitive data this policy is
      primarily concerned with.</li>
  <li><strong>Account identifiers</strong> — the platform-issued account identifier (channel ID,
      member URN, Page ID, Instagram Business ID, TikTok open ID) and a display name the operator
      types in themselves, used to label which account a scheduled post targets.</li>
  <li><strong>Post content the operator authored</strong> — captions, titles, publishing options,
      scheduled times, per-post status and error messages, and the media files to be published.</li>
</ul>
<p>
  Nothing else is retrieved or stored. In particular, the app does not store Google profile
  information, email addresses obtained from any platform, follower or subscriber data, analytics,
  or content belonging to anyone other than the operator.
</p>

<h2>3. How sensitive data is protected</h2>
<p>
  Access and refresh tokens are treated as the app's most sensitive data, and the following
  technical measures apply to them:
</p>
<ul>
  <li><strong>Encryption at rest, at the application layer.</strong> Every token is encrypted with
      <strong>AES-256-GCM</strong> (Web Crypto <code>crypto.subtle</code>) <em>before</em> it is
      written to the database. A fresh, cryptographically random 96-bit initialization vector is
      generated per encryption, and GCM's authentication tag means any tampering with stored
      ciphertext causes decryption to fail rather than yield altered data. The database stores only
      ciphertext and IV — no plaintext token is ever written to storage.</li>
  <li><strong>Key management.</strong> The 256-bit encryption key is generated offline and held
      exclusively as an encrypted Cloudflare Workers secret, injected into the runtime at execution
      time. It is not present in the source code, the git repository, the database, any
      configuration file, or any log. It is write-only in the provider dashboard and cannot be read
      back after being set. Compromise of the database alone therefore does not expose any token.</li>
  <li><strong>Encryption in transit.</strong> All traffic is HTTPS/TLS end to end: the OAuth
      redirect endpoint is served over TLS only, every call to a platform API is HTTPS, and the
      database and object storage are reached over TLS. The one exception by design is Google's
      installed-app OAuth flow, whose redirect is a loopback address
      (<code>http://127.0.0.1</code>) that never leaves the operator's own machine, per Google's
      documented flow for installed applications.</li>
  <li><strong>Infrastructure-level encryption at rest.</strong> The database (Cloudflare D1) and
      media storage (Cloudflare R2) are additionally encrypted at rest by the infrastructure
      provider, underneath the application-layer encryption described above.</li>
  <li><strong>Access control and least privilege.</strong> The app exposes no endpoint that reads,
      returns, or lists stored data: the only public routes are this policy, a static home page,
      and the OAuth redirect handler. There is no admin interface, no API for retrieving posts or
      tokens, and no third-party access. Administrative access to the database is limited to the
      single operator, through a provider account protected by two-factor authentication, using an
      API token scoped to that one database.</li>
  <li><strong>Secrets never logged.</strong> Tokens, ciphertext, the encryption key and platform
      client secrets are never written to logs. Error logs record the platform, an account label,
      and the platform's error message only.</li>
  <li><strong>Secure development practices.</strong> Credentials are provided as runtime secrets;
      local environment files are excluded from version control; the codebase carries no committed
      credentials. Dependencies are kept minimal, and cryptography uses the runtime's standard
      primitives rather than a custom implementation.</li>
  <li><strong>Data minimization.</strong> Only the scopes listed in section 2 are requested, no
      broader scope is retained "just in case", and a single record per platform is kept — a
      re-authentication overwrites the previous credentials rather than accumulating them.</li>
</ul>

<h2>4. Google user data and Limited Use</h2>
<p>
  ${APP_NAME}'s use and transfer of information received from Google APIs adheres to the
  <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services
  User Data Policy</a>, including the Limited Use requirements. Concretely, data obtained through
  Google APIs is used <em>only</em> to upload videos the operator scheduled to the operator's own
  YouTube channel. It is never sold, never transferred to third parties (except as required by law),
  never used for advertising or ad targeting, never used to train generalized or artificial
  intelligence models, and never read by humans except as strictly necessary for security purposes,
  to comply with applicable law, or with the operator's explicit consent.
</p>
<p>
  By using ${APP_NAME} with a YouTube account, the operator is also agreeing to the
  <a href="https://www.youtube.com/t/terms">YouTube Terms of Service</a>. Google's handling of data
  is described in the <a href="https://policies.google.com/privacy">Google Privacy Policy</a>.
</p>

<h2>5. Sharing and disclosure</h2>
<p>
  No data is sold, rented, or shared with third parties for their own purposes. Data is disclosed
  only to: (a) the social media platform the post is being published to, which is the entire point
  of the app and only ever the content the operator scheduled for that platform; and (b) the
  infrastructure provider that hosts the app's compute, database, and object storage
  (Cloudflare, Inc.), acting as a processor. Data may additionally be disclosed if required by
  applicable law.
</p>

<h2>6. Retention and deletion</h2>
<ul>
  <li><strong>Tokens</strong> are retained only while the corresponding account remains connected.
      Re-authenticating an account overwrites the stored credentials; disconnecting an account
      deletes them.</li>
  <li><strong>Scheduled posts and their media</strong> are retained while the schedule is pending
      and afterwards as the operator's own record of what was published, until the operator deletes
      them.</li>
  <li><strong>Deletion.</strong> Because the operator is the sole user and controls the underlying
      infrastructure directly, deletion is immediate and complete: removing the account record
      destroys the stored ciphertext, and removing a media object deletes it from object storage.
      Deletion requests, or questions about them, can be sent to
      <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a> and will be handled within 30 days.</li>
</ul>

<h2>7. Revoking access</h2>
<p>
  Authorization can be withdrawn at any time, independently of the app, from the platform's own
  settings. Revocation immediately invalidates the stored token, and the app can no longer publish
  anything.
</p>
<ul>
  <li>Google / YouTube: <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a></li>
  <li>LinkedIn: Settings &rarr; Data privacy &rarr; Permitted services</li>
  <li>Facebook / Instagram: Settings &rarr; Business integrations</li>
  <li>Pinterest: Settings &rarr; Security &rarr; Apps</li>
  <li>TikTok: Settings and privacy &rarr; Security &amp; permissions &rarr; Manage app permissions</li>
</ul>

<h2>8. Security incidents</h2>
<p>
  If stored credentials were ever believed to be exposed, the response is to revoke every connected
  platform authorization, rotate the encryption key and all platform client secrets, and re-issue
  fresh credentials. Any affected party would be notified without undue delay, in line with
  applicable law.
</p>

<h2>9. Children</h2>
<p>
  The app is not directed at children and is not usable by anyone other than its operator, who is
  an adult. No data about children is knowingly collected.
</p>

<h2>10. Changes to this policy</h2>
<p>
  Material changes are published on this page with a revised "Last updated" date. The current
  version is always available at this URL.
</p>

<h2>11. Contact</h2>
<p>
  Questions, privacy requests, or deletion requests:
  <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.
</p>

<div class="lang"></div>
<h1>Política de Privacidade</h1>
<p class="meta">${APP_NAME} &middot; Última atualização: ${POLICY_LAST_UPDATED} &middot; Versão em português (a versão em inglês acima é a de referência)</p>

<h2>1. A quem esta política se aplica</h2>
<p>
  O ${APP_NAME} ("o app") é uma ferramenta pessoal de agendamento, de usuário único. O app publica
  posts escritos previamente por quem o opera, nas contas de redes sociais dessa mesma pessoa. Não
  há cadastro, não existem usuários além de quem opera, e nenhum dado é coletado de visitantes deste
  site. Dúvidas e pedidos relativos a privacidade são tratados pelo endereço de contato da seção 11.
</p>

<h2>2. Dados acessados e por quê</h2>
<p>
  O app acessa apenas o necessário para publicar um post em nome de quem o opera, sempre pelo escopo
  mais restrito que cada plataforma oferece. No caso do Google, o escopo é
  <code>https://www.googleapis.com/auth/youtube.upload</code> — um escopo somente de envio, que não
  permite ler métricas, inscritos, comentários nem histórico de visualização. Os demais escopos
  estão listados na tabela da versão em inglês.
</p>
<p>São armazenados apenas: credenciais OAuth (access token, refresh token e validade),
  identificadores de conta da plataforma e um nome de exibição digitado por quem opera o app, e o
  conteúdo dos posts criados por essa pessoa (legendas, títulos, opções, horário agendado, status e
  mídia). Nada além disso é obtido ou guardado.</p>

<h2>3. Como os dados sensíveis são protegidos</h2>
<ul>
  <li><strong>Criptografia em repouso, na camada da aplicação.</strong> Todo token é criptografado
      com <strong>AES-256-GCM</strong> (Web Crypto) <em>antes</em> de ser gravado no banco, com IV
      aleatório de 96 bits gerado a cada operação. O banco guarda apenas o texto cifrado e o IV —
      nenhum token em texto claro é gravado em disco.</li>
  <li><strong>Gestão da chave.</strong> A chave de 256 bits é gerada offline e existe apenas como
      secret criptografado do Cloudflare Workers, injetado em tempo de execução. Não está no código,
      no repositório, no banco, em arquivos de configuração nem em logs, e não pode ser lida de
      volta no painel. Ou seja: um vazamento apenas do banco não expõe nenhum token.</li>
  <li><strong>Criptografia em trânsito.</strong> Todo o tráfego usa HTTPS/TLS ponta a ponta. A única
      exceção, por definição do próprio fluxo do Google para aplicativos instalados, é o redirect
      de loopback (<code>http://127.0.0.1</code>), que nunca sai da máquina de quem opera o app.</li>
  <li><strong>Criptografia em repouso da infraestrutura.</strong> Banco (Cloudflare D1) e mídia
      (Cloudflare R2) também são criptografados em repouso pelo provedor, por baixo da criptografia
      da aplicação.</li>
  <li><strong>Controle de acesso e menor privilégio.</strong> O app não expõe nenhum endpoint que
      leia ou devolva dados armazenados: as únicas rotas públicas são esta política, uma página
      inicial estática e o callback OAuth. Não há painel administrativo nem acesso de terceiros. O
      acesso administrativo ao banco é exclusivo de quem opera o app, por conta com autenticação em dois
      fatores e token de API restrito a esse único banco.</li>
  <li><strong>Segredos nunca vão para log.</strong> Tokens, texto cifrado, chave de criptografia e
      client secrets das plataformas nunca são registrados em log.</li>
  <li><strong>Práticas de desenvolvimento.</strong> Credenciais só existem como secrets de runtime,
      arquivos de ambiente locais ficam fora do controle de versão, e a criptografia usa as
      primitivas padrão da plataforma, não implementação própria.</li>
  <li><strong>Minimização.</strong> Somente os escopos listados são solicitados, e há um único
      registro por plataforma — reautenticar sobrescreve as credenciais anteriores.</li>
</ul>

<h2>4. Dados do Google e Uso Limitado</h2>
<p>
  O uso e a transferência de informações recebidas das APIs do Google pelo ${APP_NAME} seguem a
  <a href="https://developers.google.com/terms/api-services-user-data-policy">Política de Dados do
  Usuário dos Serviços de API do Google</a>, incluindo os requisitos de Uso Limitado. Os dados
  obtidos via APIs do Google são usados exclusivamente para enviar os vídeos agendados ao canal do
  YouTube de quem opera o app. Nunca são vendidos, transferidos a terceiros (salvo exigência
  legal), usados para publicidade, usados para treinar modelos de inteligência artificial, nem lidos
  por pessoas — exceto quando estritamente necessário por segurança, por exigência legal ou com
  consentimento explícito de quem opera o app. O uso do app com uma conta do YouTube implica concordância
  com os <a href="https://www.youtube.com/t/terms">Termos de Serviço do YouTube</a>; o tratamento de
  dados pelo Google está descrito na
  <a href="https://policies.google.com/privacy">Política de Privacidade do Google</a>.
</p>

<h2>5. Compartilhamento</h2>
<p>
  Nenhum dado é vendido, alugado ou compartilhado com terceiros para fins próprios deles. Os dados
  só chegam (a) à rede social de destino do post, que é a finalidade do app, e (b) ao provedor de
  infraestrutura que hospeda a aplicação, o banco e a mídia (Cloudflare, Inc.), na condição de
  operador. Pode haver divulgação adicional se exigida por lei.
</p>

<h2>6. Retenção e exclusão</h2>
<p>
  Tokens são mantidos apenas enquanto a conta estiver conectada; reautenticar sobrescreve,
  desconectar apaga. Posts agendados e mídia ficam guardados como registro do que foi publicado até
  que sejam apagados. Como quem opera o app controla a infraestrutura diretamente, a exclusão é
  imediata e completa. Pedidos de exclusão ou dúvidas:
  <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>, respondidos em até 30 dias.
</p>

<h2>7. Revogação de acesso</h2>
<p>
  A autorização pode ser revogada a qualquer momento, direto na plataforma e independentemente do
  app — no caso do Google, em
  <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>. A
  revogação invalida o token imediatamente e o app deixa de conseguir publicar.
</p>

<h2>8. Incidentes de segurança</h2>
<p>
  Havendo suspeita de exposição de credenciais, a resposta é revogar todas as autorizações, girar a
  chave de criptografia e os client secrets, e emitir credenciais novas, com notificação sem demora
  indevida a quem for afetado, conforme a legislação aplicável.
</p>

<h2>9. Crianças</h2>
<p>O app não se destina a crianças e não coleta conscientemente dados de crianças.</p>

<h2>10. Alterações</h2>
<p>
  Mudanças relevantes são publicadas nesta página com nova data de "última atualização". A versão
  vigente está sempre nesta URL.
</p>

<h2>11. Contato</h2>
<p><a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></p>`
  );
}
