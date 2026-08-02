import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { collectIntervalMs, nextMetricsAt, COLLECT_HORIZON_MS } from '../src/metrics/cadence.js';
import { resetDb, insertAccount, insertPost } from './helpers.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('cadência de coleta', () => {
  it('coleta a cada 1h nas primeiras 6h', () => {
    expect(collectIntervalMs(0)).toBe(HOUR);
    expect(collectIntervalMs(5 * HOUR)).toBe(HOUR);
  });

  it('a cada 6h entre 6h e 48h', () => {
    expect(collectIntervalMs(6 * HOUR)).toBe(6 * HOUR);
    expect(collectIntervalMs(47 * HOUR)).toBe(6 * HOUR);
  });

  it('1×/dia entre 2 e 14 dias', () => {
    expect(collectIntervalMs(2 * DAY)).toBe(DAY);
    expect(collectIntervalMs(13 * DAY)).toBe(DAY);
  });

  it('1×/semana entre 14 dias e o horizonte', () => {
    expect(collectIntervalMs(14 * DAY)).toBe(7 * DAY);
    expect(collectIntervalMs(COLLECT_HORIZON_MS - HOUR)).toBe(7 * DAY);
  });

  it('para de coletar depois do horizonte (null)', () => {
    expect(collectIntervalMs(COLLECT_HORIZON_MS)).toBeNull();
    expect(collectIntervalMs(999 * DAY)).toBeNull();
  });

  it('clock skew (idade negativa) trata como recém-publicado', () => {
    expect(collectIntervalMs(-HOUR)).toBe(HOUR);
  });

  it('nextMetricsAt devolve um instante no futuro dentro do horizonte, e null depois', () => {
    const now = new Date('2026-06-01T12:00:00.000Z');
    const publishedRecent = new Date('2026-06-01T10:00:00.000Z'); // 2h → +1h
    expect(nextMetricsAt(publishedRecent, now)).toBe('2026-06-01T13:00:00.000Z');

    const publishedOld = new Date('2026-01-01T00:00:00.000Z'); // > horizonte
    expect(nextMetricsAt(publishedOld, now)).toBeNull();
  });
});

describe('schema de métricas (migração 0005)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('grava e lê um snapshot de post_metrics, e cascateia ao apagar o destino', async () => {
    const accountId = await insertAccount({ platform: 'instagram' });
    const targetId = await insertPost({ accountId, platform: 'instagram', status: 'published' });
    await env.DB.prepare(`update post_targets set external_post_id = ?, published_at = ? where id = ?`)
      .bind('IG_123', '2026-06-01T10:00:00.000Z', targetId)
      .run();

    await env.DB.prepare(
      `insert into post_metrics (id, post_target_id, external_post_id, platform, fetched_at, reach, likes, comments, raw)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(crypto.randomUUID(), targetId, 'IG_123', 'instagram', '2026-06-01T12:00:00.000Z', 500, 42, 7, '{"x":1}')
      .run();

    const row = await env.DB.prepare(`select * from post_metrics where post_target_id = ?`).bind(targetId).first<any>();
    expect(row.reach).toBe(500);
    expect(row.likes).toBe(42);
    expect(row.impressions).toBeNull(); // não enviado → null, como esperado do núcleo normalizado

    // ON DELETE CASCADE: apagar o destino leva os snapshots junto.
    await env.DB.prepare(`delete from post_targets where id = ?`).bind(targetId).run();
    const after = await env.DB.prepare(`select count(*) as n from post_metrics where post_target_id = ?`).bind(targetId).first<{ n: number }>();
    expect(after?.n).toBe(0);
  });

  it('next_metrics_at existe em post_targets e começa null', async () => {
    const accountId = await insertAccount({ platform: 'youtube' });
    const targetId = await insertPost({ accountId, platform: 'youtube', status: 'published' });
    const row = await env.DB.prepare(`select next_metrics_at from post_targets where id = ?`).bind(targetId).first<{ next_metrics_at: string | null }>();
    expect(row?.next_metrics_at).toBeNull();
  });
});
