-- Milestone "Conexões in-app": permitir MAIS DE UMA conta por rede (ex.: dois Instagrams).
-- O schema original (0001) tinha `platform text not null unique` — uma linha por rede, pra sempre —
-- porque era um "single-user tool". Agora o operador conecta várias contas da mesma rede pelo app,
-- então a unicidade passa a ser por (platform, external_account_id).
--
-- SQLite não faz DROP CONSTRAINT, então é rebuild de tabela. A primeira versão disto tentou o
-- rebuild só de `accounts`, confiando em `defer_foreign_keys` — e falhou duas vezes no D1 remoto
-- com "FOREIGN KEY constraint failed" (rollback atômico, sem perda). O motivo: `DROP TABLE accounts`
-- com filhos vivos conta como apagar todas as linhas-pai, o que registra uma violação por linha
-- filha; recriar depois uma tabela com os mesmos ids NÃO zera esse contador, e o COMMIT falha.
--
-- A saída é não ter filho vivo na hora do DROP. Guarda os filhos em tabelas temporárias sem
-- constraint (CREATE TABLE ... AS SELECT não copia FK nem índice), dropa os filhos — remover linha
-- filha nunca viola FK —, reconstrói `accounts` já sem ninguém apontando pra ela, e só então recria
-- os filhos com o DDL original de 0001 e devolve os dados. Todos os `id` são preservados.
--
-- APLICAR NO REMOTO: `wrangler d1 execute social-scheduler --remote --file=migrations/0002_accounts_multi.sql`.
-- O D1 roda o arquivo inteiro numa transação e faz rollback atômico se algo falhar.

PRAGMA defer_foreign_keys = true;

-- 1. Filhos pra fora, sem constraint nenhuma.
CREATE TABLE _mig_post_target_media AS SELECT * FROM post_target_media;
CREATE TABLE _mig_post_targets AS SELECT * FROM post_targets;

DROP TABLE post_target_media;
DROP TABLE post_targets;

-- 2. Com ninguém referenciando `accounts`, o rebuild é trivial.
CREATE TABLE accounts_new (
  id text primary key,
  platform text not null
    check (platform in ('youtube','linkedin','instagram','facebook','pinterest','tiktok')),
  display_name text not null,
  external_account_id text,
  status text not null default 'active'
    check (status in ('active','needs_reauth','disabled')),
  token_ciphertext text,
  token_iv text,
  access_token_expires_at text,
  refresh_token_expires_at text,
  scope text,
  extra text not null default '{}',
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- várias contas por rede, mas nunca a MESMA conta (mesmo external id) duas vezes na mesma rede.
  unique (platform, external_account_id)
);

INSERT INTO accounts_new
  (id, platform, display_name, external_account_id, status, token_ciphertext, token_iv,
   access_token_expires_at, refresh_token_expires_at, scope, extra, created_at, updated_at)
SELECT
   id, platform, display_name, external_account_id, status, token_ciphertext, token_iv,
   access_token_expires_at, refresh_token_expires_at, scope, extra, created_at, updated_at
FROM accounts;

DROP TABLE accounts;
ALTER TABLE accounts_new RENAME TO accounts;

-- 3. Filhos de volta, com o DDL de 0001 (idêntico — nada aqui muda de forma).
CREATE TABLE post_targets (
  id text primary key,
  scheduled_post_id text not null references scheduled_posts(id) on delete cascade,
  account_id text not null references accounts(id),
  platform text not null
    check (platform in ('youtube','linkedin','instagram','facebook','pinterest','tiktok')),
  status text not null default 'queued'
    check (status in ('draft','queued','publishing','processing','published','failed','canceled','ambiguous')),
  caption_override text,
  options text not null default '{}',
  adapter_state text not null default '{}',
  external_post_id text,
  external_url text,
  attempt_count integer not null default 0,
  last_error text,
  published_at text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO post_targets
  (id, scheduled_post_id, account_id, platform, status, caption_override, options, adapter_state,
   external_post_id, external_url, attempt_count, last_error, published_at, created_at, updated_at)
SELECT
   id, scheduled_post_id, account_id, platform, status, caption_override, options, adapter_state,
   external_post_id, external_url, attempt_count, last_error, published_at, created_at, updated_at
FROM _mig_post_targets;

CREATE TABLE post_target_media (
  post_target_id text not null references post_targets(id) on delete cascade,
  media_asset_id text not null references media_assets(id),
  position integer not null default 0,
  role text not null default 'primary',
  primary key (post_target_id, media_asset_id, role)
);

INSERT INTO post_target_media (post_target_id, media_asset_id, position, role)
SELECT post_target_id, media_asset_id, position, role FROM _mig_post_target_media;

DROP TABLE _mig_post_targets;
DROP TABLE _mig_post_target_media;

-- 4. Índices de 0001 que viviam nas tabelas recriadas.
CREATE INDEX idx_post_targets_status ON post_targets (status);
CREATE INDEX idx_post_targets_status_updated ON post_targets (status, updated_at);
