# Estado do produto — ATENTA!

Inventário do que **existe**, do que existe **pela metade** e do que **não existe**, com o motivo de
cada lacuna. Levantado do código e do ambiente publicado em 06/08/2026, não de memória.

Os outros três documentos respondem outras perguntas:

| Pergunta | Arquivo |
| --- | --- |
| Como monto o ambiente e conecto cada rede? | [`README.md`](README.md) |
| Qual é a regra do produto (modelo de dados, ciclo de vida, limites, API)? | [`design.md`](design.md) |
| Como uma tela nova deve parecer? | [`web/design.md`](web/design.md) |
| **O que está pronto, o que falta e por quê?** | **este arquivo** |

Legenda de estado:

- ✅ **funciona** — exercitado contra a API real ou coberto por teste que pega regressão
- ⚠️ **não verificado** — o código existe e passa no typecheck, mas nunca rodou contra o mundo real
- 🚧 **bloqueado** — depende de terceiro (aprovação, credencial) e não de trabalho nosso
- ❌ **não existe**

---

## 1. Publicação

| O que | Onde mora | Estado |
| --- | --- | --- |
| Fila, claim atômico, sweep de travados, retry com backoff | `src/worker.ts` (`runPoller`) | ✅ |
| Cron de 1 em 1 minuto | `wrangler.toml [triggers]` | ✅ |
| YouTube | `src/adapters/youtube.ts` | ✅ |
| LinkedIn | `src/adapters/linkedin.ts` | ✅ |
| Instagram (post, reel, story) | `src/adapters/instagram.ts` | ✅ |
| Facebook | `src/adapters/facebook.ts` | ✅ |
| TikTok | `src/adapters/tiktok.ts` | ✅ desde a correção do upload em partes |
| Pinterest | `src/adapters/pinterest.ts` | 🚧 **sem credencial em produção** (ver §6) |
| Carrossel (IG, FB, LinkedIn, Pinterest) | os quatro adapters | ⚠️ escrito a partir da doc, **nenhum publicado de verdade** |
| Vários Stories seguidos (1 post por arquivo, 1min de intervalo) | `src/api.ts` (`createPost`) | ✅ |
| Upload em partes do YouTube | `src/adapters/youtube.ts` | ✅ partes de 16 MB com `Content-Range`, verificado publicando um vídeo de 126 MB que antes falhava |
| Upload de vídeo do Pinterest | `src/adapters/pinterest.ts` | ⚠️ o formato de `upload_url`/`upload_parameters` veio da doc, não de teste |

**A regra de cada rede é do servidor.** `validate()` de cada adapter decide o que é publicável;
`web/src/lib/platforms.ts` é só espelho pra avisar antes de enviar. Mover regra pro front quebra a
promessa de "falhar na criação, não na publicação".

## 2. Planejamento

| O que | Onde mora | Estado |
| --- | --- | --- |
| Compositor com campos em cascata e pré-visualização por rede | `web/src/components/PostComposer.tsx`, `PostPreview.tsx` | ✅ |
| Recorte 4:5 / 1:1 / 1.91:1 pra faixa que a Meta aceita | `MediaCropDialog.tsx` | ✅ |
| Grade 3 colunas arrastável, com permutação de horários | `GridPlanner.tsx`, `web/src/lib/gridOrder.ts` | ✅ com teste |
| Ideias (post sem data), com pilar e arte opcional | `IdeaSidebar.tsx`, migrações 0003 e 0013 | ✅ |
| Pilares de conteúdo | `TagPicker.tsx`, migração 0014 | ✅ |
| Agenda em lista, semana e mês | `ListView` / `WeekView` / `CalendarView` | ✅ |
| Painel com pendências e "sai a seguir" | `HomeView.tsx`, `lib/pendencias.tsx` | ✅ |
| Sino de notificações | `NotificationsBell.tsx` | ✅ |
| **Recorte por rede** | `PostComposer.tsx` | ❌ **defeito conhecido**, ver §6 |

## 3. Métricas

| O que | Onde mora | Estado |
| --- | --- | --- |
| Coleta com cadência crescente (1h, 6h, 1d, 7d) | `src/metrics/cadence.ts` | ✅ |
| Instagram | `src/metrics/instagram.ts` | ✅ |
| YouTube | `src/metrics/youtube.ts` | ✅ |
| TikTok | `src/metrics/tiktok.ts` | ⚠️ só enxerga vídeo público; enquanto a auditoria não passa, os posts saem `SELF_ONLY` e a consulta volta vazia |
| Facebook | `src/metrics/facebook.ts` | 🚧 curtidas/comentários vêm dos campos do post; **alcance e demografia devolvem 403** até a Meta aprovar |
| "Quem comenta com você" | `post_comments`, migrações 0015 e 0016 | ✅ |
| Insights por assunto (pilar) | `InsightsView.tsx` | ✅ |
| Importação de histórico | `src/metrics/backfill.ts` | ✅ Instagram e YouTube |
| Métrica de CANAL do YouTube (inscritos) | `src/metrics/youtube.ts` | ✅ implementada em 06/08/2026 (faltava: era a única rede com coletor de post e sem o de conta) |
| LinkedIn e Pinterest | — | ❌ **sem coletor nenhum**, nem registrados em `metricsFetchers` |

**LinkedIn e Pinterest, em detalhe** (levantado em 06/08/2026):

- **LinkedIn**: pedimos `openid profile w_member_social`, que serve pra publicar e não pra ler
  desempenho. Métrica de post de PERFIL exige a Member Post Analytics API (`memberCreatorPostAnalytics`)
  com escopo `r_member_social` — escopo novo, consentimento novo, e reconexão de todas as contas.
- **Pinterest**: `GET /v5/pins/{pin_id}/analytics` é coberto por `boards:read` + `pins:read`, que
  **já pedimos**. Então é o mais barato dos dois: dá pra implementar sem escopo novo. O que trava é
  outra coisa — os Pins hoje só existem em modo Sandbox (falta Standard Access), então não há
  desempenho real pra ler.

## 4. Inteligência artificial

| O que | Onde mora | Estado |
| --- | --- | --- |
| Sugestão de legenda no tom do histórico | `src/lib/legenda.ts`, `LegendaIA.tsx` | ✅ verificado contra o modelo real |
| Teto diário por dono, com devolução em caso de falha | migração 0018, `UsoIA.tsx` | ✅ com teste |
| Fallback entre modelos (Llama 4 Scout → 3.3 70B) | `src/lib/legenda.ts` | ⚠️ o caminho de fallback nunca disparou de verdade |
| Análise de concorrentes | — | ❌ ver §6 |

Roda no **Workers AI**, não numa API de IA de terceiro, porque a declaração de tratamento de dados
enviada à Meta diz que a Cloudflare é a única operadora. Custo: ~28 Neurons por legenda contra
10.000/dia gratuitos, ou seja ~350 legendas por dia sem custo.

## 5. Conta, acesso e cobrança

| O que | Onde mora | Estado |
| --- | --- | --- |
| Cadastro e login por e-mail e senha | `src/lib/auth-server.ts` (better-auth) | ✅ |
| Isolamento por dono (`owner_id` em toda consulta) | schema + `src/api.ts` | ✅ com teste de isolação |
| Cadastro por convite | `signup_invites`, `SIGNUP_MODE` | ✅ (hoje **aberto**: `SIGNUP_MODE=open` desde 13/08/2026, pelas revisões) |
| Lista de espera | `signup_waitlist`, migração 0017 | ✅ |
| Recuperação de senha por e-mail | `src/lib/email.ts` (Resend) | ✅ |
| Avatar do usuário, personalizável (Open Peeps) | `/api/profile/avatar`, `web/src/components/AvatarDialog.tsx` | ✅ com teste |
| Login com Google | — | ❌ decisão adiada até as revisões responderem |
| **Cobrança** | `src/lib/billing.ts` | ❌ **código morto**, ver §6 |

---

## 6. Lacunas, agrupadas pelo que as destrava

### 6.1 Bloqueado por terceiro

| Lacuna | Quem destrava | Consequência hoje |
| --- | --- | --- |
| Alcance e demografia do Facebook | App Review da Meta | os cards de alcance ficam vazios pra Páginas |
| TikTok publica só pra si (`SELF_ONLY`) | auditoria da Content Posting API | nenhum post do TikTok é público, e a métrica dele volta vazia |
| TikTok não publica foto | mesma auditoria | `PLATFORM_REQUIRES_MEDIA.tiktok: 'vídeo'` continua no front |
| Pins só em modo Sandbox | Standard Access do Pinterest | exige vídeo demonstrando o fluxo |

### 6.2 Depende só de configuração sua

| Lacuna | O que fazer |
| --- | --- |
| **Pinterest não conecta** | `PINTEREST_CLIENT_ID` e `PINTEREST_CLIENT_SECRET` **não estão gravados em produção**. Clicar em Conectar redireciona pra `/app?connect_error=pinterest&reason=missing_PINTEREST_CLIENT_ID`. É a única das cinco redes OAuth sem credencial |
| ~~**Revisor não consegue entrar**~~ | ✅ resolvido em 13/08/2026: `SIGNUP_MODE=open` no `wrangler.toml`, e qualquer um cria conta pelo fluxo normal (testado de ponta a ponta em produção). A conta `revisor.meta@omangue.co` continua existindo, mas deixou de ser o único caminho — ela está vazia, e o revisor precisa percorrer do cadastro à publicação. **Fechar de novo depois das aprovações**: apague a linha e publique |
| Alerta de falha não sai | `ALERT_WEBHOOK_URL` não está gravado; o código existe (`src/lib/notify.ts`) e hoje só registra em log |
| Dashboard sem senha | `DASHBOARD_PASSWORD` não está gravado — decisão deliberada, já que a autenticação por sessão substituiu o gate |

### 6.3 Não construído

| Lacuna | Nota |
| --- | --- |
| **Cobrança** | Não existe: a tabela `subscriptions` **não está em produção** (migração 0008 nunca aplicada) e ninguém cobra nada. O que passou a existir em 13/08/2026 são os **limites sem cobrança**: `FREE_LIMITS` é aplicado em contas conectadas (`/api/connect`) e posts por mês (`POST /api/posts`), com aviso dizendo que a assinatura ainda não saiu — em vez de "assine para liberar", que seria vender uma porta que não abre. Vale só para contas criadas a partir do corte (`LIMITES_DESDE`), porque as duas contas anteriores já usavam muito acima do anunciado e travá-las seria incidente. Quando a cobrança entrar, o corte por data sai junto |
| **Análise de concorrentes** | `business_discovery` exige `instagram_basic`, `instagram_manage_insights` e `pages_read_engagement` — os três já são pedidos hoje. Devolve seguidores, total de posts, curtidas e comentários do concorrente; **não** devolve alcance nem demografia. Adiado pra não acrescentar variável no meio da análise da Meta |
| Foto de perfil real das contas | o `PlatformAvatar` mostra o logo da rede tingido. O TikTok já grava `avatar_url`; as outras redes só passam a gravar quando a conta reconectar |
| Login com Google | resolve a falta de recuperação de conta sem contratar um segundo operador de dados |
| Domínio `atenta.co` | mexe em cinco consoles de plataforma e obriga TODAS as contas conectadas a reconectar |

### 6.4 Auditoria de segurança (06/08/2026)

Quatro lacunas encontradas e **corrigidas**, todas com teste de regressão em
`test/isolation.test.ts`:

| Lacuna | O que permitia |
| --- | --- |
| `media_asset_id` sem filtro por dono | agendar post com a arte de outro dono, e publicá-la na sua conta (respondia 201) |
| `/api/media/:id/bytes` sem filtro por dono | ler o arquivo de qualquer dono sabendo o uuid |
| multipart `part`/`complete` sem dono | escrever num upload alheio (migração 0019 criou `media_uploads`) |
| Sem freio de força bruta no login | o rate limit do better-auth é inerte no Worker: exige `NODE_ENV=production` e guarda contador em memória de isolate. Confirmado em produção: 8 senhas erradas, nenhum 429 |

Também entraram os cabeçalhos que não existiam: CSP (por hash dos blocos embutidos, ver
`src/lib/csp.ts`), `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` e HSTS.

**O que a auditoria confirmou como correto:** injeção SQL (tudo em placeholder), isolação por dono
nas demais tabelas, CSRF do OAuth, ausência de vazamento de token, XSS, segredos não versionados,
CORS fechado, allowlist de MIME no upload, bucket sem listagem e `npm audit` limpo.

**Ressalva do freio de login:** o binding de rate limit da Cloudflare conta por localização, então
segura o atacante único e não um ataque distribuído. Contra o distribuído o que vale é senha forte
e, adiante, 2FA.

### 6.5 Defeitos conhecidos

| Defeito | Onde | Nota |
| --- | --- | --- |
| **Recorte vale pra todas as redes de uma vez** | `PostComposer.tsx` + `MediaCropDialog.tsx` | com Instagram e Facebook selecionados, recortar pra um aplica o mesmo recorte no outro. Cada rede tem proporção aceita diferente, então a peça sai errada em uma delas. **Relatado e ainda não corrigido** |
| Meta usa só a primeira Página | `handleMetaCallback` em `src/worker.ts` | se `/me/accounts` devolver mais de uma Página concedida, as outras são ignoradas |
| Popover de sugestão cobre o compositor | `LegendaIA.tsx` | com o modal curto, o popover abre pra cima e tapa mídia e formato. Não impede o uso |

---

## 7. O que eu conferiria primeiro

Em ordem de risco, não de esforço:

1. **Cobrança.** A landing vende R$ 39/mês e limites de plano gratuito que o código não aplica. Quem
   assinar hoje paga por algo que já teria de graça, e quem não assinar não é limitado por nada.
2. **Pinterest sem credencial.** A rede aparece em Conexões e o botão leva a um erro. É uma promessa
   visível quebrando na primeira tentativa.
3. **Acesso do revisor.** Sem isso, o material do App Review não chega a ser avaliado.
4. **Carrossel nunca publicado.** Quatro caminhos de código escritos a partir da documentação. O do
   Instagram cria os containers-filho e o pai numa tacada só, sem esperar o processamento de cada
   filho, e é justamente onde carrossel com vídeo tende a falhar.
5. **Recorte por rede.** Produz peça publicada errada, em silêncio.
