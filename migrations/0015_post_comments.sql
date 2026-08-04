-- "Quem comenta com você": o Instagram não expõe quem deixou de seguir, mas expõe quem comenta —
-- e quem comenta de verdade é um sinal de gente engajada, um ativo mesmo sem ser "seguidor" no
-- sentido estrito.
--
-- LOG BRUTO, não um contador que soma a cada coleta. O mesmo post é revisitado várias vezes pela
-- cadência de métricas (1h, 6h, 1 dia, 7 dias — src/metrics/cadence.ts); se cada passagem SOMASSE
-- os comentários lidos, o mesmo comentário seria contado de novo a cada coleta. Guardando cada
-- comentário pelo próprio id da rede (chave primária), a segunda leitura é descartada por
-- `insert or ignore` — dedup de graça. "Quem comenta mais" é sempre um `group by` na hora de ler,
-- nunca um contador gravado.
--
-- Sem o TEXTO do comentário: a pergunta é QUEM comenta, não o que disse — menos dado sensível
-- guardado do que precisaria.
create table post_comments (
  -- Id do comentário NA REDE, não um uuid nosso — é o que faz o dedup funcionar sem lógica extra.
  id text primary key,
  -- `set null`, não `cascade`: se o post for excluído, quem comentou nele comentou de verdade — só
  -- o post é que deixou de existir. Apagar o comentário junto reescreveria o passado.
  post_target_id text references post_targets(id) on delete set null,
  account_id text not null references accounts(id) on delete cascade,
  external_user_id text not null,
  username text,
  created_at text not null,
  fetched_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create index idx_post_comments_account_user on post_comments (account_id, external_user_id);
