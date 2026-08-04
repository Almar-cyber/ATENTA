-- Coleta de comentário ganha cadência PRÓPRIA, separada de `next_metrics_at`.
--
-- POR QUE NÃO REAPROVEITAR next_metrics_at: reach e views congelam depois de
-- COLLECT_HORIZON_MS (60 dias, src/metrics/cadence.ts) e o poller PARA de revisitar o post — o
-- valor vira uma data bem no futuro (METRICS_NEVER) e nunca mais é lido de novo. Comentário não
-- funciona assim: pode chegar em post de meses atrás, e "quem comenta com você" é justamente
-- sobre continuar enxergando esse engajamento tardio. Presas na mesma cadência, todo post que já
-- tivesse passado dos 60 dias NUNCA seria revisitado pra comentário — que é o backlog inteiro de
-- quem ligou o escopo `instagram_manage_comments` hoje, com meses ou anos de posts já publicados.
--
-- BACKFILL PRA AGORA, não null: uma coluna nova começando null faria post NOVO entrar na fila
-- (bom) mas todo post JÁ publicado ficaria de fora pra sempre (o defeito que motivou esta
-- migração). Marcando os já publicados como "devidos agora", o próximo tick do poller já começa a
-- varrer o backlog, em lotes de COMMENTS_COLLECT_BATCH por vez.
alter table post_targets add column next_comments_at text;
update post_targets set next_comments_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') where status = 'published';
