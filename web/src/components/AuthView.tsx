import { useState } from 'react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { requestPasswordReset, signIn, signUp } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Tela de entrada. Substitui a caixa de Basic Auth do navegador — que além de feia era uma senha
// só, compartilhada: todo mundo que entrava caía no MESMO espaço de dados.
//
// Um formulário só, trocando de modo, em vez de três telas: a diferença entre entrar e criar conta
// é um campo, e quem erra o modo (o caso comum é tentar entrar sem ter conta) muda com um clique
// sem perder o que já digitou — os campos são os mesmos, o estado é o mesmo.

type Mode = 'in' | 'up' | 'forgot';

const COPY: Record<Mode, { title: string; cta: string; alt: Mode; altLabel: string }> = {
  in: { title: 'Entrar', cta: 'Entrar', alt: 'up', altLabel: 'Não tenho conta' },
  up: { title: 'Criar conta', cta: 'Criar conta', alt: 'in', altLabel: 'Já tenho conta' },
  forgot: { title: 'Recuperar senha', cta: 'Enviar link', alt: 'in', altLabel: 'Voltar para entrar' },
};

export function AuthView({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [mode, setMode] = useState<Mode>('in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const copy = COPY[mode];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      if (mode === 'forgot') {
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
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-10">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: [0.2, 0.7, 0.3, 1] }}
        className="w-full max-w-sm"
      >
        <img src="/atenta-wordmark.png" alt="ATENTA!" className="mx-auto mb-8 h-11 w-auto" />

        <form
          onSubmit={submit}
          className="rounded-2xl border-2 border-brand bg-card p-6 shadow-[6px_6px_0_0_var(--brand)]"
        >
          <h1 className="mb-1 text-xl font-bold">{copy.title}</h1>
          <p className="mb-5 text-sm text-muted-foreground">
            {mode === 'forgot'
              ? 'Informe o e-mail da sua conta e mandamos um link para criar uma senha nova.'
              : 'Agende seus posts e planeje o feed em todas as redes.'}
          </p>

          {mode === 'up' && (
            <div className="mb-4">
              <Label htmlFor="nome">Seu nome</Label>
              <Input id="nome" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className="mt-1.5" />
            </div>
          )}

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

          {mode !== 'forgot' && (
            <div className="mb-2">
              <Label htmlFor="senha">Senha</Label>
              <Input
                id="senha"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                // Diz ao gerenciador de senhas se ele deve OFERECER uma senha nova ou preencher a
                // existente. Com o valor errado, ele preenche a antiga na tela de criar conta.
                autoComplete={mode === 'up' ? 'new-password' : 'current-password'}
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
            onClick={() => setMode(copy.alt)}
            className="mt-4 w-full text-sm font-medium text-accent-foreground underline-offset-4 hover:underline"
          >
            {copy.altLabel}
          </button>
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
  );
}
