import { useCallback, useEffect, useState } from 'react';

// Cliente de autenticação — fetch direto no /api/auth do better-auth, sem a lib cliente dele.
//
// POR QUE SEM A LIB CLIENTE: o que usamos são cinco POSTs de JSON e um GET; o pacote cliente traria
// um store reativo e um plugin system que não têm papel aqui, e todo KB de bundle numa tela que
// carrega ANTES do app é KB no caminho crítico de quem só quer entrar.
//
// O cookie de sessão é HttpOnly — o JavaScript não o lê nem o escreve. Quem manda é o navegador,
// desde que todo fetch use `credentials: 'include'`. Esquecer isso em uma chamada faz aquela rota
// parecer deslogada sem erro nenhum, então o wrapper abaixo é o único caminho.

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

async function post(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`/api/auth${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as { message?: string; code?: string } | null;
  if (!res.ok) throw new Error(translate(json?.code, json?.message, res.status));
  return json;
}

// As mensagens do better-auth são em inglês e escritas pra quem integra, não pra quem usa
// ("Reset password isn't enabled"). Traduzir pelo `code` — que é estável — em vez de pelo texto.
const BY_CODE: Record<string, string> = {
  RESET_PASSWORD_DISABLED:
    'A recuperação por e-mail ainda não está ligada. Peça uma senha nova a quem te convidou.',
  INVALID_EMAIL_OR_PASSWORD: 'E-mail ou senha incorretos.',
  USER_ALREADY_EXISTS: 'Já existe uma conta com esse e-mail.',
  PASSWORD_TOO_SHORT: 'A senha precisa ter pelo menos 8 caracteres.',
};

function translate(code: string | undefined, message: string | undefined, status: number): string {
  if (code && BY_CODE[code]) return BY_CODE[code];
  // A mensagem do portão de convite é nossa e já está em português — vale mais que o genérico.
  if (status === 403 && message) return message;
  if (status === 401) return 'E-mail ou senha incorretos.';
  if (status === 422) return 'Já existe uma conta com esse e-mail.';
  return 'Não foi possível completar. Tente de novo em instantes.';
}

export const signIn = (email: string, password: string) => post('/sign-in/email', { email, password });
export const signUp = (email: string, password: string, name: string) => post('/sign-up/email', { email, password, name });
export const signOut = () => post('/sign-out', {});
// `redirectTo` tem que ser CAMINHO relativo: mandando a URL completa, mesmo sendo a mesma origem,
// o better-auth responde INVALID_REDIRECT_URL.
export const requestPasswordReset = (email: string) =>
  post('/request-password-reset', { email, redirectTo: '/app?redefinir=1' });

export type SessionState = { status: 'loading' } | { status: 'out' } | { status: 'in'; user: SessionUser };

/**
 * A sessão atual. `loading` é um estado próprio de propósito: sem ele, o primeiro quadro renderiza
 * a tela de entrar mesmo pra quem já está logado — um pisca-pisca a cada refresh.
 */
export function useSession() {
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/get-session', { credentials: 'include' });
      const json = (await res.json().catch(() => null)) as { user?: SessionUser } | null;
      setState(json?.user ? { status: 'in', user: json.user } : { status: 'out' });
    } catch {
      // Rede caiu: tratar como deslogado mostraria a tela de entrar e faria a pessoa achar que
      // perdeu a sessão. É o comportamento certo mesmo assim — sem confirmação do servidor não dá
      // pra afirmar que ela existe.
      setState({ status: 'out' });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { session: state, refresh };
}
