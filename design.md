# Specs da plataforma — Social Scheduler

Especificação do **produto**: o que ele faz, com que regras, e onde cada regra mora no código.

- Setup, credenciais e OAuth por rede → [`README.md`](README.md)
- Design system visual do dashboard (tokens, componentes, padrões de UI) → [`web/design.md`](web/design.md)

---

## 1. O que é

Agendador pessoal de posts para seis redes (YouTube, LinkedIn, Instagram, Facebook, Pinterest,
TikTok), rodando inteiro na Cloudflare com custo alvo de **$0/mês**.

Um Worker só, com dois papéis:

| Papel | Handler | O que faz |
| --- | --- | --- |
| **Poller** | `scheduled()` | Cron a cada 10min: pega o que está na fila e venceu, publica, acompanha o processamento assíncrono, reenfileira falha temporária |
| **App** | `fetch()` | `/api/*` (dashboard), `/oauth/callback/*` (consentimento), `/privacy`, e o SPA nos static assets |

Persistência: **D1** (SQLite) para agenda e contas, **R2** para os arquivos. Tokens OAuth ficam
cifrados em AES-GCM (`src/lib/crypto.ts`), com a chave só num secret do Worker — nenhum endpoint
devolve token.

## 2. Modelo de dados

```
accounts ─┐
          ├─< post_targets >─── post_target_media >─── media_assets
scheduled_posts ─┘                                          ↑
                                              grid_previews ─┘
```

| Tabela | Papel |
| --- | --- |
| `accounts` | uma conta conectada. `unique(platform, external_account_id)` — várias contas por rede (migração 0002) |
| `scheduled_posts` | a **peça**: título, legenda canônica, `scheduled_for`. (Chamava-se "a ideia" aqui — o nome foi liberado quando `grid_previews` passou a ser a ideia de verdade, a que ainda não tem data) |
| `post_targets` | a **saída** numa conta. Tem o status, o formato, o erro, o id externo. É a unidade real de publicação |
| `post_target_media` | ordem dos arquivos daquele destino (`position` = ordem no carrossel) |
| `media_assets` | arquivo no R2 + `public_url`, mime, dimensões, duração |
| `tags` | um **pilar de conteúdo** ("bastidores", "viagem"). Tabela própria, com índice único normalizado por dono — é o que faz o Insights agrupar por assunto sem partir a amostra em "Viagem"/"viagem" (migração 0014) |
| `grid_previews` | uma **ideia**: um post que ainda não tem data. Texto e/ou imagem, uma posição na grade, nenhum horário de publicação — o poller nunca a enxerga (migrações 0003 e 0013) |
| `post_comments` | log bruto de comentário lido no Instagram (id da rede como PK — dedup de graça). "Quem comenta com você" é sempre um `group by` na hora de ler, nunca um contador gravado (migração 0015). Cadência própria (`post_targets.next_comments_at`, migração 0016), sem horizonte — ao contrário da de métrica, que congela depois de 60 dias |

**Um post, N destinos.** A legenda vive em `scheduled_posts.body`; cada destino pode divergir via
`post_targets.caption_override`. A **mídia** diverge do mesmo jeito: `post_target_media` sempre foi
por destino, então a mesma foto pode entrar recortada numa proporção por rede (4:5 no feed, 9:16 no
Reel) dentro de um post só. `POST /api/posts` recebe isso em `target_media_asset_ids`, um mapa de
`account_id` pra lista de mídia, com três leituras possíveis por conta:

| No mapa | Significa |
| --- | --- |
| ausente | usa a lista compartilhada do post (`media_asset_ids`) |
| `["md-a", "md-b"]` | esta conta tem a mídia dela, nesta ordem de carrossel |
| `[]` | esta conta sai **sem arquivo**, mesmo que o post tenha lista compartilhada |

A lista compartilhada é resolvida mesmo quando toda conta diverge, pra que um id inexistente siga
sendo 400 em vez de virar uma lista ignorada em silêncio. E a guarda de "post vazio" (legenda OU
mídia) só conta as contas que estão em `target_account_ids`: mapa apontando pra conta de fora não é
conteúdo. O horário é um só, compartilhado por todos os destinos.

**Ideia → post.** `grid_previews` é o estágio anterior: o que você quer postar, ainda sem data. Não
virou um "rascunho sem data" porque `scheduled_for` é `not null` e o SQLite não remove um NOT NULL
sem reconstruir a tabela — com `post_targets` viva apontando pra ela, que é a armadilha de FK
descrita no README pra migração 0002. A ideia já era essa peça desde a 0003; só faltava carregar
texto. O "Agendar" abre o compositor com o que ela tem, e ali ela ganha data e conta.

`options` (JSON em `post_targets`) carrega o que é específico de rede: `format`, `privacyStatus`,
`board_id`, `cover_media_id`, `cover_timestamp_ms`, `trial_graduation`.

## 3. Ciclo de vida

```
rascunho ──p/ fila──> na fila ──poller──> publicando ──> processando ──> publicado
    ↑                    │                    │
    │                 cancelar                └──> falhou ──retry──> na fila
    └── reativar ────────┴──── cancelado                    └─(esgotou)─> falhou
                                                            └──> indefinido
```

| Status | Significado |
| --- | --- |
| `draft` | só no painel. **Nunca publica**, por mais que a data passe. Pula a validação de mídia |
| `queued` | autorizado. O poller publica na primeira varredura em que `scheduled_for <= agora` |
| `publishing` | o poller está falando com a plataforma agora |
| `processing` | a plataforma aceitou e está transcodificando (Instagram, Pinterest, TikTok) |
| `published` | saiu. Guarda `external_post_id` e `external_url` |
| `failed` | erro; reenfileira sozinho até esgotar as tentativas (`MAX_ATTEMPTS = 5`) |
| `canceled` | tirado da fila antes de publicar |
| `ambiguous` | a conexão caiu **depois** de mandar a publicação. **Não tenta de novo** de propósito — publicar duplicado é pior que não publicar. Exige conferência humana |

Regras que valem a pena não esquecer:

- **A fila cobra a data, não espera por ela.** Mandar pra fila um post com data passada publica na
  varredura seguinte. Por isso "Reativar" devolve pra `draft`, nunca direto pra `queued`.
- **Claim atômico**: `UPDATE ... WHERE status='queued'` garante que duas execuções do cron não
  publiquem o mesmo destino.
- **Sweep de travados**: `publishing` parado além do limite volta pra `queued`.
- **Desconectar exige recusa, não tropeço.** A varredura de saúde de token (Step 0) roda a cada
  tique e renova o que está perto de vencer. Quando a renovação falha, quem decide é o
  `classifyError()`: só marca `needs_reauth` se a recusa for DEFINITIVA — a plataforma disse não ao
  `refresh_token` (`auth`), um 4xx que não muda tentando de novo (`permanent`), ou a rede não tem
  renovação automática (LinkedIn e Meta lançam com `code: 'no_refresh_mechanism'`). Passageiro
  (`retryable`, `quota`) NÃO desconecta: a conta segue ativa e a varredura seguinte tenta de novo.
  Antes era um `catch` só, e qualquer erro desconectava — com o cron de minuto em minuto, um 500 do
  Google ou um 429 da TikTok derrubava conta com token perfeitamente vivo. Se a plataforma ficar
  fora do ar até o token vencer, quem marca é a falha na publicação, que classifica do mesmo jeito.
- **Nem todo erro reenfileira.** O `classifyError()` do adapter decide: `retryable` volta pra fila
  (15min entre tentativas, até `MAX_ATTEMPTS`), `quota` espera 24h, `auth` marca a conta como
  `needs_reauth`, e **`permanent` falha na primeira**. Pra isso funcionar o adapter tem que jogar
  `ApiError` (via `apiError()`), que carrega o STATUS: sem ele, tudo que não casa na tabela de
  códigos vira `retryable` e uma recusa definitiva custa cinco tentativas e uma hora. A tabela de
  códigos é consultada ANTES do status, e é ela que impede um caso perigoso — a Meta responde
  limite de requisição como `OAuthException` com HTTP 400, e sem a tabela ele viraria `permanent`.
- **Recheck com cadência**: quem está em `processing` não é reconsultado a cada tique. `updated_at`
  é congelado na entrada (nunca bumpado por um recheck), então ele é a idade do processamento, e
  `next_check_after` diz quando perguntar de novo: sem espera nos 5 primeiros minutos, 5min até os
  30, 15min depois. É o que transforma o pior caso de 6h em ~30 chamadas à plataforma em vez de 360.

## 4. Formato do post

O formato é **escolhido** no compositor, não deduzido do arquivo — porque no Instagram ele muda o
`media_type` do container, o que é uma diferença real de API.

| Rede | Formatos | Efeito |
| --- | --- | --- |
| **Instagram** | Post · Reel · Story | `media_type` = `VIDEO`/ausente · `REELS` · `STORIES` |
| **YouTube** | Vídeo · Short | Nenhum na API — o YouTube classifica sozinho (vertical, ≤3min). A escolha só ajusta preview e avisos |
| Demais | um só | Sem seletor |

**Instagram em detalhe:**

| | Mídia | Carrossel | Capa | Legenda |
| --- | --- | --- | --- | --- |
| **Post** | foto ou vídeo | até 10 imagens | só frame (`thumb_offset`) | sim |
| **Reel** | um vídeo | não | imagem própria (`cover_url`) ou frame | sim |
| **Story** | um arquivo | não — mas **vários Stories seguidos sim** (um post por arquivo, espaçados de 1min) | não | **ignorada** |

**Reel de teste** (`options.trial_graduation`): o Reel sai só pra quem **não segue** a conta, você
mede o desempenho, e depois ele "gradua" — vira Reel normal, entra no feed de quem segue e aparece
no perfil. Na API é o mesmo container de Reel com um `trial_params` a mais, e por isso é OPÇÃO do
Reel e não um quarto formato: o critério pra ser formato, aqui, é mudar o `media_type`.

| Valor | Quem gradua |
| --- | --- |
| ausente | não é teste — sai pra todo mundo na hora |
| `MANUAL` | você, dentro do app do Instagram |
| `SS_PERFORMANCE` | o Instagram, sozinho, se o desempenho com não-seguidores justificar |

Três consequências que não são óbvias:

1. **Exige conta profissional (Criador ou Empresa) e perfil público** — isso é firme. Um mínimo de
   ~1.000 seguidores e um teto diário de testes são **relatados e não documentados**: aparecem em
   várias fontes do setor, atribuídas a um AMA do Instagram, mas a Meta não publica nenhum dos dois,
   e os tetos que circulam divergem. O compositor separa as duas coisas de propósito — dar relato
   como regra faz a pessoa desistir de algo que talvez possa fazer. De um jeito ou de outro não dá
   pra recusar na criação (a contagem não está do nosso lado), então ele **avisa** em vez de
   bloquear; quem recusa de fato é a Meta, na publicação.
2. **Enquanto está em teste ele não aparece no perfil.** Some da grade do Instagram até graduar; ver
   `web/src/lib/gridTiles.ts`, que usa o feed real como autoridade sobre o que está no perfil.
3. **A graduação não nos avisa.** Acontece dentro do app (MANUAL) ou sozinha (SS_PERFORMANCE), sem
   webhook nem campo consultável — daí a grade descobrir pelo feed em vez de por um estado nosso.

**Abrir pra todo mundo não tem API.** Não existe endpoint de graduação: com `MANUAL` o passo final
é dentro do app do Instagram, e é lá que ficam os números do teste comparados aos seus Reels de
sempre. O que o produto faz é fechar o ciclo até a porta:

| Peça | O que faz |
| --- | --- |
| `atencao.testes_para_decidir` (`/api/summary`) | conta os testes `MANUAL` publicados entre 72h e 7 dias atrás |
| `teste_a_decidir` | o mais antigo deles, pra pendência abrir NUM post em vez de numa lista |
| pendência no Painel e no sino | "Reel de teste rodou — decidir no app do Instagram". **Não é `grave`**: nada quebrou |
| `PostDialog` | diz que o Reel está em teste, desde quando, e que o passo final é no app |
| `external_url` do Instagram | o link pro post, capturado na publicação (ver abaixo) |

A janela de 72h–7 dias é uma **aproximação deliberada**: o lembrete não tem como se apagar sozinho
ao ser atendido, e sem teto seria o único número do painel impossível de zerar — aviso que nunca sai
é aviso que se aprende a ignorar. O preço: graduou no dia 2, ele insiste até o dia 7; ignorou, some
sozinho. Constantes em `TESTE_DECISAO_*` (`src/api.ts`).

**`external_url` do Instagram**: o adapter passou a buscar o `permalink` logo depois do
`media_publish`. Era a única rede que publicava sem link (Facebook, Pinterest e YouTube montam a URL
a partir do id; o Instagram usa um shortcode que a API não deriva). Essa busca **nunca lança**: nesse
ponto o post já saiu, e deixar um erro subir faria o poller republicar — o pior desfecho possível
(princípio 6).

Posts criados antes do seletor não têm `options.format`; o adapter cai na regra antiga
(`as_story`, e vídeo = Reel).

## 5. Limites por rede

Fonte da verdade: o `validate()` de cada adapter (`src/adapters/*.ts`). O que está em
`web/src/lib/platforms.ts` é **espelho para o cliente** — serve pra avisar antes do envio, nunca
pra decidir.

| Rede | Legenda¹ | Máx. arquivos | Vídeo no carrossel | Duração do vídeo | Proporção |
| --- | --- | --- | --- | --- | --- |
| Instagram | 2.200 | 10 | ✅ | 3s–15min (Story: 60s) | foto de feed **4:5 a 1.91:1** (recusa fora disso) |
| Facebook | 5.000 | 10 | ❌ | até 20min | — |
| LinkedIn | 3.000 | 20 | ❌ | 3s–30min | — |
| Pinterest | 500 | 5 | ❌ | 4s–5min | — |
| YouTube | 5.000 | 1 vídeo | — | até 12h | — |
| TikTok | 2.200 | 1 vídeo | — | até 10min (o teto real vem do `creator_info` da conta) | — |

¹ O limite de legenda é o **único** da tabela que não passa pelo `validate()` — ele existe só como
aviso no compositor (`PLATFORM_CAPTION_LIMITS`). Quem corta o excesso é a própria rede.

**Formatos de arquivo:** JPEG, PNG, MP4, MOV. RAW de câmera (`.ARW`/`.CR2`/`.NEF`) é recusado na
entrada — passa num filtro `image/*` e sobe, mas toda rede recusa na hora de publicar.

**Quem precisa de `public_url`:** Instagram, Facebook (posts com mídia) e Pinterest — a plataforma
busca os bytes sozinha, então o domínio customizado do R2 é obrigatório pra eles. YouTube, LinkedIn
e TikTok recebem os bytes direto.

**Proporção:** a única regra dura é a da Meta para foto de feed. Fora dela a API recusa o container
— não corta nada por conta própria. Por isso o dashboard oferece o recorte antes do upload. Note que
a grade 3:4 do perfil do Instagram é **recorte de capa**, coisa diferente: não tem relação com o que
a API aceita.

## 6. API

Tudo atrás do gate de dashboard (Basic Auth via `DASHBOARD_PASSWORD`) **menos** `/oauth/callback/*`
e `/privacy`, que são acessados por quem não tem como apresentar credencial.

| Método | Rota | Papel |
| --- | --- | --- |
| GET | `/api/accounts` | contas conectadas (nunca devolve token) |
| GET | `/api/summary` | o Painel: destinos por status, o que travou, os 5 próximos a sair e os Reels de teste esperando decisão. Existe no servidor porque `/api/posts` é filtrada e paginada — um painel não pode mudar de número por causa de um filtro ligado noutra tela, nem contar "publicados" até o teto da página |
| GET | `/api/state` | contas + agenda + pilares + resumo numa resposta só — é o que o poll do dashboard chama. Composição dos quatro handlers acima, não uma quinta query: requisição é o recurso contado do plano grátis do Workers, e o poll era quem mais gastava (4 por ciclo) |
| GET | `/api/connect/:rede` | 302 pro consentimento, com nonce CSRF em cookie |
| GET | `/api/posts` | agenda, com filtro de status/plataforma |
| POST | `/api/posts` | cria; roda o `validate()` de cada adapter na entrada |
| PATCH | `/api/posts/:id` | edita; trancado se algum destino passou de `queued` (cancelado e falhou continuam editáveis) |
| POST | `/api/posts/reschedule` | permuta os `scheduled_for` entre os posts dados — o conjunto de horários é invariante |
| POST | `/api/post-targets/:id/queue` · `/cancel` · `/reactivate` | transições de status |
| DELETE | `/api/post-targets/:id` | apaga o destino, e o post junto se era o último |
| POST | `/api/media` | upload direto (≤60MB) |
| PUT/DELETE | `/api/profile/avatar` | avatar do usuário: guarda as ESCOLHAS (~140 bytes de JSON), não uma imagem. O desenho é montado no navegador pelo Open Peeps (CC0), então não há upload, cota nem purge. Toda variante passa por allowlist (`src/lib/avatar.ts`) porque o valor volta pra dentro de um `<svg>`. Nulo = usa o padrão derivado do id, ninguém fica sem rosto |
| POST/PUT | `/api/media/multipart/*` | upload em partes — acima de 60MB estoura o limite de corpo (100MB) e de memória (128MB) do Worker |
| GET | `/api/media/:id/bytes` | os bytes pela nossa origem, pro recorte no navegador não sujar o canvas |
| GET | `/api/feed/:accountId` | feed real da conta, ao vivo (Instagram e YouTube) |
| GET | `/api/accounts/:id/commenters` | "quem comenta com você" — agregado de `post_comments` (não busca ao vivo; comentário não expira como URL de mídia) |
| GET/POST/PATCH/DELETE | `/api/grid-previews` | ideias: texto e/ou imagem, sem data. Recusa as duas vazias |
| GET/POST/PATCH/DELETE | `/api/tags` | pilares de conteúdo. Nome repetido devolve o existente; apagar o pilar não apaga as peças |
| POST | `/api/legenda` | três sugestões de legenda pelo Workers AI, no tom dos posts do próprio dono que mais engajaram naquele pilar. Teto de 20 por dono por dia (`ai_usage`), devolvido quando o modelo falha |

## 7. Princípios

1. **O servidor é a autoridade.** O `validate()` do adapter decide o que é publicável; o cliente só
   antecipa o aviso. Nunca mover uma regra de plataforma pro front.
2. **Falhar na criação, não na publicação.** Um post que vai quebrar é recusado na hora de agendar,
   com a mesma mensagem que apareceria no poller — quando a pessoa ainda está olhando pro arquivo.
3. **Aviso diz o que fazer.** "Anexe um arquivo", não "mídia obrigatória"; e junto do campo que o
   causou, não num bloco no rodapé.
4. **Nada de beco sem saída.** Toda peça tem uma saída: cancelado reativa, falhou reativa ou
   exclui, foto fora de proporção recorta.
5. **Não inventar data.** Reordenar redistribui os horários que já existem; nunca cria novos nem
   deixa buraco.
6. **Ambíguo não se repete.** Na dúvida entre não publicar e publicar duas vezes, não publica.

## 8. Onde as coisas moram

| Assunto | Arquivo |
| --- | --- |
| Poller, claim, sweeps, callbacks OAuth | `src/worker.ts` |
| Endpoints do dashboard | `src/api.ts` |
| Regra de cada rede (autoridade) | `src/adapters/<rede>.ts` |
| Cifragem de token | `src/lib/crypto.ts` |
| Content-Security-Policy (hashes dos blocos embutidos) | `src/lib/csp.ts` |
| URLs de consentimento (Worker + CLIs) | `src/lib/oauth-urls.ts` |
| Prompt e teto da legenda por IA | `src/lib/legenda.ts` |
| Espelho das regras no cliente | `web/src/lib/platforms.ts` |
| Matemática de reordenação da grade | `web/src/lib/gridOrder.ts` |
| Design system visual | [`web/design.md`](web/design.md) |
