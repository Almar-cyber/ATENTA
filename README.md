# social-scheduler

Agendador pessoal de posts para YouTube, LinkedIn, Instagram, Facebook, Pinterest e TikTok.
Custo alvo: $0/mês.

Live: `https://social-scheduler.zona21.workers.dev` — cron rodando **a cada 1min**.
Repo: https://github.com/Almar-cyber/social-scheduler

## Stack

- **Cloudflare Worker** (`src/worker.ts`) — um único Worker com dois handlers:
  - `scheduled()` — o poller, disparado por um **Cron Trigger** nativo (substitui GitHub Actions inteiro, sem limite de minutos e sem precisar de repo público)
  - `fetch()` — callback OAuth para LinkedIn, Meta, Pinterest e TikTok (YouTube usa loopback local, não passa por aqui)
- **Cloudflare D1** (SQLite) — banco `social-scheduler`, via binding `DB`
- **Cloudflare R2** — bucket `social-scheduler-media`, via binding `MEDIA`. Domínio público: `https://scheduler-media.omangue.co` (subdomínio novo — não toca no site que já roda em omangue.co)
- **Web Crypto (AES-GCM)** (`src/lib/crypto.ts`) — criptografia dos tokens OAuth, chave só existe como secret do Worker

## Por que migrou de Supabase

A org Supabase existente já tinha 2 projetos ativos no free tier (limite da conta) — um terceiro esbarraria no limite. Como já havia conta Cloudflare com domínio configurado, consolidar tudo lá (D1 + R2 + Worker) resolve o limite E elimina de vez a pegadinha de minutos do GitHub Actions.

## Setup (Fase 0 — já feito neste ambiente)

```bash
npm install
wrangler login
wrangler d1 create social-scheduler          # database_id já no wrangler.toml
wrangler d1 execute social-scheduler --remote --file=migrations/0001_init.sql
wrangler r2 bucket create social-scheduler-media
wrangler secret put TOKEN_ENCRYPTION_KEY     # valor: `openssl rand -base64 32`
wrangler deploy
```

Para os CLIs locais (`enqueue`, `youtube-auth`, `*-auth-url`), copiar `.env.example` para `.env` e preencher `D1_ACCOUNT_ID` / `D1_DATABASE_ID` / `D1_API_TOKEN` (um API token com permissão de D1 Edit, criado no dashboard da Cloudflare). **Importante**: não nomeie essas variáveis `CF_ACCOUNT_ID`/`CF_API_TOKEN` — o Wrangler carrega esse mesmo `.env` sozinho e trata esses dois nomes como credenciais de autenticação da Cloudflare, o que quebra silenciosamente todo comando `wrangler` (secret put, deploy, ...) rodado nessa pasta.

## Fase 1 — YouTube

1. No [Google Cloud Console](https://console.cloud.google.com/): criar projeto → ativar "YouTube Data API v3" → tela de consentimento OAuth (External, publicar em "In production" para não expirar o refresh_token em 7 dias) → criar credencial OAuth do tipo **Desktop app** (isso é o que habilita o redirect loopback `http://127.0.0.1:8783/callback`).
2. `wrangler secret put YOUTUBE_CLIENT_ID` e `wrangler secret put YOUTUBE_CLIENT_SECRET` (Worker).
3. Preencher as mesmas duas chaves + `TOKEN_ENCRYPTION_KEY` no `.env` local (o script de auth roda fora do Worker).
4. `npm run youtube-auth -- --account="Meu Canal"` — abre a URL de consentimento, você loga com a conta dona do canal, e o script grava o token já criptografado direto no D1.
5. Se o canal aceita vídeos de mais de 15min, confirmar que já passou pela verificação de telefone do YouTube (separada da verificação do Google Cloud).

## Fase 1 — LinkedIn

1. Acesse [developer.linkedin.com](https://developer.linkedin.com) → **My apps** (canto superior direito) → **Create app**. Pede uma LinkedIn Page associada — dá pra criar uma ali mesmo se não tiver. Depois, adicionar os produtos "Sign In with LinkedIn using OpenID Connect" + "Share on LinkedIn" (ambos self-serve, sem aprovação de parceiro) → em Auth, registrar o redirect URI exato: `https://social-scheduler.zona21.workers.dev/oauth/callback/linkedin`.
2. `wrangler secret put LINKEDIN_CLIENT_ID` e `wrangler secret put LINKEDIN_CLIENT_SECRET` (Worker).
3. Preencher `LINKEDIN_CLIENT_ID` no `.env` local (o secret fica só no Worker, que faz a troca de código por token).
4. `npm run linkedin-auth-url -- --account="Meu Perfil" --redirect-base=https://social-scheduler.zona21.workers.dev` — abre a URL impressa, loga, e o Worker cria/atualiza a conta no D1 automaticamente ao receber o redirect.
5. **Sem refresh token nessa camada self-serve**: o acesso expira em 60 dias; passado esse prazo (ou quando o poller marcar `needs_reauth`), repetir o passo 4.

## Fase 2 — Instagram + Facebook (Meta Graph API)

1. No [Meta for Developers](https://developers.facebook.com/apps/): criar app tipo "Business" → adicionar os produtos "Facebook Login" (dá acesso ao fluxo OAuth) → em Configurações → Básico, anotar App ID/Secret → em Facebook Login → Configurações, registrar o redirect URI exato: `https://social-scheduler.zona21.workers.dev/oauth/callback/meta`.
2. `wrangler secret put META_APP_ID` e `wrangler secret put META_APP_SECRET` (Worker).
3. Preencher `META_APP_ID` no `.env` local.
4. `npm run meta-auth-url -- --account="Minha Marca" --redirect-base=https://social-scheduler.zona21.workers.dev` — abre a URL, você loga e concede acesso a **uma** Page (o fluxo assume só uma; se aparecer seletor com várias, desmarque as outras). O Worker troca o código por um token de usuário, estende pra long-lived, busca a Page e, se ela tiver uma conta Instagram Business vinculada, cria as duas linhas (`facebook` e `instagram`) no D1 de uma vez.
5. **Token de Page praticamente não expira** (só morre com troca de senha, revogação, ou ~90 dias sem uso) — por isso não tem refresh automático implementado; se `needs_reauth` aparecer, repetir o passo 4.
6. **Instagram exige o domínio customizado do R2** (ver Pendências) — o container de mídia é criado com uma URL pública que a Meta busca sozinha. Facebook só precisa disso pra posts com foto/vídeo (post só-texto funciona sem).

## Fase 3 — Pinterest

1. No [Pinterest Developers](https://developers.pinterest.com/apps/): criar app → em Redirect URIs, registrar `https://social-scheduler.zona21.workers.dev/oauth/callback/pinterest` → pedir acesso Trial (automático) e, quando for usar de verdade, solicitar **Standard access** (exige um vídeo curto demonstrando o fluxo de publicação — sem isso os Pins só ficam visíveis em modo Sandbox, só pra você).
2. `wrangler secret put PINTEREST_CLIENT_ID` e `wrangler secret put PINTEREST_CLIENT_SECRET` (Worker).
3. Preencher `PINTEREST_CLIENT_ID` no `.env` local.
4. `npm run pinterest-auth-url -- --account="Meu Perfil" --redirect-base=https://social-scheduler.zona21.workers.dev` — o Worker troca o código por token, busca seus boards e usa o primeiro como padrão (`accounts.extra.default_board_id`; dá pra sobrescrever por post com `options.board_id`).
5. Pinterest não tem agendamento nativo — timing é 100% o poller, igual LinkedIn/Instagram/TikTok. Imagem publica direto; vídeo passa por registro + poll (igual o Instagram).

## Fase 4 — TikTok (auditoria **aprovada**)

1. No [TikTok Developers](https://developers.tiktok.com/apps/): app criado, produto "Content Posting API" com a auditoria **aprovada** (era o maior gargalo do projeto — já passou), redirect URI registrado: `https://social-scheduler.zona21.workers.dev/oauth/callback/tiktok`.
2. `wrangler secret put TIKTOK_CLIENT_KEY` e `wrangler secret put TIKTOK_CLIENT_SECRET` (Worker).
3. Preencher `TIKTOK_CLIENT_KEY` no `.env` local.
4. `npm run tiktok-auth-url -- --account="Minha Conta" --redirect-base=https://social-scheduler.zona21.workers.dev` — aceitar as duas permissões (perfil + publicar vídeo). Se a conta já tinha sido autenticada antes da aprovação, **refaça esse passo**: o token antigo foi emitido para um app não auditado e continua limitado.
5. Com a auditoria aprovada, o post sai de verdade: `privacy_level` default é `PUBLIC_TO_EVERYONE`. O adapter só aceita um valor que a própria conta oferece — ele lê `creator_info` antes de cada post e usa a lista de lá.

### Opções por post (`--options`)

```bash
npm run enqueue -- --platform=tiktok --account="Minha Conta" --scheduled_for=2026-09-01T12:00:00Z \
  --caption="legenda com #hashtag" \
  --options='{"privacy_level":"PUBLIC_TO_EVERYONE","disable_duet":true}'
```

| opção | default | o que faz |
| --- | --- | --- |
| `privacy_level` | `PUBLIC_TO_EVERYONE` | `MUTUAL_FOLLOW_FRIENDS`, `FOLLOWER_OF_CREATOR`, `SELF_ONLY` — precisa estar entre as opções que `creator_info` devolve pra conta |
| `disable_comment` / `disable_duet` / `disable_stitch` | `false` | se a conta já desabilitou a interação nas configurações dela, o adapter força `true` (mandar o contrário é erro na API) |
| `brand_content_toggle` | `false` | conteúdo pago por terceiro (não combina com `SELF_ONLY`) |
| `brand_organic_toggle` | `false` | você promovendo sua própria marca |
| `is_aigc` | — | marca o vídeo como gerado por IA |
| `video_cover_timestamp_ms` | — | frame usado como capa |

A legenda vai em `post_info.title` (limite de 2200 caracteres, truncada se passar). O vídeo sobe direto de bytes do R2 — TikTok não precisa do domínio público, diferente de Instagram/Pinterest.

### Como o upload funciona

`video/init` → `PUT` de cada chunk → poll de `status/fetch` até `PUBLISH_COMPLETE` (o poller cuida disso na etapa "processing", com timeout de 6h). Chunks seguem as regras do Media Transfer Guide: 5MB–64MB cada, o último absorve o resto, `total_chunk_count = floor(video_size / chunk_size)`, máximo de 1000. Vídeo de até 64MB sobe inteiro num chunk só; acima disso o adapter fatia em 16MB e lê cada pedaço do R2 por byte-range, então um vídeo grande nunca fica inteiro na memória do Worker (limite de 128MB por isolate).

**O upload é retomável.** O progresso (`publish_id`, `upload_url`, chunk atual) é gravado em `post_targets.adapter_state` antes do primeiro byte e depois de cada chunk. Se o Worker morrer no meio, a sweep de 30min requeue o post e o adapter continua do chunk seguinte, no mesmo `publish_id`. Três guardas em volta disso:

- se todos os chunks já subiram e só a escrita final se perdeu, o adapter **não** faz um novo `video/init` — ele devolve o `publish_id` antigo pro `status/fetch`, senão o mesmo vídeo seria publicado duas vezes;
- se a `upload_url` já passou de 45min (a assinatura do TikTok vale ~1h), a retomada é abandonada e o post recomeça — seguro porque upload incompleto nunca publica nada;
- enquanto os chunks estão subindo, cada checkpoint atualiza o `updated_at`, então a sweep de `publishing` travado não arranca um upload que está vivo.

## Postando pelo celular (`/admin`)

`https://social-scheduler.zona21.workers.dev/admin?key=SUA_SENHA` — página servida pelo próprio Worker: escolhe o arquivo, escreve a legenda, marca as contas, define a hora e pronto. Embaixo do formulário aparece a fila com o status de cada post.

Abrir `/admin` sem estar logado mostra uma tela de senha comum — é o caminho normal; salve nos favoritos e a sessão dura 90 dias (cookie `HttpOnly` restrito a `/admin`). O `?key=` continua funcionando como atalho e é convertido em cookie por redirect, pra senha não ficar no histórico.

**Conectar contas também é pela página.** Cada plataforma tem um botão que abre o consentimento dela e volta pra cá — mesma URL de consentimento que os scripts `*-auth-url` imprimiam, só que sem terminal. Duas ressalvas: o `redirect_uri` mostrado na página precisa estar registrado igual no painel da plataforma (se você acessa o Worker por mais de um domínio, fixe com a var `OAUTH_REDIRECT_BASE`), e o **YouTube continua pelo terminal** (`npm run youtube-auth`) porque a credencial dele é do tipo Desktop e exige redirect local, que um celular não tem como servir.

```bash
wrangler secret put ADMIN_TOKEN     # openssl rand -base64 24
```

Sem terminal: crie o secret `ADMIN_TOKEN` no GitHub (mesmo lugar dos secrets da Cloudflare) e rode o workflow de Deploy — ele grava a senha no Worker.

Como funciona por dentro: o arquivo sobe por um `PUT /admin/media` que faz stream direto pro R2 (nada de multipart, então um vídeo grande não precisa caber na memória do Worker), e o `POST /admin/enqueue` cria post, targets e o vínculo da mídia num `D1.batch` só — um post meio criado nunca chega a ser reivindicado pelo poller.

Limites: 100MB por upload (teto de corpo de requisição do plano free da Cloudflare) e uma mídia por post. Um post pode ir pra várias contas de uma vez.

## Enfileirando um post pelo terminal

```bash
npm run enqueue -- --platform=youtube --account="Meu Canal" --scheduled_for=2026-08-01T12:00:00Z --caption="..."
```

Isso só cria as linhas em `scheduled_posts`/`post_targets` — falta anexar mídia via `post_target_media` (ainda não tem CLI pra isso). Pra fazer manualmente:

```bash
wrangler r2 object put social-scheduler-media/meu-video.mp4 --file=./meu-video.mp4
# public_url = https://scheduler-media.omangue.co/meu-video.mp4
wrangler d1 execute social-scheduler --remote --command "insert into media_assets (id, storage_key, public_url, mime_type, size_bytes) values ('...', 'meu-video.mp4', 'https://scheduler-media.omangue.co/meu-video.mp4', 'video/mp4', 12345)"
wrangler d1 execute social-scheduler --remote --command "insert into post_target_media (post_target_id, media_asset_id) values ('...', '...')"
```

## Latência de publicação

O cron **é** o atraso: um post só sai no tick seguinte ao `scheduled_for` dele. Estava em `*/10`, ou seja 0–10min de espera (5min na média) — foi pra `* * * * *`, então o pior caso é ~60s. Um minuto é a granularidade mínima do Cron Trigger da Cloudflare; abaixo disso só saindo de cron pra um alarme de Durable Object por post, o que sai do free tier de $0.

Continua $0/mês: 1440 invocações/dia contra as 100k requests/dia do plano free, e as leituras do poller são poucas e indexadas.

O que **não** atrasa a primeira publicação:

- `retry_after` só é preenchido depois de uma falha — post novo tem `null` e nunca espera por causa dele.
- Rodadas sobrepostas (um upload de vídeo longo atravessa o próximo tick) são seguras: tanto o claim do post (`queued` → `publishing`) quanto o claim do refresh de token são atômicos, então nada publica duas vezes nem gira o refresh token duas vezes em paralelo.
- Backoff de erro retryable agora começa em 1min e dobra (1, 2, 4, 8, 15min de teto) em vez de 15min fixos — um erro transitório custa um tick, não um quarto de hora. Erro de `quota` continua esperando 24h de propósito.
- O backoff do recheck de `processing` só começa depois de 5min: nos primeiros 5min o post é consultado em todo tick, então ele aparece como publicado assim que a plataforma termina. Depois disso abre pra 5min e, passados 30min, pra 15min — o que corta o pior caso de 6h de 360 consultas pra ~30 sem atrasar o caso normal.

## Rodando localmente

```bash
npm run dev      # wrangler dev — Worker local (D1 local + cron testável via /__scheduled)
npm run deploy   # publica de verdade (ativa o Cron Trigger real)
```

### Migrations pendentes

**Migration antes do deploy, sempre** — o poller consulta colunas (`retry_after`, `processing_since`, `next_check_after`) que só existem depois delas; um Worker novo contra um banco velho quebra em toda rodada.

```bash
wrangler d1 execute social-scheduler --remote --file=migrations/0002_post_target_retry_after.sql
wrangler d1 execute social-scheduler --remote --file=migrations/0003_processing_recheck_backoff.sql
npm run deploy
```

### Deploy sem terminal (celular)

Os dois passos acima precisam de credencial da Cloudflare, o que normalmente quer dizer terminal. `.github/workflows/deploy.yml` transforma isso num botão: **Actions → Deploy → Run workflow**, dá pra apertar do navegador do celular. Ele aplica as migrations que você listar no campo (já vem preenchido com as pendentes) e publica o Worker.

Uma vez só, antes de usar: em **Settings → Secrets and variables → Actions**, criar `CLOUDFLARE_API_TOKEN` (token com Workers Scripts:Edit, D1:Edit e Workers R2 Storage:Edit) e `CLOUDFLARE_ACCOUNT_ID`. E o workflow só aparece na aba Actions depois de estar na branch padrão.

O campo de migrations vem **vazio** e é assim que deve ficar no dia a dia: só preencha quando existir migration nova, com o nome do arquivo. Aplicar a mesma duas vezes dá erro de coluna duplicada. (O campo não tem valor padrão de propósito — o GitHub troca input vazio pelo default declarado, então um padrão preenchido seria impossível de desligar.) Isso **não** é o poller: o agendamento continua no Cron Trigger do Worker, e o workflow só roda quando você aperta o botão.

## Fases

1. **Fase 0** ✅ — fundação: schema D1, Worker com a lógica real do poller (claim, sweeps, refresh), callback OAuth como shell de rota.
2. **Fase 1** ✅ (código) — YouTube + LinkedIn com integração real. Falta só você gerar as credenciais (passos acima) e rodar os CLIs de auth.
3. **Fase 2** ✅ (código) — Instagram + Facebook via Meta Graph API. Falta você gerar o app Meta e rodar o CLI de auth; Instagram também depende do domínio customizado do R2 (ver Pendências).
4. **Fase 3** ✅ (código) — Pinterest. Falta gerar o app e, principalmente, conseguir o Standard access.
5. **Fase 4** ✅ — TikTok. Auditoria da Content Posting API **aprovada**; adapter reescrito em cima disso (privacy level real, upload em chunks, códigos de erro do TikTok mapeados). Falta o primeiro post real pra confirmar ponta a ponta.

Todos os seis adapters (`src/adapters/*.ts`) têm integração real agora. O que falta em todos os casos é você gerar as credenciais OAuth de cada plataforma (não posso criar essas contas/apps por você) e rodar o CLI de auth correspondente.

## Pendências

- **Domínio customizado pro R2** — falta configurar (precisa de um dos seus domínios na Cloudflare). Bloqueia Instagram, posts com mídia do Facebook e imagens/vídeos do Pinterest (todos buscam a mídia por URL pública; YouTube/LinkedIn/TikTok recebem os bytes direto, não precisam disso).
- **Alerta de falha** — Cron Triggers não têm o e-mail automático que o GitHub Actions teria. Falhas só aparecem em `wrangler tail` / dashboard. TODO em `src/worker.ts` (`runPoller`).
- **Upload em chunks do YouTube** — `youtube.ts` faz um PUT único (não o protocolo resumível de verdade com offset de 256KB). Funciona bem pra vídeos de tamanho normal; vídeos muito grandes podem estourar limite de CPU/memória do Worker. O TikTok já usa o padrão que dá pra copiar aqui: chunk + `saveAdapterState` a cada pedaço (`src/lib/db.ts`).
- **Meta assume uma Page só** — se `/me/accounts` retornar mais de uma Page concedida, o callback só usa a primeira. Ajustar `handleMetaCallback` em `src/worker.ts` se isso vier a ser necessário.
- **Sem carrossel/multi-mídia** — `instagram.ts`, `linkedin.ts` e `pinterest.ts` cobrem só um arquivo de mídia por post.
- **`/admin` não mostra progresso de upload** — em vídeo grande no 4G a tela fica em "Enviando..." sem barra até terminar. Falta trocar o `fetch` por `XMLHttpRequest`, que é o único jeito de ter evento de progresso de upload no navegador.
- **TikTok: falta o primeiro post real** — com a auditoria aprovada dá pra testar de verdade agora. Os campos do adapter foram conferidos contra a doc atual (Direct Post, Media Transfer Guide, Get Post Status), mas nenhum post passou pela API ainda. Comece com um vídeo curto e `{"privacy_level":"SELF_ONLY"}` pra validar o fluxo sem publicar pro mundo, depois solte um público.
- **Pinterest: upload de vídeo é a parte menos certa** — o formato exato de `upload_url`/`upload_parameters` do endpoint `/v5/media` pode variar; imagem (via `image_url`) é o caminho mais testado/documentado.
