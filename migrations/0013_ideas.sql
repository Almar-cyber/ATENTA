-- Prévia vira IDEIA.
--
-- A prévia nasceu como "imagem solta na grade, só pra ver a capa do feed". Na prática ela sempre foi
-- a peça que faltava pro planejamento: um post que ainda não tem data. Quem cuida de um perfil
-- anota o que quer postar antes de decidir quando — e o rascunho não servia pra isso, porque o
-- compositor inventa uma data ("amanhã, 09:00") e a peça some no meio da agenda.
--
-- Duas mudanças bastam pra ela virar rascunho de verdade:
--   1. `note` — o que É a ideia. Sem isso ela só sabe se parecer com algo, não dizer o que é.
--   2. `media_asset_id` opcional — ideia costuma começar em palavras ("carrossel da colheita"),
--      e exigir a arte antes do texto inverte a ordem em que as coisas acontecem.
--
-- POR QUE A IDEIA NÃO VIROU UM RASCUNHO SEM DATA (que seria o caminho óbvio): `scheduled_posts`
-- tem `scheduled_for not null`, e o SQLite não remove um NOT NULL sem RECONSTRUIR a tabela — com
-- `post_targets` viva apontando pra ela. É exatamente a armadilha documentada no README pra
-- migração 0002: dropar uma tabela com filhas vivas registra uma violação de FK por linha filha, e
-- recriar depois com os mesmos ids não zera esse contador. Aqui a reconstrução é segura porque
-- `grid_previews` NÃO tem nenhuma tabela filha — nada referencia ela.

create table grid_previews_novo (
  id text primary key,
  platform text not null
    check (platform in ('youtube','linkedin','instagram','facebook','pinterest','tiktok')),
  -- Agora opcional: a ideia pode ser só texto até a arte existir.
  media_asset_id text references media_assets(id) on delete cascade,
  -- O que é a ideia, em palavras.
  note text,
  sort_at text not null,
  owner_id text not null default 'owner',
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- Uma ideia sem imagem E sem texto não é nada — seria uma linha invisível que ninguém consegue
  -- identificar pra apagar depois.
  check (note is not null or media_asset_id is not null)
);

insert into grid_previews_novo (id, platform, media_asset_id, note, sort_at, owner_id, created_at)
  select id, platform, media_asset_id, null, sort_at, owner_id, created_at from grid_previews;

drop table grid_previews;
alter table grid_previews_novo rename to grid_previews;

create index grid_previews_platform_sort on grid_previews (platform, sort_at desc);
create index idx_grid_previews_owner on grid_previews (owner_id, platform, sort_at desc);
