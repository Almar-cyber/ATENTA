# Design system — Social Scheduler dashboard

O frontend (`web/`) é um app Vite + React + TypeScript + Tailwind v4 + shadcn/ui (preset **Nova**:
Radix primitives, ícones Lucide, fonte Geist) com animações via **motion** (motion.dev). Build sai
em `../dist`, servido pelos static assets do Cloudflare Worker. Este documento é a referência de
design — leia antes de criar telas ou componentes novos, pra manter tudo coerente.

## Princípios

1. **A pré-visualização é o herói.** O usuário decide o que postar olhando como fica, não lendo
   campos. Todo fluxo de criação/edição mostra o `PostPreview` da plataforma alvo.
2. **Feedback imediato, validação em duas camadas.** Dicas no composer avisam antes do envio
   (limite de caracteres, mídia obrigatória, limite de carrossel); o servidor continua sendo a
   autoridade (`validate()` de cada adapter). Nunca confie só no cliente.
3. **Status legível num relance.** Cor por plataforma + badge de status + tratamento visual na
   própria peça (linha vermelha = falhou, borda tracejada = rascunho). Ver `STATUS_META`.
4. **Movimento com propósito.** Animações comunicam mudança de estado (troca de view, item novo na
   fila, reordenação do grid), nunca decoram à toa. Duração curta (120–200ms).

## Tokens

Cores, raios e tipografia vêm do tema em `src/index.css` (variáveis CSS em `oklch`). A paleta é
**branca/neutra com acento dourado/âmbar** (`--primary`): fundo branco, blocos de conteúdo em cinza
claro levemente frio, dourado só nos realces (botões, estado ativo, "hoje", foco). Use sempre as
classes utilitárias semânticas — nunca hex solto:

- Superfícies: `bg-background` (branco), `bg-card`, `bg-muted`/`bg-secondary` (blocos cinza)
- Texto: `text-foreground`, `text-muted-foreground`
- Ação primária: `bg-primary` / `text-primary-foreground` (dourado, texto escuro); destrutiva: `variant="destructive"`
- Bordas/sombra: `border` (usa `--border`); cards flutuam com `shadow-soft` + `ring-1 ring-foreground/5`
- Raio base `--radius` (**1rem**) e derivados `rounded-md/lg/xl/2xl`
- Fonte: Geist (variável `--font-sans`), já aplicada no `body`

**Exceção deliberada — cores de marca das plataformas.** `PLATFORM_COLORS` (em
`src/lib/platforms.ts`) tem os hex oficiais (YouTube #FF0000, LinkedIn #0A66C2, Instagram #E1306C,
Facebook #1877F2, Pinterest #E60023, TikTok #111827). Use só nos indicadores de plataforma (o
pontinho, a borda-esquerda de chips/tiles, o avatar do preview) — nunca como cor de UI geral.

## Componentes-chave (`src/components/`)

| Componente | Papel |
| --- | --- |
| `PostComposer` | Formulário de criação, aberto num **modal amplo em split** (form à esquerda, preview ao vivo à direita) pelo botão "Novo post". Campos em **cascata**: só mostra Contas de destino no início; o resto (legenda, quando, mídia) aparece após escolher ≥1 conta, e os específicos são gated por rede (Título só YouTube, Story só Instagram, board só Pinterest). |
| `MediaCropDialog` | Recorte com arrastar: a imagem entra em "cover" no quadro, a pessoa arrasta/aproxima e escolhe entre 4:5, 1:1 e 1.91:1 (as proporções que a API da Meta publica). Devolve um `File` novo — o original não é enviado. Abre sozinho quando uma foto fora da faixa entra na fila com Instagram/Facebook selecionados, e manualmente pelo ✂ no tile. |
| `MediaQueueGrid` | Grade de thumbnails da fila de mídia do composer — arrastar reordena (mesmo padrão de DnD do `GridPlanner`), hover revela trocar/remover. Trocar substitui só aquele slot (mesma posição), sem desmontar a ordem dos outros. |
| `AccountPicker` | Seletor de contas de destino do composer — chips (`ToggleGroup` multi-seleção do shadcn) em vez de lista de checkbox; conta inativa fica desabilitada com `Tooltip` explicando o motivo. |
| `PostPreview` | Card que imita o formato de cada rede (IG quadrado, YouTube 16:9, Story 9:16, Pinterest 3:4). Reusado no composer e no dialog. |
| `ListView` | Lista agrupada por dia, thumbnail real, badge de status, ações inline. |
| `WeekView` | Vista "Semana": grade horas × 7 dias, cada post na sua hora agendada; clique em slot vazio pré-preenche data/hora. |
| `CalendarView` | Vista "Mês": grade mensal; chip por post (cor = plataforma, tracejado = rascunho, ⚠ = falhou). Clique em dia vazio pré-preenche a data. |
| `GridPlanner` | Grade 3-colunas do Instagram, arrastável (HTML5 DnD + `layout` do motion), com Desfazer. Três espécies de tile — **agendado**, **publicado** (registro nosso + feed real, âncoras) e **prévia** (imagem sem post, borda tracejada dourada). A matemática de reordenação fica em `src/lib/gridOrder.ts`, fora do componente. |
| `PostDialog` | Detalhe do post em **split** (dados/ações à esquerda, preview "Como vai ficar" à direita). |
| `ConnectionsView` | Tela "Conexões" (botão no header): grid de cards por rede com as contas conectadas + status e botão "Conectar" que navega pra `/api/connect/:rede` (OAuth). Várias contas por rede aparecem como linhas separadas. YouTube fica "em breve" (ainda usa CLI). |
| `PlatformIcon` | Logo oficial de cada rede (SVG inline), colorido por `PLATFORM_COLORS`. Use onde a rede precisa ficar clara (lista, semana, chips, header, preview, dialog). |
| `AlertBanner` | Card recuado de falhas/reautenticação no topo. |
| `Thumb` | Thumbnail pequeno com fallback pra glyph quando a URL não resolve. |

## Padrões

- **Estado global**: `SchedulerProvider` (`src/store.tsx`) expõe `accounts`, `posts`, `filters`,
  `reload`. Poll de 30s. Componentes chamam `reload()` após mutações.
- **Comunicação composer ⇄ views**: bus pub-sub minúsculo (`src/lib/composer-bus.ts`) —
  `requestPrefill` (duplicar), `requestEdit` (editar o post inteiro), `requestPrefillDate` (clicar
  num dia/slot vazio) e `requestPrefillMedia` (agendar uma prévia do grid — só a mídia). O modal do
  composer fica sempre montado (translate/opacity, não desmonta) pra
  manter as assinaturas vivas e abrir já com o payload aplicado. Evita prop-drilling.
- **Modais em split**: prefira layout horizontal (dados/form à esquerda, preview à direita) a scroll
  vertical longo; limite a altura de mídia/preview (`PostPreview` corta em ~340px e mostra faixa
  "sem mídia" em vez de estourar formatos verticais). Ver `PostDialog` e `PostComposer`.
- **CTAs primários**: ação principal usa `size="lg"` (grande, uppercase, dourado); secundária fica
  `variant="outline"`.
- **Conexão de contas (OAuth pelo app)**: o botão "Conectar" navega o top-level pra
  `/api/connect/:rede` (o Worker monta a URL de consentimento e redireciona); ao voltar, o callback
  redireciona pra `/?connected=<rede>` e o `Dashboard` (efeito no mount) lê o param, dá `reload()` e
  abre o modal de sucesso. Meta cobre Instagram+Facebook juntos; várias contas por rede convivem
  (o schema é `unique(platform, external_account_id)`, ver migração 0002).
- **Toasts**: `sonner` (`toast.success/error`) pra todo feedback de ação; nunca `alert()`.
- **Aspects do preview**: `PLATFORM_PREVIEW_SHAPE` mapeia plataforma → proporção. Story sempre 9:16.
- **Motion**: entradas de lista com stagger sutil (`delay: i*0.015`, teto 0.3s); troca de view com
  fade+slide de 150ms (evite `AnimatePresence mode="wait"` numa view que também sofre poll —
  já causou um freeze real, ver `App.tsx`: prefira remount-and-fade via `key`); itens da fila de
  mídia com `layout`.
- **Drag-and-drop nativo**: `GridPlanner` e `MediaQueueGrid` usam o mesmo padrão — HTML5
  `draggable`/`onDragStart`/`onDragOver`(`preventDefault`)/`onDrop`, sem lib externa. Reaproveite
  esse padrão em vez de introduzir uma dependência de DnD nova.
- **`useMediaUrl`** (`src/lib/useMediaUrl.ts`): resolve um `QueuedMedia` pra URL exibível (object
  URL pro `File` ainda não enviado, com revoke no cleanup; `public_url` pro que já foi upload).
  Compartilhado por `PostPreview` e `MediaQueueGrid` — não duplicar essa lógica.

## Ao adicionar algo novo

1. Precisa de um componente shadcn ainda não instalado? `npx shadcn@latest add <nome>` dentro de `web/`.
2. Cor nova de UI? Não invente hex — use um token existente ou estenda o tema no `index.css`.
3. Nova plataforma? Adicione em `PLATFORM_*` (labels, cores, limites, shape) — os componentes leem
   desses mapas, não têm plataforma hard-coded.
4. Rode `npm run build` em `web/` (typecheck + bundle) antes de considerar pronto.
