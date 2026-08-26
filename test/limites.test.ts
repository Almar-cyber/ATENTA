import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/worker.js';
import { resetDb } from './helpers.js';
import { avisoDeLimite, FREE_LIMITS, LIMITES_DESDE, limitesValemPara } from '../src/lib/billing.js';

// Os limites do plano gratuito, aplicados SEM cobrança.
//
// O ponto delicado é o corte por data: quando o cadastro abriu (13/08/2026) as contas que já
// existiam usavam muito acima do anunciado (5 e 4 redes, 63 e 234 posts no mês). Ligar os limites
// pra todo mundo as travaria na hora. Então quem é anterior ao corte passa livre, e quem chega
// depois pega o teto — é isso que os testes abaixo protegem, porque é a regra fácil de quebrar sem
// perceber numa mexida futura.

const ORIGIN = 'https://atenta.omangue.co';

async function call(request: Request): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function register(email: string): Promise<{ id: string; cookie: string }> {
  await env.DB.prepare(`insert into signup_invites (email) values (?)`).bind(email.toLowerCase()).run();
  const res = await call(
    new Request(`${ORIGIN}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'senha-de-teste-123', name: email }),
    })
  );
  if (!res.ok) throw new Error(`sign-up falhou (${res.status}): ${await res.text()}`);
  const body = (await res.json()) as { user: { id: string } };
  const cookie = res.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('sign-up não devolveu cookie de sessão');
  return { id: body.user.id, cookie };
}

/** Move a data de criação da conta, pra simular quem chegou antes ou depois do corte. */
async function nasceuEm(userId: string, quando: string): Promise<void> {
  await env.DB.prepare(`update user set createdAt = ? where id = ?`).bind(quando, userId).run();
}

/** Facebook porque ele publica post só de texto — assim o teste não precisa subir mídia. */
async function criarConta(owner: string, tag: string): Promise<string> {
  const id = `acc-${tag}`;
  await env.DB.prepare(
    `insert into accounts (id, platform, display_name, external_account_id, status, extra, owner_id)
     values (?, 'facebook', ?, ?, 'active', '{}', ?)`
  )
    .bind(id, `conta ${tag}`, `ext-${tag}`, owner)
    .run();
  return id;
}

async function criarPost(user: { cookie: string }, contaId: string, quando: string): Promise<Response> {
  return call(
    new Request(`${ORIGIN}/api/posts`, {
      method: 'POST',
      headers: { Cookie: user.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'oi', scheduled_for: quando, target_account_ids: [contaId], save_as: 'draft' }),
    })
  );
}

const DEPOIS = '2026-09-01T10:00:00.000Z';
const ANTES = '2026-08-01T10:00:00.000Z';

describe('limitesValemPara', () => {
  it('conta anterior ao corte fica isenta', () => {
    expect(limitesValemPara(ANTES)).toBe(false);
  });

  it('conta criada a partir do corte é limitada', () => {
    expect(limitesValemPara(LIMITES_DESDE)).toBe(true);
    expect(limitesValemPara(DEPOIS)).toBe(true);
  });

  it('sem data conhecida, limita — na dúvida barra em vez de liberar', () => {
    expect(limitesValemPara(null)).toBe(true);
    expect(limitesValemPara(undefined)).toBe(true);
  });
});

describe('avisoDeLimite', () => {
  // A assinatura não existe: billing.ts não é importado por ninguém e a tabela `subscriptions` nem
  // foi criada. Mandar assinar seria vender uma porta que não abre.
  it('não manda assinar — diz que o plano ainda não saiu', () => {
    const texto = avisoDeLimite('Acabou o espaço.');
    expect(texto).toContain('ainda não está disponível');
    expect(texto.toLowerCase()).not.toContain('assine');
  });
});

describe('limite de posts por mês', () => {
  let novo: Awaited<ReturnType<typeof register>>;
  let conta: string;

  beforeEach(async () => {
    await resetDb();
    novo = await register('novo@exemplo.com');
    await nasceuEm(novo.id, DEPOIS);
    conta = await criarConta(novo.id, 'novo');
  });

  it('recusa o post que passa do teto, com 429 e a mensagem honesta', async () => {
    for (let i = 0; i < FREE_LIMITS.postsPerMonth; i++) {
      expect((await criarPost(novo, conta, '2026-09-10T10:00:00.000Z')).status).toBe(201);
    }

    const res = await criarPost(novo, conta, '2026-09-10T10:00:00.000Z');
    expect(res.status).toBe(429);
    const { error } = (await res.json()) as { error: string };
    expect(error).toContain('ainda não está disponível');
    expect(error).toContain(String(FREE_LIMITS.postsPerMonth));
  });

  it('rascunho conta igual — senão o teto vira só um contorno de um clique', async () => {
    for (let i = 0; i < FREE_LIMITS.postsPerMonth; i++) {
      await criarPost(novo, conta, '2026-09-10T10:00:00.000Z');
    }
    expect((await criarPost(novo, conta, '2026-09-10T10:00:00.000Z')).status).toBe(429);
  });

  it('conta antiga passa do teto sem ser barrada', async () => {
    const antigo = await register('antigo@exemplo.com');
    await nasceuEm(antigo.id, ANTES);
    const contaAntiga = await criarConta(antigo.id, 'antigo');

    for (let i = 0; i < FREE_LIMITS.postsPerMonth + 3; i++) {
      expect((await criarPost(antigo, contaAntiga, '2026-09-10T10:00:00.000Z')).status).toBe(201);
    }
  });
});

describe('limite de contas conectadas', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('conta nova no teto é barrada ANTES do consentimento da plataforma', async () => {
    const novo = await register('novo@exemplo.com');
    await nasceuEm(novo.id, DEPOIS);
    await criarConta(novo.id, 'ja-tem');

    const res = await call(
      new Request(`${ORIGIN}/api/connect/meta`, { headers: { Cookie: novo.cookie }, redirect: 'manual' })
    );

    expect(res.status).toBe(302);
    const destino = res.headers.get('location') ?? '';
    // Volta pro app com o motivo, e NÃO pra tela de consentimento da plataforma: entregar acesso
    // pra ouvir "não deu" depois seria pior que barrar antes.
    expect(destino).toContain('connect_error=meta');
    expect(destino).toContain('reason=limite_contas');
    expect(destino).not.toContain('facebook.com');
  });

  it('conta antiga com várias redes continua conectando', async () => {
    const antigo = await register('antigo@exemplo.com');
    await nasceuEm(antigo.id, ANTES);
    for (const t of ['a', 'b', 'c']) await criarConta(antigo.id, t);

    const res = await call(
      new Request(`${ORIGIN}/api/connect/meta`, { headers: { Cookie: antigo.cookie }, redirect: 'manual' })
    );
    expect(res.headers.get('location') ?? '').not.toContain('limite_contas');
  });
});
