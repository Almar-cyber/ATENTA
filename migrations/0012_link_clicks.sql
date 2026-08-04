-- Cliques no link do perfil (a bio do Instagram, o site da Página).
--
-- As colunas `reach` e `profile_views` de account_metrics já existiam desde a 0005 e nunca foram
-- preenchidas: o coletor só buscava followers_count. Passam a ser usadas agora, junto desta.
--
-- É a métrica que fecha o ciclo do conteúdo: alcance diz quantos viram, engajamento diz quantos
-- reagiram, e o clique diz quantos SAÍRAM da rede pra ir aonde você queria. Sem ela o painel mede
-- popularidade; com ela, mede tráfego.
alter table account_metrics add column link_clicks integer;
