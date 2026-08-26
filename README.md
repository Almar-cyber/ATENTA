# atenta

Agendador pessoal de posts para YouTube, LinkedIn, Instagram, Facebook, Pinterest e TikTok.
Custo alvo: $0/mês.

Live: `https://atenta.omangue.co` — cron rodando de minuto em minuto.
Repo: https://github.com/Almar-cyber/ATENTA

O Worker na Cloudflare se chama `atenta` (antes `social-scheduler` — renomeado em 15/08/2026). Os
recursos abaixo (D1, R2) continuam com o nome antigo de propósito: renomear um binding existente
exigiria recriar o recurso, e `social-scheduler`/`social-scheduler-media` são só identificadores
internos, não aparecem pra ninguém.

## Stack

- **Cloudflare Worker** (`src/worker.ts`) — um único Worker com dois handlers:
  - `scheduled()` — o poller, disparado por um **Cron Trigger** nativo (substitui GitHub Actions inteiro, sem limite de minutos e sem precisar de repo público)
  - `fetch()` — callback OAuth para LinkedIn, Meta, Pinterest e TikTok (YouTube usa loopback local, não passa por aqui)
- **Cloudflare D1** (SQLite) — banco `social-scheduler`, via binding `DB`
- **Cloudflare R2** — bucket `social-scheduler-media`, via binding `MEDIA`. Domínio público: `https://scheduler-media.omangue.co` (subdomínio novo — não toca no site que já roda em omangue.co)
- **Cloudflare Workers AI** (`src/lib/legenda.ts`) — sugestão de legenda, via binding `AI`. Sem conta nem chave nova: 10.000 Neurons/dia de graça, e uma legenda custa ~28. Está aqui, e não numa API de IA de terceiro, porque a declaração de tratamento de dados enviada à Meta diz que a Cloudflare é a única operadora — trocar isso obrigaria a voltar lá
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
wrangler d1 execute social-scheduler --remote --file=migrations/0003_grid_previews.sql   # ideias do Grid IG
wrangler d1 execute social-scheduler --remote --file=migrations/0013_ideas.sql          # ideia ganha texto; imagem vira opcional
wrangler d1 execute social-scheduler --remote --file=migrations/0014_tags.sql           # pilares de conteúdo
wrangler d1 execute social-scheduler --remote --file=migrations/0018_ai_usage.sql       # teto diário da legenda por IA
wrangler d1 execute social-scheduler --remote --file=migrations/0019_media_uploads.sql  # dono de cada upload em partes
wrangler r2 bucket create social-scheduler-media
wrangler secret put TOKEN_ENCRYPTION_KEY     # valor: `openssl rand -base64 32`
npm run deploy                               # builda o front (web/ → dist/) e faz wrangler deploy
# DASHBOARD_PASSWORD é opcional e hoje NÃO está definido — sem ele o dashboard fica aberto.
# Ver "Autenticação" na seção Dashboard.
```

Para o CLI local que sobrou (`queue`, só leitura), copiar `.env.example` para `.env` e preencher `D1_ACCOUNT_ID` / `D1_DATABASE_ID` / `D1_API_TOKEN` (um API token com permissão de D1 Edit, criado no dashboard da Cloudflare). **Importante**: não nomeie essas variáveis `CF_ACCOUNT_ID`/`CF_API_TOKEN` — o Wrangler carrega esse mesmo `.env` sozinho e trata esses dois nomes como credenciais de autenticação da Cloudflare, o que quebra silenciosamente todo comando `wrangler` (secret put, deploy, ...) rodado nessa pasta.

## Conectar contas pelo app (Conexões)

Depois de deployado, dá pra conectar LinkedIn / Meta (Instagram + Facebook) / Pinterest / TikTok
**direto no dashboard**: header → **Conexões** → botão **Conectar** de cada rede. O fluxo abre o
consentimento da plataforma e, ao voltar, o Worker grava a conta (nome puxado automático da API) e
mostra "conta conectada com sucesso". **É o único caminho** — os CLIs `*-auth-url` e `youtube-auth`
foram removidos: eles gravavam a conta sem dono, e desde que a identidade passou a vir da sessão uma
conta sem dono é invisível pra todo mundo (toda consulta filtra por `owner_id`), com o token válido e
o poller publicando por um fantasma. O callback agora recusa conexão sem dono no `state`.

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
  `…/oauth/callback/youtube` registrado.
  Se a conta Google já autorizou o app antes, o callback adota a linha que o CLI havia criado sem
  `external_account_id` em vez de tentar inserir uma segunda — era isso que derrubava o Worker com
  "Error 1101" no meio do consentimento.
- Cada rede precisa ter o `redirect_uri` `…/oauth/callback/<rede>` registrado no console dela (o mesmo
  que os CLIs já usavam) e os `client_id`/secret setados como secrets do Worker.

## Fase 1 — YouTube

1. No [Google Cloud Console](https://console.cloud.google.com/): criar projeto → ativar "YouTube Data API v3" → tela de consentimento OAuth (External, publicar em "In production" para não expirar o refresh_token em 7 dias) → criar credencial OAuth do tipo **Desktop app** (isso é o que habilita o redirect loopback `http://127.0.0.1:8783/callback`).
2. `wrangler secret put YOUTUBE_CLIENT_ID` e `wrangler secret put YOUTUBE_CLIENT_SECRET` (Worker).
3. Preencher as mesmas duas chaves + `TOKEN_ENCRYPTION_KEY` no `.env` local (o script de auth roda fora do Worker).
4. Conecte pelo app: header → **Conexões** → **Conectar** no YouTube.
5. Se o canal aceita vídeos de mais de 15min, confirmar que já passou pela verificação de telefone do YouTube (separada da verificação do Google Cloud).

## Fase 1 — LinkedIn

1. Acesse [developer.linkedin.com](https://developer.linkedin.com) → **My apps** (canto superior direito) → **Create app**. Pede uma LinkedIn Page associada — dá pra criar uma ali mesmo se não tiver. Depois, adicionar os produtos "Sign In with LinkedIn using OpenID Connect" + "Share on LinkedIn" (ambos self-serve, sem aprovação de parceiro) → em Auth, registrar o redirect URI exato: `https://atenta.omangue.co/oauth/callback/linkedin`.
2. `wrangler secret put LINKEDIN_CLIENT_ID` e `wrangler secret put LINKEDIN_CLIENT_SECRET` (Worker).
3. Preencher `LINKEDIN_CLIENT_ID` no `.env` local (o secret fica só no Worker, que faz a troca de código por token).
4. Conecte pelo app: header → **Conexões** → **Conectar**.
5. **Sem refresh token nessa camada self-serve**: o acesso expira em 60 dias; passado esse prazo (ou quando o poller marcar `needs_reauth`), repetir o passo 4.

## Fase 2 — Instagram + Facebook (Meta Graph API)

1. No [Meta for Developers](https://developers.facebook.com/apps/): criar app tipo "Business" → adicionar os produtos "Facebook Login" (dá acesso ao fluxo OAuth) → em Configurações → Básico, anotar App ID/Secret → em Facebook Login → Configurações, registrar o redirect URI exato: `https://atenta.omangue.co/oauth/callback/meta`.
2. `wrangler secret put META_APP_ID` e `wrangler secret put META_APP_SECRET` (Worker).
3. Preencher `META_APP_ID` no `.env` local.
4. Conecte pelo app: header → **Conexões** → **Conectar**.
5. **Token de Page praticamente não expira** (só morre com troca de senha, revogação, ou ~90 dias sem uso) — por isso não tem refresh automático implementado; se `needs_reauth` aparecer, repetir o passo 4.
6. **Instagram exige o domínio customizado do R2** (ver Pendências) — o container de mídia é criado com uma URL pública que a Meta busca sozinha. Facebook só precisa disso pra posts com foto/vídeo (post só-texto funciona sem).

## Fase 3 — Pinterest

1. No [Pinterest Developers](https://developers.pinterest.com/apps/): criar app → em Redirect URIs, registrar `https://atenta.omangue.co/oauth/callback/pinterest` → pedir acesso Trial (automático) e, quando for usar de verdade, solicitar **Standard access** (exige um vídeo curto demonstrando o fluxo de publicação — sem isso os Pins só ficam visíveis em modo Sandbox, só pra você).
2. `wrangler secret put PINTEREST_CLIENT_ID` e `wrangler secret put PINTEREST_CLIENT_SECRET` (Worker).
3. Preencher `PINTEREST_CLIENT_ID` no `.env` local.
4. Conecte pelo app: header → **Conexões** → **Conectar**.
5. Pinterest não tem agendamento nativo — timing é 100% o poller, igual LinkedIn/Instagram/TikTok. Imagem publica direto; vídeo passa por registro + poll (igual o Instagram).

## Fase 4 — TikTok

1. No [TikTok Developers](https://developers.tiktok.com/apps/): criar app → adicionar o produto "Content Posting API" e submeter a auditoria (vídeo de demonstração do fluxo + política de privacidade — **submeta isso o quanto antes**, é o maior gargalo de tempo do projeto todo, de dias a semanas) → registrar o redirect URI: `https://atenta.omangue.co/oauth/callback/tiktok`.
2. `wrangler secret put TIKTOK_CLIENT_KEY` e `wrangler secret put TIKTOK_CLIENT_SECRET` (Worker).
3. Preencher `TIKTOK_CLIENT_KEY` no `.env` local.
4. Conecte pelo app: header → **Conexões** → **Conectar**.
5. **Enquanto a auditoria não passa**: posts saem forçados `SELF_ONLY` numa conta de sandbox, não públicos de verdade. `src/adapters/tiktok.ts` está com confiança menor que os outros — os nomes exatos de campos vieram de padrões documentados, não de um teste real contra a API; testar com um post real antes de confiar 100% nele.

## Dashboard

`https://atenta.omangue.co/` serve o dashboard. É um app **React + Vite +
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
- **Sugerir legenda** — o botão ao lado do campo manda o que você já escreveu (o rascunho É o
  briefing, não existe um segundo campo pra preencher) e devolve três opções. O prompt leva as
  **suas** legendas que mais engajaram naquela rede, no mesmo pilar, então a saída sai no seu tom em
  vez de genérica; quando ainda não há histórico, o popover avisa isso em vez de fingir. Teto de 20
  por dia por dono (`ai_usage`, migração 0018), devolvido quando a geração falha. Roda no Workers AI
  com dois modelos em ordem (Llama 4 Scout, e o 3.3 70B como reserva) — o fallback é entre modelos
  da mesma conta, não entre fornecedores, porque um segundo fornecedor tiraria o dado da Cloudflare
  e obrigaria a atualizar a declaração enviada à Meta.
- **Rascunhos** — "Salvar como rascunho" grava com status `draft` (sem passar pela validação de
  mídia, já que a ideia é capturar antes de estar pronto); "Mover p/ fila" promove pra `queued`.
- **Duplicar** — copia um post existente pro formulário reaproveitando a mídia já no R2 (sem
  re-upload), pra republicar em outra data ou outra conta.
- **Pré-visualização** — abaixo do formulário, um card por conta selecionada mostra como o post
  vai ficar, com **play** no vídeo (som e controles; se houver capa, é ela que aparece parada) (mock do formato de cada rede: Instagram quadrado com @usuário, YouTube 16:9 com
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
  formulário. Filtros por status, plataforma e conta. Atualiza sozinho a cada 60s (só com a aba
  visível; ao voltar pra aba, atualiza na hora).
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
- **Ideia**: não tem horário de publicação, só um `sort_at` que é interpolado entre os agendados
  vizinhos — ela cabe entre dois posts sem empurrar nenhum.

O botão **Desfazer** restaura o arranjo anterior (um passo). O que já foi publicado nunca entra na
permutação; arrastar pra cima de um explica isso em vez de não fazer nada.

### Ideias (a lista ao lado da grade)

**Ideia é um post que ainda não tem data** (`grid_previews`, migrações `0003` e `0013`). Nasceu como
"prévia" — imagem solta na grade só pra ver a capa — e virou o lugar de planejar: quem cuida de um
perfil anota o que quer postar antes de decidir quando, e o rascunho não servia pra isso (o
compositor inventa "amanhã, 09:00" e a peça some no meio da agenda).

Na lista ao lado da grade, escrever e dar **Enter** cria uma ideia. Depois:

- **anexar arte** — a partir daí ela também aparece na grade. *Ideia só de texto não entra na
  grade*: a grade existe pra mostrar como o feed vai ficar, e um quadrado cinza atrapalha
  justamente essa leitura.
- **Agendar** — abre o compositor com o que ela tem (texto e/ou mídia), faltando conta e data. A
  ideia continua na lista até você removê-la.
- **Marcar o pilar** — "bastidores", "viagem", "produto". Criar e escolher acontecem no mesmo lugar;
  filtrando a lista por um pilar, a ideia nova já nasce nele.
- **Remover**.

**Pilares de conteúdo** (`tags`, migração `0014`): o pilar acompanha a ideia quando ela vira post, e
é isso que faz os **Insights** ganharem a seção *Por assunto* — "seus posts de bastidores engajam 2×
mais". Era a única pergunta que o painel não sabia responder (ele já dizia qual formato e qual
horário rendem). Não é texto livre de propósito: o índice único é normalizado por dono, senão
"Viagem" e "viagem" viram dois pilares com metade da amostra cada e o erro é invisível. Apagar um
pilar devolve as peças dele a "sem pilar" — nunca apaga post.

Posts cancelados/falhos não aparecem na grade, e o que a API do Instagram devolve como já publicado
é deduplicado contra o nosso próprio registro (`external_post_id`) pra não aparecer duas vezes —
mas a **capa** do feed é aproveitada quando a nossa cópia do arquivo já foi apagada pelo purge de 30
dias, senão todo post com mais de um mês virava um quadrado cinza.

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
printf 'Nova senha: ' && read -rs P && echo && printf '%s' "$P" | npx wrangler secret put DASHBOARD_PASSWORD && sleep 6 && curl -s -o /dev/null -w "login: HTTP %{http_code}\n" -u "almar:$P" https://atenta.omangue.co/; unset P
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

**Vários Stories de uma vez**: a API publica um arquivo por Story (não existe Story em carrossel),
mas nada impede publicar vários seguidos. Escolhendo Story com 2+ arquivos, o compositor cria **um
post por arquivo**, espaçados de 1 minuto — o espaçamento é o que garante a ordem, já que o poller
varre em lote. Cada Story aparece separado na lista e pode ser cancelado sozinho.

Story some em 24h e **não exibe legenda**; a API também não publica Story em carrossel nem
elementos interativos (stickers, links, música), só a imagem/vídeo base.

No **YouTube** a escolha (Vídeo / Short) é só previsão: a API não tem flag de Short — o YouTube
classifica sozinho quando o vídeo é vertical e tem até 3min. A opção ajusta a pré-visualização e os
avisos. As demais redes têm um formato só e nem mostram o seletor.

Posts criados antes disso não têm o campo `format` gravado; o adapter cai na regra antiga
(`as_story`, e vídeo = Reel), então nada muda pra eles.

## Enfileirando um post

Pelo dashboard: **Novo post**. O CLI `enqueue` foi removido — ele criava o post sem `owner_id`, que
com login de verdade nasceria invisível (toda consulta filtra por dono).


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

- **Migrar para o domínio próprio `atenta.co`** (já registrado) — hoje o produto vive em
  `atenta.omangue.co`, subdomínio do estúdio. Para quem chega, a diferença é entre "isso é uma
  empresa" e "isso é o projeto paralelo de alguém", e o e-mail transacional herda o mesmo problema
  (ver `EMAIL_FROM` em src/lib/email.ts: o remetente precisa ficar no MESMO domínio dos links do
  corpo, senão filtro de spam trata como phishing).
  **Só depois das revisões responderem.** Migrar mexe em: `redirect_uri` nos cinco consoles de
  plataforma, o campo de site nos formulários da Meta e do TikTok, a verificação de marca do Google
  (aprovada em 2026-08-05, seria refeita), o domínio verificado na Resend, o `MEDIA_PUBLIC_BASE_URL`
  do R2 — e TODAS as contas conectadas precisam reconectar, porque o redirect mudou.
  Fazer isso no meio de uma análise derruba a aprovação sem deixar rastro do porquê.
- **Login com Google** — hoje só existe e-mail + senha, e **não há recuperação de senha**: esquecer
  a senha é perder a conta. Login social resolve isso sem contratar serviço de envio de e-mail — o
  que importa porque a declaração de tratamento de dados enviada à Meta diz que a **Cloudflare é a
  única operadora**; adicionar Resend/SendGrid obrigaria a voltar lá e declarar um segundo.
  Os escopos são `openid email profile`, que o Google classifica como não sensíveis, então não
  passam por verificação nem afetam a pendência do YouTube. O `better-auth` (1.6) já traz
  `socialProviders`, então é config + botão na `AuthView`.
  **Só depois das revisões em andamento** (Meta, TikTok, Google): mexer em autenticação no meio
  delas acrescenta variável, e uma recusa ficaria sem causa identificável.
  O caso chato a não esquecer: quem já tem conta por senha e entra com Google pela primeira vez
  precisa cair na MESMA conta, não criar uma segunda com o mesmo e-mail.
- **Login com Facebook foi descartado de propósito** — não é esquecimento. Três razões: (1) mudaria
  o caso de uso do Facebook Login declarado no App Review, que hoje é só conectar Páginas; (2) o
  mesmo botão passaria a significar duas coisas ("entre" e "autorize sua Página"); (3) o público do
  produto é justamente quem toma bloqueio no Facebook com frequência — amarrar o acesso ao
  agendador na conta mais frágil faria a pessoa perder a ferramenta que usa pras outras cinco redes.
- **Foto de perfil das contas conectadas** — o `PlatformAvatar` mostra o logo da rede tingido, não a
  foto real do perfil. Todas as APIs já expõem esse dado nos escopos que JÁ pedimos (o
  `user.info.basic` do TikTok inclui `avatar_url`; Instagram, Facebook e YouTube idem), então não
  custa permissão nova nem passa por revisão. O TikTok já grava em `accounts.extra.avatar_url` desde
  2026-08-05; as demais redes só passam a gravar quando a conta reconectar, porque o callback é quem
  captura. Falta: buscar nos outros callbacks e usar no `PlatformAvatar` (front), com o logo da rede
  como fallback quando a URL não resolver — as URLs de avatar da Meta expiram.
- **TikTok não publica foto** — `src/adapters/tiktok.ts` exige vídeo (`media must be a video`), mas
  a Content Posting API suporta o Photo Mode pelo endpoint `/post/publish/content/init/` com
  `media_type: PHOTO`, no MESMO escopo `video.publish` (o nome do escopo engana). Não implementar
  antes da auditoria aprovar: seria empilhar código não testável sobre o adapter de menor confiança
  do projeto. Quando entrar, sai também o `PLATFORM_REQUIRES_MEDIA.tiktok: 'vídeo'` no front.
- ~~**Domínio customizado pro R2**~~ ✅ resolvido — `https://scheduler-media.omangue.co` está de pé e servindo objetos do bucket (verificado com um PUT + GET + delete). É de lá que sai o `public_url` que Instagram, Facebook (posts com mídia) e Pinterest precisam pra buscar o arquivo; YouTube/LinkedIn/TikTok recebem os bytes direto e não dependem disso.
- **Alerta de falha** — Cron Triggers não têm o e-mail automático que o GitHub Actions teria. Falhas só aparecem em `wrangler tail` / dashboard. TODO em `src/worker.ts` (`runPoller`).
- ~~**Upload em chunks do YouTube**~~ ✅ resolvido em 13/08/2026 — era um PUT único, e um vídeo real de 126 MB derrubou a publicação com `Network connection lost` (conexão de saída aberta tempo demais; a memória já estava resolvida pelo streaming do R2). Agora vai em partes de 16 MB, cada uma lida do R2 por faixa e enviada com `Content-Range`. Fatiamento próprio, e não o `tiktokChunking`: o Google exige que todo pedaço menos o último seja múltiplo de 256 KB, e aquele divide em partes iguais. Entre pedaços o Google responde **308**, que não é erro e também não é `res.ok` — tratar isso antes da checagem de sucesso é o que impede o caminho feliz de parecer falha. Verificado publicando o vídeo de 126 MB que falhava.
- **Meta assume uma Page só** — se `/me/accounts` retornar mais de uma Page concedida, o callback só usa a primeira. Ajustar `handleMetaCallback` em `src/worker.ts` se isso vier a ser necessário.
- **Carrossel: nenhum foi testado contra a API real ainda** — o código dos quatro caminhos (ver seção Carrossel) foi escrito a partir da documentação oficial de cada plataforma, não de uma publicação real. O caminho do Instagram em particular cria os containers-filho e o container-pai numa tacada só, sem esperar o processamento de cada filho: pra carrossel de imagens isso é o que a doc da Meta mostra, mas carrossel com vídeo pode falhar na criação do pai e cair no retry do poller (que recria os filhos — os antigos expiram sozinhos). Testar com um post real de cada tipo antes de confiar.
- **TikTok tem confiança menor** — nomes de campos vieram de padrões documentados, não de teste real contra a API (não dá pra testar de verdade até a auditoria da Content Posting API aprovar). Verificar contra a doc atual antes de confiar em produção.
- **Pinterest: upload de vídeo é a parte menos certa** — o formato exato de `upload_url`/`upload_parameters` do endpoint `/v5/media` pode variar; imagem (via `image_url`) é o caminho mais testado/documentado.
