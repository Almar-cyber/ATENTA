-- Milestone "Conexões in-app": permitir MAIS DE UMA conta por rede (ex.: dois Instagrams).
-- O schema original (0001) tinha `platform text not null unique` — uma linha por rede, pra sempre —
-- porque era um "single-user tool". Agora o operador conecta várias contas da mesma rede pelo app,
-- então a unicidade passa a ser por (platform, external_account_id).
--
-- SQLite não faz DROP CONSTRAINT, então é o rebuild padrão (cria nova, copia, dropa, renomeia). Os
-- `id` são PRESERVADOS, então as FKs de post_targets.account_id -> accounts(id) continuam válidas.
--
-- APLICAR NO REMOTO: `wrangler d1 execute social-scheduler --remote --file=migrations/0002_accounts_multi.sql`.
-- `PRAGMA defer_foreign_keys=true` adia a checagem de FK para o COMMIT da transação (o D1 roda o
-- arquivo inteiro numa transação), quando `accounts` já foi recriada com os mesmos ids. Se algo
-- falhar, o D1 faz rollback atômico — não deixa o banco pela metade.
--
-- OBS: o miniflare (`--local`) NÃO replica esse `defer_foreign_keys` e rejeita o DROP da tabela
-- referenciada; o rebuild foi validado à parte em SQLite (aceita 2 contas por rede, mantém as FKs).
-- Valide/rode isto no REMOTO.

PRAGMA defer_foreign_keys = true;

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
