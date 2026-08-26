import type { Env } from './env.js';

// Planos por dono. Agnóstico de gateway de propósito: o app só pergunta "esse dono pode fazer X?",
// e quem preenche a tabela é o webhook do provedor escolhido. Trocar de gateway não deve exigir
// mexer em handler nenhum.
//
// FREE permanente em vez de trial-e-morre: a faixa de R$ 0 está vazia no mercado brasileiro
// (pesquisa 02/08/2026 — nenhuma ferramenta BR com preço público tem grátis de verdade), e o custo
// de infra por usuário é irrisório. O free é a porta de entrada; o PRO vende quem cresceu.

// 7, não os 14 do padrão de mercado: o produto entrega o valor central (planejar o feed e ver a
// peça antes de publicar) na primeira sessão, não na terceira semana. Trial longo demais só adia a
// decisão de quem já se convenceu, e dá tempo de esfriar pra quem não.
//
// Este número é PROMETIDO na landing ("Testar 7 dias grátis"): mudar aqui sem mudar lá é vender uma
// coisa e entregar outra.
export const TRIAL_DAYS = 7;

/** Limites do plano gratuito. Passar deles é o que motiva o upgrade. */
export const FREE_LIMITS = {
  connections: 1,
  // 5, não 10: com 10 dá pra manter um perfil pequeno indefinidamente de graça, e a decisão de
  // assinar nunca chega. Cinco cobre experimentar o produto de verdade (planejar uma semana de
  // feed) sem virar o plano definitivo de ninguém.
  //
  // Este número aparece em QUATRO lugares na landing (hero, FAQ, CTA final) e é o que a pessoa lê
  // antes de criar conta — mudar aqui sem mudar lá é prometer uma coisa e entregar outra.
  postsPerMonth: 5,
  /** Dias de histórico de métricas visíveis. */
  metricsHistoryDays: 30,
} as const;

/**
 * A partir de quando os limites do plano gratuito passam a valer.
 *
 * POR QUE UM CORTE POR DATA, e não simplesmente aplicar a todos: no dia em que o cadastro abriu
 * (13/08/2026), as duas contas reais já usavam MUITO acima do que a landing anuncia — 5 e 4 redes
 * conectadas, 63 e 234 posts no mês. Ligar os limites de uma vez as travaria na hora, e limite que
 * quebra quem já usa não é limite, é incidente.
 *
 * Com o corte, a promessa da landing ("1 conta e 5 posts por mês") passa a ser verdade pra quem
 * chega — inclusive pra quem analisa o app — sem derrubar quem já estava dentro.
 *
 * QUANDO A COBRANÇA ENTRAR: esta constante deixa de fazer sentido, porque aí o que decide o limite
 * é o plano da pessoa, não a data em que ela chegou. Apagar junto com a virada.
 */
export const LIMITES_DESDE = '2026-08-13T00:00:00.000Z';

/**
 * Os limites valem pra esta conta?
 *
 * Sem data conhecida devolve `true` (restritivo): uma linha de usuário sem `createdAt` é anomalia,
 * e na dúvida é melhor barrar de mais que liberar de mais.
 */
export function limitesValemPara(userCreatedAt: string | null | undefined): boolean {
  if (!userCreatedAt) return true;
  return userCreatedAt >= LIMITES_DESDE;
}

/**
 * O aviso que a pessoa lê ao bater num limite.
 *
 * NÃO diz "assine para liberar": a assinatura não existe — o `billing.ts` não é importado por
 * ninguém e a tabela `subscriptions` nem foi criada. Mandar assinar seria vender uma porta que não
 * abre, que é pior que o limite em si. O texto assume a verdade: o teto é este por enquanto, e o
 * plano que amplia ainda não saiu.
 */
export function avisoDeLimite(oQueAcabou: string): string {
  return `${oQueAcabou} A assinatura que amplia esse limite ainda não está disponível. Estamos liberando o acesso aos poucos.`;
}

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
