import { describe, expect, it } from 'vitest';
import { canPublish, trialDaysLeft, TRIAL_DAYS } from '../src/lib/billing.js';
import type { Subscription } from '../src/lib/billing.js';

// Regras de acesso por assinatura. São decisões de PRODUTO (quem pode publicar, quando o trial
// acaba), então ficam em função pura e cobertas por teste — errar aqui ou libera de graça, ou
// bloqueia quem pagou.

const sub = (over: Partial<Subscription>): Subscription => ({
  owner_id: 'x@y.com',
  status: 'trialing',
  trial_ends_at: '2026-01-08T00:00:00Z',
  current_period_end: null,
  ...over,
});

const AT = (iso: string) => new Date(iso);

describe('canPublish', () => {
  it('trial dentro do prazo publica', () => {
    expect(canPublish(sub({}), AT('2026-01-05T00:00:00Z'))).toBe(true);
  });

  it('trial vencido NÃO publica', () => {
    expect(canPublish(sub({}), AT('2026-01-09T00:00:00Z'))).toBe(false);
  });

  it('assinatura ativa publica', () => {
    expect(canPublish(sub({ status: 'active' }), AT('2030-01-01T00:00:00Z'))).toBe(true);
  });

  it('inadimplente recente ainda publica — o gateway ainda está tentando cobrar', () => {
    expect(canPublish(sub({ status: 'past_due' }), AT('2030-01-01T00:00:00Z'))).toBe(true);
  });

  it('cancelada não publica', () => {
    expect(canPublish(sub({ status: 'canceled' }), AT('2026-01-01T00:00:00Z'))).toBe(false);
  });

  it('o instante EXATO do fim do trial já não publica', () => {
    expect(canPublish(sub({}), AT('2026-01-08T00:00:00Z'))).toBe(false);
  });
});

describe('trialDaysLeft', () => {
  it('conta os dias que faltam, arredondando pra cima', () => {
    expect(trialDaysLeft(sub({}), AT('2026-01-01T00:00:00Z'))).toBe(7);
    expect(trialDaysLeft(sub({}), AT('2026-01-06T12:00:00Z'))).toBe(2);
  });

  it('trial vencido é 0, não negativo', () => {
    expect(trialDaysLeft(sub({}), AT('2026-02-01T00:00:00Z'))).toBe(0);
  });

  it('quem já assinou não vê contagem de trial', () => {
    expect(trialDaysLeft(sub({ status: 'active' }), AT('2026-01-01T00:00:00Z'))).toBe(0);
  });

  it('TRIAL_DAYS é o que a migração e a UI prometem', () => {
    expect(TRIAL_DAYS).toBe(7);
  });
});
