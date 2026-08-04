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

## Psicologia aplicada (referência: [growth.design/psychology](https://growth.design/psychology))

Estes não são enfeite — são o critério pra decidir se uma tela está pronta. **Toda lista, grade ou
bloco de números novo passa por eles antes de fechar.**

| Princípio | O que exige | Onde já vale |
| --- | --- | --- |
| **Lei de Miller** (7±2) | Nunca despejar mais que ~6 itens de uma vez. O resto fica atrás de "ver mais". | `Comentaristas` (1 + 5 + resto), `Summary.proximos` (teto de 5) |
| **Efeito Von Restorff** | Se um item é *estatisticamente* diferente, ele tem que **parecer** diferente. Lista onde tudo tem o mesmo peso visual não comunica nada. | 1º comentarista em destaque; pendência `grave` em vermelho |
| **Posição serial** | O que importa vai no começo. O meio de uma lista longa é onde a informação morre. | Pendências ordenadas da mais urgente; ranking explícito |
| **Lei de Hick** | Menos opções visíveis = decisão mais rápida. Cauda longa fica colapsada. | "Ver mais N pessoas"; filtros dentro do `FilterMenu`, não soltos na barra |
| **Chunking + proximidade** | Agrupar por algo que **signifique** — e o agrupamento tem que sobreviver aos dados reais, não só ao caso imaginado. | Ideias por pilar; lista da Agenda por dia |
| **Ancoragem** | Um número solto não tem escala. "20 pessoas" numa lista truncada mente; "102 pessoas comentaram" ancora. | Total em `Comentaristas`; "somando N publicações" no Painel |
| **Carga cognitiva** | Data absoluta obriga conta de cabeça. Tempo relativo já entrega a conclusão. | `fmtQuando` (futuro), `fmtHaQuantoTempo` (passado) |

**A regra que mais pega na prática**: agrupamento que parece óbvio no papel pode colapsar nos dados
reais. "Comentou nos últimos 30 dias" parecia o corte natural pra `Comentaristas` — mas o comentário
mais recente da conta real era de nove meses atrás, e *todo mundo* cairia num balde só. Antes de
escolher um agrupamento, **consulte a distribuição real no banco**.

## Tokens

Cores, raios e tipografia vêm do tema em `src/index.css` (variáveis CSS em `oklch`). A paleta é a da
marca **ATENTA!**: fundo branco, **texto preto**, a "tinta" brutalista (bordas e sombras deslocadas)
em **roxo #52277F** (`--brand`) e o destaque/ação em **amarelo #FCEC0E** (`--primary`, com texto
preto por cima, alto contraste — é o combo do próprio logo). O amarelo vivo fica **contido nos
realces** (botão, estado ativo, "hoje"); como fundo de área grande cansaria, o fundo é branco. Use
sempre as classes utilitárias semânticas — nunca hex solto:

- Superfícies: `bg-background` (branco), `bg-card`, `bg-muted`/`bg-secondary` (blocos cinza levemente arroxeados)
- Texto: `text-foreground` (**preto**), `text-muted-foreground` (roxo dessaturado)
- Ação primária: `bg-primary` / `text-primary-foreground` (amarelo, texto preto); destrutiva: `variant="destructive"`
- **Tinta brutalista**: `border-brand` + `shadow-[Npx_Npx_0_0_var(--brand)]` (roxo). É o `--brand`, **não** o `--foreground` — separados de propósito, pra borda ser roxa e texto continuar preto.
- Borda leve (inputs/divisórias): `border` (usa `--border`, levemente arroxeada)
- Links/ênfase: `text-accent-foreground` (roxo legível — amarelo como texto não tem contraste)
- Raio base `--radius` (**1rem**) e derivados `rounded-md/lg/xl/2xl`
- Fonte: Geist (variável `--font-sans`), já aplicada no `body`
- Logo: `web/public/atenta-wordmark.png` (sticker roxo com traço amarelo, pra fundo claro) no header;
  `atenta-wordmark-onpurple.png` (traço branco) pra superfície colorida; `atenta-icon.svg` no favicon.
  **PNG, não SVG, no wordmark** — o SVG deformava o "A" e o "N" em alguns renderizadores.

**Segunda exceção — cores dos pilares de conteúdo.** `TAG_COLORS` (`src/lib/tags.ts`) tem seis tons que não significam nada no sistema; só precisam ser distinguíveis entre si. O banco guarda a CHAVE ('roxo'), nunca o hex, então mudar a paleta é editar um arquivo.

**Exceção deliberada — cores de marca das plataformas.** `PLATFORM_COLORS` (em
`src/lib/platforms.ts`) tem os hex oficiais (YouTube #FF0000, LinkedIn #0A66C2, Instagram #E1306C,
Facebook #1877F2, Pinterest #E60023, TikTok #111827). Use só nos indicadores de plataforma (o
pontinho, a borda-esquerda de chips/tiles, o avatar do preview) — nunca como cor de UI geral.

## Componentes-chave (`src/components/`)

| Componente | Papel |
| --- | --- |
| `PostComposer` | Formulário de criação, aberto num **modal amplo em split** (form à esquerda, preview ao vivo à direita) pelo botão "Novo post". Campos em **cascata**: só mostra Contas de destino no início; o resto (legenda, quando, mídia) aparece após escolher ≥1 conta, e os específicos são gated por rede (Título só YouTube, board só Pinterest). O **formato** (`FormatPicker`) vem logo depois das contas, antes da mídia. |
| `MediaCropDialog` | Recorte com arrastar: a imagem entra em "cover" no quadro, a pessoa arrasta/aproxima e escolhe entre 4:5, 1:1 e 1.91:1 (as proporções que a API da Meta publica). Devolve um `File` novo — o original não é enviado. Abre sozinho quando uma foto fora da faixa entra na fila com Instagram/Facebook selecionados, e manualmente pelo ✂ no tile. |
| `MediaQueueGrid` | Grade de thumbnails da fila de mídia do composer — arrastar reordena (mesmo padrão de DnD do `GridPlanner`), hover revela recortar/trocar/remover. O **tile pontilhado no fim** é quem abre o seletor de arquivos (`onAdd`); o `<input type=file>` fica escondido, porque cru ele comia uma linha inteira do formulário. Trocar substitui só aquele slot (mesma posição), sem desmontar a ordem dos outros. |
| `FormatPicker` | Escolha do formato dentro da rede (Post/Reel/Story no Instagram, Vídeo/Short no YouTube). Vem **antes da mídia** no composer: é o formato que define o que a rede aceita e, no Instagram, o `media_type` do container. Os formatos ficam em `PLATFORM_FORMATS` (`lib/platforms.ts`) — não hard-code plataforma no componente. |
| `AccountPicker` | Seletor de contas de destino do composer — chips (`ToggleGroup` multi-seleção do shadcn) em vez de lista de checkbox; conta inativa fica desabilitada com `Tooltip` explicando o motivo. |
| `PostPreview` | Card que imita o formato de cada rede — a proporção vem do **formato** escolhido, não do arquivo. Vídeo tem play (com som e controles); com capa escolhida, a capa é o que aparece parado e o play toca o vídeo por baixo. Reusado no composer e no dialog. |
| `HomeView` | **Painel** — a tela inicial. Três grades de cards: *Precisa de você* (pendências acionáveis, cada uma leva à Agenda já filtrada), *Sai a seguir* (próximos posts com a capa em destaque) e *Como foi* (números + link pro Insights). A conta de pendências fica em `@/lib/pendencias` (`construirPendencias`), reusada pelo `NotificationsBell` — ver abaixo. |
| `NotificationsBell` | Sino no cabeçalho (substitui a antiga faixa vermelha, sempre visível): abre um `Popover` com as mesmas pendências do Painel. Um ponto vermelho liga só quando há pendência **grave** (falha, conta caída, fila atrasada) — rascunho esperando é acervo normal, não alarme, e um ponto ligado o tempo todo por causa dele treina a ignorá-lo. Balança (rotação via `motion`) quando a pendência grave aparece e a cada 12s enquanto o popover estiver fechado; para de balançar assim que abre. Fica sempre visível, inclusive no Painel — ele não disputa espaço com o bloco "Precisa de você" como a faixa vermelha disputava. |
| `ViewHeader` | Cabeçalho das telas de segundo nível (título, descrição, voltar, ações). Existe porque cada tela montava o seu e eles divergiram. Isola a armadilha do `CardHeader` ser **grid**: passar `flex-row` muda a direção sem mudar o `display`, e cada filho vira uma linha. **Voltar é só pra drill-down de verdade** (Conexões, chegada pelo menu da conta; o detalhe de uma rede dentro do Insights) — nunca nos três destinos de primeiro nível do cabeçalho (Painel, Agenda, Insights), que não têm "de onde voltar". |
| `ListView` | Lista agrupada por dia, thumbnail real, badge de status, ações inline. |
| `WeekView` | Vista "Semana": grade horas × 7 dias, cada post na sua hora agendada; clique em slot vazio pré-preenche data/hora. |
| `CalendarView` | Vista "Mês": grade mensal; chip por post (cor = plataforma, tracejado = rascunho, ⚠ = falhou). Clique em dia vazio pré-preenche a data. |
| `GridPlanner` | Grade 3-colunas do Instagram, arrastável (HTML5 DnD + `layout` do motion), com Desfazer — **à esquerda**, com o `IdeaSidebar` ocupando o resto da largura. Três espécies de tile: **agendado**, **publicado** (âncoras; a capa cai pro feed real quando a nossa cópia já foi apagada pelo purge de 30 dias) e **ideia com arte**. A matemática de reordenação fica em `src/lib/gridOrder.ts`, fora do componente — e agora tem teste (`test/gridOrder.test.ts`). |
| `IdeaSidebar` | A lista de **ideias** ao lado da grade: um post que ainda não tem data. Campo rápido (Enter cria), card com capa/texto, e as ações **anexar arte**, **Agendar** (abre o compositor com o que a ideia tem) e **Remover**. Ideia só de texto **não** entra na grade — a grade mostra como o feed vai ficar, e um quadrado cinza atrapalha essa leitura. Agrupada por pilar (não filtrada): um FILTRO esconde o desbalanço — você vê "viagem" e nunca fica sabendo que "depoimento" está zerado. Agrupar mostra os dois, com todo pilar aparecendo mesmo em 0 posts; é a linha vazia que revela o buraco. |
| `PostHoverCard` | Cartão que aparece ao passar o mouse num chip do calendário (Mês e Semana): thumbnail da peça na proporção do formato, legenda/título, conta, horário e status. Substitui o `title=` do navegador — o chip só cabe o nome da conta, e é a imagem que faz reconhecer o post. |
| `PostDialog` | Detalhe do post em **split** (dados/ações à esquerda, preview "Como vai ficar" à direita). |
| `ConnectionsView` | Tela "Conexões" (botão no header): grid de cards por rede com as contas conectadas + status e botão "Conectar" que navega pra `/api/connect/:rede` (OAuth). Várias contas por rede aparecem como linhas separadas. |
| `TagPicker` / `TagChip` | Escolher (ou **criar na hora**) o pilar de conteúdo. Criar no mesmo lugar de escolher é o que faz isto ser usado: uma tela separada de "gerenciar pilares" custaria sair do fluxo, e pilar que ninguém marca não vira insight. A cor vem de `proximaCor` (a primeira não usada), nunca sorteada — sortear repetiria tons no terceiro pilar. |
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
- **Padrão de tamanho de botão** — três níveis, e nada fora deles:
  - `size="lg"` (h-11, uppercase): **CTA primário** de fluxo — "Novo post", "Agendar post", "Usar
    este recorte". Um por contexto; o secundário ao lado fica `variant="outline"`.
  - `size="default"` (h-8): **controles de barra e de navegação** — o botão de Filtros, "Hoje"/"Esta
    semana", as setas ‹ › do calendário (via `size="icon" className="size-8"`). **Bate com a altura
    da pílula de abas (`TabsList` é h-8)**, então a fileira do topo fica alinhada.
  - `size="sm"` (h-7): **ações terciárias inline** numa linha de lista (Duplicar/Cancelar/Excluir).
  Regra: se está na mesma fileira das abas, é `default` (h-8) — não misture `sm`/`lg` ali.
- **Responsivo dos controles do topo**: header e barra usam `px-3 sm:px-6` (aproveita a lateral no
  mobile). No mobile os CTAs do header dividem a linha (`flex-1`), os avatares de conta somem
  (`hidden sm:flex`) e o botão de Filtros vira **só ícone** (`hidden sm:inline` no rótulo). Os
  filtros moram num popover (`FilterMenu`), não soltos na barra.
- **Card quadrado, não faixa**: numa tela larga, um card de largura total vira uma faixa com o texto
  num canto e o resto vazio — o olho atravessa a tela pra ligar duas pontas que cabiam num palmo.
  Grade de cards altos resolve os dois lados: ocupa a largura em colunas e abre espaço pra
  **hierarquia dentro do card** (número em corpo grande, rótulo, detalhe apagado), coisa que numa
  faixa era tudo texto do mesmo tamanho na mesma linha. Ver `HomeView`. Grades de leitura levam teto
  de largura (`max-w-[1500px]`); sem ele a grade continua esticando e os cards viram faixas de novo.
- **Card clicável vs estático**: no sistema brutalista, o sinal de "clicável" é **levantar no hover e
  afundar no clique** (como os botões). Card de navegação/drill usa
  `transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[5px_5px_0_0_var(--brand)] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none cursor-pointer`;
  card expansível (não navega) usa só `cursor-pointer hover:bg-muted/40`. Card **estático** (stat,
  destaque) não tem hover nenhum — é assim que se distingue um do outro num relance.
- **Scroll**: o container das views é `overflow-hidden` — **quem rola é cada view por dentro**. Nas
  vistas de calendário (Semana/Mês) a barra de navegação é `shrink-0` (fixa) e só a grade rola, com
  o cabeçalho de dias `sticky top-0`. Sem isso, rolar levava a nav junto.
- **Conexão de contas (OAuth pelo app)**: o botão "Conectar" navega o top-level pra
  `/api/connect/:rede` (o Worker monta a URL de consentimento e redireciona); ao voltar, o callback
  redireciona pra `/?connected=<rede>` e o `Dashboard` (efeito no mount) lê o param, dá `reload()` e
  abre o modal de sucesso. Meta cobre Instagram+Facebook juntos; várias contas por rede convivem
  (o schema é `unique(platform, external_account_id)`, ver migração 0002).
- **Superfícies flutuantes** (`Tooltip`, `HoverCard`, `DropdownMenu`, `Select`, `Popover`): mesma linguagem
  dos botões e cards — `border-2 border-foreground` + `shadow-[3px_3px_0_0_var(--foreground)]`, sem
  sombra difusa nem `ring`. O tooltip é claro (`bg-card`), não a pílula escura do preset, e não tem
  seta: um losango girado não carrega a borda de 2px sem emendar torto.
- **Toasts**: `sonner` (`toast.success/error`) pra todo feedback de ação; nunca `alert()`. Mesma
  estética das outras superfícies — fundo claro, borda preta de 2px, sombra deslocada sólida. O
  `richColors` fica só no ícone e no texto (verde/vermelho); o bloco pastel de fundo foi trocado
  por `var(--card)`. As classes precisam de `!`: o sonner traz o próprio `box-shadow` difuso na
  folha de estilo dele, com especificidade maior que a das utilitárias.
- **Aspects do preview**: quem manda é o **formato** (`PLATFORM_FORMATS[p].shape`) — Reel/Story/Short são 9:16, post de feed é 4:5. `PLATFORM_PREVIEW_SHAPE` é só o fallback de quem não tem formatos.
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
- **`videoPosterUrl`** (mesmo arquivo): todo `<video>` usado como thumbnail parado tem que passar
  por ela. `preload="metadata"` carrega duração/dimensão mas **não decodifica frame nenhum** — na
  tela vira um retângulo vazio (foi o bug de "o vídeo não aparece"). Ela acrescenta o media fragment
  `#t=0.1`, que força o navegador a buscar aquele instante e desenhá-lo.

## Ao adicionar algo novo

1. Precisa de um componente shadcn ainda não instalado? `npx shadcn@latest add <nome>` dentro de `web/`.
2. Cor nova de UI? Não invente hex — use um token existente ou estenda o tema no `index.css`.
3. Nova plataforma? Adicione em `PLATFORM_*` (labels, cores, limites, shape) — os componentes leem
   desses mapas, não têm plataforma hard-coded.
4. Rode `npm run build` em `web/` (typecheck + bundle) antes de considerar pronto.
