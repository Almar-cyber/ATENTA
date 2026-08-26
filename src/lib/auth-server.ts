// Autenticação de verdade: contas, sessões, senha com hash e recuperação — via better-auth.
//
// POR QUE UMA BIBLIOTECA E NÃO CÓDIGO NOSSO: hash de senha, token de sessão, expiração, token de
// recuperação de uso único e proteção contra timing são justamente onde vulnerabilidade nasce.
// Nada aqui é escrito à mão; o que este arquivo faz é configurar uma lib mantida.
//
// POR QUE UMA FÁBRICA E NÃO UM SINGLETON: no Worker o `env` (e portanto o binding do D1 e os
// secrets) só existe dentro da requisição. Criar a instância no topo do módulo não teria como
// receber o banco. O custo é montar o objeto por requisição, que é barato perto de uma consulta.
//
// D1 é suporte nativo desde a 1.5 — passa-se o binding direto, sem adaptador. Ressalva que vale
// lembrar: D1 não tem transação interativa, então a lib usa batch() para atomicidade.
import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { signupIsOpen } from './env.js';
import { emailRedefinirSenha, enviarEmail } from './email.js';
import type { Env } from './env.js';

/**
 * Este e-mail pode criar conta agora?
 *
 * Com SIGNUP_MODE=open, sim — é o estado final, depois do App Review. Enquanto isso o padrão é
 * fechado: só quem está em `signup_invites`. O padrão é o modo restritivo de propósito — esquecer
 * de configurar deve travar o cadastro, não escancará-lo.
 */
async function canSignUp(email: string, env: Env): Promise<boolean> {
  if (signupIsOpen(env)) return true;
  const row = await env.DB.prepare(`select email from signup_invites where email = ?`)
    .bind(email.toLowerCase())
    .first<{ email: string }>();
  return !!row;
}

/**
 * Instância do better-auth para ESTA requisição.
 *
 * `baseURL` sai da própria URL da requisição de propósito: o app roda em três origens diferentes
 * (atenta.omangue.co, o *.workers.dev e o localhost do `wrangler dev`), e fixar uma delas faria os
 * links de e-mail e o cookie apontarem para o lugar errado nas outras duas.
 */
export function createAuth(request: Request, env: Env) {
  const origin = new URL(request.url).origin;

  return betterAuth({
    database: env.DB,
    baseURL: origin,
    basePath: '/api/auth',
    // Sem o secret o better-auth cai num valor de desenvolvimento — que assinaria sessões com uma
    // chave conhecida. Melhor falhar alto na subida do que rodar inseguro em silêncio.
    secret: env.AUTH_SECRET,
    trustedOrigins: [origin],

    emailAndPassword: {
      enabled: true,
      // Continua desligada mesmo com o envio funcionando. Ligar transformaria toda conta nova em
      // refém da entrega do e-mail — e o cadastro hoje é por convite, então quem chega já foi
      // conferido por outro caminho. Quando o cadastro abrir, aí sim vale reavaliar.
      requireEmailVerification: false,
      minPasswordLength: 8,

      /**
       * O e-mail de "esqueci minha senha".
       *
       * Sem isto, o better-auth gerava o token e não mandava nada: a tela dizia "o link chega em
       * instantes" e não chegava nunca — pior que não ter o recurso, porque a pessoa espera. Era a
       * pendência mais antiga do projeto, e a que fazia esquecer a senha significar perder a conta.
       *
       * Falha de envio NÃO derruba a requisição: a resposta ao cliente é a mesma exista ou não a
       * conta (ver o toast em AuthView), então lançar aqui vazaria, pelo erro HTTP, quais e-mails
       * têm cadastro.
       */
      sendResetPassword: async ({ user, url }) => {
        const { assunto, html } = emailRedefinirSenha(url);
        await enviarEmail(env, { para: user.email, assunto, html });
      },
    },

    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 dias
      updateAge: 60 * 60 * 24, // renova a sessão no máximo 1x/dia
    },

    user: {
      additionalFields: {
        // As escolhas do avatar (Open Peeps) em JSON — ver migração 0020.
        //
        // Declarado aqui pra viajar junto do `get-session`: o cabeçalho já lê o usuário de lá, e
        // sem isto precisaria de uma segunda chamada só pra saber que cara desenhar.
        //
        // `input: false` é o que importa em segurança: sem ele o campo entraria pelo corpo do
        // sign-up e do update-user, e qualquer um gravaria string arbitrária no lugar. Quem escreve
        // é só o nosso PUT /api/profile/avatar, que valida variante por variante.
        avatar: { type: 'string', required: false, input: false },
      },
    },

    databaseHooks: {
      user: {
        create: {
          // O portão do convite mora AQUI, e não numa checagem antes de chamar o handler, porque
          // este é o único ponto por onde toda criação de usuário passa — hoje e-mail+senha,
          // amanhã login social. Um `if` na rota de sign-up seria contornável pela próxima rota
          // que criasse conta.
          before: async (user) => {
            if (await canSignUp(user.email, env)) return;
            throw new APIError('FORBIDDEN', {
              message:
                'O cadastro está fechado durante os testes. Se você recebeu um convite, use o mesmo e-mail que foi convidado.',
            });
          },
          // Marca o convite como usado só DEPOIS da conta existir: se a criação falhar no meio, o
          // convite continua valendo em vez de queimar sem ter virado conta.
          after: async (user) => {
            await env.DB.prepare(
              `update signup_invites set used_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') where email = ? and used_at is null`
            )
              .bind(user.email.toLowerCase())
              .run();
          },
        },
      },
    },

    advanced: {
      // Cookie de sessão em HTTPS. O `wrangler dev` local serve HTTP, e aí `secure` impediria o
      // navegador de guardá-lo — daí a exceção explícita ao localhost.
      useSecureCookies: origin.startsWith('https://'),
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
