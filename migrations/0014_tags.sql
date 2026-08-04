-- TAGS: os pilares de conteúdo ("bastidores", "produto", "viagem", "depoimento").
--
-- POR QUE ISTO NÃO É TEXTO LIVRE. O objetivo final não é filtrar a lista de ideias — é o Insights
-- conseguir dizer "seus posts de bastidores engajam 2× mais". Isso é um GROUP BY, e um group by
-- sobre texto digitado transforma "Viagem", "viagem" e "viagens " em três pilares diferentes, cada
-- um com um terço da amostra. O painel mostraria três respostas fracas no lugar de uma forte, e o
-- erro seria invisível: os números continuam certos, só a pergunta virou outra.
--
-- Uma linha por pilar, referenciada por id, resolve isso e ainda deixa renomear o pilar sem tocar
-- em post nenhum.
--
-- UM pilar por peça, não vários. Pilar responde "sobre o que é isto", e uma peça que é sobre três
-- coisas não tem pilar — tem confusão. Vários exigiria tabela de junção e deixaria o Insights sem
-- resposta ("qual dos três rendeu?"), que é exatamente o que ele existe pra responder.

create table tags (
  id text primary key,
  owner_id text not null,
  name text not null,
  -- CHAVE da paleta ('roxo', 'verde', ...), não hex: cor escrita no banco não acompanha tema nem
  -- ajuste de contraste, e o dia em que a paleta mudar todas as linhas gravadas ficam para trás.
  color text not null default 'roxo',
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Normalizado no índice, não na aplicação: é o banco que tem que recusar o pilar repetido, senão
-- duas abas abertas ao mesmo tempo criam "Viagem" duas vezes e ninguém percebe.
create unique index idx_tags_owner_name on tags (owner_id, lower(trim(name)));

-- `add column` simples, sem reconstruir nada: nenhuma das duas tabelas precisa perder um NOT NULL.
-- A cláusula REFERENCES é aceita aqui porque o padrão é NULL (exigência do SQLite pra ALTER TABLE).
alter table scheduled_posts add column tag_id text references tags(id) on delete set null;
alter table grid_previews add column tag_id text references tags(id) on delete set null;

create index idx_scheduled_posts_tag on scheduled_posts (tag_id);
create index idx_grid_previews_tag on grid_previews (tag_id);
