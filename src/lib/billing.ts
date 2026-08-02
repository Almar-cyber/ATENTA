import type { Env } from './env.js';

// Estado de assinatura por dono. Agnóstico de gateway de propósito: o app só pergunta "esse dono
// pode publicar?", e quem preenche a tabela é o webhook do provedor escolhido (Stripe, Asaas, ...).
// Trocar de gateway não deve exigir mexer em nenhum handler.

export const TRIAL_DAYS = 7;

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled';

export interface Subscription {
  owner_id: string;
  status: SubscriptionStatus;
  trial_ends_at: string;
  current_period_end: string | null;
}

/**
 * A assinatura deste dono, criando o trial no primeiro acesso. É idempotente — chamar várias vezes
 * não reinicia o trial (o `on conflict do nothing` garante que a data de fim é a do primeiro
 * acesso, não a de agora).
 */
export async function ensureSubscription(owner: string, env: Env): Promise<Subscription> {
  const trialEnds = new Date(Date.now() + TRIAL_DAYS * 24 * 3_600_000).toISOString();
  await env.DB.prepare(
    `insert into subscriptions (owner_id, status, trial_ends_at) values (?, 'trialing', ?)
     on conflict (owner_id) do nothing`
  )
    .bind(owner, trialEnds)
    .run();

  const row = await env.DB.prepare(
    `select owner_id, status, trial_ends_at, current_period_end from subscriptions where owner_id = ?`
  )
    .bind(owner)
    .first<Subscription>();

  // O insert acima garante a linha; o fallback é só pra satisfazer o tipo.
  return row ?? { owner_id: owner, status: 'trialing', trial_ends_at: trialEnds, current_period_end: null };
}

/**
 * Pode publicar coisas novas? Trial dentro do prazo, assinatura ativa, ou inadimplente recente
 * (o gateway ainda está tentando cobrar — cortar na primeira falha de cartão é hostil).
 *
 * Quem NÃO pode continua com acesso de leitura: os posts, métricas e contas ficam todos lá. Perder
 * o acesso ao próprio histórico por causa de um cartão vencido seria punição desproporcional.
 */
export function canPublish(sub: Subscription, now: Date = new Date()): boolean {
  if (sub.status === 'active' || sub.status === 'past_due') return true;
  if (sub.status === 'trialing') return new Date(sub.trial_ends_at) > now;
  return false;
}

/** Dias que faltam do trial (0 se acabou). Pro aviso no topo do app. */
export function trialDaysLeft(sub: Subscription, now: Date = new Date()): number {
  if (sub.status !== 'trialing') return 0;
  const ms = new Date(sub.trial_ends_at).getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / (24 * 3_600_000)));
}
