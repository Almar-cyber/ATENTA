// D1Database / R2Bucket / ScheduledEvent / ExecutionContext types come from
// @cloudflare/workers-types (see tsconfig.json "types"), no import needed.
export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;

  // Workers AI (wrangler.toml [ai]) — geração de legenda, src/lib/legenda.ts. Opcional no tipo
  // porque os testes montam Env sem ele: sem o binding, a rota responde "indisponível" em vez de
  // estourar, e todo o resto do app segue igual.
  AI?: Ai;

  // Limite por IP do atendente público da landing (wrangler.toml [[ratelimits]]). Opcional pelo
  // mesmo motivo do AI: os testes montam Env sem ele, e ausente o endpoint segue funcionando com
  // o teto global do D1 como única defesa.
  ATENDENTE_LIMITE?: RateLimit;

  // Limite por IP das rotas de credencial (/api/auth/sign-in, sign-up, forget-password). Opcional
  // pelo mesmo motivo dos outros bindings: os testes montam Env sem ele.
  LOGIN_LIMITE?: RateLimit;

  // Static-assets binding (wrangler.toml [assets]) serving the built React SPA from ./dist.
  // The Worker owns /api, /oauth and /privacy and delegates everything else to this.
  ASSETS: Fetcher;

  // Plain (non-secret) var — see wrangler.toml [vars]. Base URL of the custom R2 domain used to
  // build media_assets.public_url on upload; empty/undefined leaves public_url null (media still
  // uploads fine, it just isn't usable by platforms that require a fetchable URL — see README).
  MEDIA_PUBLIC_BASE_URL?: string;

  // Quem pode criar conta. Ausente ou qualquer outro valor = fechado: só e-mails na tabela
  // signup_invites (fase de testadores). 'open' libera pra qualquer um — é a virada de chave
  // depois do App Review. O padrão restritivo é de propósito: esquecer de configurar deve travar
  // o cadastro, não escancarar.
  SIGNUP_MODE?: 'open' | string;

  // Envio de e-mail transacional (redefinição de senha, vaga da lista de espera) pela Resend.
  // Ausente = envio desligado, e os fluxos que dependem dele apenas registram no log em vez de
  // falhar. Ver src/lib/email.ts, inclusive a nota sobre a Resend virar operadora de dados.
  RESEND_API_KEY?: string;
  // Remetente. Precisa ser de um domínio VERIFICADO na Resend, senão ela recusa o envio.
  EMAIL_FROM?: string;


  // Wrangler secrets (`wrangler secret put NAME`) — never committed, never in .env.
  TOKEN_ENCRYPTION_KEY: string;

  // Chave que assina os cookies de sessão (src/lib/auth-server.ts). Sem ela o better-auth cai num
  // valor de desenvolvimento conhecido publicamente — qualquer um forjaria uma sessão. Gerar com
  // `openssl rand -base64 32` e gravar com `wrangler secret put AUTH_SECRET`.
  AUTH_SECRET: string;

  // Opcional: webhook (ntfy.sh ou Discord) pra onde o poller empurra alertas de falha/reauth/
  // ambíguo/timeout — os Cron Triggers não têm o e-mail de "workflow falhou" que o GitHub Actions
  // teria. Sem o secret, o alerta é só log (comportamento anterior). Ver src/lib/notify.ts.
  ALERT_WEBHOOK_URL?: string;

  YOUTUBE_CLIENT_ID: string;
  YOUTUBE_CLIENT_SECRET: string;

  LINKEDIN_CLIENT_ID: string;
  LINKEDIN_CLIENT_SECRET: string;

  META_APP_ID: string;
  META_APP_SECRET: string;

  PINTEREST_CLIENT_ID: string;
  PINTEREST_CLIENT_SECRET: string;

  TIKTOK_CLIENT_KEY: string;
  TIKTOK_CLIENT_SECRET: string;
}

/**
 * O cadastro está aberto pra qualquer um?
 *
 * Mora aqui, junto da variável, porque três lugares precisam da MESMA resposta e divergir entre eles
 * é o bug caro: o portão real (`canSignUp`, em auth-server.ts), a landing (que promete "comece
 * grátis") e a tela de entrar (que escolhe entre criar conta e lista de espera). Se a landing
 * convidasse e o portão recusasse, a pessoa descobriria depois de digitar tudo.
 */
export function signupIsOpen(env: Env): boolean {
  return env.SIGNUP_MODE === 'open';
}
