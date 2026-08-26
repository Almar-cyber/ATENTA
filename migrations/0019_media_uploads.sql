-- Uploads em partes ainda em andamento, para saber de QUEM é cada um.
--
-- POR QUE PRECISA EXISTIR. O upload multipart tem três chamadas: start (cria no R2), part (manda
-- cada pedaço) e complete (fecha). Só start e complete recebiam o dono; `part` recebia apenas
-- `key` e `upload_id` pela query string e escrevia direto no bucket, sem nada que ligasse aquele
-- upload a quem o iniciou. Auditoria de 2026-08-06.
--
-- O risco era limitado (o upload_id é opaco e só quem chamou start o conhece), mas "difícil de
-- adivinhar" não é controle de acesso — é a mesma falha de raciocínio que deixou o uuid da mídia
-- servir de autorização em /api/media/:id/bytes. Com esta tabela, `part` passa a exigir que o par
-- (storage_key, upload_id) pertença a quem está mandando os bytes.
--
-- POR QUE UMA TABELA E NÃO UM TOKEN ASSINADO: dá pra resolver sem estado, assinando o par com o
-- AUTH_SECRET. A tabela ganha por ser conferível — dá pra olhar o que ficou pendurado e limpar.
-- Upload abandonado (a pessoa fechou a aba no meio) deixa lixo no R2 que ninguém veria de outro
-- jeito, e o created_at é o que permite varrer isso depois.
create table media_uploads (
  -- A chave do objeto no R2. É única por upload: nasce de um uuid em multipartStart.
  storage_key text primary key,
  upload_id text not null,
  owner_id text not null,
  created_at text not null
);

-- Varre por dono (conferir o que é de quem) e por idade (limpar abandonado).
create index idx_media_uploads_owner on media_uploads (owner_id);
create index idx_media_uploads_idade on media_uploads (created_at);
