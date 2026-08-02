# Specs — Insights & Analytics (proposta)

Plano do módulo de **métricas + dashboard de indicadores + insights por IA**. Este documento é a
especificação da feature **antes** de escrever código — modelo de dados, endpoints exatos de cada
rede, cadência de coleta e o plano em fases.

- Specs do produto atual → [`design.md`](design.md)
- Design system visual → [`web/design.md`](web/design.md)

> **Status: proposta.** Nada aqui está implementado. A Fase A é o alvo imediato.

---

## 1. Objetivo

Sair de "publiquei" para "funcionou?". Três camadas, em ordem de dependência:

1. **Coletar** as métricas reais de cada post publicado (alcance, engajamento, etc.), ao longo do
   tempo — não um retrato único, porque a métrica cresce.
2. **Mostrar** num dashboard de indicadores: o que deu certo, por formato/horário/conta, tendências.
3. **Interpretar** com IA (Gemini): transformar os números em recomendações em linguagem natural.

A regra que rege tudo: **lixo entra, lixo sai.** A camada 3 só vale quando a 1 tem dado acumulado.
Por isso a coleta vem primeiro e a IA por último.

## 2. O gargalo real — escopos e acesso por rede

O nosso código não é o limite; a **permissão de cada API** é. As métricas exigem escopos que não
pedimos no consentimento original (`src/lib/oauth-urls.ts`), então cada rede precisa de **escopo
novo + reconexão da conta**. Pior: algumas redes não expõem o dado no nosso nível de acesso.

| Rede | Escopo hoje | Escopo a **adicionar** | Endpoint de métrica | Confiança |
| --- | --- | --- | --- | --- |
| **Instagram** | `instagram_basic, instagram_content_publish, pages_*` | `instagram_manage_insights` | `GET /{ig-media-id}/insights` · `GET /{ig-user-id}/insights` | 🟢 alta |
| **Facebook** | `pages_read_engagement, pages_manage_posts` | `read_insights` | `GET /{post-id}/insights` · `GET /{page-id}/insights` | 🟢 alta |
| **YouTube (básico)** | `youtube.upload, youtube.readonly` | **nenhum** — já dá | `GET /youtube/v3/videos?part=statistics&id=…` | 🟢 alta |
| **YouTube (avançado)** | idem | `yt-analytics.readonly` | `GET /v2/reports` (YouTube **Analytics** API) | 🟡 média |
| **Pinterest** | `boards:read, pins:read, pins:write` | analytics + **Standard access** (auditoria) | `GET /v5/pins/{pin_id}/analytics` | 🟡 travado na aprovação |
| **TikTok** | `user.info.basic, video.publish, video.upload` | `video.list` + **auditoria** | `GET /v2/video/query/` | 🔴 bloqueado pré-auditoria |
| **LinkedIn** | `openid profile w_member_social` | — | analytics de post **pessoal** não existe self-serve | 🔴 inviável |

**Conclusão de escopo:** a Fase A cobre **Instagram + Facebook + YouTube básico** — 80% do valor,
desbloqueável só com reconexão (IG/FB) e zero mudança de escopo (YT básico). O resto espera aprovação
das plataformas.

### 2.1 Métricas por rede (o que cada endpoint devolve)

Nomes de métrica da Meta mudam entre versões da API — confirmar contra a versão em uso (`v21.0`) na
implementação; abaixo é o alvo, não uma citação literal.

- **Instagram — post de feed:** `reach`, `likes`, `comments`, `saved`, `shares`, `total_interactions`.
  (`impressions` foi descontinuada para mídia nova em favor de `views` nas versões recentes.)
- **Instagram — Reel:** `reach`, `likes`, `comments`, `saved`, `shares`, `views`/`plays`,
  `ig_reels_avg_watch_time`.
- **Instagram — Story:** `reach`, `replies`, `taps_forward`, `taps_back`, `exits`.
- **Instagram — conta:** `reach`, `follower_count`, `profile_views` (period=day).
- **Facebook — post:** `post_impressions`, `post_engaged_users`, `post_reactions_by_type_total`,
  `post_clicks`.
- **YouTube — básico (Data API):** `viewCount`, `likeCount`, `commentCount`.
- **YouTube — avançado (Analytics API):** `estimatedMinutesWatched`, `averageViewDuration`,
  `averageViewPercentage`, tráfego por fonte.

## 3. Modelo de dados

Métrica é **série temporal**: cresce após publicar e desacelera. Guardar snapshots ao longo do
tempo mostra velocidade e curva, não só o total final.

```
post_targets ──< post_metrics          (um snapshot por coleta, por destino)
accounts ─────< account_metrics        (série do nível da conta: seguidores, alcance/dia)
```

```sql
-- migração futura (0005). Um snapshot por (destino, momento de coleta).
create table post_metrics (
  id text primary key,
  post_target_id text not null references post_targets(id) on delete cascade,
  external_post_id text not null,          -- redundante com post_targets, mas evita join na coleta
  platform text not null,
  fetched_at text not null,                -- quando ESTE snapshot foi tirado (UTC ISO8601)

  -- Núcleo normalizado — o denominador comum entre as redes. Null = a rede não expõe aquela métrica.
  impressions integer,
  reach integer,
  likes integer,
  comments integer,
  shares integer,
  saves integer,
  video_views integer,
  avg_watch_seconds real,

  raw text not null default '{}',          -- corpo bruto da API, pro que é específico de cada rede
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index post_metrics_target_time on post_metrics (post_target_id, fetched_at desc);

create table account_metrics (
  id text primary key,
  account_id text not null references accounts(id) on delete cascade,
  fetched_at text not null,
  followers integer,
  reach integer,
  profile_views integer,
  raw text not null default '{}',
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index account_metrics_time on account_metrics (account_id, fetched_at desc);
```

**Núcleo normalizado + `raw`:** a UI e a IA leem as colunas normalizadas (comparáveis entre redes);
o `raw` preserva o que é único de cada plataforma sem forçar uma coluna por métrica exótica.

## 4. Coleta

Um passo novo no poller (`scheduled()`), rodando **junto do cron de 10min** que já existe.

**Não coletar tudo a cada 10min.** Métrica nova muda rápido e depois estabiliza; snapshots demais
gastam rate limit à toa. Cadência por idade do post desde `published_at`:

| Idade do post | Frequência de snapshot |
| --- | --- |
| 0–6h | a cada 1h |
| 6–48h | a cada 6h |
| 2–14 dias | 1×/dia |
| > 14 dias | 1×/semana (ou para de coletar) |

Implementação: guardar `next_metrics_at` por destino (mesmo padrão do `next_attempt_at` que já
existe) e o coletor só pega quem venceu. Um destino vira elegível quando `status='published'`.

**Rate limits** — a Meta cobra por app-token/hora; coletar em lote pequeno por varredura e respeitar
o teto. Falha de coleta **nunca** derruba a publicação (mesma regra do `notify`: log e segue).

**Backfill:** ao ligar a feature, uma coleta inicial pega o estado atual de tudo que já está
publicado — vira o snapshot t0.

## 5. Dashboard "Insights"

Nova aba/tela, reusando o design system (cards, cores de plataforma, `PostHoverCard`, etc.).

- **Visão por post:** cada publicado com seus números atuais + mini-sparkline da evolução.
- **Agregados:** taxa de engajamento média, **melhor horário** (engajamento × hora do dia), **melhor
  formato** (Reel vs Post vs Story), **melhor conta**, tendência de seguidores.
- **Comparações:** este post vs a média da conta; formato A vs B.
- **Filtros:** por conta, plataforma, período, formato — os mesmos que a agenda já tem.

Regra de design que já vale: número sozinho não é insight; sempre com um comparativo ("+40% vs sua
média") pra ter significado. Segue o princípio 1 do `web/design.md` (a peça é o herói) — aqui o
**delta** é o herói, não o valor absoluto.

## 6. Camada de IA (Gemini)

Tecnicamente a parte mais simples: uma chamada de API com um bom prompt. Entram os **agregados** (não
linha a linha) + as legendas; sai insight qualitativo e recomendações.

- **Entrada:** JSON com os agregados por formato/horário/conta + amostras de legenda dos melhores e
  piores posts.
- **Saída:** 3–5 recomendações acionáveis ("Reels engajam 3× mais que posts estáticos — priorize";
  "legendas com pergunta recebem mais comentários"; "depois das 18h vai melhor").
- **Modelo:** Gemini via API do Google (`generativelanguage.googleapis.com`). Secret novo
  `GEMINI_API_KEY` no Worker.
- **Custo / $0-mês:** o free tier do Gemini tem limite de requisições. Estratégia: gerar insight
  **sob demanda** (ao abrir a tela) e **cachear** o resultado (ex.: 1×/dia por conta), nunca por
  post. Assim cabe no alvo de custo zero.
- **Guarda:** a saída da IA é sugestão, não verdade — rotular como tal na UI. E o insight é só tão
  bom quanto o dado das Fases A/coleta.

## 7. Fases

1. **Fase A — coleta + dash básico** (desbloqueado agora): reconectar IG/FB com escopo de insights,
   `post_metrics`/`account_metrics`, coletor no cron, tela de números reais. YouTube básico entra
   sem reconexão.
2. **Fase B — insights de IA:** só depois de A ter dado acumulado; Gemini sobre os agregados.
3. **Fase C — Pinterest/TikTok:** quando as auditorias/Standard access passarem.
4. **YouTube avançado** (watch time/retenção) e **LinkedIn**: fora de escopo até haver caminho de API.

## 8. Riscos e decisões em aberto

- **Reconexão obrigatória** (IG/FB) — o usuário precisa passar pelo consentimento de novo com o
  escopo novo. Sem isso, nada de Instagram/Facebook.
- **Nomes de métrica da Meta** mudam por versão da API — confirmar contra `v21.0` na implementação.
- **Pinterest/TikTok** dependem de aprovação das plataformas, fora do nosso controle (mesma espera do
  publish).
- **Volume no D1** — série temporal cresce, mas em escala pessoal (poucos posts/dia × poucos
  snapshots) é irrisório pro free tier. Reavaliar só se virar multi-usuário.
- **Fuso** — "melhor horário" precisa do fuso do usuário; hoje guardamos tudo em UTC. Definir o fuso
  de referência antes de agregar por hora do dia.

## 9. Onde as coisas vão morar

| Assunto | Arquivo (proposto) |
| --- | --- |
| Coletor de métricas (passo do cron) | `src/worker.ts` (novo `stepCollectMetrics`) |
| Busca de métrica por rede | `src/adapters/<rede>.ts` (novo método `fetchMetrics`) ou `src/metrics/<rede>.ts` |
| Escopos de insights | `src/lib/oauth-urls.ts` |
| Schema | `migrations/0005_metrics.sql` |
| Endpoints do dash de insights | `src/api.ts` (`/api/metrics/*`) |
| Camada Gemini | `src/lib/insights.ts` (+ secret `GEMINI_API_KEY`) |
| Telas de insights | `web/src/components/Insights*.tsx` |
