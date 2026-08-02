-- Multi-usuário, Passo 2 (design-multiuser.md §3): dono de cada dado.
--
-- Só as três tabelas "raiz" ganham owner_id. As filhas (post_targets, post_target_media) escopam
-- pelo pai — post_targets pertence a um scheduled_post e a um account, ambos já com dono; toda
-- query passa por um deles. media_assets fica sem dono de propósito: é conteúdo endereçado por id
-- opaco (uuid), referenciado só por linhas que já têm dono.
--
-- Aditiva e segura: coluna nova + backfill. O valor 'owner' é o SINGLE_OPERATOR de
-- src/lib/identity.ts — é quem tudo que já existe passa a pertencer. Quando o Cloudflare Access
-- entrar na frente, os donos novos passam a ser e-mails, e 'owner' continua sendo o histórico.

alter table accounts add column owner_id text not null default 'owner';
alter table scheduled_posts add column owner_id text not null default 'owner';
alter table grid_previews add column owner_id text not null default 'owner';

-- Toda listagem filtra por dono; sem índice isso vira full scan conforme o volume cresce.
create index idx_accounts_owner on accounts (owner_id);
create index idx_scheduled_posts_owner on scheduled_posts (owner_id, scheduled_for desc);
create index idx_grid_previews_owner on grid_previews (owner_id, platform, sort_at desc);
