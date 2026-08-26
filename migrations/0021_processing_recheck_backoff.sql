-- Cadência de recheck do que está em 'processing'.
--
-- O sweep de 6h já funcionava: updated_at é carimbado só na ENTRADA em processing, nunca num
-- recheck que encontra o container ainda processando, então a idade não é empurrada pra frente.
-- O que faltava era o outro lado da mesma moeda: sem uma coluna dizendo QUANDO checar de novo, o
-- poller reconsulta todo destino em processing a cada tique. No cron de 10 em 10 minutos isso
-- passava batido; de minuto em minuto, um post travado é consultado 360 vezes antes de o sweep
-- desistir dele, e cada consulta é uma chamada à API da plataforma.
--
-- null significa "checa no próximo tique", então quem acabou de subir o arquivo nunca espera.
--
-- JÁ APLICADA NO REMOTO: esta coluna entrou no banco de produção em 18/08/2026, pelo arquivo
-- migrations/0003_processing_recheck_backoff.sql da branch main, que também trazia processing_since.
-- A renumeração aqui é só do ledger: 0003 já estava ocupada por grid_previews deste lado, e as duas
-- branches numeraram por cima uma da outra. NÃO reaplique: dá "duplicate column name".
--
-- processing_since ficou de fora de propósito. Ela media a idade do processamento, que é o que o
-- updated_at congelado já faz aqui, e uma segunda fonte pra mesma verdade é uma pra sair de sincronia.
alter table post_targets add column next_check_after text;

create index idx_post_targets_processing on post_targets (status, next_check_after);
