import type { Env } from './env.js';
import { createAuth } from './auth-server.js';

// Identidade de quem está usando o app. Ponto ÚNICO onde "quem é o usuário" entra no sistema —
// tudo que precisa saber o dono de um dado chama currentUser(), e daí pra baixo todo handler
// recebe `owner` e TODA query filtra por ele.
//
// A fonte é a SESSÃO do better-auth: cookie assinado, validado contra a tabela `session` no D1.
// Nada aqui lê header de requisição. A versão anterior confiava no header
// Cf-Access-Authenticated-User-Email do Cloudflare Access, o que só seria seguro se o Worker fosse
// inalcançável por fora do Access — e não era: a URL *.workers.dev responde direto, e por ela
// qualquer um mandaria o header na mão e se passaria por qualquer dono.
//
// O dono é o `user.id`, não o e-mail. E-mail muda (a pessoa troca de endereço) e levaria junto o
// vínculo com posts, contas conectadas e mídia; o id é estável pela vida da conta.

/**
 * Quem está fazendo esta requisição, ou `null` se não houver sessão válida.
 *
 * Devolver null em vez de lançar é de propósito: quem chama decide se o caso é 401 (o /api) ou
 * mandar pra tela de entrar (o SPA).
 */
export async function sessionUser(request: Request, env: Env): Promise<{ id: string; email: string } | null> {
  try {
    const session = await createAuth(request, env).api.getSession({ headers: request.headers });
    if (!session?.user?.id) return null;
    return { id: session.user.id, email: session.user.email };
  } catch {
    // Ler a sessão está no caminho de TODA requisição; uma falha de banco aqui não pode virar 500
    // no app inteiro. Sem sessão comprovada, trata-se como não autenticado.
    return null;
  }
}
