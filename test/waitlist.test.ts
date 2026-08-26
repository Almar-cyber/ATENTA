import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/worker.js';
import { resetDb } from './helpers.js';

// LISTA DE ESPERA (`/api/waitlist`) e ESTADO DO CADASTRO (`/api/config`).
//
// A landing convida qualquer um a "começar grátis", mas o cadastro fica fechado até o App Review da
// Meta aprovar. Antes desta lista, quem chegava de fora preenchia nome, e-mail e senha pra só então
// tomar um "o cadastro está fechado" — beco sem saída (design.md, princípio 4).
//
// O que estes testes protegem, em ordem de importância:
//  1. as duas rotas são PÚBLICAS — quem entra na fila, por definição, ainda não tem sessão. Se elas
//     caírem atrás do gate, a lista fica inalcançável justo pra quem ela existe;
//  2. entrar duas vezes não duplica nem reordena a fila;
//  3. a resposta é a MESMA pra e-mail novo e repetido — senão a mensagem vira um oráculo de quem
//     já se inscreveu;
//  4. `/api/config` conta a verdade, porque é dele que a tela decide entre "criar conta" e "entrar
//     na lista". Divergir do portão real é reintroduzir o beco.

const ORIGIN = 'https://atenta.omangue.co';

async function call(request: Request, overrides?: Partial<typeof env>): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, { ...env, ...overrides } as typeof env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

function entrar(body: unknown, overrides?: Partial<typeof env>): Promise<Response> {
  return call(
    new Request(`${ORIGIN}/api/waitlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    overrides
  );
}

interface LinhaFila {
  email: string;
  name: string | null;
  created_at: string;
  invited_at: string | null;
}

async function fila(): Promise<LinhaFila[]> {
  const { results } = await env.DB.prepare(
    `select email, name, created_at, invited_at from signup_waitlist order by created_at`
  ).all<LinhaFila>();
  return results ?? [];
}

describe('lista de espera', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('aceita sem sessão — é o único jeito de ela servir pra quem ainda não tem conta', async () => {
    const res = await entrar({ email: 'novata@exemplo.com', name: 'Novata' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const linhas = await fila();
    expect(linhas).toHaveLength(1);
    expect(linhas[0].email).toBe('novata@exemplo.com');
    expect(linhas[0].name).toBe('Novata');
    // Ainda não convidada: é o campo que separa a fila de quem já passou por ela.
    expect(linhas[0].invited_at).toBeNull();
  });

  it('normaliza o e-mail, pra MAIÚSCULA e espaço não criarem uma segunda vaga', async () => {
    await entrar({ email: 'Alguem@Exemplo.com' });
    await entrar({ email: '  alguem@exemplo.com  ' });

    const linhas = await fila();
    expect(linhas).toHaveLength(1);
    expect(linhas[0].email).toBe('alguem@exemplo.com');
  });

  it('entrar de novo não fura a fila nem muda a resposta', async () => {
    await entrar({ email: 'primeira@exemplo.com', name: 'Primeira' });
    const antes = (await fila())[0];

    const repetida = await entrar({ email: 'primeira@exemplo.com', name: 'Outro Nome' });
    // Resposta idêntica à da primeira vez: quem tenta de novo não descobre pela mensagem que já
    // estava na lista.
    expect(repetida.status).toBe(200);
    expect(await repetida.json()).toEqual({ ok: true });

    const depois = await fila();
    expect(depois).toHaveLength(1);
    // A data de entrada é a posição na fila — reescrevê-la mandaria quem chegou primeiro pro fim.
    expect(depois[0].created_at).toBe(antes.created_at);
    expect(depois[0].name).toBe('Primeira');
  });

  it('recusa e-mail inválido em vez de gravar linha morta', async () => {
    for (const invalido of ['', 'sem-arroba', 'sem@dominio', 'a@b@c.com', 'espaço @exemplo.com']) {
      const res = await entrar({ email: invalido });
      expect(res.status, `deveria recusar: ${JSON.stringify(invalido)}`).toBe(400);
    }
    expect(await fila()).toHaveLength(0);
  });

  it('com o cadastro aberto, recusa — não existe fila quando dá pra criar conta direto', async () => {
    const res = await entrar({ email: 'tarde@exemplo.com' }, { SIGNUP_MODE: 'open' });
    expect(res.status).toBe(400);
    expect(await fila()).toHaveLength(0);
  });
});

describe('/api/config', () => {
  beforeEach(async () => {
    await resetDb();
  });

  // Este é o teste que segura o beco sem saída: a tela escolhe entre "criar conta" e "entrar na
  // lista" a partir daqui, então se ele mentir a pessoa volta a preencher tudo pra ser recusada.
  it('reporta cadastro fechado quando SIGNUP_MODE não está definido', async () => {
    const res = await call(new Request(`${ORIGIN}/api/config`), { SIGNUP_MODE: undefined });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ signup_open: false });
  });

  it('reporta aberto com SIGNUP_MODE=open', async () => {
    const res = await call(new Request(`${ORIGIN}/api/config`), { SIGNUP_MODE: 'open' });
    expect(await res.json()).toEqual({ signup_open: true });
  });

  it('qualquer outro valor conta como fechado — o padrão restritivo é o seguro', async () => {
    const res = await call(new Request(`${ORIGIN}/api/config`), { SIGNUP_MODE: 'aberto' });
    expect(await res.json()).toEqual({ signup_open: false });
  });

  it('responde sem sessão', async () => {
    const res = await call(new Request(`${ORIGIN}/api/config`));
    // Não é 401: a rota vive antes do gate de propósito.
    expect(res.status).toBe(200);
  });
});
