-- Contas de usuário, sessões e senhas — schema do better-auth (gerado por @better-auth/cli, não
-- escrito à mão: os nomes de tabela e coluna são contrato da biblioteca e mudar qualquer um quebra
-- a autenticação em silêncio).
--
-- Substitui o gate de senha única (src/lib/auth.ts), onde todo mundo que entrava era o MESMO dono
-- (owner_id = 'owner'). Com login de verdade, cada pessoa vira um owner_id distinto e o
-- escopamento que já existe em accounts/scheduled_posts/grid_previews/media_assets passa a separar
-- os dados de fato.
--
-- Nota sobre nomes: a tabela "account" (singular) é do better-auth e guarda a CREDENCIAL de login
-- (a senha com hash fica em account.password, uma linha por provedor). Não confundir com a nossa
-- "accounts" (plural), que guarda as contas de rede social conectadas. São coisas diferentes que
-- por azar quase compartilham o nome.

-- A pessoa. `emailVerified` é 0/1; fica 0 enquanto o envio de e-mail não estiver ligado.
create table "user" (
  "id" text not null primary key,
  "name" text not null,
  "email" text not null unique,
  "emailVerified" integer not null,
  "image" text,
  "createdAt" date not null,
  "updatedAt" date not null
);

-- Uma linha por sessão ativa. `token` é o que vai no cookie assinado.
create table "session" (
  "id" text not null primary key,
  "expiresAt" date not null,
  "token" text not null unique,
  "createdAt" date not null,
  "updatedAt" date not null,
  "ipAddress" text,
  "userAgent" text,
  "userId" text not null references "user" ("id") on delete cascade
);

-- Credencial de login. Para e-mail+senha, `providerId` = 'credential' e `password` traz o hash.
-- Os campos de token OAuth aqui são do better-auth (login social futuro) e não têm relação com os
-- tokens das redes sociais, que continuam cifrados na nossa tabela accounts.
create table "account" (
  "id" text not null primary key,
  "accountId" text not null,
  "providerId" text not null,
  "userId" text not null references "user" ("id") on delete cascade,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" date,
  "refreshTokenExpiresAt" date,
  "scope" text,
  "password" text,
  "createdAt" date not null,
  "updatedAt" date not null
);

-- Tokens de uso único e prazo curto: confirmação de e-mail e redefinição de senha.
create table "verification" (
  "id" text not null primary key,
  "identifier" text not null,
  "value" text not null,
  "expiresAt" date not null,
  "createdAt" date not null,
  "updatedAt" date not null
);

create index "session_userId_idx" on "session" ("userId");
create index "account_userId_idx" on "account" ("userId");
create index "verification_identifier_idx" on "verification" ("identifier");
