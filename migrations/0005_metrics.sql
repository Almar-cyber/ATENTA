-- Métricas (Fase A de analytics, ver design-analytics.md). Duas tabelas de SÉRIE TEMPORAL: métrica
-- cresce depois de publicar e desacelera, então guardamos snapshots ao longo do tempo em vez de um
-- retrato único. As colunas "núcleo" são o denominador comum entre as redes (null = a rede não
-- expõe aquela métrica); o `raw` guarda o corpo bruto pro que é específico de cada plataforma.

-- Um snapshot por (destino, momento de coleta).
create table post_metrics (
  id text primary key,
  post_target_id text not null references post_targets(id) on delete cascade,
  external_post_id text not null,          -- redundante com post_targets, mas evita join na coleta
  platform text not null,
  fetched_at text not null,                -- quando ESTE snapshot foi tirado (UTC ISO8601)

  impressions integer,
  reach integer,
  likes integer,
  comments integer,
  shares integer,
  saves integer,
  video_views integer,
  avg_watch_seconds real,

  raw text not null default '{}',
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index post_metrics_target_time on post_metrics (post_target_id, fetched_at desc);

-- Série do nível da conta (seguidores, alcance/dia).
create table account_metrics (
  id text primary key,
  account_id text not null references accounts(id) on delete cascade,
  fetched_at text not null,
  followers integer,
  reach integer,
  profile_views integer,
  raw text not null default '{}',
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index account_metrics_time on account_metrics (account_id, fetched_at desc);

-- Backoff de coleta por destino (mesmo padrão do next_attempt_at, migração 0004): null enquanto
-- nunca coletou; o coletor só pega quem venceu. A cadência (quão longe fica o próximo) é decidida em
-- código pela idade do post desde published_at — ver src/metrics/cadence.ts.
alter table post_targets add column next_metrics_at text;
create index idx_post_targets_next_metrics on post_targets (status, next_metrics_at);
