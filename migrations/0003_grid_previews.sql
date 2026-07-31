-- Prévias do planejador de grade: imagens que ainda NÃO são posts agendados, colocadas na grade
-- só pra ver como o feed vai ficar. Não têm legenda, conta de destino nem horário de publicação —
-- o poller nunca as enxerga. A única coisa que carregam é uma posição (`sort_at`) no MESMO eixo de
-- tempo em que a grade já ordena agendados e publicados, pra conviverem com eles sem inventar um
-- segundo critério de ordenação (e sem ocupar um horário real de publicação).

create table grid_previews (
  id text primary key,
  platform text not null
    check (platform in ('youtube','linkedin','instagram','facebook','pinterest','tiktok')),
  media_asset_id text not null references media_assets(id) on delete cascade,
  sort_at text not null,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create index grid_previews_platform_sort on grid_previews (platform, sort_at desc);
