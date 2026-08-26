import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { requestPasswordReset, resetPassword, signIn, signUp } from '@/lib/auth';
import { getPublicConfig, joinWaitlist } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Tela de entrada. Substitui a caixa de Basic Auth do navegador — que além de feia era uma senha
// só, compartilhada: todo mundo que entrava caía no MESMO espaço de dados.
//
// Um formulário só, trocando de modo, em vez de três telas: a diferença entre entrar e criar conta
// é um campo, e quem erra o modo (o caso comum é tentar entrar sem ter conta) muda com um clique
// sem perder o que já digitou — os campos são os mesmos, o estado é o mesmo.

// 'wait' = lista de espera. Existe porque o cadastro fica fechado até o App Review da Meta aprovar
// (SIGNUP_MODE), e a landing convida qualquer um a "começar grátis": sem ela, quem chegava de fora
// preenchia tudo pra tomar um "cadastro fechado" no fim — beco sem saída (design.md, princípio 4).
// A tela pergunta o estado ao /api/config ANTES de a pessoa digitar, e oferece o caminho certo.
type Mode = 'in' | 'up' | 'forgot' | 'wait' | 'redefinir';

// Fundo em vídeo desta tela. Servido pela NOSSA origem (web/public), não por CDN de terceiro: a
// versão anterior apontava pra fora, e o `media-src` da CSP nunca liberou aquele domínio — o vídeo
// nunca tocou, pra ninguém, desde que a CSP entrou. Same-origin já cai dentro de `media-src 'self'`,
// sem precisar abrir a política pra um host novo.
//
// `muted` e `playsInline` não são enfeite — são o que TORNA o autoplay possível: navegador nenhum
// inicia vídeo com som sozinho, e no iOS, sem playsInline, o vídeo sequestra a tela cheia em vez de
// ficar no fundo. `loop` fecha a emenda; `aria-hidden` tira do leitor de tela, porque é decoração e
// anunciá-lo só atrapalharia quem está tentando entrar.
const BACKGROUND_VIDEO = '/auth-video.mp4';

const COPY: Record<Mode, { title: string; cta: string; alt: Mode; altLabel: string }> = {
  in: { title: 'Entrar', cta: 'Entrar', alt: 'up', altLabel: 'Não tenho conta' },
  up: { title: 'Criar conta', cta: 'Criar conta', alt: 'in', altLabel: 'Já tenho conta' },
  forgot: { title: 'Recuperar senha', cta: 'Enviar link', alt: 'in', altLabel: 'Voltar para entrar' },
  wait: { title: 'Acesso antecipado', cta: 'Entrar na lista', alt: 'in', altLabel: 'Já tenho conta' },
  redefinir: { title: 'Criar senha nova', cta: 'Salvar senha', alt: 'in', altLabel: 'Voltar para entrar' },
};

export function AuthView({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [mode, setMode] = useState<Mode>('in');
  // `null` = ainda perguntando. Começa otimista só depois da resposta: enquanto não sabe, o botão
  // de criar conta fica quieto, em vez de piscar de "Criar conta" pra "Entrar na lista".
  const [signupOpen, setSignupOpen] = useState<boolean | null>(null);
  // Token do link do e-mail de redefinição. Lido UMA vez, no primeiro render, e a URL é limpa logo
  // em seguida: token de redefinição em barra de endereço vaza por histórico, por print e por
  // "compartilhar esta página".
  const [tokenReset] = useState<string | null>(() => {
    const p = new URLSearchParams(window.location.search);
    return p.get('redefinir') === '1' ? p.get('token') : null;
  });
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  // Quem pediu menos movimento no sistema recebe o vídeo PARADO no primeiro quadro, não a ausência
  // dele: o painel, a moldura e a legenda continuam existindo, e só o movimento sai. Esconder o
  // painel inteiro abriria um buraco na composição pra quem só queria menos animação.
  const [motionOk] = useState(() => !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const videoRef = useRef<HTMLVideoElement>(null);

  // O atributo `autoplay` sozinho não garante reprodução. Ele é um PEDIDO, e o navegador recusa em
  // situações comuns: Safari com "Nunca reproduzir automaticamente" no site, Modo de Baixo Consumo
  // (iOS e macOS), economia de bateria do Chrome, e aba aberta em segundo plano. Nesses casos o
  // vídeo fica congelado no primeiro quadro sem erro nenhum no console — parece que não carregou.
  //
  // Daí este efeito: pede play() na montagem e, se for recusado, tenta de novo na primeira
  // interação da pessoa (que é o gesto que libera a política de autoplay) e sempre que a aba volta
  // a ficar visível.
  useEffect(() => {
    if (!motionOk) return;
    const video = videoRef.current;
    if (!video) return;

    const play = () => void video.play().catch(() => {});
    play();

    const onVisible = () => {
      if (!document.hidden) play();
    };
    // `once` não serve aqui: se a primeira tentativa acontecer com a aba oculta, ela é recusada de
    // novo e não haveria segunda chance.
    document.addEventListener('pointerdown', play);
    document.addEventListener('keydown', play);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('pointerdown', play);
      document.removeEventListener('keydown', play);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [motionOk]);

  // Chegou pelo link do e-mail: abre direto no formulário de senha nova e tira o token da URL.
  useEffect(() => {
    if (!tokenReset) return;
    setMode('redefinir');
    window.history.replaceState({}, '', '/app');
  }, [tokenReset]);

  // Falha aqui não trava a tela: sem resposta, assume fechado — que é o padrão do servidor. O erro
  // oposto seria pior (oferecer "criar conta" e a pessoa levar a recusa depois de digitar tudo).
  useEffect(() => {
    getPublicConfig()
      .then((c) => setSignupOpen(c.signup_open))
      .catch(() => setSignupOpen(false));
  }, []);

  const copy = COPY[mode];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      if (mode === 'redefinir') {
        if (!tokenReset) throw new Error('Link inválido ou expirado. Peça um novo em "Esqueci minha senha".');
        await resetPassword(password, tokenReset);
        toast.success('Senha alterada. Entre com ela.');
        setPassword('');
        setMode('in');
      } else if (mode === 'wait') {
        await joinWaitlist(email, name);
        toast.success('Pronto! Avisamos assim que abrir uma vaga.');
        setMode('in');
      } else if (mode === 'forgot') {
        await requestPasswordReset(email);
        // Mensagem igual exista ou não a conta: dizer "esse e-mail não está cadastrado" entrega a
        // quem tentar adivinhar quais e-mails têm conta aqui.
        toast.success('Se houver uma conta com esse e-mail, o link de recuperação chega em instantes.');
        setMode('in');
      } else if (mode === 'up') {
        await signUp(email, password, name || email.split('@')[0]);
        onAuthenticated();
      } else {
        await signIn(email, password);
        onAuthenticated();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível completar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    // Split: formulário à esquerda, vídeo à direita. Separar os dois é o que permite o vídeo ficar
    // LIMPO — enquanto ele era fundo do formulário, todo texto por cima dependia de um véu, e o véu
    // era o que o transformava em textura borrada. Cada lado agora resolve o seu.
    <div className="flex min-h-dvh bg-secondary">
      <div className="flex w-full flex-col items-center justify-center px-4 py-10 lg:w-1/2">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: [0.2, 0.7, 0.3, 1] }}
          className="w-full max-w-sm"
        >
        <img src="/atenta-logoetipo.png" alt="ATENTA!" className="mx-auto mb-8 h-11 w-auto" />

        <form
          onSubmit={submit}
          className="rounded-2xl border-2 border-brand bg-card p-6 shadow-[6px_6px_0_0_var(--brand)]"
        >
          <h1 className="mb-1 text-xl font-bold">{copy.title}</h1>
          <p className="mb-5 text-sm text-muted-foreground">
            {mode === 'forgot'
              ? 'Informe o e-mail da sua conta e mandamos um link para criar uma senha nova.'
              : mode === 'redefinir'
                ? 'Escolha a senha nova da sua conta. Pelo menos 8 caracteres.'
                : mode === 'wait'
                  ? 'O ATENTA! ainda está aberto por convite enquanto passamos pela análise das redes sociais. Deixe seu e-mail e avisamos assim que abrir uma vaga.'
                  : 'Agende seus posts e planeje o feed em todas as redes.'}
          </p>

          {(mode === 'up' || mode === 'wait') && (
            <div className="mb-4">
              <Label htmlFor="nome">Seu nome</Label>
              <Input id="nome" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className="mt-1.5" />
            </div>
          )}

          {/* Sem campo de e-mail ao redefinir: quem chega pelo link já provou quem é (o token diz
              de qual conta se trata). Pedir o e-mail de novo seria perguntar algo que o sistema já
              sabe — e abriria a porta pra pessoa digitar outro endereço e não entender por que
              "não funcionou". */}
          {mode !== 'redefinir' && (
            <div className="mb-4">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                className="mt-1.5"
              />
            </div>
          )}

          {mode !== 'forgot' && mode !== 'wait' && (
            <div className="mb-2">
              <Label htmlFor="senha">{mode === 'redefinir' ? 'Senha nova' : 'Senha'}</Label>
              <Input
                id="senha"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                // Diz ao gerenciador de senhas se ele deve OFERECER uma senha nova ou preencher a
                // existente. Com o valor errado, ele preenche a antiga na tela de criar conta.
                autoComplete={mode === 'up' || mode === 'redefinir' ? 'new-password' : 'current-password'}
                className="mt-1.5"
              />
              {mode === 'up' && <p className="mt-1.5 text-xs text-muted-foreground">Pelo menos 8 caracteres.</p>}
            </div>
          )}

          {mode === 'in' && (
            <button
              type="button"
              onClick={() => setMode('forgot')}
              className="mb-4 text-sm font-medium text-accent-foreground underline-offset-4 hover:underline"
            >
              Esqueci minha senha
            </button>
          )}

          <Button type="submit" size="lg" className="mt-3 w-full" disabled={busy}>
            {busy ? 'Aguarde…' : copy.cta}
          </Button>

          <button
            type="button"
            // Com o cadastro fechado, "Não tenho conta" leva à LISTA, não ao formulário que vai
            // recusar. Enquanto a resposta do /api/config não chegou (null), segue o caminho
            // fechado — errar pro lado da lista custa um clique; errar pro outro custa o beco.
            onClick={() => setMode(copy.alt === 'up' && signupOpen !== true ? 'wait' : copy.alt)}
            className="mt-4 w-full text-sm font-medium text-accent-foreground underline-offset-4 hover:underline"
          >
            {copy.altLabel}
          </button>

          {/* Quem FOI convidado precisa continuar chegando ao cadastro de verdade — a lista não pode
              engolir o caminho de quem já tem convite na mão. */}
          {mode === 'wait' && (
            <button
              type="button"
              onClick={() => setMode('up')}
              className="mt-2 w-full text-sm text-muted-foreground underline-offset-4 hover:underline"
            >
              Recebi um convite
            </button>
          )}
        </form>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Ao continuar você concorda com os{' '}
          <a href="/terms" className="text-accent-foreground underline-offset-4 hover:underline">
            Termos
          </a>{' '}
          e a{' '}
          <a href="/privacy" className="text-accent-foreground underline-offset-4 hover:underline">
            Política de Privacidade
          </a>
          .
        </p>
      </motion.div>
      </div>

      {/* Vídeo. Some abaixo de lg: numa tela estreita não existe "lado direito", e espremê-lo numa
          faixa de 40% de altura só empurraria o formulário pra fora da dobra.

          COSTURA COM O LADO ESQUERDO — antes o vídeo sangrava até a borda, sem moldura nenhuma, e
          os dois lados liam como produtos diferentes colados. Três coisas os aproximam:

          1. MESMA MOLDURA. O painel recebe a receita brutalista do card do formulário (borda roxa
             de 2px, canto arredondado, sombra sólida deslocada). Deixa de ser papel de parede e
             passa a ser uma peça do mesmo sistema, ao lado de outra.
          2. MESMA PALETA. Uma camada roxa em multiply puxa os azuis da cena pro --brand, e a
             legenda sai no amarelo --primary, que é a cor do botão logo ao lado. O amarelo já
             existia no vídeo (o brilho da tela, as flores) — só está sendo reconhecido.
          3. MESMO ASSUNTO. Uma frase do produto sobre o vídeo, em vez de imagem muda: o que estava
             decorando passa a dizer algo, como o resto da tela. */}
      <div className="hidden p-5 lg:block lg:w-1/2">
        <div className="relative h-full overflow-hidden rounded-2xl border-2 border-brand shadow-[6px_6px_0_0_var(--brand)]">
          <video
            ref={videoRef}
            className="absolute inset-0 h-full w-full object-cover"
            src={BACKGROUND_VIDEO}
            // `muted` e `playsInline` são pré-requisito do autoplay, não estilo: navegador nenhum
            // inicia vídeo com som sozinho, e no iOS, sem playsInline, ele abre em tela cheia.
            autoPlay={motionOk}
            loop
            muted
            playsInline
            preload="auto"
            aria-hidden
          />
          <div aria-hidden className="absolute inset-0 bg-brand/30 mix-blend-multiply" />
          {/* Degradê só no pé, onde a legenda mora — véu na área inteira foi o que apagou o vídeo
              na primeira versão. */}
          <div aria-hidden className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-brand/80 to-transparent" />
          <p className="absolute inset-x-0 bottom-0 p-7 text-2xl font-bold leading-tight text-primary">
              Planeje o feed inteiro
              <br />
              antes de publicar a primeira peça.
          </p>
        </div>
      </div>
    </div>
  );
}
