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
import type { Env } from './env.js';

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
      // Verificação de e-mail entra junto com o envio (tarefa do Cloudflare Email Service). Ligar
      // antes disso trancaria todo mundo do lado de fora, inclusive a operadora.
      requireEmailVerification: false,
      minPasswordLength: 8,
    },

    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 dias
      updateAge: 60 * 60 * 24, // renova a sessão no máximo 1x/dia
    },

    advanced: {
      // Cookie de sessão em HTTPS. O `wrangler dev` local serve HTTP, e aí `secure` impediria o
      // navegador de guardá-lo — daí a exceção explícita ao localhost.
      useSecureCookies: origin.startsWith('https://'),
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
