# Social Scheduler

Cloudflare Worker (poller + OAuth) + dashboard Vite/React em `web/`.
Ver @README.md (setup e OAuth por plataforma) e @web/design.md (design system —
leia antes de criar ou restilizar telas).

## Comandos

- Preview do front ao vivo: `npm run web:dev` (Vite em :5173, faz proxy de `/api` e
  `/oauth` pro Worker em :8787). Precisa do Worker rodando (`npm run dev`) pra ter
  dados reais — sem ele, `/api` responde 500.
- Typecheck do front antes de fechar mudanças de UI: `cd web && npx tsc -b --noEmit`
  (o `npm run typecheck` da raiz só checa o Worker).
- Build/deploy: `npm run deploy` (builda `web/` → `dist/`, depois `wrangler deploy`).

## Convenções

- UI, README e comentários são em **pt-BR** — mantenha.
- O `validate()` dos adapters no Worker é a autoridade sobre limites de plataforma;
  as dicas em `web/src/lib/platforms.ts` são só do cliente — nunca mova a regra pro front.
- `PLATFORM_COLORS` (hex de marca das redes) só em indicadores de plataforma, nunca
  como cor de UI geral.

## Pegadinhas

- Não nomeie vars do `.env` local como `CF_ACCOUNT_ID` / `CF_API_TOKEN` — o Wrangler
  as trata como credencial dele e quebra silenciosamente todo comando `wrangler` nesta
  pasta. Use `D1_ACCOUNT_ID` / `D1_API_TOKEN` (ver README).
