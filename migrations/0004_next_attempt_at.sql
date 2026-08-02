-- Backoff de retry por-target. O poller original tentava escrever isso em post_targets.scheduled_for
-- — uma coluna que nunca existiu: scheduled_for mora em scheduled_posts (0001_init.sql), é o horário
-- que VOCÊ escolheu e é compartilhado por todos os destinos do post. O UPDATE estourava dentro do
-- próprio handler de falha, então o destino ficava preso em 'publishing' até o sweep de 30min, sem
-- attempt_count e sem last_error — um retry infinito em vez de cinco tentativas.
--
-- next_attempt_at fica null enquanto o destino nunca falhou; a query de posts vencidos trata
-- "null ou no passado" como elegível, então nada muda pra quem nunca falhou.
--
-- (Portada da branch claude/o-que-falta-ul8w7q, onde era 0002 — renumerada pra 0004 porque 0002 e
-- 0003 já foram usadas aqui por multi-conta e grid_previews.)

alter table post_targets add column next_attempt_at text;

-- Espelha idx_post_targets_status: a query de vencidos filtra por status e depois next_attempt_at.
create index idx_post_targets_status_next_attempt on post_targets (status, next_attempt_at);
