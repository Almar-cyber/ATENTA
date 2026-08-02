import type { Env } from './env.js';

// Planos por dono. Agnóstico de gateway de propósito: o app só pergunta "esse dono pode fazer X?",
// e quem preenche a tabela é o webhook do provedor escolhido. Trocar de gateway não deve exigir
// mexer em handler nenhum.
//
// FREE permanente em vez de trial-e-morre: a faixa de R$ 0 está vazia no mercado brasileiro
// (pesquisa 02/08/2026 — nenhuma ferramenta BR com preço público tem grátis de verdade), e o custo
// de infra por usuário é irrisório. O free é a porta de entrada; o PRO vende quem cresceu.

export const TRIAL_DAYS = 14; // padrão do mercado (mLabs, KingHost, Zoho, Buffer, Later)

/** Limites do plano gratuito. Passar deles é o que motiva o upgrade. */
export const FREE_LIMITS = {
  connections: 1,
  postsPerMonth: 10,
  /** Dias de histórico de métricas visíveis. */
  metricsHistoryDays: 30,
} as const;

export type Plan = 'free' | 'trialing' | 'active' | 'past_due' | 'canceled';

export interface Subscription {
  owner_id: string;
  plan: Plan;
  trial_ends_at: string | null;
  current_period_end: string | null;
}

/**
 * A assinatura deste dono, criando o free no primeiro acesso. Idempotente — o `do nothing` garante
 * que reentrar não zera nada.
 */
export async function ensureSubscription(owner: string, env: Env): Promise<Subscription> {
  await env.DB.prepare(`insert into subscriptions (owner_id, plan) values (?, 'free') on conflict (owner_id) do nothing`)
    .bind(owner)
    .run();

  const row = await env.DB.prepare(
    `select owner_id, plan, trial_ends_at, current_period_end from subscriptions where owner_id = ?`
  )
    .bind(owner)
    .first<Subscription>();

  return row ?? { owner_id: owner, plan: 'free', trial_ends_at: null, current_period_end: null };
}

/**
 * Está no PRO agora? Trial dentro do prazo, assinatura ativa, ou inadimplente recente.
 *
 * `past_due` conta como PRO de propósito: o gateway ainda está retentando o cartão, e derrubar
 * alguém pra free na primeira falha é hostil — a pessoa pode nem saber que o cartão venceu.
 */
export function isPro(sub: Subscription, now: Date = new Date()): boolean {
  if (sub.plan === 'active' || sub.plan === 'past_due') return true;
  if (sub.plan === 'trialing') return !!sub.trial_ends_at && new Date(sub.trial_ends_at) > now;
  return false;
}

/**
 * Pode conectar mais uma conta? No free, o limite é FREE_LIMITS.connections.
 * `current` é quantas o dono já tem conectadas.
 */
export function canConnectMore(sub: Subscription, current: number, now: Date = new Date()): boolean {
  return isPro(sub, now) || current < FREE_LIMITS.connections;
}

/**
 * Pode agendar mais um post neste mês? No free, o teto é FREE_LIMITS.postsPerMonth.
 * `usedThisMonth` é quantos já foram criados no mês corrente.
 */
export function canScheduleMore(sub: Subscription, usedThisMonth: number, now: Date = new Date()): boolean {
  return isPro(sub, now) || usedThisMonth < FREE_LIMITS.postsPerMonth;
}

/** Dias que faltam do trial (0 quando não está em trial). Pro aviso no topo do app. */
export function trialDaysLeft(sub: Subscription, now: Date = new Date()): number {
  if (sub.plan !== 'trialing' || !sub.trial_ends_at) return 0;
  const ms = new Date(sub.trial_ends_at).getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / (24 * 3_600_000)));
}
