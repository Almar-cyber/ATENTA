# social-scheduler

Agendador pessoal de posts para YouTube, LinkedIn, Instagram, Facebook, Pinterest e TikTok.
Custo alvo: $0/mês.

## Stack

- **Cloudflare Worker** (`src/worker.ts`) — um único Worker com dois handlers:
  - `scheduled()` — o poller, disparado por um **Cron Trigger** nativo (substitui GitHub Actions inteiro, sem limite de minutos e sem precisar de repo público)
  - `fetch()` — callback OAuth para LinkedIn, Meta, Pinterest e TikTok (YouTube usa loopback local, não passa por aqui)
- **Cloudflare D1** (SQLite) — banco de dados, via binding `DB`
- **Cloudflare R2** — mídia, via binding `MEDIA` (mais um domínio customizado para servir publicamente, já que r2.dev não é para produção)
- **Web Crypto (AES-GCM)** (`src/lib/crypto.ts`) — criptografia dos tokens OAuth, chave só existe como secret do Worker (sem Vault do Postgres, sem chave em lugar nenhum do repo)

## Por que migrou de Supabase

A org Supabase existente já tinha 2 projetos ativos no free tier (limite da conta) — um terceiro esbarraria no limite. Como já havia conta Cloudflare com domínio configurado, consolidar tudo lá (D1 + R2 + Worker) resolve o limite E elimina de vez a pegadinha de minutos do GitHub Actions.

## Setup

```bash
npm install
wrangler login                        # você mesmo, é OAuth da sua conta Cloudflare
wrangler d1 create social-scheduler   # copiar o database_id pro wrangler.toml
wrangler d1 execute social-scheduler --remote --file=migrations/0001_init.sql

# preencher wrangler.toml: [[r2_buckets]] bucket_name com seu bucket R2 existente

wrangler secret put TOKEN_ENCRYPTION_KEY   # valor: `openssl rand -base64 32`
# (repetir wrangler secret put para YOUTUBE_/LINKEDIN_/META_/PINTEREST_/TIKTOK_* conforme cada fase)

wrangler deploy
```

Para o CLI local de enqueue, copiar `.env.example` para `.env` e preencher `CF_ACCOUNT_ID` / `CF_D1_DATABASE_ID` / `CF_API_TOKEN` (um API token com permissão de D1 Edit, criado no dashboard da Cloudflare).

## Migrações

Em `migrations/0001_init.sql` — tabelas core (accounts, media_assets, scheduled_posts, post_targets, post_target_media), dialeto SQLite/D1. Aplicar com `wrangler d1 execute ... --file=...` (local: sem `--remote`, para testar contra o D1 local do `wrangler dev`).

## Rodando

```bash
npm run dev                 # wrangler dev — roda o Worker localmente (D1 local + cron testável via /__scheduled)
npm run deploy               # publica o Worker (ativa o Cron Trigger de verdade)
npm run enqueue -- --platform=youtube --account="Meu Canal" --scheduled_for=2026-08-01T12:00:00Z --caption="..."
```

## Fases

1. **Fase 0 (esta)** — fundação: schema D1, adapters como stub, Worker com a lógica real do poller (claim, sweeps, refresh), callback OAuth como shell de rota.
2. **Fase 1** — YouTube + LinkedIn.
3. **Fase 2** — Instagram + Facebook.
4. **Fase 3** — Pinterest (submeter Standard access o quanto antes).
5. **Fase 4** — TikTok (submeter auditoria da Content Posting API o quanto antes — é o maior gargalo de tempo).

Cada `src/adapters/<platform>.ts` hoje lança `Error('not implemented yet — Phase N')`; a fase correspondente troca isso pela integração real, usando `src/lib/tokens.ts` (`getAccountTokens`/`setAccountTokens`) para ler/gravar os tokens já criptografados.

## Gap conhecido: alerta de falha

O design original contava com o e-mail automático de "workflow failed" do GitHub Actions como alerta grátis. Cron Triggers da Cloudflare não têm isso — falhas hoje só aparecem em `wrangler tail` / na aba Logs do dashboard. Ver TODO em `src/worker.ts` (`runPoller`): considerar um webhook simples (Discord/ntfy.sh) antes de confiar cegamente no scheduler sem checar os logs de vez em quando.
