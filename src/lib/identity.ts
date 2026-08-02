import type { Env } from './env.js';

// Identidade de quem está usando o app. Ponto ÚNICO onde "quem é o usuário" entra no sistema —
// tudo que precisa saber o dono de um dado chama currentUser(). Ver design-multiuser.md §3.
//
// Duas fontes, nesta ordem:
//  1. Cloudflare Access (Zero Trust): quando o Worker está atrás de uma aplicação do Access, ele
//     injeta o e-mail autenticado no header Cf-Access-Authenticated-User-Email. Esse é o modo
//     multi-usuário: cada pessoa entra com o e-mail/Google dela e vira um dono distinto.
//  2. Fallback single-operador: sem Access, todo mundo que passar pelo gate de Basic Auth é o
//     MESMO dono (SINGLE_OPERATOR). É o comportamento de hoje, preservado.
//
// Segurança: o header do Access só é confiável porque o Access fica NA FRENTE do Worker e
// sobrescreve qualquer valor que o cliente tente injetar. Se um dia o Worker for exposto por uma
// rota que não passa pelo Access, a validação do JWT (Cf-Access-Jwt-Assertion contra o JWKS da
// equipe) passa a ser obrigatória — ver design-multiuser.md §3, Passo 1.

/** Dono usado quando não há Cloudflare Access — o modo single-operador de hoje. */
export const SINGLE_OPERATOR = 'owner';

const ACCESS_EMAIL_HEADER = 'Cf-Access-Authenticated-User-Email';

/**
 * Quem está fazendo esta requisição. Devolve o e-mail autenticado pelo Cloudflare Access, ou
 * SINGLE_OPERATOR quando o Access não está na frente (instalação de um operador só).
 */
export function currentUser(request: Request, _env: Env): string {
  const email = request.headers.get(ACCESS_EMAIL_HEADER);
  if (email && email.includes('@')) return email.toLowerCase();
  return SINGLE_OPERATOR;
}

/** Há Cloudflare Access na frente? (útil pra UI decidir se mostra "sair"/troca de conta.) */
export function isAccessEnabled(request: Request): boolean {
  return !!request.headers.get(ACCESS_EMAIL_HEADER);
}
