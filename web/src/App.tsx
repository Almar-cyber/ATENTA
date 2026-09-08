import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { BarChart3, CalendarDays, Check, CheckCircle2, Grid3x3, LayoutDashboard, Link2, LogOut, Menu, Plus, Smile } from 'lucide-react';
import { toast } from 'sonner';
import { SchedulerProvider, useScheduler } from '@/store';
import type { View } from '@/store';
import { PLATFORM_LABELS } from '@/lib/platforms';
import type { Post } from '@/lib/types';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PostComposer } from '@/components/PostComposer';
import { onConnectRequest } from '@/lib/composer-bus';
import { PlatformAvatar } from '@/components/PlatformAvatar';
import { NotificationsBell } from '@/components/NotificationsBell';
import { ListView } from '@/components/ListView';
import { WeekView } from '@/components/WeekView';
import { CalendarView } from '@/components/CalendarView';
import { GridPlanner } from '@/components/GridPlanner';
import { InsightsView } from '@/components/InsightsView';
import { HomeView } from '@/components/HomeView';
import type { PainelDestino } from '@/lib/pendencias';
import { ConnectionsView } from '@/components/ConnectionsView';
import { FilterMenu } from '@/components/FilterMenu';
import { PostDialog } from '@/components/PostDialog';
import { AuthView } from '@/components/AuthView';
import { useSession, signOut, type SessionUser } from '@/lib/auth';
import { AvatarUsuario } from '@/components/AvatarUsuario';
import { AvatarDialog } from '@/components/AvatarDialog';
import type { DialogSelection } from '@/components/PostDialog';

/** As telas do app. `connections` fica fora da navegação — chega pelo menu da conta. */
type Screen = 'home' | 'scheduler' | 'planner' | 'connections' | 'insights';

/**
 * Nome e ícone de cada tela. Serve pros itens do menu E pro gatilho dele, que carrega a tela atual.
 */
const SCREEN_META: Record<Screen, { label: string; icon: typeof LayoutDashboard }> = {
  home: { label: 'Painel', icon: LayoutDashboard },
  scheduler: { label: 'Agenda', icon: CalendarDays },
  // Grid3x3 e NÃO LayoutGrid: aquele é 2×2 e fica quase idêntico ao LayoutDashboard do Painel —
  // dois dos quatro itens do menu com o mesmo desenho. Este é a própria grade de 3 colunas do
  // perfil, que é literalmente o que a tela mostra.
  planner: { label: 'Planejar', icon: Grid3x3 },
  insights: { label: 'Insights', icon: BarChart3 },
  connections: { label: 'Conexões', icon: Link2 },
};

/**
 * Os destinos do app. Aparecem de dois jeitos, e o corte é `xl` (1280px):
 *
 * - **A partir de `xl`**: os quatro botões visíveis ao lado do logo. Ali eles cabem na mesma
 *   fileira das ações, então não custam altura nenhuma — e navegação visível é melhor que navegação
 *   escondida sempre que couber.
 * - **Abaixo de `xl`**: um menu ao lado do logo. É onde os botões NÃO cabem ao lado das ações e
 *   desceriam pra uma fileira própria — 44px mais o respiro, tirados do conteúdo em toda tela, o
 *   tempo todo, por uma navegação que se usa uma vez a cada visita.
 *
 * O corte era `lg` com TRÊS destinos. "Planejar" é o quarto botão, e com ele a fileira voltava a
 * quebrar em duas de 1024 a ~1099 (medido: 136px em vez de 76, com 1 conta e com 6; a partir de
 * 1100 cabia). Então o corte subiu junto com o número de botões, em vez de o cabeçalho voltar a ter
 * duas linhas — que é exatamente o que este menu existe pra desfazer. Os avatares de conta, que já
 * eram os primeiros a ceder, foram junto pra `2xl`.
 *
 * O gatilho do menu NOMEIA a tela atual em vez de ser só o ☰. É o que faz o menu não perder a régua
 * de "onde você está" que o botão aceso dá de graça: some a lista, fica o rótulo.
 */
const NAV: Screen[] = ['home', 'scheduler', 'planner', 'insights'];

function Header({
  screen,
  onNavigate,
  onNewPost,
  onOpenConnections,
  onIr,
  user,
  onSignedOut,
  onProfileChanged,
}: {
  screen: Screen;
  onNavigate: (s: Screen) => void;
  onNewPost: () => void;
  onOpenConnections: () => void;
  onIr: (destino: PainelDestino) => void;
  user: SessionUser;
  onSignedOut: () => void;
  /** Revalida a sessão — é o que faz o avatar novo aparecer sem recarregar a página. */
  onProfileChanged: () => void;
}) {
  const { accounts } = useScheduler();
  const [avatarAberto, setAvatarAberto] = useState(false);
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 px-3 pb-2 pt-4 sm:gap-4 sm:px-6 sm:pt-6">
      {/* O MENU VEM PRIMEIRO, e o logo à direita dele. O ☰ é o que se usa; o logo é identidade,
          não controle. Deixar o controle no canto que o polegar alcança primeiro, e a marca logo ao
          lado, é a ordem que a mão pede — o inverso punha um alvo não-clicável na melhor posição da
          barra. A partir de `lg` o ☰ some e sobra logo + navegação, como sempre foi. */}
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        {/* O gatilho carrega a tela atual (ícone + nome), não só o ☰ — ver o comentário de NAV.
            Abaixo de 768px fica só o ☰: ali a largura é o recurso escasso, e é ela que decide se o
            cabeçalho cabe numa fileira; a tela abaixo já se apresenta de qualquer forma (o
            "Painel"/"Insights"/"Conexões" do ViewHeader, o "Posts agendados" da Agenda). */}
        <div className="xl:hidden">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="lg"
                variant="outline"
                aria-label={`Menu de navegação — você está em ${SCREEN_META[screen].label}`}
                className="px-3 md:px-5"
              >
                <Menu className="size-4" />
                <span className="hidden md:inline">{SCREEN_META[screen].label}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              {NAV.map((id) => {
                const { label, icon: Icon } = SCREEN_META[id];
                const ativo = screen === id;
                return (
                  <DropdownMenuItem
                    key={id}
                    aria-current={ativo ? 'page' : undefined}
                    onSelect={() => onNavigate(id)}
                    className={ativo ? 'bg-muted font-semibold' : undefined}
                  >
                    <Icon className="size-4" />
                    {label}
                    {ativo && <Check className="ml-auto size-4" />}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {/* PNG, não SVG: o SVG do wordmark deformava o "A" e o "N" em alguns renderizadores.
            No celular entra o SELO quadrado no lugar do logotipo deitado: o logotipo sozinho come
            145px dos ~336px de uma tela de 360, e com o menu ao lado o cabeçalho voltaria a quebrar
            em duas fileiras — que é justamente o que este menu existe pra desfazer. É a mesma marca,
            a mesma que o aparelho já mostra no ícone do app. Aqui o SVG vale (a ressalva do
            web/design.md é sobre o WORDMARK, cujas letras deformavam): o selo é só path, sem texto.
            Não use `atenta-icon-256.png` — esse arquivo está cortado, o glifo sai pela metade. */}
        <button type="button" onClick={() => onNavigate('home')} aria-label="Ir para o Painel" className="shrink-0 cursor-pointer">
          <img src="/atenta-icon.svg" alt="ATENTA!" className="h-10 w-auto sm:hidden" />
          <img src="/atenta-logoetipo.png" alt="ATENTA!" className="hidden h-10 w-auto sm:block" />
        </button>
        {/* A mesma navegação aberta, a partir de `xl`. `size="lg"` e não a pílula de abas:
            web/design.md proíbe misturar a `TabsList` (h-8) com os botões (h-11) na mesma fileira. */}
        <nav className="hidden items-center gap-1 xl:flex">
          {NAV.map((id) => {
            // Conexões não acende nenhum dos três de propósito: ela é ajuste de conta, chega pelo
            // menu do avatar, e acender a Agenda ali diria que você está num lugar onde não está.
            // (Abaixo de `xl`, onde não há botão pra acender, quem diz isso é o rótulo do gatilho.)
            const { label, icon: Icon } = SCREEN_META[id];
            const ativo = screen === id;
            return (
              <Button
                key={id}
                size="lg"
                variant={ativo ? 'default' : 'ghost'}
                aria-current={ativo ? 'page' : undefined}
                onClick={() => onNavigate(id)}
                className="px-5"
              >
                <Icon className="size-4" />
                {label}
              </Button>
            );
          })}
        </nav>
      </div>
      <div className="flex items-center justify-end gap-3 sm:ml-auto">
        {/* Avatares só a partir de `2xl` (já foram `sm:`, depois `xl:`): eles são o item mais ELÁSTICO da fileira
            — crescem a cada conta conectada — e por isso são os primeiros a fazer o cabeçalho
            quebrar em duas fileiras, que é o que este cabeçalho existe pra evitar. Mediram os
            ~115px que quebravam a linha entre 640 e ~830px com o menu, e os que sobravam em 1024
            com a navegação aberta de volta ao lado. Some sem perda de caminho: quem quer Conexões
            chega pelo menu da conta, pelos estados vazios e pela pendência do Painel, e "conta
            precisa reautenticar" já é o sino. */}
        <button
          type="button"
          onClick={onOpenConnections}
          className="hidden flex-wrap items-center gap-1.5 rounded-full p-1 transition-colors hover:bg-muted 2xl:flex"
          title="Gerenciar conexões"
        >
          {accounts.length === 0 ? (
            <span className="px-1.5 text-xs text-muted-foreground">Nenhuma conta conectada</span>
          ) : (
            accounts.map((a) => (
              <PlatformAvatar
                key={a.id}
                platform={a.platform}
                size="md"
                shape="circle"
                tone="tint"
                muted={a.status !== 'active'}
                className="ring-2 ring-card"
                title={`${PLATFORM_LABELS[a.platform]} — ${a.display_name}${a.status !== 'active' ? ' (precisa reautenticar)' : ''}`}
              />
            ))
          )}
        </button>
        {/* Conexões continua fora da barra e dentro do menu da conta, por FREQUÊNCIA: você conecta
            uma vez e volta lá raramente, e ocupar espaço permanente por uma visita ocasional
            empurraria o CTA primário. Os caminhos até ela continuam: os avatares ao lado, os
            estados vazios e a pendência de reautenticação no Painel. */}
        <NotificationsBell onIr={onIr} />
        {/* Só o "+" no celular: com o texto, este botão (146px) sozinho já não deixava logo + sino
            + conta caberem ao lado do wordmark, e a fileira de cima quebrava em duas. Ícone-só
            (44px, do tamanho do sino/conta ao lado) devolve tudo pra uma fileira só — o rótulo some
            porque "+" já é o símbolo universal de criar, sem precisar de explicação ao lado. */}
        <Button size="lg" onClick={onNewPost} aria-label="Novo post" className="px-3 sm:px-6">
          <Plus className="size-4" />
          <span className="hidden sm:inline">Novo post</span>
        </Button>
        {/* Num app multi-conta, saber EM QUAL conta você está deixou de ser detalhe: o mesmo
            navegador pode ter entrado com outro e-mail. Por isso o e-mail aparece no menu, e não
            só um botão "Sair" solto. O menu também afasta o Sair do CTA primário ao lado. */}
        <AvatarDialog user={user} open={avatarAberto} onClose={() => setAvatarAberto(false)} onSaved={onProfileChanged} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            {/* Botão redondo em que o avatar OCUPA tudo: com o padding padrão sobrava o desenho em
                20px dentro de 44px (45% de ocupação), e o rosto ficava ilegível no meio do vazio.
                `p-0` + `size-11` transformam o próprio botão na moldura do avatar. */}
            <Button
              size="lg"
              variant="outline"
              aria-label="Sua conta"
              className="size-11 overflow-hidden rounded-full p-0"
            >
              {/* 40 = 44 do botão menos os 2px de borda de cada lado. */}
              <AvatarUsuario user={user} size={40} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="font-normal">
              <span className="block text-xs text-muted-foreground">Conectado como</span>
              <span className="block truncate font-medium">{user.email}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setAvatarAberto(true)}>
              <Smile className="size-4" />
              Personalizar avatar
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onOpenConnections}>
              <Link2 className="size-4" />
              Conexões
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={async () => {
                try {
                  await signOut();
                } finally {
                  // Mesmo se o servidor recusar, revalidar é o certo: ou a sessão caiu (e a UI
                  // acompanha), ou continua válida (e a pessoa vê que não saiu, em vez de olhar
                  // uma tela de login que ainda tem sessão viva por baixo).
                  onSignedOut();
                }
              }}
            >
              <LogOut className="size-4" />
              Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

// Wide centered modal that keeps its children MOUNTED when closed (toggles opacity/scale rather
// than unmounting), so PostComposer's composer-bus subscriptions stay alive and a "duplicar" /
// "editar" / empty-slot click can open it with the payload already applied. Wide + internally split
// (form | preview) instead of a tall scroll, so nothing gets uncomfortably long.
function ComposerModal({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <div
      className={`fixed inset-0 z-40 flex items-center justify-center p-4 transition-opacity duration-200 ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
    >
      <div aria-hidden onClick={onClose} className="absolute inset-0 bg-foreground/25 backdrop-blur-[2px]" />
      <div
        className={`relative z-10 flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-card border-2 border-brand shadow-[6px_6px_0_0_var(--brand)] transition-transform duration-200 ${open ? 'scale-100' : 'scale-95'}`}
      >
        {children}
      </div>
    </div>
  );
}

function accountFilter(posts: Post[], accountId: string): Post[] {
  if (!accountId) return posts;
  const out: Post[] = [];
  for (const post of posts) {
    const targets = post.targets.filter((t) => t.account_id === accountId);
    if (targets.length) out.push({ ...post, targets });
  }
  return out;
}

function Dashboard({
  user,
  onSignedOut,
  onProfileChanged,
}: {
  user: SessionUser;
  onSignedOut: () => void;
  onProfileChanged: () => void;
}) {
  const { posts, accounts, filters, setFilters, reload } = useScheduler();
  const [view, setView] = useState<View>('list');
  // O Painel é a tela inicial: o app não tinha porta de entrada, você caía direto numa lista sem
  // nenhuma leitura do todo — e o rascunho, que é a peça mais fácil de esquecer, não aparecia em
  // lugar nenhum até você rolar até a data que o compositor inventou pra ele.
  const [screen, setScreen] = useState<Screen>('home');
  const [selection, setSelection] = useState<DialogSelection | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [justConnected, setJustConnected] = useState(false);

  const openComposer = useCallback(() => setComposerOpen(true), []);
  const closeComposer = useCallback(() => setComposerOpen(false), []);

  // Pedido vindo do estado vazio do seletor de contas, lá dentro do compositor.
  useEffect(
    () =>
      onConnectRequest(() => {
        setComposerOpen(false);
        setScreen('connections');
      }),
    []
  );

  // OAuth round-trip: o callback do Worker redireciona pra /?connected=<rede> (ou connect_error).
  // Lê o param no mount, atualiza as contas, abre o modal de sucesso e limpa a URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('connected');
    const err = params.get('connect_error');
    if (connected) {
      setScreen('connections');
      setJustConnected(true);
      reload().catch(() => {});
    } else if (err) {
      setScreen('connections');
      const reason = params.get('reason');
      const missing = reason?.startsWith('missing_') ? reason.slice('missing_'.length) : null;
      toast.error(
        missing
          ? `${err} ainda não está configurado — falta definir o secret ${missing} no Worker (wrangler secret put ${missing}).`
          : // O texto do limite vem daqui e não do servidor porque a resposta é um REDIRECT 302 pro
            // app, não um JSON: não há corpo onde carregar a mensagem. O motivo viaja no query
            // string e a frase mora no cliente.
            reason === 'limite_contas'
            ? 'Você já conectou o número de contas do plano gratuito. A assinatura que amplia esse limite ainda não está disponível. Estamos liberando o acesso aos poucos.'
            : 'Não foi possível conectar a conta. Tente de novo.'
      );
    }
    if (connected || err) {
      // Sempre '/app', não `window.location.pathname`. Usar o pathname recebido só reproduzia o
      // endereço em que a pessoa caiu — e o callback antigo mandava pra raiz, que é a LANDING. A
      // URL ficava em '/', o app seguia funcionando, e no primeiro F5 aparecia a página de vendas.
      window.history.replaceState({}, '', '/app');
    }
  }, [reload]);

  const visible = useMemo(() => accountFilter(posts, filters.account), [posts, filters.account]);

  // Vem ANTES de `irPara` de propósito: aquele depende deste, e `const` não é içado — invertido,
  // a lista de dependências lê `abrirPost` na zona morta temporal e derruba o render.
  // O Painel só tem os ids; o objeto inteiro do post mora no store. Quando um filtro ligado deixa
  // o post fora do que o store carregou, cair na Agenda limpa é melhor que um clique que não faz
  // nada — a pessoa continua a um passo do post em vez de achar que o card quebrou.
  const abrirPost = useCallback(
    (postId: string, targetId: string) => {
      const post = posts.find((p) => p.id === postId);
      const target = post?.targets.find((t) => t.id === targetId);
      if (post && target) {
        setSelection({ post, target });
        return;
      }
      setFilters({ status: '', platform: '', account: '' });
      setView('list');
      setScreen('scheduler');
    },
    [posts, setFilters]
  );

  // Uma pendência do Painel leva à Agenda JÁ FILTRADA — é o que transforma a linha em ação em vez
  // de recado. Sem aplicar o filtro, "3 rascunhos ficaram pra trás" devolveria a pessoa pra mesma
  // lista onde eles estavam escondidos, que é exatamente o problema que o Painel existe pra evitar.
  const irPara = useCallback(
    (destino: PainelDestino) => {
      if (destino.tipo === 'agenda') {
        setFilters({ status: destino.status });
        setView('list');
        setScreen('scheduler');
      } else if (destino.tipo === 'conexoes') {
        setScreen('connections');
      } else if (destino.tipo === 'post') {
        // Abre o post direto — é o destino do Reel de teste, onde estão os números e o link pro
        // Instagram. `abrirPost` já cai na Agenda limpa quando o post não está no que o store
        // carregou, então um filtro ligado noutra tela não transforma isto num clique morto.
        abrirPost(destino.post_id, destino.target_id);
      } else {
        setScreen('insights');
      }
    },
    [setFilters, abrirPost]
  );

  // h-dvh (dynamic viewport height), não h-screen/100vh: no iOS o 100vh ignora a barra de endereço
  // e fica mais alto que a área visível, sobrando um branco rolável embaixo.
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <Header
        screen={screen}
        onNavigate={setScreen}
        onNewPost={openComposer}
        onOpenConnections={() => setScreen('connections')}
        onIr={irPara}
        user={user}
        onSignedOut={onSignedOut}
        onProfileChanged={onProfileChanged}
      />
      <main className="min-h-0 flex-1 px-3 pb-3 pt-2 sm:px-6 sm:pb-6">
        {screen === 'home' ? (
          <HomeView onIr={irPara} onAbrirPost={abrirPost} />
        ) : screen === 'connections' ? (
          <ConnectionsView onBack={() => setScreen('scheduler')} />
        ) : screen === 'planner' ? (
          <GridPlanner onOpen={setSelection} onOpenConnections={() => setScreen('connections')} />
        ) : screen === 'insights' ? (
          <InsightsView onOpenConnections={() => setScreen('connections')} />
        ) : (
        <section className="flex h-full flex-col rounded-2xl bg-card p-3 border-2 border-brand shadow-[4px_4px_0_0_var(--brand)] sm:p-5">
          <div className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold">Posts agendados</h2>
            {/* Abas à esquerda, Filtros à direita. No mobile a fileira ocupa a largura toda e o
                Filtros vai pro canto (ml-auto); no desktop fica compacto. */}
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <Tabs value={view} onValueChange={(v) => setView(v as View)}>
                <TabsList>
                  <TabsTrigger value="list">Lista</TabsTrigger>
                  <TabsTrigger value="week">Semana</TabsTrigger>
                  <TabsTrigger value="calendar">Mês</TabsTrigger>
                </TabsList>
              </Tabs>
              <div className="ml-auto sm:ml-0">
                <FilterMenu filters={filters} setFilters={setFilters} accounts={accounts} />
              </div>
            </div>
          </div>

          {/* overflow-hidden (não -auto): quem rola é cada view por dentro, com a barra de
              navegação dela fixa. Sem isso, rolar a Semana levava a nav do calendário junto. */}
          <div className="min-h-0 flex-1 overflow-hidden">
            {/* Remount-and-fade on view change (key={view}). No AnimatePresence/exit here on
                purpose: mode="wait" deadlocks when the 30s poll re-creates `visible` mid-exit,
                freezing the old view. Keying the div remounts instantly, then motion plays the
                enter. */}
            <motion.div
              key={view}
              className="h-full min-h-0"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.15 }}
            >
              {view === 'list' && <ListView posts={visible} onOpen={setSelection} />}
              {view === 'week' && <WeekView posts={visible} onOpen={setSelection} />}
              {view === 'calendar' && <CalendarView posts={visible} onOpen={setSelection} />}
            </motion.div>
          </div>
        </section>
        )}
      </main>

      <ComposerModal open={composerOpen} onClose={closeComposer}>
        <PostComposer aberto={composerOpen} onRequestOpen={openComposer} onDone={closeComposer} />
      </ComposerModal>

      <Dialog open={justConnected} onOpenChange={(v) => !v && setJustConnected(false)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader className="items-center gap-3 text-center">
            <CheckCircle2 className="size-12 text-green-600" />
            <DialogTitle className="text-lg">Conta conectada com sucesso!</DialogTitle>
          </DialogHeader>
          <div className="mt-2 flex flex-col gap-2">
            <Button
              size="lg"
              onClick={() => {
                setJustConnected(false);
                setScreen('scheduler');
                openComposer();
              }}
            >
              Agendar post
            </Button>
            <Button variant="outline" onClick={() => setJustConnected(false)}>
              Continuar conectando
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <PostDialog selection={selection} onClose={() => setSelection(null)} />
    </div>
  );
}

export default function App() {
  const { session, refresh } = useSession();

  // `loading` renderiza vazio de propósito: mostrar a tela de entrar enquanto a sessão é conferida
  // faria quem já está logado ver um pisca de login a cada refresh. Fundo da marca em vez de
  // branco puro pra troca não dar flash.
  if (session.status === 'loading') return <div className="min-h-dvh bg-background" />;

  if (session.status === 'out') return <AuthView onAuthenticated={() => void refresh()} />;

  // O SchedulerProvider só monta DEPOIS de haver sessão: ele dispara o carregamento de contas e
  // posts no mount, e sem sessão essas chamadas voltariam vazias e ficariam em cache no estado.
  return (
    <SchedulerProvider>
      <Dashboard user={session.user} onSignedOut={() => void refresh()} onProfileChanged={() => void refresh()} />
    </SchedulerProvider>
  );
}
