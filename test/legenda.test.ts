import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buscarExemplos,
  consumirCota,
  devolverCota,
  diaDeHoje,
  lerSugestoes,
  montarPrompt,
  TETO_DIARIO,
} from '../src/lib/legenda.js';
import { insertAccount, insertPost, resetDb } from './helpers.js';

// SUGESTÃO DE LEGENDA.
//
// Três coisas aqui merecem teste, e o resto não: a leitura da resposta do modelo (que é onde a
// funcionalidade quebra de um jeito intermitente), o teto diário (que é onde ela custa dinheiro de
// todo mundo) e o prompt (que é onde mora a regra de produto). A chamada ao modelo em si não é
// testada — depende de rede e devolve texto diferente a cada vez.

describe('montarPrompt', () => {
  const base = { assunto: 'lançamento da coleção de inverno', plataforma: 'instagram' as const };

  it('leva o limite de caracteres da rede escolhida', () => {
    expect(montarPrompt(base)).toContain('2200');
    expect(montarPrompt({ ...base, plataforma: 'pinterest' })).toContain('500');
  });

  it('leva o pilar quando a peça tem um', () => {
    expect(montarPrompt({ ...base, pilar: 'bastidores' })).toContain('bastidores');
  });

  // A razão de a funcionalidade existir: sem os exemplos do próprio dono a saída é genérica, igual
  // à de qualquer ferramenta. Se este teste cair, o diferencial sumiu sem ninguém notar.
  it('leva as legendas que mais engajaram como exemplo de tom', () => {
    const prompt = montarPrompt({ ...base, exemplos: ['acordamos 5h pra pegar essa luz', 'terceiro café do dia'] });
    expect(prompt).toContain('acordamos 5h pra pegar essa luz');
    expect(prompt).toContain('terceiro café do dia');
  });

  it('ignora exemplo vazio em vez de mandar linha em branco', () => {
    const prompt = montarPrompt({ ...base, exemplos: ['', '   '] });
    expect(prompt).not.toContain('melhor desempenho');
  });

  it('proíbe inventar fato e usar travessão', () => {
    const prompt = montarPrompt(base);
    expect(prompt).toContain('Não invente fato');
    expect(prompt).toContain('travessão');
  });
});

describe('lerSugestoes', () => {
  it('lê o formato pedido: opções separadas por ---', () => {
    expect(lerSugestoes('primeira opção\n---\nsegunda opção\n---\nterceira opção')).toEqual([
      'primeira opção',
      'segunda opção',
      'terceira opção',
    ]);
  });

  // Legenda de Instagram TEM quebra de linha. Se o separador as engolisse, a funcionalidade
  // entregaria parágrafo solto em vez de legenda.
  it('preserva as quebras de linha dentro de cada opção', () => {
    const r = lerSugestoes('linha um\nlinha dois\n---\noutra opção');
    expect(r[0]).toBe('linha um\nlinha dois');
  });

  it('lê o array JSON limpo', () => {
    expect(lerSugestoes('["uma", "duas", "três"]')).toEqual(['uma', 'duas', 'três']);
  });

  // REGRESSÃO de um caso real: na primeira chamada de verdade ao modelo, ele devolveu um array com
  // quebra de linha CRUA dentro das aspas (JSON inválido), e as três opções voltaram grudadas numa
  // só, com colchete e aspas à mostra na tela.
  it('lê o array mesmo com quebra de linha crua dentro das aspas', () => {
    const cru = '["Chegamos à coleção!\nNovas peças na loja.", "Segunda opção\naqui."]';
    expect(lerSugestoes(cru)).toEqual(['Chegamos à coleção!\nNovas peças na loja.', 'Segunda opção\naqui.']);
  });

  // Modelo pequeno embrulha em markdown com frequência. Tratar isso como erro deixaria a
  // funcionalidade quebrada de um jeito que só aparece às vezes.
  it('lê o array dentro de cerca de markdown', () => {
    expect(lerSugestoes('```json\n["uma", "duas"]\n```')).toEqual(['uma', 'duas']);
  });

  it('lê o array mesmo com conversa antes', () => {
    expect(lerSugestoes('Claro! Aqui estão:\n["uma", "duas"]')).toEqual(['uma', 'duas']);
  });

  it('cai pra lista numerada quando não veio JSON', () => {
    expect(lerSugestoes('1. primeira opção\n2. segunda opção\n3. terceira opção')).toEqual([
      'primeira opção',
      'segunda opção',
      'terceira opção',
    ]);
  });

  it('texto solto ainda vale como uma sugestão', () => {
    expect(lerSugestoes('só uma frase mesmo')).toEqual(['só uma frase mesmo']);
  });

  it('devolve vazio quando não veio nada aproveitável', () => {
    expect(lerSugestoes('   ')).toEqual([]);
  });

  it('não devolve mais que três, mesmo se o modelo mandar dez', () => {
    const dez = JSON.stringify(Array.from({ length: 10 }, (_, i) => `opção ${i}`));
    expect(lerSugestoes(dez)).toHaveLength(3);
  });

  it('descarta item que não é string', () => {
    expect(lerSugestoes('["boa", 42, null, "outra"]')).toEqual(['boa', 'outra']);
  });
});

// A consulta do histórico é a parte mais frágil do módulo: é SQL escrito contra nomes de coluna de
// quatro tabelas, e já quebrou uma vez aqui (o join usava `post_id`, e a coluna real é
// `scheduled_post_id`). Sem estes testes o erro só apareceria em produção, na forma de sugestão
// genérica — que é indistinguível de "o modelo não caprichou".
describe('buscarExemplos', () => {
  /** Publica um post com legenda e grava um snapshot de métrica pra ele. */
  async function publicar(opts: {
    owner: string;
    accountId: string;
    legenda: string;
    curtidas: number;
    tagId?: string;
    coletas?: number;
  }): Promise<void> {
    const targetId = await insertPost({
      accountId: opts.accountId,
      platform: 'instagram',
      body: opts.legenda,
      status: 'published',
    });
    await env.DB.prepare(
      `update scheduled_posts set owner_id = ?, tag_id = ?
        where id = (select scheduled_post_id from post_targets where id = ?)`
    )
      .bind(opts.owner, opts.tagId ?? null, targetId)
      .run();

    // Várias coletas do MESMO post: é o que prova que a ordenação usa o último snapshot e não a
    // soma. Somando, quem tem post antigo (mais coletas) ganharia sempre.
    for (let i = 0; i < (opts.coletas ?? 1); i++) {
      await env.DB.prepare(
        `insert into post_metrics (id, post_target_id, external_post_id, platform, fetched_at, likes, comments)
         values (?, ?, 'ext', 'instagram', ?, ?, 0)`
      )
        .bind(crypto.randomUUID(), targetId, `2026-08-0${i + 1}T00:00:00Z`, opts.curtidas)
        .run();
    }
  }

  let contaId: string;

  beforeEach(async () => {
    await resetDb();
    contaId = await insertAccount({ platform: 'instagram' });
  });

  it('traz as legendas com mais engajamento primeiro', async () => {
    await publicar({ owner: 'alice', accountId: contaId, legenda: 'a legenda fraca deste post aqui', curtidas: 3 });
    await publicar({ owner: 'alice', accountId: contaId, legenda: 'a legenda campeã deste post aqui', curtidas: 90 });

    const exemplos = await buscarExemplos(env, 'alice', 'instagram');
    expect(exemplos[0]).toContain('campeã');
  });

  it('não vaza legenda de outro dono', async () => {
    await publicar({ owner: 'bob', accountId: contaId, legenda: 'post do bob que ninguém deveria ver', curtidas: 99 });
    expect(await buscarExemplos(env, 'alice', 'instagram')).toEqual([]);
  });

  it('post ainda não publicado não serve de exemplo', async () => {
    const targetId = await insertPost({
      accountId: contaId,
      platform: 'instagram',
      body: 'rascunho que ainda nem saiu do forno',
      status: 'draft',
    });
    await env.DB.prepare(
      `update scheduled_posts set owner_id = 'alice' where id = (select scheduled_post_id from post_targets where id = ?)`
    )
      .bind(targetId)
      .run();
    expect(await buscarExemplos(env, 'alice', 'instagram')).toEqual([]);
  });

  // Ordenar pela SOMA multiplicaria o número do post pela quantidade de vezes que ele foi visitado.
  it('post visitado muitas vezes não ganha por isso', async () => {
    await publicar({ owner: 'alice', accountId: contaId, legenda: 'post velho com muitas coletas', curtidas: 5, coletas: 5 });
    await publicar({ owner: 'alice', accountId: contaId, legenda: 'post novo que engajou de verdade', curtidas: 80 });

    const exemplos = await buscarExemplos(env, 'alice', 'instagram');
    expect(exemplos[0]).toContain('engajou de verdade');
  });

  it('filtra pelo pilar quando ele tem histórico', async () => {
    await env.DB.prepare(`insert into tags (id, owner_id, name, color) values ('t1', 'alice', 'bastidores', 'roxo')`).run();
    await publicar({ owner: 'alice', accountId: contaId, legenda: 'este post é de bastidores mesmo', curtidas: 2, tagId: 't1' });
    await publicar({ owner: 'alice', accountId: contaId, legenda: 'este post é de outro assunto', curtidas: 99 });

    const exemplos = await buscarExemplos(env, 'alice', 'instagram', 't1');
    expect(exemplos).toHaveLength(1);
    expect(exemplos[0]).toContain('bastidores');
  });

  // Pilar recém-criado é o caso comum, e é justo nele que a ajuda faz mais falta: sem esta queda
  // pro geral, marcar o pilar PIORARIA a sugestão em vez de melhorar.
  it('pilar sem histórico cai nos melhores do dono', async () => {
    await env.DB.prepare(`insert into tags (id, owner_id, name, color) values ('t2', 'alice', 'novo', 'verde')`).run();
    await publicar({ owner: 'alice', accountId: contaId, legenda: 'o único post publicado até agora', curtidas: 7 });

    const exemplos = await buscarExemplos(env, 'alice', 'instagram', 't2');
    expect(exemplos[0]).toContain('único post publicado');
  });

  it('legenda curta demais não vira exemplo de tom', async () => {
    await publicar({ owner: 'alice', accountId: contaId, legenda: 'oi', curtidas: 50 });
    expect(await buscarExemplos(env, 'alice', 'instagram')).toEqual([]);
  });
});

describe('teto diário (ai_usage)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('conta cada geração e devolve quantas sobram', async () => {
    expect(await consumirCota(env, 'alice')).toBe(TETO_DIARIO - 1);
    expect(await consumirCota(env, 'alice')).toBe(TETO_DIARIO - 2);
  });

  // O teto existe porque a cota do Workers AI é da CONTA inteira, não de cada pessoa: sem ele, uma
  // pessoa insistindo no botão deixa a funcionalidade morta pros outros no meio do dia.
  it('barra ao chegar no teto', async () => {
    for (let i = 0; i < TETO_DIARIO; i++) expect(await consumirCota(env, 'alice')).not.toBeNull();
    expect(await consumirCota(env, 'alice')).toBeNull();
  });

  it('o teto de uma pessoa não gasta o da outra', async () => {
    for (let i = 0; i < TETO_DIARIO; i++) await consumirCota(env, 'alice');
    expect(await consumirCota(env, 'alice')).toBeNull();
    expect(await consumirCota(env, 'bob')).toBe(TETO_DIARIO - 1);
  });

  // Sem isto o contador precisaria de alguém pra zerar. Com o dia na chave, amanhã é outra linha.
  it('vira o dia sozinho', async () => {
    const hoje = new Date('2026-08-06T10:00:00Z');
    const amanha = new Date('2026-08-07T10:00:00Z');
    for (let i = 0; i < TETO_DIARIO; i++) await consumirCota(env, 'alice', hoje);
    expect(await consumirCota(env, 'alice', hoje)).toBeNull();
    expect(await consumirCota(env, 'alice', amanha)).toBe(TETO_DIARIO - 1);
  });

  // Falha do modelo não pode custar cota da pessoa: ela veria o contador cair sem receber legenda.
  it('devolve a cota quando a geração falha', async () => {
    await consumirCota(env, 'alice');
    await consumirCota(env, 'alice');
    await devolverCota(env, 'alice');
    expect(await consumirCota(env, 'alice')).toBe(TETO_DIARIO - 2);
  });

  it('devolver mais vezes que consumiu não deixa o contador negativo', async () => {
    await devolverCota(env, 'alice');
    await devolverCota(env, 'alice');
    const row = await env.DB.prepare(`select usos from ai_usage where owner_id = ? and dia = ?`)
      .bind('alice', diaDeHoje())
      .first<{ usos: number }>();
    // A linha só existe se algum consumo a criou; devolver sem consumo não deve inventar dívida.
    expect(row?.usos ?? 0).toBe(0);
  });
});
