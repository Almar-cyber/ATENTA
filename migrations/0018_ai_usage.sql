-- Teto diário de geração de legenda, por dono.
--
-- POR QUE PRECISA DE TETO. A cota gratuita do Workers AI é de 10.000 Neurons por DIA e é da CONTA
-- inteira, não de cada usuário. Uma legenda gasta ~28 Neurons, então cabem ~350 por dia; sem teto,
-- uma pessoa segurando o botão consome a cota de todo mundo, e o sintoma pra quem não fez nada é a
-- funcionalidade simplesmente parar de responder no meio do dia, sem explicação.
--
-- POR QUE UMA LINHA POR DIA, E NÃO UM CONTADOR ÚNICO POR DONO. Contador único precisaria de alguém
-- pra zerar (cron, ou uma comparação de data na aplicação que erra no fuso). Com o dia na chave, o
-- "zerar" acontece sozinho: amanhã é outra linha, e a de hoje vira histórico. É o mesmo raciocínio
-- do dedup por id em post_comments (migração 0015) — deixar a chave primária fazer o trabalho em
-- vez de escrever lógica que pode divergir.
--
-- O dia é gravado em UTC, igual a todo o resto do banco. Consequência aceita: pra quem está no
-- Brasil o contador vira às 21h, não à meia-noite. Corrigir isso exigiria guardar o fuso de cada
-- dono, e o teto é generoso o bastante pra ninguém encostar nele nas três horas de diferença.
create table ai_usage (
  owner_id text not null,
  dia text not null,               -- 'YYYY-MM-DD' em UTC
  usos integer not null default 0,
  primary key (owner_id, dia)
);

-- Varre por dia pra poder limpar o que é velho sem escanear a tabela toda.
create index idx_ai_usage_dia on ai_usage (dia);
