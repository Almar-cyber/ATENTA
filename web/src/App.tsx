import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { BarChart3, CalendarDays, CheckCircle2, LayoutDashboard, Link2, LogOut, Plus, Smile } from 'lucide-react';
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

/**
 * Os três destinos do app, na barra de cima.
 *
 * Antes o cabeçalho tinha só um botão de Insights solto e a Agenda era a tela implícita — o que
 * funcionava enquanto havia duas telas. Com o Painel eles viram três lugares de igual estatura, e
 * uma navegação nomeada diz onde você está, coisa que um botão solto não faz.
 *
 * São `Button size="lg"`, e não a pílula de abas: web/design.md proíbe misturar a `TabsList` (h-8)
 * com os botões (h-11) na mesma fileira, e o botão resolve a altura sozinho.
 */
const NAV: { id: Screen; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'home', label: 'Painel', icon: LayoutDashboard },
  { id: 'scheduler', label: 'Agenda', icon: CalendarDays },
  { id: 'insights', label: 'Insights', icon: BarChart3 },
];

/** As telas do app. `connections` fica fora da navegação — chega pelo menu da conta. */
type Screen = 'home' | 'scheduler' | 'connections' | 'insights';

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
      {/* PNG, não SVG: o SVG do wordmark deformava o "A" e o "N" em alguns renderizadores. */}
      <button type="button" onClick={() => onNavigate('home')} aria-label="Ir para o Painel" className="cursor-pointer">
        {/* Menor no celular: a 375px o wordmark em h-10 sozinho já não deixava o "Novo post" caber
            na mesma fileira, e o cabeçalho quebrava numa terceira linha. */}
        <img src="/atenta-logoetipo.png" alt="ATENTA!" className="h-8 w-auto sm:h-10" />
      </button>
      {/* No desktop largo a navegação senta ao lado do wordmark. Em qualquer largura menor — do
          celular até uma janela estreita de desktop — ela desce pra própria fileira, e fica
          SEMPRE por último (`order-last` sem reverter antes do `lg`), nunca entre o logo e as
          ações.
          Isso não é só estética: a navegação decide o que aparece abaixo dela na tela — é a régua
          de "onde você está". Ela precisa ficar colada no conteúdo, não separada dele por uma
          fileira de botões no meio. `sm:order-none` (o que havia antes) revertia cedo demais: entre
          640 e ~1023px o logo+navegação cabiam juntos numa linha, mas as ações (avatares, sino,
          Novo post, conta) não cabiam mais do lado — e sobravam pra uma SEGUNDA fileira, com a
          navegação em cima e as ações no meio do caminho até o conteúdo. `lg:order-none` empurra
          esse reverter pra uma largura em que tudo cabe de verdade numa linha só (testado: ~930px
          de conteúdo é o teto; o breakpoint `lg` do Tailwind, 1024px, sobra folga).
          No celular ela ocupa a largura toda, dividida em três — o formato de barra de abas, que é
          onde a mão alcança — e o ÍCONE some e o RÓTULO fica (o contrário do resto do cabeçalho),
          porque um quadriculado, um calendário e um gráfico lado a lado não dizem para onde levam;
          a palavra diz. */}
      <nav className="order-last flex w-full items-center gap-1 lg:order-none sm:w-auto">
        {NAV.map(({ id, label, icon: Icon }) => {
          // Conexões não acende nenhum dos três de propósito: ela é ajuste de conta, chega pelo
          // menu do avatar, e acender a Agenda ali diria que você está num lugar onde não está.
          const ativo = screen === id;
          return (
            <Button
              key={id}
              size="lg"
              variant={ativo ? 'default' : 'ghost'}
              aria-current={ativo ? 'page' : undefined}
              onClick={() => onNavigate(id)}
              className="flex-1 px-2.5 sm:flex-none sm:px-5"
            >
              <Icon className="hidden size-4 sm:block" />
              {label}
            </Button>
          );
        })}
      </nav>
      <div className="flex items-center justify-end gap-3 sm:ml-auto">
        {/* Avatares só no desktop: no mobile eles empurravam o "Novo post" pra quebrar, e a função
            (abrir Conexões) já está no botão ao lado. */}
        <button
          type="button"
          onClick={onOpenConnections}
          className="hidden flex-wrap items-center gap-1.5 rounded-full p-1 transition-colors hover:bg-muted sm:flex"
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
      } else {
        setScreen('insights');
      }
    },
    [setFilters]
  );

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
                  <TabsTrigger value="grid">Grid IG</TabsTrigger>
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
              {view === 'grid' && <GridPlanner posts={visible} onOpen={setSelection} />}
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
