import { describe, expect, it } from 'vitest';
import { canConnectMore, canScheduleMore, isPro, trialDaysLeft, FREE_LIMITS, TRIAL_DAYS } from '../src/lib/billing.js';
import type { Subscription } from '../src/lib/billing.js';

// Regras de plano. São decisões de PRODUTO (quem publica, quantos posts, quantas conexões), então
// ficam em função pura e cobertas por teste — errar aqui ou dá o PRO de graça, ou bloqueia quem paga.

const sub = (over: Partial<Subscription>): Subscription => ({
  owner_id: 'x@y.com',
  plan: 'free',
  trial_ends_at: null,
  current_period_end: null,
  ...over,
});

const AT = (iso: string) => new Date(iso);
const TRIAL = { plan: 'trialing' as const, trial_ends_at: '2026-01-15T00:00:00Z' };

describe('isPro', () => {
  it('free não é pro', () => {
    expect(isPro(sub({}))).toBe(false);
  });

  it('trial dentro do prazo é pro', () => {
    expect(isPro(sub(TRIAL), AT('2026-01-10T00:00:00Z'))).toBe(true);
  });

  it('trial vencido deixa de ser pro', () => {
    expect(isPro(sub(TRIAL), AT('2026-01-16T00:00:00Z'))).toBe(false);
  });

  it('o instante EXATO do fim do trial já não é pro', () => {
    expect(isPro(sub(TRIAL), AT('2026-01-15T00:00:00Z'))).toBe(false);
  });

  it('assinatura ativa é pro', () => {
    expect(isPro(sub({ plan: 'active' }), AT('2030-01-01T00:00:00Z'))).toBe(true);
  });

  it('inadimplente recente ainda é pro — o gateway ainda está retentando', () => {
    expect(isPro(sub({ plan: 'past_due' }), AT('2030-01-01T00:00:00Z'))).toBe(true);
  });

  it('cancelada volta pro free', () => {
    expect(isPro(sub({ plan: 'canceled' }))).toBe(false);
  });

  it('plano trialing SEM data não é pro (dado inconsistente não libera acesso)', () => {
    expect(isPro(sub({ plan: 'trialing', trial_ends_at: null }))).toBe(false);
  });
});

describe('canConnectMore', () => {
  it('free conecta a primeira, mas não a segunda', () => {
    expect(canConnectMore(sub({}), 0)).toBe(true);
    expect(canConnectMore(sub({}), FREE_LIMITS.connections)).toBe(false);
  });

  it('pro conecta sem limite', () => {
    expect(canConnectMore(sub({ plan: 'active' }), 50)).toBe(true);
  });
});

describe('canScheduleMore', () => {
  it('free agenda até o teto do mês', () => {
    expect(canScheduleMore(sub({}), FREE_LIMITS.postsPerMonth - 1)).toBe(true);
    expect(canScheduleMore(sub({}), FREE_LIMITS.postsPerMonth)).toBe(false);
  });

  it('pro agenda sem limite', () => {
    expect(canScheduleMore(sub({ plan: 'active' }), 9999)).toBe(true);
  });

  it('trial vencido volta a valer o teto do free', () => {
    expect(canScheduleMore(sub(TRIAL), FREE_LIMITS.postsPerMonth, AT('2026-02-01T00:00:00Z'))).toBe(false);
  });
});

describe('trialDaysLeft', () => {
  it('conta os dias que faltam, arredondando pra cima', () => {
    expect(trialDaysLeft(sub(TRIAL), AT('2026-01-01T00:00:00Z'))).toBe(14);
    expect(trialDaysLeft(sub(TRIAL), AT('2026-01-13T12:00:00Z'))).toBe(2);
  });

  it('trial vencido é 0, não negativo', () => {
    expect(trialDaysLeft(sub(TRIAL), AT('2026-03-01T00:00:00Z'))).toBe(0);
  });

  it('quem está no free ou já assinou não vê contagem', () => {
    expect(trialDaysLeft(sub({}))).toBe(0);
    expect(trialDaysLeft(sub({ plan: 'active' }))).toBe(0);
  });

  // O valor exato importa porque a landing PROMETE ele por extenso ("Testar 7 dias grátis"). Este
  // teste é o que faz alguém lembrar de mudar os dois juntos.
  it('TRIAL_DAYS é o que a landing promete', () => {
    expect(TRIAL_DAYS).toBe(7);
  });
});
