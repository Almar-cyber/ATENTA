-- Lista de espera do cadastro fechado.
--
-- POR QUE EXISTE: a landing promete "Comece grátis", mas o cadastro só aceita quem está em
-- `signup_invites` (ver SIGNUP_MODE em src/lib/env.ts). Quem chegava de fora preenchia nome, e-mail
-- e senha pra só então tomar um "o cadastro está fechado" — beco sem saída, contra o princípio 4 de
-- design.md. Com a lista, a recusa vira um passo adiante em vez de uma porta.
--
-- E ela tem valor próprio: no dia em que o App Review aprovar e o SIGNUP_MODE virar 'open', esta
-- tabela é a fila de quem convidar primeiro.

create table signup_waitlist (
  -- E-mail é a chave: entrar duas vezes na fila não cria duas linhas, e o `insert or ignore` do
  -- endpoint devolve a mesma resposta nos dois casos — quem tenta de novo não descobre, pela
  -- mensagem, se aquele e-mail já estava na lista.
  email text primary key,
  name text,
  created_at text not null,
  -- Preenchido quando a pessoa for promovida a `signup_invites`. Null = ainda esperando.
  invited_at text
);

create index idx_signup_waitlist_espera on signup_waitlist (invited_at, created_at);
