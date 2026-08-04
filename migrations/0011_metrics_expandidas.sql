-- Métricas que respondem "e daí?" em vez de só "quantos".
--
-- O painel sabia dizer curtidas e comentários. Não sabia dizer o que o post RENDEU (seguidor novo,
-- visita ao perfil) nem QUANDO falar com essa gente. Estas colunas são o que falta pra isso, e todas
-- vêm de escopos que a conta já tem — nenhuma exige permissão nova.

-- Por post: o resultado além do aplauso.
alter table post_metrics add column follows integer;          -- seguidores que ESTE post trouxe
alter table post_metrics add column profile_visits integer;   -- quem foi ver o perfil por causa dele
alter table post_metrics add column interactions integer;     -- total_interactions, o consolidado da Meta

-- Por conta: retrato do público, não do post.
--
-- JSON e não colunas: são séries com forma própria (24 valores por hora no caso de online_followers,
-- N faixas no de demografia) e que a Meta remodela de tempos em tempos. Espalhar isso em coluna
-- exigiria migração a cada mudança da API; o painel lê o JSON e se vira.
alter table account_metrics add column online_followers text; -- seguidores online por hora (0–23)
alter table account_metrics add column demographics text;     -- faixa etária, gênero, cidade, país
