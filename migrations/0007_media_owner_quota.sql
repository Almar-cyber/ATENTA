-- Dono da mídia — o que torna possível a COTA por usuário (e, no futuro, limpeza seletiva).
--
-- Na 0006 media_assets ficou de fora de propósito: é conteúdo endereçado por uuid opaco, sempre
-- alcançado por uma linha que já tem dono. Isso continua verdade pra LEITURA. Mas cota é sobre
-- ESCRITA: pra saber quanto um dono já ocupa, o arquivo precisa apontar pra ele desde o upload —
-- antes de existir qualquer post que o referencie.
--
-- O R2 é o único recurso que escala junto com o número de usuários a ponto de sair do free tier
-- (10 GB); Workers e D1 têm folga de ordens de grandeza. Por isso a cota é de bytes.

alter table media_assets add column owner_id text not null default 'owner';

-- Backfill do que já existe: o dono vem de quem referencia o arquivo — primeiro um post, senão uma
-- prévia da grade. O que não é referenciado por nada fica com o default ('owner').
update media_assets set owner_id = coalesce(
  (select sp.owner_id
     from post_target_media ptm
     join post_targets pt on pt.id = ptm.post_target_id
     join scheduled_posts sp on sp.id = pt.scheduled_post_id
    where ptm.media_asset_id = media_assets.id
    limit 1),
  (select gp.owner_id from grid_previews gp where gp.media_asset_id = media_assets.id limit 1),
  'owner'
);

-- A cota soma size_bytes por dono a cada upload — sem índice isso vira full scan da tabela.
create index idx_media_assets_owner on media_assets (owner_id);
