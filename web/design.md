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
- Logo: `web/public/atenta-logoetipo.png` (sticker roxo com traço amarelo, pra fundo claro) no
  header a partir de `sm` e na tela de entrar; `atenta-wordmark-onpurple.png` (traço branco) pra
  superfície colorida; `atenta-icon.svg` no favicon **e como selo do header no celular**, onde o
  logotipo deitado não cabe. **PNG, não SVG, no wordmark** — o SVG deformava o "A" e o "N" em alguns
  renderizadores; a ressalva é das LETRAS, o selo é só path e vale em SVG.

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
| `FormatPicker` | Escolha do formato dentro da rede (Post/Reel/Story no Instagram, Vídeo/Short no YouTube). Vem **antes da mídia** no composer: é o formato que define o que a rede aceita e, no Instagram, o `media_type` do container. Os formatos ficam em `PLATFORM_FORMATS` (`lib/platforms.ts`) — não hard-code plataforma no componente. **O Reel de teste NÃO entra aqui**: ele não muda o `media_type` (é o mesmo container de Reel com um `trial_params` a mais), e o critério pra ser formato é justamente esse. Ele mora em "Ajustes por rede", como um `Select` ("Quem vê primeiro") ao lado dos da mesma natureza — a privacidade do TikTok e o "Quem pode ver" do YouTube. |
| `AccountPicker` | Seletor de contas de destino do composer — chips (`ToggleGroup` multi-seleção do shadcn) em vez de lista de checkbox; conta inativa fica desabilitada com `Tooltip` explicando o motivo. |
| `PostPreview` | Card que imita o formato de cada rede — a proporção vem do **formato** escolhido, não do arquivo. Vídeo tem play (com som e controles); com capa escolhida, a capa é o que aparece parado e o play toca o vídeo por baixo. Reusado no composer e no dialog. |
| `HomeView` | **Painel** — a tela inicial. Três grades de cards: *Precisa de você* (pendências acionáveis, cada uma leva à Agenda já filtrada), *Sai a seguir* (próximos posts com a capa em destaque) e *Como foi* (números + link pro Insights). A conta de pendências fica em `@/lib/pendencias` (`construirPendencias`), reusada pelo `NotificationsBell` — ver abaixo. |
| `NotificationsBell` | Sino no cabeçalho (substitui a antiga faixa vermelha, sempre visível): abre um `Popover` com as mesmas pendências do Painel. Um ponto vermelho liga só quando há pendência **grave** (falha, conta caída, fila atrasada) — rascunho esperando é acervo normal, não alarme, e um ponto ligado o tempo todo por causa dele treina a ignorá-lo. Balança (rotação via `motion`) quando a pendência grave aparece e a cada 12s enquanto o popover estiver fechado; para de balançar assim que abre. Fica sempre visível, inclusive no Painel — ele não disputa espaço com o bloco "Precisa de você" como a faixa vermelha disputava. |
| `ViewHeader` | Cabeçalho das telas de segundo nível (título, descrição, voltar, ações). Existe porque cada tela montava o seu e eles divergiram. Isola a armadilha do `CardHeader` ser **grid**: passar `flex-row` muda a direção sem mudar o `display`, e cada filho vira uma linha. **Voltar é só pra drill-down de verdade** (Conexões, chegada pelo menu da conta; o detalhe de uma rede dentro do Insights) — nunca nos quatro destinos de primeiro nível do cabeçalho (Painel, Agenda, Planejar, Insights), que não têm "de onde voltar". |
| `ListView` | Lista agrupada por dia, thumbnail real, badge de status, ações inline. |
| `WeekView` | Vista "Semana": grade horas × 7 dias, cada post na sua hora agendada; clique em slot vazio pré-preenche data/hora. |
| `CalendarView` | Vista "Mês": grade mensal; chip por post (cor = plataforma, tracejado = rascunho, ⚠ = falhou). Clique em dia vazio pré-preenche a data. |
| `GridPlanner` | A tela **Planejar** — destino de primeiro nível, não uma aba da Agenda. É a tela inteira: `Card` + `ViewHeader`, e o `Select` de perfil no `actions` quando há mais de um Instagram (uma grade é UM perfil; dois no mesmo quadriculado desenhariam um feed que nenhum dos dois vai ter). **Busca os próprios posts** (`getPosts({platform:'instagram'})`, todos os status) em vez de receber a lista do store: os filtros da Agenda vão pra query do servidor, e filtrar por "rascunho" apagava os PUBLICADOS — que são justamente as âncoras contra as quais se planeja. Grade 3-colunas do Instagram, arrastável (HTML5 DnD + `layout` do motion), com Desfazer — **à esquerda**, com o `IdeaSidebar` ocupando o resto da largura. As regras da grade (horários permutam, ideia não ocupa horário, corte 3:4) vivem num **`Popover` atrás de um `?`** na fileira dos botões, não num parágrafo fixo: eram quatro linhas acima da grade, quase uma tela de celular gasta a cada visita por uma explicação que se lê uma vez (mesma régua do ponto vermelho do `NotificationsBell` e do `UsoIA`). No celular isso levou o começo da grade de 244px pra 136px do topo do card. Três espécies de tile: **agendado**, **publicado** (âncoras; a capa cai pro feed real quando a nossa cópia já foi apagada pelo purge de 30 dias) e **ideia com arte**. **Story não entra** — ele nunca aparece no perfil, e um Story publicado virava âncora imóvel no meio do feed planejado. **Reel de teste só entra quando o feed real confirma**: enquanto está em teste ele não está no perfil, e a graduação acontece sem nos avisar — o feed é a única autoridade sobre isso. Fora da janela que a API do feed devolve, a grade MOSTRA: esconder um post que existe é o erro pior. Só renderiza: a montagem da grade fica em `src/lib/gridTiles.ts` e a matemática de reordenação em `src/lib/gridOrder.ts`, ambas fora do componente e ambas com teste (`test/gridTiles.test.ts`, `test/gridOrder.test.ts`) — são as duas partes que erram em silêncio. |
| `IdeaSidebar` | A lista de **ideias** ao lado da grade: um post que ainda não tem data. Campo rápido (Enter cria), card com capa/texto, e as ações **anexar arte**, **Agendar** (abre o compositor com o que a ideia tem) e **Remover**. Ideia só de texto **não** entra na grade — a grade mostra como o feed vai ficar, e um quadrado cinza atrapalha essa leitura. Agrupada por pilar (não filtrada): um FILTRO esconde o desbalanço — você vê "viagem" e nunca fica sabendo que "depoimento" está zerado. Agrupar mostra os dois, com todo pilar aparecendo mesmo em 0 posts; é a linha vazia que revela o buraco. |
| `PostHoverCard` | Cartão que aparece ao passar o mouse num chip do calendário (Mês e Semana): thumbnail da peça na proporção do formato, legenda/título, conta, horário e status. Substitui o `title=` do navegador — o chip só cabe o nome da conta, e é a imagem que faz reconhecer o post. |
| `PostDialog` | Detalhe do post em **split** (dados/ações à esquerda, preview "Como vai ficar" à direita). Num **Reel de teste** publicado, mostra um `InlineAlert tone="info"` dizendo que ele está saindo só pra quem não segue, desde quando, e que abrir pra todo mundo é um passo dentro do app do Instagram — a API não expõe a graduação. Sem essa linha a pendência do Painel abriria um post idêntico a qualquer outro, e a pessoa procuraria aqui um botão que não pode existir. |
| `ConnectionsView` | Tela "Conexões" (botão no header): grid de cards por rede com as contas conectadas + status e botão "Conectar" que navega pra `/api/connect/:rede` (OAuth). Várias contas por rede aparecem como linhas separadas. |
| `LegendaIA` | Botão "Sugerir legenda" ao lado do rótulo do campo. **O campo de legenda É o briefing**: a pessoa escreve uma linha do que quer dizer e gera, em vez de preencher um segundo campo com a mesma coisa. Por isso o botão nasce desabilitado, com o motivo no `Tooltip` (princípio 3: o aviso diz o que fazer). A sugestão SUBSTITUI o rascunho, então o texto anterior fica guardado e o botão vira "Desfazer a sugestão" (mesmo padrão do `GridPlanner`). O rodapé do popover diz se o histórico entrou; é o que explica por que a sugestão melhora conforme a pessoa publica. |
| `UsoIA` | Quanto sobrou da cota diária de IA. **Só aparece nas últimas 5**: mostrar "20 de 20" em toda geração transforma uma funcionalidade generosa numa medida, e aviso que aparece sempre é aviso que ninguém lê no dia em que importa (mesma régua do ponto vermelho do `NotificationsBell`). Sempre com o teto junto ("restam 4 de 20"), porque número solto não tem escala. Componente próprio e não uma linha dentro do `LegendaIA`: a IA não para na legenda, e o segundo consumidor da cota tem que herdar esta régua em vez de inventar outra. |
| `TagPicker` / `TagChip` | Escolher (ou **criar na hora**) o pilar de conteúdo. Criar no mesmo lugar de escolher é o que faz isto ser usado: uma tela separada de "gerenciar pilares" custaria sair do fluxo, e pilar que ninguém marca não vira insight. A cor vem de `proximaCor` (a primeira não usada), nunca sorteada — sortear repetiria tons no terceiro pilar. |
| `PlatformIcon` | Logo oficial de cada rede (SVG inline), colorido por `PLATFORM_COLORS`. Use onde a rede precisa ficar clara (lista, semana, chips, header, preview, dialog). |
| `AlertBanner` | Card recuado de falhas/reautenticação no topo. |
| `Thumb` | Thumbnail pequeno com fallback pra glyph quando a URL não resolve. |

## Padrões

- **Estado global**: `SchedulerProvider` (`src/store.tsx`) expõe `accounts`, `posts`, `filters`,
  `reload`. Poll de 60s via `GET /api/state` (uma requisição com contas+agenda+pilares+resumo, não
  quatro), pausado enquanto a aba está oculta e disparado na hora ao voltar — requisição é o recurso
  contado do plano grátis do Workers, e a aba de fundo era quem mais gastava. Componentes chamam
  `reload()` após mutações.
- **Pendência que abre UM post**: `PainelDestino` tem, além de `agenda`/`conexoes`/`insights`, o
  `{ tipo: 'post' }` — usado pelo Reel de teste. Filtrar a Agenda por "published" devolveria tudo que
  já saiu e o teste sumiria no meio; abrir o post leva direto ao que explica o estado e ao link. Em
  `App.tsx`, `abrirPost` é declarado **antes** de `irPara`: aquele depende deste, e `const` não é
  içado — invertido, a lista de dependências lê na zona morta temporal e derruba o render.
- **Comunicação composer ⇄ views**: bus pub-sub minúsculo (`src/lib/composer-bus.ts`) —
  `requestPrefill` (duplicar), `requestEdit` (editar o post inteiro), `requestPrefillDate` (clicar
  num dia/slot vazio) e `requestPrefillMedia` (agendar uma prévia do grid — só a mídia). O modal do
  composer fica sempre montado (translate/opacity, não desmonta) pra
  manter as assinaturas vivas e abrir já com o payload aplicado. Evita prop-drilling.
- **Modais em split**: prefira layout horizontal (dados/form à esquerda, preview à direita) a scroll
  vertical longo; limite a altura de mídia/preview (`PostPreview` cabe em ~340px de altura — pela
  largura, ver "Aspects do preview" — e mostra faixa
  "sem mídia" em vez de estourar formatos verticais). Ver `PostDialog` e `PostComposer`.
  **Quem rola muda com o breakpoint, e errar isso CORTA conteúdo.** Empilhado (abaixo de `md`) quem
  rola é o modal INTEIRO — `overflow-y-auto md:overflow-hidden` no envelope, e as colunas com
  `md:flex-1 md:overflow-y-auto` em vez de scroll próprio desde o celular. Duas colunas com scroll
  próprio dentro de um envelope `max-h-[88vh]` que não rola deixam o excedente da de baixo
  inalcançável: no `PostDialog` o rodapé da pré-visualização ficava atrás da borda, e girar o
  aparelho não salva (a orientação costuma estar travada).
- **Padrão de tamanho de botão** — três níveis, e nada fora deles:
  - `size="lg"` (h-11, uppercase): **CTA primário** de fluxo — "Novo post", "Agendar post", "Usar
    este recorte". Um por contexto; o secundário ao lado fica `variant="outline"`.
  - `size="default"` (h-8): **controles de barra e de navegação** — o botão de Filtros, "Hoje"/"Esta
    semana", as setas ‹ › do calendário (via `size="icon" className="size-8"`). **Bate com a altura
    da pílula de abas (`TabsList` é h-8)**, então a fileira do topo fica alinhada.
  - `size="sm"` (h-7): **ações terciárias inline** numa linha de lista (Duplicar/Cancelar/Excluir).
  Regra: se está na mesma fileira das abas, é `default` (h-8) — não misture `sm`/`lg` ali.
- **Navegação: aberta onde cabe, num menu onde não cabe.** Os quatro destinos (Painel, Agenda,
  Planejar, Insights) aparecem de dois jeitos, com o corte em `xl` (1280px). **A partir de `xl`**,
  quatro `Button size="lg"` visíveis ao lado do logo — ali eles cabem na mesma fileira das ações e
  não custam altura nenhuma, e navegação visível é melhor que escondida sempre que couber. **Abaixo
  de `xl`**, um `DropdownMenu` **no canto esquerdo, com o logo à direita dele** — o ☰ é o que se usa e
  o logo é identidade, não controle, então quem fica no canto que o polegar alcança primeiro é o
  controle; o inverso punha um alvo não-clicável na melhor posição da barra. É exatamente onde os
  três não cabiam ao lado das ações e
  desciam pra uma **fileira própria** — 44px mais o respiro, tirados do conteúdo em toda tela, o
  tempo todo, por uma navegação que se usa uma vez a cada visita (medido: 124→68px a 360, 192→76 a
  640, 136→76 de 768 a 1023). **O gatilho do menu carrega a tela atual** (ícone + nome,
  `SCREEN_META` no `App.tsx`), não só o ☰: é o que substitui a régua de "onde você está" que o botão
  aceso dá de graça. Em Conexões o gatilho diz "Conexões" e nenhum item acende — ela continua não
  sendo um dos quatro.
  **O corte acompanha o número de botões.** Era `lg` com três; o quarto ("Planejar") fazia a fileira
  quebrar em duas de 1024 a ~1099 (medido: 136px em vez de 76, com 1 conta e com 6), então subiu pra
  `xl` e os avatares foram junto pra `2xl`. Ícone repetido conta como erro aqui: `Planejar` usa
  `Grid3x3` e não `LayoutGrid`, que ficava quase igual ao `LayoutDashboard` do Painel.
- **Uma fileira em toda largura**: o cabeçalho quebrar em duas devolve o problema que o menu
  resolveu, então o que entra nele tem que caber — **de 360 a 1920, com 1 conta ou com 6**. As três
  válvulas, na ordem em que cedem: o wordmark vira o **selo quadrado** (`atenta-icon.svg`) abaixo de
  `sm` — o logotipo deitado come 145px dos ~336 de uma tela de 360; o **rótulo do gatilho** some
  abaixo de `md`; e os **avatares de conta** só aparecem em `xl` (são o item mais elástico da
  fileira — crescem a cada conta conectada — e por isso os primeiros a quebrar a linha: eram os
  ~115px que estouravam entre 640 e ~830px com o menu, e os que sobravam em 1024 com a navegação
  aberta de volta ao lado; com o quarto destino desceram mais um degrau). Nenhum caminho se perde: Conexões está no menu da conta, nos estados
  vazios e na pendência do Painel; "precisa reautenticar" é o sino.
  Use `atenta-icon.svg` e **não** `atenta-icon-256.png` — esse PNG está cortado no repositório.
- **Responsivo dos controles do topo**: header e barra usam `px-3 sm:px-6` (aproveita a lateral no
  mobile). No mobile o "Novo post" vira **só o "+"** (`hidden sm:inline` no rótulo) e o botão de
  Filtros vira **só ícone** pela mesma regra. Os filtros moram num popover (`FilterMenu`), não
  soltos na barra.
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
- **Aspects do preview**: no **feed** quem manda é o ARQUIVO, limitado à faixa que a rede aceita
  (`PLATFORM_ASPECT_RANGE`) — uma foto deitada no Facebook aparece deitada, porque é assim que ela
  vai sair; uma panorâmica 5:1 aparece em 1.91:1, que é o recorte que a Meta vai aplicar. Nos
  formatos de proporção **cravada** (Reel, Story, Short, TikTok) o arquivo não tem voz e quem manda é
  o `shape` do formato. O que separa os dois é `seguirArquivo` em `PLATFORM_FORMATS`;
  `PLATFORM_PREVIEW_SHAPE` é o fallback de quem não tem formatos.
  O teto de altura se aplica limitando a **largura** (`larguraDaMidia`), nunca com `max-height`:
  `max-height` não encolhe a largura junto, então a caixa virava 300×340 tanto pro 9:16 quanto pro
  3:4 e **Reel, Story, TikTok e Pinterest apareciam todos na mesma proporção** (0,88), nenhum na sua.
  Numa tela cujo trabalho é dizer "é assim que vai ficar", errar a proporção é errar a única coisa
  que ela promete. A mídia fica centralizada (`mx-auto`) quando é mais estreita que o card.
- **Motion**: entradas de lista com stagger sutil (`delay: i*0.015`, teto 0.3s); troca de view com
  fade+slide de 150ms (evite `AnimatePresence mode="wait"` numa view que também sofre poll —
  já causou um freeze real, ver `App.tsx`: prefira remount-and-fade via `key`); itens da fila de
  mídia com `layout`.
- **Drag-and-drop: duas metades, uma lib nenhuma.** `GridPlanner` e `MediaQueueGrid` usam o mesmo
  par. No **ponteiro**, HTML5 `draggable`/`onDragStart`/`onDragOver`(`preventDefault`)/`onDrop`. No
  **toque**, `usePressDrag` (`src/lib/usePressDrag.ts`) — porque navegador de celular **não emite
  `dragstart` a partir do dedo**, em nenhum deles: a grade dizia "arraste para reordenar" e no
  telefone não reordenava nada. Reaproveite esse par em vez de introduzir uma dependência de DnD.
  O gesto do toque é **pressionar e segurar** (320ms parado) antes de arrastar, e isso não é
  enfeite: pra a página não rolar junto é preciso `preventDefault()` no `touchmove`, e isso não
  desfaz uma rolagem já começada — a espera garante que o `preventDefault` já esteja posto antes de
  qualquer rolagem existir. `touch-action: none` nos tiles resolveria o scroll e mataria a rolagem
  da grade, que ocupa a tela inteira no celular. Duas consequências a manter: a peça na mão e o
  destino sob o dedo precisam de **estado visual** (não há imagem de arraste no toque), e o clique
  que o navegador dispara ao soltar precisa ser engolido (`consumiuClique`), senão terminar um
  arraste abre o detalhe da peça.
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
4. **Imagem de origem externa? Ela precisa entrar no `img-src` do `CSP_APP`** (`src/lib/csp.ts`). A
   CSP do app é uma lista fechada, e host fora dela é recusado **em silêncio**: o TypeScript não liga
   uma `<img>` a uma linha da política, o console do navegador reclama e a tela não, e o resultado é
   um quadrado cinza igual ao de "não tem capa" — foi assim que as capas do feed do Instagram sumiram
   por duas semanas. Hoje passam por lá o R2 e os CDNs de Instagram/Facebook e do YouTube; o resto é
   `public_url`, `data:` ou `blob:`, já liberados.
5. Rode `npm run build` em `web/` (typecheck + bundle) antes de considerar pronto.
