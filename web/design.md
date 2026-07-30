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

Cores, raios e tipografia vêm do tema do shadcn em `src/index.css` (variáveis CSS em `oklch`, tema
Nova/slate). Use sempre as classes utilitárias semânticas do shadcn — nunca hex solto:

- Superfícies: `bg-background`, `bg-card`, `bg-muted`, `bg-secondary`
- Texto: `text-foreground`, `text-muted-foreground`
- Ação primária: `bg-primary` / `text-primary-foreground`; destrutiva: `variant="destructive"`
- Bordas: `border` (usa `--border`); raio base `--radius` (0.625rem) e derivados `rounded-md/lg/xl`
- Fonte: Geist (variável `--font-sans`), já aplicada no `body`

**Exceção deliberada — cores de marca das plataformas.** `PLATFORM_COLORS` (em
`src/lib/platforms.ts`) tem os hex oficiais (YouTube #FF0000, LinkedIn #0A66C2, Instagram #E1306C,
Facebook #1877F2, Pinterest #E60023, TikTok #111827). Use só nos indicadores de plataforma (o
pontinho, a borda-esquerda de chips/tiles, o avatar do preview) — nunca como cor de UI geral.

## Componentes-chave (`src/components/`)

| Componente | Papel |
| --- | --- |
| `PostComposer` | Formulário de criação: campos, fila de mídia, dicas, preview ao vivo, rascunho. |
| `MediaQueueGrid` | Grade de thumbnails da fila de mídia do composer — arrastar reordena (mesmo padrão de DnD do `GridPlanner`), hover revela trocar/remover. Trocar substitui só aquele slot (mesma posição), sem desmontar a ordem dos outros. |
| `AccountPicker` | Seletor de contas de destino do composer — chips (`ToggleGroup` multi-seleção do shadcn) em vez de lista de checkbox; conta inativa fica desabilitada com `Tooltip` explicando o motivo. |
| `PostPreview` | Card que imita o formato de cada rede (IG quadrado, YouTube 16:9, Story 9:16, Pinterest 3:4). Reusado no composer e no dialog. |
| `ListView` | Lista agrupada por dia, thumbnail real, badge de status, ações inline. |
| `CalendarView` | Grade mensal; chip por post (cor = plataforma, tracejado = rascunho, ⚠ = falhou). Clique em dia vazio pré-preenche a data. |
| `GridPlanner` | Grade 3-colunas do Instagram, arrastável (HTML5 DnD + `layout` do motion), com Desfazer. |
| `PostDialog` | Detalhe do post: preview "Como vai ficar" + ações (duplicar / mover p/ fila / cancelar). |
| `AlertBanner` | Barra de falhas/reautenticação no topo. |
| `Thumb` | Thumbnail pequeno com fallback pra glyph quando a URL não resolve. |

## Padrões

- **Estado global**: `SchedulerProvider` (`src/store.tsx`) expõe `accounts`, `posts`, `filters`,
  `reload`. Poll de 30s. Componentes chamam `reload()` após mutações.
- **Comunicação composer ⇄ views**: bus pub-sub minúsculo (`src/lib/composer-bus.ts`) —
  `requestPrefill` (duplicar) e `requestPrefillDate` (clicar num dia). Evita prop-drilling.
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
