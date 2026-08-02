# Specs — Multi-usuário (proposta)

Plano de como o ATENTA! sai de **single-operador** (hoje) para **vários usuários**, sem refazer o
que já existe. Documento de planejamento **antes** de codar.

- Specs do produto atual → [`design.md`](design.md)
- Analytics → [`design-analytics.md`](design-analytics.md)

> **Status: proposta.** Nada aqui está implementado. O app hoje é single-operador: uma senha
> (`DASHBOARD_PASSWORD`), zero `user_id`, todos os tokens sob uma chave.

---

## 1. Os dois caminhos (recap)

| | **Caminho 2 — círculo técnico** | **Caminho 1 — produto público** |
| --- | --- | --- |
| Quem usa | você + poucas pessoas (técnicas/confiança) | qualquer um, cadastro aberto |
| Apps OAuth | os **seus** (ou cada um traz os dele) | os seus, **aprovados em produção** (App Review Meta, auditoria Google/TikTok) |
| Identidade | Cloudflare Access (e-mail/Google) | login próprio + recuperação de senha |
| Gargalo | quase só código | **aprovação das plataformas** (semanas-meses, externo) + entidade jurídica + billing |
| Custo | cabe no $0 por um tempo | morre o $0 (mídia/cron/IA escalam) |

Este doc detalha o **Caminho 2**, que é o próximo passo real, e deixa as costuras prontas pro
Caminho 1 (o `owner_id` e o seam de identidade servem aos dois; só a fonte de identidade e o
billing mudam).

## 2. Princípio: costuras agora, motor depois

- **Costuras** (baratas hoje, caras de retrofitar): `owner_id` no schema, um seam `currentUser()`,
  toda query escopada por dono. Fazer já.
- **Motor** (só tem valor com muitos usuários, e sai errado sem requisitos reais): billing, cadastro
  aberto, rate-limit por usuário, gestão de apps OAuth por usuário. Adiar.

E a regra que não muda: **guardar token OAuth de terceiros é crítico de segurança.** Um filtro de
`owner_id` esquecido = usuário A publica na conta de B ou vê o token dele. Por isso cada query
escopada vem **com teste de isolação** (o A tenta ver o dado do B e falha). Sem esse teste, é teatro.

## 3. Sequência (cada passo é útil sozinho)

### Passo 1 — Identidade via Cloudflare Access (sem escrever auth)

Access (Zero Trust, grátis até 50 usuários) põe uma tela de login **na frente** do Worker: entra
com **código no e-mail** ou **conta Google**, sem senha, sem fluxo de recuperação pra construir.
Você libera por e-mail (uma allowlist na política do Access).

- **Wrinkle**: Access protege domínios da **sua** zona Cloudflare. O app está em `*.workers.dev`
  (domínio da Cloudflare) — pra usar Access, o Worker precisa ir pra um **domínio custom seu** (já
  temos `omangue.co` no R2). É config no dashboard, não código.
- O Worker lê a identidade do header **`Cf-Access-Authenticated-User-Email`** (ou valida o JWT
  `Cf-Access-Jwt-Assertion` contra o JWKS do Access — mais robusto, recomendado). Esse e-mail é o
  `currentUser`. O gate de `DASHBOARD_PASSWORD` sai de cena (ou vira fallback local).
- **Resultado**: login de verdade **já**, e o alicerce (`currentUser`) pronto — ainda single-user,
  mas com identidade real.

### Passo 2 — `owner_id` + `currentUser()` + queries escopadas (com testes de isolação)

- **Schema** (migração `0006_owner_id.sql`): `owner_id text` em `accounts`, `scheduled_posts` e
  `grid_previews`. Backfill: tudo que já existe recebe o seu e-mail como dono. Depois, `not null`.
  `media_assets`/`post_targets`/`post_target_media` **não** precisam de `owner_id` — escopam via o
  pai (`accounts`/`scheduled_posts`), desde que TODA query passe pelo pai.
- **Seam** `currentUser(request)` (`src/lib/auth.ts`): hoje devolve o e-mail do header do Access;
  ponto único onde a identidade entra.
- **Queries**: toda leitura/escrita em `src/api.ts` ganha `where owner_id = ?`. O **poller NÃO
  filtra por usuário** (ele publica de todo mundo) — mas cada destino já sabe seu dono via a conta.
- **Testes de isolação** (o ponto crítico, `test/isolation.test.ts`): sobe dois usuários A e B, cada
  um com contas/posts; A chama cada endpoint (`GET /api/posts`, `POST /api/posts` mirando conta do
  B, `DELETE /api/post-targets/:id` de B, `/api/media/:id/bytes` de B...) e **espera 403/404/vazio**,
  nunca o dado de B. Um teste por endpoint. É isso que separa "multi-tenant de verdade" de teatro.

### Passo 3 — Segundo usuário

Vira **adicionar um e-mail** na política do Access. Sem reescrita: a identidade flui pro `owner_id`,
as queries já escopam. As contas OAuth que cada um conecta ficam com o `owner_id` dele (o
`/api/connect/:rede` grava `currentUser` como dono).

### Passo 4 — Motor (só quando houver demanda real)

Cadastro aberto, billing, rate-limit por usuário, painel de admin, gestão de apps OAuth. Fora de
escopo até existir a demanda — e aí já é conversa de Caminho 1.

## 4. O que muda em cada arquivo

| Arquivo | Mudança |
| --- | --- |
| Cloudflare (dashboard) | Worker no domínio custom + aplicação Access com allowlist de e-mails |
| `src/lib/auth.ts` | `currentUser(request)` — valida o JWT do Access, devolve o e-mail; `DASHBOARD_PASSWORD` vira fallback local (dev) |
| `migrations/0006_owner_id.sql` | `owner_id` em `accounts`/`scheduled_posts`/`grid_previews` + backfill |
| `src/api.ts` | todo handler resolve `currentUser` e escopa as queries por `owner_id`; `/api/connect` grava o dono |
| `src/worker.ts` | poller **não** muda de lógica de seleção (publica de todos); só garante que não vaza dado entre donos em nenhum lugar |
| `test/isolation.test.ts` (novo) | um teste de vazamento por endpoint |
| `web/*` | quase nada — o front já fala com `/api/*`; some o "login por senha" se o Access cobre |

## 5. Riscos e decisões em aberto

- **Domínio custom + Access** é pré-requisito do Passo 1 — sem ele, não há identidade real (config
  sua no dashboard Cloudflare).
- **Um `owner_id` esquecido vaza dados.** Mitigação: os testes de isolação por endpoint + revisar
  cada query. Não deployar o Passo 2 sem os testes verdes.
- **Tokens sob uma chave só** (`TOKEN_ENCRYPTION_KEY`) — cripto continua boa pra multi-user (a chave
  é do Worker, não do usuário); o que isola é o `owner_id` nas queries, não a chave.
- **Rate limit compartilhado**: com N usuários publicando sob os SEUS apps OAuth, os limites de API
  das plataformas são um teto **compartilhado**. Só vira problema com volume real (Caminho 1).
- **Migração de `owner_id`**: aditiva (coluna nova + backfill), segura de aplicar. Mas o Passo 2 (as
  queries escopadas) muda comportamento — testar pesado antes de produção.

## 6. Onde as coisas vão morar

| Assunto | Arquivo |
| --- | --- |
| Identidade (`currentUser`) | `src/lib/auth.ts` |
| Schema `owner_id` | `migrations/0006_owner_id.sql` |
| Escopo por dono | `src/api.ts` (todo handler) |
| Testes de isolação | `test/isolation.test.ts` |
| Config Access + domínio | Cloudflare dashboard (não versionado) |
