# social-scheduler

Agendador pessoal de posts para YouTube, LinkedIn, Instagram, Facebook, Pinterest e TikTok.
Custo alvo: $0/mês.

Live: `https://social-scheduler.zona21.workers.dev` — cron rodando a cada 10min.
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
npm install                                  # deps do Worker
npm run web:install                          # deps do frontend (web/)
wrangler login
wrangler d1 create social-scheduler          # database_id já no wrangler.toml
wrangler d1 execute social-scheduler --remote --file=migrations/0001_init.sql
wrangler d1 execute social-scheduler --remote --file=migrations/0002_accounts_multi.sql  # multi-conta por rede (ver nota abaixo)
wrangler d1 execute social-scheduler --remote --file=migrations/0003_grid_previews.sql   # prévias do Grid IG
wrangler r2 bucket create social-scheduler-media
wrangler secret put TOKEN_ENCRYPTION_KEY     # valor: `openssl rand -base64 32`
npm run deploy                               # builda o front (web/ → dist/) e faz wrangler deploy
# DASHBOARD_PASSWORD é opcional e hoje NÃO está definido — sem ele o dashboard fica aberto.
# Ver "Autenticação" na seção Dashboard.
```

Para os CLIs locais (`enqueue`, `youtube-auth`, `*-auth-url`), copiar `.env.example` para `.env` e preencher `D1_ACCOUNT_ID` / `D1_DATABASE_ID` / `D1_API_TOKEN` (um API token com permissão de D1 Edit, criado no dashboard da Cloudflare). **Importante**: não nomeie essas variáveis `CF_ACCOUNT_ID`/`CF_API_TOKEN` — o Wrangler carrega esse mesmo `.env` sozinho e trata esses dois nomes como credenciais de autenticação da Cloudflare, o que quebra silenciosamente todo comando `wrangler` (secret put, deploy, ...) rodado nessa pasta.

## Conectar contas pelo app (Conexões)

Depois de deployado, dá pra conectar LinkedIn / Meta (Instagram + Facebook) / Pinterest / TikTok
**direto no dashboard**: header → **Conexões** → botão **Conectar** de cada rede. O fluxo abre o
consentimento da plataforma e, ao voltar, o Worker grava a conta (nome puxado automático da API) e
mostra "conta conectada com sucesso". Os CLIs `*-auth-url` continuam funcionando como alternativa.

- **Múltiplas contas por rede** (ex.: dois Instagrams): a migração `0002_accounts_multi.sql` troca o
  `unique(platform)` por `unique(platform, external_account_id)` — **já aplicada no remoto**. Na Meta,
  conecta todas as contas que você autorizar no consentimento; na hora de postar, você escolhe em qual
  conta no compositor.
  Nota pra quem for reaplicar em outro banco: ela dropa e recria `post_targets`/`post_target_media`
  junto, porque `DROP TABLE accounts` com filhos vivos registra uma violação de FK por linha filha, e
  recriar a tabela com os mesmos ids depois **não** zera esse contador — `defer_foreign_keys` sozinho
  não resolve (foi assim que ela falhou duas vezes antes). Os dados e os ids são preservados.
- **YouTube também conecta pelo navegador** — precisa de uma credencial OAuth do tipo **Web application**
  no Google Cloud (a de "Desktop app" que o CLI usa só aceita redirect loopback), com o redirect
  `…/oauth/callback/youtube` registrado. O CLI (`npm run youtube-auth`) continua valendo.
  Se a conta Google já autorizou o app antes, o callback adota a linha que o CLI havia criado sem
  `external_account_id` em vez de tentar inserir uma segunda — era isso que derrubava o Worker com
  "Error 1101" no meio do consentimento.
- Cada rede precisa ter o `redirect_uri` `…/oauth/callback/<rede>` registrado no console dela (o mesmo
  que os CLIs já usavam) e os `client_id`/secret setados como secrets do Worker.

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

## Fase 4 — TikTok

1. No [TikTok Developers](https://developers.tiktok.com/apps/): criar app → adicionar o produto "Content Posting API" e submeter a auditoria (vídeo de demonstração do fluxo + política de privacidade — **submeta isso o quanto antes**, é o maior gargalo de tempo do projeto todo, de dias a semanas) → registrar o redirect URI: `https://social-scheduler.zona21.workers.dev/oauth/callback/tiktok`.
2. `wrangler secret put TIKTOK_CLIENT_KEY` e `wrangler secret put TIKTOK_CLIENT_SECRET` (Worker).
3. Preencher `TIKTOK_CLIENT_KEY` no `.env` local.
4. `npm run tiktok-auth-url -- --account="Minha Conta" --redirect-base=https://social-scheduler.zona21.workers.dev`.
5. **Enquanto a auditoria não passa**: posts saem forçados `SELF_ONLY` numa conta de sandbox, não públicos de verdade. `src/adapters/tiktok.ts` está com confiança menor que os outros — os nomes exatos de campos vieram de padrões documentados, não de um teste real contra a API; testar com um post real antes de confiar 100% nele.

## Dashboard

`https://social-scheduler.zona21.workers.dev/` serve o dashboard. É um app **React + Vite +
TypeScript + Tailwind v4 + shadcn/ui** (preset Nova: Radix, Lucide, Geist) com animações via
**motion** (motion.dev), em `web/`. O build sai em `dist/` e é servido pelos **static assets** do
Cloudflare Worker (`[assets]` no `wrangler.toml`); o Worker continua dono de `/api/*`,
`/oauth/*` e `/privacy`, e delega o resto pro SPA. Guia de design em [`web/design.md`](web/design.md).

Comandos (na raiz): `npm run web:dev` (Vite com HMR, proxy do /api pro `wrangler dev`),
`npm run dev` (build do front + `wrangler dev`), `npm run deploy` (build do front + `wrangler deploy`).

O que dá pra fazer:

- **Criar posts** — formulário com legenda, título opcional (YouTube), data/hora, contas de
  destino (uma ou várias, uma checkbox por conta autenticada), upload de mídia (um arquivo ou
  vários pra carrossel, reordenáveis com ↑/↓) e os campos específicos mais comuns
  (`privacyStatus` do YouTube, `board_id` do Pinterest, Story do Instagram).
- **Rascunhos** — "Salvar como rascunho" grava com status `draft` (sem passar pela validação de
  mídia, já que a ideia é capturar antes de estar pronto); "Mover p/ fila" promove pra `queued`.
- **Duplicar** — copia um post existente pro formulário reaproveitando a mídia já no R2 (sem
  re-upload), pra republicar em outra data ou outra conta.
- **Pré-visualização** — abaixo do formulário, um card por conta selecionada mostra como o post
  vai ficar (mock do formato de cada rede: Instagram quadrado com @usuário, YouTube 16:9 com
  título, Story 9:16 sem legenda, etc.), já com a mídia que está na fila. Avisa quando a legenda
  passa do limite da plataforma e quando um Story ignora a legenda. O mesmo card aparece no modal
  de detalhe de qualquer post agendado ("Como vai ficar").
- **Consultar** — três visões, alternáveis por aba (inspirado no calendário editorial de
  ferramentas como mLabs/Buffer/Later): **lista** agrupada por dia, com thumbnail real da mídia; um
  **calendário mensal** com um chip por post em cada dia (cor da borda = plataforma; passar o mouse abre um cartão com a thumbnail, a legenda, a conta e o status); e um **Grid
  IG** — a grade 3-colunas do perfil do Instagram, mais novo no canto superior esquerdo, que dá pra
  **arrastar e reordenar** antes de decidir a ordem final (ver abaixo). O status aparece na própria
  peça, não só na coluna de badge: borda tracejada = rascunho, ⚠ + fundo vermelho = falhou. Clicar
  num chip/tile abre o detalhe; clicar num dia vazio do calendário já pré-preenche a data no
  formulário. Filtros por status, plataforma e conta. Atualiza sozinho a cada 30s.
- **Alerta no topo** — barra vermelha quando algum post falhou ou alguma conta precisa
  reautenticar; clicar nela filtra a lista pelas falhas. Compensa em parte a falta de e-mail
  automático dos Cron Triggers (ver Pendências), mas só enquanto o dashboard estiver aberto.
- **Cancelar** — enquanto o post ainda está `draft`/`queued` (antes do poller pegar pra publicar),
  tanto na lista quanto no modal de detalhe do calendário.
- **Reativar / Excluir** — cancelado e falhou não são fim de linha. **Reativar** devolve o post pra
  `draft` (não pra fila: a data original já pode ter passado, e voltar direto pra fila publicaria na
  varredura seguinte), limpando o erro e a contagem de tentativas; de rascunho, você escolhe a nova
  data e manda pra fila. **Excluir** apaga o destino de vez — e o post junto, se era o último destino
  dele. Só não dá enquanto está `publishing`/`processing`, que é quando o poller já está falando com
  a plataforma. Editar também passou a valer pra cancelado/falhou (é o caso de reaproveitar a peça);
  ao salvar, esses destinos voltam como rascunho.

### Grid IG (planejador arrastável)

A aba **Grid IG** monta a grade 3-colunas do perfil, mais novo no canto superior esquerdo, com as
**três** coisas que compõem a aparência do feed:

| Peça | De onde vem | Arrasta? |
| --- | --- | --- |
| **Agendado** (`draft`/`queued`/`processing`) | seus posts | ✅ |
| **Publicado** | seu registro + o feed real da conta (`GET /api/feed/:accountId`, ao vivo na API do Instagram) | ❌ é âncora, já saiu |
| **Prévia** | imagem solta que você joga na grade só pra ver a capa — não é post, não tem legenda, conta nem data | ✅ |

Arrastar reordena, e cada espécie se move de um jeito:

- **Agendado**: os **horários não mudam de valor** — o conjunto de `scheduled_for` é o mesmo, só é
  redistribuído na nova ordem (o tile que passou a ser o mais antigo fica com o horário mais cedo).
  Dá pra decidir a estética sem inventar data nem deixar buraco. `POST /api/posts/reschedule` faz
  essa permutação no servidor.
- **Prévia**: não tem horário de publicação, só um `sort_at` que é interpolado entre os agendados
  vizinhos — ela cabe entre dois posts sem empurrar nenhum.

O botão **Desfazer** restaura o arranjo anterior (um passo). O que já foi publicado nunca entra na
permutação; arrastar pra cima de um explica isso em vez de não fazer nada.

**Prévias** (`grid_previews`, migração `0003`): "Adicionar prévia" (ou o tile `+` no fim da grade)
sobe a imagem pro R2 como qualquer mídia e a coloca no topo. Passando o mouse, dá pra **remover** ou
**agendar** — que abre o compositor já com aquela mídia na fila, faltando só conta e data (a prévia
continua na grade até você removê-la). Posts cancelados/falhos não aparecem, e o que a API do
Instagram devolve como já publicado é deduplicado contra o nosso próprio registro (`external_post_id`)
pra não aparecer duas vezes.

Lembrando que a grade do perfil **corta tudo em 3:4** — é só o recorte da capa; no feed o post
mantém a proporção original com que foi publicado.

### Autenticação (opcional, hoje DESLIGADA)

O gate é opt-in: **sem o secret `DASHBOARD_PASSWORD` definido, o dashboard e todo o `/api/*` ficam
abertos para qualquer um que acesse a URL** — que é o estado atual, por escolha deliberada. Vale
saber o que isso expõe, porque é mais que "ler minha fila": `POST /api/posts` agenda publicação em
qualquer conta conectada e `POST /api/media` escreve no bucket R2. Os tokens seguem criptografados
e nenhum endpoint os devolve.

Pra religar (efeito imediato, sem redeploy) — este comando grava e já testa sozinho:

```bash
printf 'Nova senha: ' && read -rs P && echo && printf '%s' "$P" | npx wrangler secret put DASHBOARD_PASSWORD && sleep 6 && curl -s -o /dev/null -w "login: HTTP %{http_code}\n" -u "almar:$P" https://social-scheduler.zona21.workers.dev/; unset P
```

Pra desligar de novo: `npx wrangler secret delete DASHBOARD_PASSWORD`.

Quando ligado, é HTTP Basic Auth contra esse único secret — qualquer nome de usuário serve, só a
senha é validada. Use `printf '%s'` (não `echo`) ao gravar por pipe: o `\n` do `echo` entra na
senha e nada casa depois. As rotas `/oauth/callback/*` e `/privacy` nunca passam pelo gate — são
acessadas pelos redirects de consentimento de cada plataforma e pelos revisores dos apps, que não
têm como apresentar credencial.

A validação de mídia por plataforma (ex: YouTube/TikTok exigem vídeo, Pinterest/Instagram exigem
`public_url`) reaproveita o `validate()` de cada adapter — um post que vai falhar na hora de
publicar já é recusado na criação, com a mesma mensagem de erro que apareceria no poller.

Upload de mídia grava no R2 e monta o `public_url` a partir de `MEDIA_PUBLIC_BASE_URL`
(`wrangler.toml [vars]`, já apontando pro domínio custom documentado abaixo). Pra rodar o
dashboard localmente (`npm run dev`), crie um `.dev.vars` (gitignored) com pelo menos
`DASHBOARD_PASSWORD=qualquercoisa` e `TOKEN_ENCRYPTION_KEY=...` — o Wrangler carrega esse arquivo
sozinho como secrets locais, sem precisar de `wrangler secret put`.

## Carrossel e Stories

Anexar 2+ arquivos no dashboard cria um carrossel. Cada plataforma tem regras diferentes, e o
`validate()` de cada adapter recusa a combinação inválida na hora de criar o post (não na hora de
publicar) — o dashboard também avisa antes de enviar:

| Plataforma | Máx. de arquivos | Vídeo no carrossel | Como é feito |
| --- | --- | --- | --- |
| Instagram | 10 | ✅ (pode misturar com imagem) | containers-filho `is_carousel_item=true` → container-pai `media_type=CAROUSEL` |
| Facebook | 10 (limite auto-imposto; a Meta não documenta um número) | ❌ só imagens | `/photos` com `published=false` → `/feed` com `attached_media[N]` |
| LinkedIn | 20 | ❌ só imagens | um `initializeUpload` por imagem → `content.multiImage.images[]` |
| Pinterest | 5 | ❌ só imagens | `media_source.source_type=multiple_image_urls` |
| YouTube / TikTok | 1 vídeo | — | não têm carrossel |

Vídeo sozinho continua funcionando em todas. A ordem dos arquivos na fila do dashboard (setas ↑/↓)
é a ordem em que aparecem no carrossel — ela é gravada em `post_target_media.position`.

**Proporção da imagem (Instagram/Facebook):** a API de publicação da Meta só aceita foto de feed
entre **4:5 e 1.91:1** — e não corta nada por conta própria, ela recusa. (No app do Instagram é
diferente: ele te oferece o corte na hora. E a grade 3:4 do perfil é só recorte de capa, não tem a
ver com isso.) Por isso, ao anexar uma foto fora da faixa com Instagram/Facebook selecionados, o
dashboard abre o **recorte**: arrasta a imagem pra escolher o que aparece, aproxima se quiser, e
escolhe entre 4:5, 1:1 ou 1.91:1. O arquivo original não é alterado — o post leva só o recorte
(JPEG, no máximo 1440px de largura, que é o que a Meta serve). O ✂ no tile da fila abre o mesmo
recorte a qualquer momento.

**Formatos aceitos:** JPEG, PNG, MP4 e MOV. RAW de câmera (`.ARW`, `.CR2`, `.NEF`) passa num
filtro `image/*` e sobe pro R2 sem erro, mas toda plataforma recusa na hora de publicar — então
`POST /api/media` (e o input do dashboard) rejeitam esses formatos na entrada, com a mensagem
mandando exportar antes. A allowlist fica em `ALLOWED_MIME_TYPES` (`src/api.ts`).

### Formato do post

O formato **é escolhido** no compositor, logo abaixo das contas — antes ele era adivinhado do
arquivo (anexou vídeo, virava Reel), e não havia como publicar vídeo no feed nem como saber, antes
de agendar, onde a peça ia parar. A escolha muda o `media_type` do container na Meta, então é uma
diferença real de API, não só de preview:

| Instagram | `media_type` | Mídia | Capa |
| --- | --- | --- | --- |
| **Post** | `VIDEO` (ou nenhum, se for imagem) | foto, carrossel de até 10, ou um vídeo | só frame do vídeo |
| **Reel** | `REELS` | um vídeo, vertical | imagem própria (`cover_url`) ou frame |
| **Story** | `STORIES` | um arquivo, até 60s | — |

Story some em 24h e **não exibe legenda**; a API também não publica Story em carrossel nem
elementos interativos (stickers, links, música), só a imagem/vídeo base.

No **YouTube** a escolha (Vídeo / Short) é só previsão: a API não tem flag de Short — o YouTube
classifica sozinho quando o vídeo é vertical e tem até 3min. A opção ajusta a pré-visualização e os
avisos. As demais redes têm um formato só e nem mostram o seletor.

Posts criados antes disso não têm o campo `format` gravado; o adapter cai na regra antiga
(`as_story`, e vídeo = Reel), então nada muda pra eles.

## Enfileirando um post (via CLI, alternativa ao dashboard)

```bash
npm run enqueue -- --platform=youtube --account="Meu Canal" --scheduled_for=2026-08-01T12:00:00Z --caption="..."
```

Isso só cria as linhas em `scheduled_posts`/`post_targets` — falta anexar mídia via `post_target_media` (ainda não tem CLI pra isso, mas o dashboard cobre esse caso). Pra fazer manualmente:

```bash
wrangler r2 object put social-scheduler-media/meu-video.mp4 --file=./meu-video.mp4
# public_url = https://scheduler-media.omangue.co/meu-video.mp4
wrangler d1 execute social-scheduler --remote --command "insert into media_assets (id, storage_key, public_url, mime_type, size_bytes) values ('...', 'meu-video.mp4', 'https://scheduler-media.omangue.co/meu-video.mp4', 'video/mp4', 12345)"
wrangler d1 execute social-scheduler --remote --command "insert into post_target_media (post_target_id, media_asset_id) values ('...', '...')"
```

## Rodando localmente

```bash
npm run web:dev  # Vite com HMR na 5173, proxy de /api pro wrangler dev — melhor pra mexer na UI
npm run dev      # builda o front + wrangler dev na 8787 (Worker local, D1 local, cron via /__scheduled)
npm run deploy   # builda o front + publica de verdade (ativa o Cron Trigger real)
```

Pra `web:dev`: rode `npm run dev` (ou `wrangler dev`) num terminal e `npm run web:dev` noutro — o
Vite serve a UI com hot reload e encaminha as chamadas de API pro Worker local.

## Fases

1. **Fase 0** ✅ — fundação: schema D1, Worker com a lógica real do poller (claim, sweeps, refresh), callback OAuth como shell de rota.
2. **Fase 1** ✅ (código) — YouTube + LinkedIn com integração real. Falta só você gerar as credenciais (passos acima) e rodar os CLIs de auth.
3. **Fase 2** ✅ (código) — Instagram + Facebook via Meta Graph API. Falta você gerar o app Meta e rodar o CLI de auth; Instagram também depende do domínio customizado do R2 (ver Pendências).
4. **Fase 3** ✅ (código) — Pinterest. Falta gerar o app e, principalmente, conseguir o Standard access.
5. **Fase 4** ✅ (código, confiança menor) — TikTok. Falta gerar o app e submeter a auditoria — comece esse passo primeiro, é o que demora mais.
6. **Fase 5** ✅ — Dashboard web (`GET /`) pra criar e consultar posts agendados sem precisar dos CLIs ou do D1 Table Editor. Falta só você rodar `wrangler secret put DASHBOARD_PASSWORD` (passo já incluído no Setup acima).
7. **Fase 6** ✅ (código, não testado contra as APIs reais) — Carrossel/multi-mídia nas quatro plataformas que suportam, + toggle de Stories do Instagram no dashboard. Ver seção Carrossel e a ressalva em Pendências.
8. **Fase 7** ✅ — Dashboard reescrito como app React (Vite + TS + Tailwind + shadcn/ui + motion) em `web/`, servido pelos static assets do Worker. Novidades de UI: planejador em grade arrastável do Instagram e pré-visualização por plataforma no composer e no modal de detalhe. Ver [`web/design.md`](web/design.md).

Todos os seis adapters (`src/adapters/*.ts`) têm integração real agora. O que falta em todos os casos é você gerar as credenciais OAuth de cada plataforma (não posso criar essas contas/apps por você) e rodar o CLI de auth correspondente.

## Pendências

- ~~**Domínio customizado pro R2**~~ ✅ resolvido — `https://scheduler-media.omangue.co` está de pé e servindo objetos do bucket (verificado com um PUT + GET + delete). É de lá que sai o `public_url` que Instagram, Facebook (posts com mídia) e Pinterest precisam pra buscar o arquivo; YouTube/LinkedIn/TikTok recebem os bytes direto e não dependem disso.
- **Alerta de falha** — Cron Triggers não têm o e-mail automático que o GitHub Actions teria. Falhas só aparecem em `wrangler tail` / dashboard. TODO em `src/worker.ts` (`runPoller`).
- **Upload em chunks do YouTube** — `youtube.ts` faz um PUT único (não o protocolo resumível de verdade com offset de 256KB). Funciona bem pra vídeos de tamanho normal; vídeos muito grandes podem estourar limite de CPU/memória do Worker.
- **Meta assume uma Page só** — se `/me/accounts` retornar mais de uma Page concedida, o callback só usa a primeira. Ajustar `handleMetaCallback` em `src/worker.ts` se isso vier a ser necessário.
- **Carrossel: nenhum foi testado contra a API real ainda** — o código dos quatro caminhos (ver seção Carrossel) foi escrito a partir da documentação oficial de cada plataforma, não de uma publicação real. O caminho do Instagram em particular cria os containers-filho e o container-pai numa tacada só, sem esperar o processamento de cada filho: pra carrossel de imagens isso é o que a doc da Meta mostra, mas carrossel com vídeo pode falhar na criação do pai e cair no retry do poller (que recria os filhos — os antigos expiram sozinhos). Testar com um post real de cada tipo antes de confiar.
- **TikTok tem confiança menor** — nomes de campos vieram de padrões documentados, não de teste real contra a API (não dá pra testar de verdade até a auditoria da Content Posting API aprovar). Verificar contra a doc atual antes de confiar em produção.
- **Pinterest: upload de vídeo é a parte menos certa** — o formato exato de `upload_url`/`upload_parameters` do endpoint `/v5/media` pode variar; imagem (via `image_url`) é o caminho mais testado/documentado.
