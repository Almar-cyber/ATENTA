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
- **Cloudflare R2** — bucket `social-scheduler-media`, via binding `MEDIA` (falta domínio customizado — ver "Pendências")
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

Para os CLIs locais (`enqueue`, `youtube-auth`), copiar `.env.example` para `.env` e preencher `CF_ACCOUNT_ID` / `CF_D1_DATABASE_ID` / `CF_API_TOKEN` (um API token com permissão de D1 Edit, criado no dashboard da Cloudflare).

## Fase 1 — YouTube

1. No [Google Cloud Console](https://console.cloud.google.com/): criar projeto → ativar "YouTube Data API v3" → tela de consentimento OAuth (External, publicar em "In production" para não expirar o refresh_token em 7 dias) → criar credencial OAuth do tipo **Desktop app** (isso é o que habilita o redirect loopback `http://127.0.0.1:8783/callback`).
2. `wrangler secret put YOUTUBE_CLIENT_ID` e `wrangler secret put YOUTUBE_CLIENT_SECRET` (Worker).
3. Preencher as mesmas duas chaves + `TOKEN_ENCRYPTION_KEY` no `.env` local (o script de auth roda fora do Worker).
4. `npm run youtube-auth -- --account="Meu Canal"` — abre a URL de consentimento, você loga com a conta dona do canal, e o script grava o token já criptografado direto no D1.
5. Se o canal aceita vídeos de mais de 15min, confirmar que já passou pela verificação de telefone do YouTube (separada da verificação do Google Cloud).

## Fase 1 — LinkedIn

1. No [LinkedIn Developer Portal](https://www.linkedin.com/developers/apps): criar app → produto "Sign In with LinkedIn using OpenID Connect" + "Share on LinkedIn" (ambos self-serve, sem aprovação de parceiro) → em Auth, registrar o redirect URI exato: `https://social-scheduler.zona21.workers.dev/oauth/callback/linkedin`.
2. `wrangler secret put LINKEDIN_CLIENT_ID` e `wrangler secret put LINKEDIN_CLIENT_SECRET` (Worker).
3. Preencher `LINKEDIN_CLIENT_ID` no `.env` local (o secret fica só no Worker, que faz a troca de código por token).
4. `npm run linkedin-auth-url -- --account="Meu Perfil" --redirect-base=https://social-scheduler.zona21.workers.dev` — abre a URL impressa, loga, e o Worker cria/atualiza a conta no D1 automaticamente ao receber o redirect.
5. **Sem refresh token nessa camada self-serve**: o acesso expira em 60 dias; passado esse prazo (ou quando o poller marcar `needs_reauth`), repetir o passo 4.

## Enfileirando um post

```bash
npm run enqueue -- --platform=youtube --account="Meu Canal" --scheduled_for=2026-08-01T12:00:00Z --caption="..."
```

Isso só cria as linhas em `scheduled_posts`/`post_targets` — falta anexar mídia via `post_target_media` (ainda não tem CLI pra isso; inserir direto no D1 por enquanto: `wrangler d1 execute social-scheduler --remote --command "insert into media_assets (...) values (...)"` depois de subir o arquivo pro bucket R2 com `wrangler r2 object put`).

## Rodando localmente

```bash
npm run dev      # wrangler dev — Worker local (D1 local + cron testável via /__scheduled)
npm run deploy   # publica de verdade (ativa o Cron Trigger real)
```

## Fases

1. **Fase 0** ✅ — fundação: schema D1, Worker com a lógica real do poller (claim, sweeps, refresh), callback OAuth como shell de rota.
2. **Fase 1** ✅ (código) — YouTube + LinkedIn com integração real. Falta só você gerar as credenciais (passos acima) e rodar os CLIs de auth.
3. **Fase 2** — Instagram + Facebook.
4. **Fase 3** — Pinterest (submeter Standard access o quanto antes).
5. **Fase 4** — TikTok (submeter auditoria da Content Posting API o quanto antes — é o maior gargalo de tempo).

`src/adapters/{instagram,facebook,pinterest,tiktok}.ts` ainda lançam `Error('not implemented yet — Phase N')`; a fase correspondente troca isso pela integração real, seguindo o mesmo padrão de `youtube.ts`/`linkedin.ts` (usar `src/lib/tokens.ts` pra ler/gravar tokens, `env.MEDIA.get()` pra ler mídia do R2).

## Pendências

- **Domínio customizado pro R2** — falta configurar (precisa de um dos seus domínios na Cloudflare). Só bloqueia a Fase 2 (Instagram busca mídia por URL pública; YouTube/LinkedIn/TikTok recebem os bytes direto, não precisam disso).
- **Alerta de falha** — Cron Triggers não têm o e-mail automático que o GitHub Actions teria. Falhas só aparecem em `wrangler tail` / dashboard. TODO em `src/worker.ts` (`runPoller`).
- **Upload em chunks do YouTube** — `youtube.ts` faz um PUT único (não o protocolo resumível de verdade com offset de 256KB). Funciona bem pra vídeos de tamanho normal; vídeos muito grandes podem estourar limite de CPU/memória do Worker.
