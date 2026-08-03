-- Cadastro fechado por convite, enquanto o App Review da Meta não sai.
--
-- POR QUE UMA TABELA E NÃO UMA VARIÁVEL: a lista de convidados muda toda semana na fase de teste.
-- Como var do wrangler.toml, cada e-mail novo exigiria um deploy; como secret, exigiria redigitar a
-- lista inteira toda vez. Numa tabela é um insert — e é auditável, que é o que interessa quando se
-- quer saber quem entrou e quando.
--
-- Abrir o cadastro depois NÃO passa por aqui: é o var SIGNUP_MODE=open no wrangler.toml, que faz o
-- better-auth parar de consultar esta tabela. Ela fica, com o registro de quem entrou na fase
-- fechada.
create table signup_invites (
  -- Sempre em minúsculas. Quem escreve é o createInvite(), que normaliza — comparar sem isso
  -- deixaria "Fulano@Gmail.com" de fora da própria lista onde foi cadastrado.
  email text primary key,
  -- Nota livre pra lembrar quem é a pessoa ("testador da agência X").
  note text,
  invited_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- Preenchido quando o convite vira conta. Null = convidado mas ainda não entrou.
  used_at text
);
