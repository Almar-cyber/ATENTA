import type { Env } from './env.js';
import type { Platform } from './types.js';
import { safeParseJson } from './errors.js';

// Geração de legenda pelo Workers AI.
//
// POR QUE NA CLOUDFLARE, E NÃO NA API DA ANTHROPIC/OPENAI. A declaração de tratamento de dados
// enviada à Meta diz que a Cloudflare é a ÚNICA operadora. A legenda que a pessoa escreve, e o
// histórico dela que entra como exemplo de tom, são dados dela; mandar isso pra um terceiro obriga
// a voltar na Meta e declarar um segundo operador — foi exatamente o que o Resend custou. Aqui o
// dado não sai de onde já estava.
//
// O QUE FAZ ISTO SER DIFERENTE de um "gerar legenda" qualquer: o prompt leva os posts que MAIS
// ENGAJARAM daquele dono, no mesmo pilar de conteúdo. Isso só é possível porque pilar (tags,
// migração 0014) e métrica (post_metrics, 0005) já moram no mesmo banco. Sem esses exemplos a saída
// é genérica e soa como qualquer ferramenta; com eles, sai no tom de quem já publica ali.

/**
 * Modelos, EM ORDEM de preferência. É aqui que mora o fallback.
 *
 * Ele é entre modelos da MESMA conta, de propósito, e não entre fornecedores: o modo de falha desta
 * funcionalidade é "não gerou legenda agora", não "não publicou o post". Um segundo fornecedor
 * custaria dinheiro por chamada justo quando o volume aperta, exigiria mais uma chave, e tiraria o
 * dado da Cloudflare (ver acima). Dois modelos cobrem o caso que acontece de verdade, que é o
 * modelo estar sobrecarregado, e custam zero a mais.
 *
 * O Scout vem primeiro por ser o mais barato dos dois (24.545 Neurons por milhão de tokens de
 * entrada, 77.273 de saída, ou seja ~28 por legenda). O 70B custa ~54 por legenda, quase tudo na
 * saída (204.805/M) — aceitável justamente porque só entra quando o primeiro cai.
 *
 * Não é o `llama-3.1-8b-instruct`, que seria o mais óbvio: esse nome não existe no catálogo tipado
 * do workers-types (só as variantes `-fp8` e `-awq`), e o 70B é melhor em português de qualquer
 * jeito. Tipado como `keyof AiModels` pra que um modelo aposentado quebre no build, não em produção.
 */
const MODELOS: readonly (keyof AiModels)[] = [
  '@cf/meta/llama-4-scout-17b-16e-instruct',
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
];

/**
 * Teto de gerações por dono por dia.
 *
 * A cota gratuita do Workers AI (10.000 Neurons/dia) é da CONTA, não de cada pessoa. Uma geração
 * custa ~28 Neurons, então cabem ~350 no dia inteiro somando todo mundo. Sem teto por dono, uma
 * pessoa insistindo no botão deixa a funcionalidade morta pros outros, e o sintoma pra quem não fez
 * nada é ela parar de responder no meio do dia sem explicação.
 *
 * 20 é generoso pra uso real (ninguém escreve 20 posts por dia) e ainda deixa margem pra dezenas de
 * pessoas no mesmo dia.
 */
export const TETO_DIARIO = 20;

/** Quantas sugestões por chamada. Três dá escolha sem virar lista pra ler (Lei de Hick). */
const QUANTAS = 3;

export interface PedidoLegenda {
  /** O que a pessoa quer dizer. É o único campo obrigatório. */
  assunto: string;
  /** Pra qual rede escrever. Muda tom e limite de caracteres. */
  plataforma: Platform;
  /** Nome do pilar de conteúdo, quando a peça tem um. */
  pilar?: string;
  /** Legendas do próprio dono que mais engajaram, pra servir de exemplo de tom. */
  exemplos?: string[];
}

// Espelho do PLATFORM_CAPTION_LIMITS do front (web/src/lib/platforms.ts). Duplicado de propósito:
// o Worker não importa nada de web/, e este número aqui serve pra INSTRUIR o modelo, enquanto lá
// serve pra avisar a pessoa. Quem corta o excesso de verdade continua sendo a própria rede.
const LIMITE: Record<Platform, number> = {
  instagram: 2200,
  facebook: 5000,
  linkedin: 3000,
  pinterest: 500,
  tiktok: 2200,
  youtube: 5000,
};

// Tom por rede. Não é enfeite: a mesma legenda no LinkedIn e no TikTok é o erro mais visível de
// quem publica em tudo de uma vez, e é justamente o que um agendador multi-rede deveria evitar.
const TOM: Record<Platform, string> = {
  instagram: 'próximo e direto, com quebras de linha curtas; hashtags só se pedirem',
  facebook: 'conversado, um pouco mais longo, sem gíria de nicho',
  linkedin: 'profissional sem ser engessado, primeira pessoa, nada de jargão corporativo',
  pinterest: 'descritivo e útil, com a palavra-chave do assunto logo no começo',
  tiktok: 'curto, falado, começa pelo gancho',
  youtube: 'descreve o vídeo e o que a pessoa ganha assistindo',
};

/**
 * O prompt. Separado da chamada porque é a parte que tem regra de produto dentro, e regra de
 * produto se testa sem rede — `test/legenda.test.ts` confere que o pilar e os exemplos entram.
 */
export function montarPrompt(p: PedidoLegenda): string {
  const partes: string[] = [
    `Escreva ${QUANTAS} opções de legenda em português do Brasil para um post de ${p.plataforma}.`,
    `Tom: ${TOM[p.plataforma]}.`,
    `Cada opção precisa caber em ${LIMITE[p.plataforma]} caracteres.`,
  ];

  if (p.pilar) partes.push(`O post faz parte do pilar de conteúdo "${p.pilar}".`);

  const exemplos = (p.exemplos ?? []).filter((e) => e.trim().length > 0);
  if (exemplos.length > 0) {
    partes.push(
      'Estas são legendas que esta mesma pessoa publicou e que tiveram o melhor desempenho. ' +
        'Siga o jeito de escrever delas (ritmo, tamanho, pontuação, uso de emoji), sem copiar o conteúdo:',
      ...exemplos.map((e) => `- ${e.slice(0, 400)}`)
    );
  }

  partes.push(
    'Regras:',
    '- Não invente fato, número, data, preço nem depoimento que não esteja no assunto abaixo.',
    '- Não escreva "confira o link na bio" nem chamada genérica que sirva pra qualquer post.',
    // Vem do mesmo motivo do resto do produto (memória do projeto): travessão em texto gerado é a
    // marca mais reconhecível de que ninguém escreveu aquilo.
    '- Não use travessão (—). Prefira vírgula, dois-pontos ou ponto.',
    // Separador de linha, e NÃO array JSON. Pedir JSON parecia mais limpo, mas legenda tem quebra
    // de linha por natureza, e o modelo põe essa quebra CRUA dentro das aspas — o que é JSON
    // inválido. Deu pra ver na primeira chamada real: as três opções voltaram como uma só.
    // O separador não tem esse problema, porque quebra de linha dentro da opção é só texto.
    '- Escreva uma opção após a outra, separadas por uma linha contendo apenas ---',
    '- Não numere as opções, não use markdown, não escreva nada antes nem depois.',
    '',
    `Assunto do post: ${p.assunto.trim()}`
  );

  return partes.join('\n');
}

/**
 * Lê a resposta do modelo.
 *
 * Defensiva de propósito: modelo pequeno desobedece "devolva só JSON" com frequência, embrulhando em
 * ```json, prefaciando com "Claro!" ou devolvendo as opções numeradas. Tratar isso como erro deixaria
 * a funcionalidade quebrada de um jeito intermitente e difícil de reproduzir. Cada degrau abaixo é um
 * formato que dá pra aproveitar; só desiste quando não sobra texto nenhum.
 */
export function lerSugestoes(bruto: string): string[] {
  const semCerca = bruto
    .trim()
    .replace(/^```(?:json|text)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  if (semCerca.length === 0) return [];

  const limpar = (s: string) =>
    s
      .trim()
      // Aspas em volta da opção inteira: sobra de quando o modelo tenta imitar o formato JSON.
      .replace(/^["'](.*)["']$/s, '$1')
      // Numeração que ele acrescenta mesmo tendo sido pedido pra não acrescentar.
      .replace(/^\s*(?:\d+[.)]|[-*])\s*/, '')
      .trim();

  // 1. O formato PEDIDO: opções separadas por uma linha de ---.
  const porSeparador = semCerca.split(/^\s*-{3,}\s*$/m).map(limpar).filter((s) => s.length > 0);
  if (porSeparador.length > 1) return porSeparador.slice(0, QUANTAS);

  // 2. Array JSON. O modelo às vezes devolve assim mesmo tendo sido pedido o separador, e às vezes
  //    com quebra de linha CRUA dentro das aspas, que é JSON inválido — daí o escapeControles.
  const inicio = semCerca.indexOf('[');
  const fim = semCerca.lastIndexOf(']');
  if (inicio !== -1 && fim > inicio) {
    const trecho = semCerca.slice(inicio, fim + 1);
    const arr = safeParseJson(trecho) ?? safeParseJson(escapeControles(trecho));
    if (Array.isArray(arr)) {
      const strings = arr.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
      if (strings.length > 0) return strings.map((s) => s.trim()).slice(0, QUANTAS);
    }
  }

  // 3. Lista numerada ou separada por linha em branco.
  const itens = semCerca
    .split(/\n\s*\n|\n(?=\s*(?:\d+[.)]|[-*])\s)/)
    .map(limpar)
    .filter((l) => l.length > 0);
  if (itens.length > 1) return itens.slice(0, QUANTAS);

  // 4. Sobrou texto: vale como uma sugestão só. Melhor que devolver nada.
  return [limpar(semCerca)];
}

/**
 * Escapa quebra de linha e tabulação que estejam DENTRO de uma string JSON.
 *
 * Existe por causa de um caso observado na primeira chamada real: o modelo devolve um array cujas
 * strings têm quebra de linha literal, o que `JSON.parse` recusa. Percorrer caractere a caractere
 * (em vez de um regex sobre o texto todo) é o que permite distinguir o que está dentro de aspas do
 * que está fora, sem estragar a estrutura do array.
 */
function escapeControles(json: string): string {
  let saida = '';
  let dentro = false;
  let escapado = false;
  for (const ch of json) {
    if (escapado) {
      saida += ch;
      escapado = false;
      continue;
    }
    if (ch === '\\') {
      saida += ch;
      escapado = true;
      continue;
    }
    if (ch === '"') dentro = !dentro;
    if (dentro && (ch === '\n' || ch === '\r' || ch === '\t')) {
      saida += ch === '\n' ? '\\n' : ch === '\r' ? '\\r' : '\\t';
      continue;
    }
    saida += ch;
  }
  return saida;
}

/**
 * Busca legendas do próprio dono que mais engajaram, pra servir de exemplo de tom.
 *
 * Ordena pelo ÚLTIMO snapshot de cada destino (`max(fetched_at)`), não pela soma: post_metrics é
 * série temporal, e somar todas as coletas do mesmo post multiplicaria o número dele pela
 * quantidade de vezes que foi visitado — quem tem post antigo (mais coletas) ganharia sempre.
 *
 * Filtra por pilar quando há um. Sem pilar, ou com pilar sem histórico, cai nos melhores do dono na
 * mesma rede: exemplo de tom genérico do próprio dono ainda é melhor que exemplo nenhum.
 */
export async function buscarExemplos(
  env: Env,
  owner: string,
  plataforma: Platform,
  tagId?: string | null,
  quantos = 3
): Promise<string[]> {
  const filtroPilar = tagId ? 'and sp.tag_id = ?' : '';
  const sql = `
    select sp.body as legenda,
           (select coalesce(pm.likes, 0) + coalesce(pm.comments, 0)
              from post_metrics pm
             where pm.post_target_id = pt.id
             order by pm.fetched_at desc
             limit 1) as engajamento
      from post_targets pt
      join scheduled_posts sp on sp.id = pt.scheduled_post_id
     where sp.owner_id = ?
       and pt.platform = ?
       and pt.status = 'published'
       and length(trim(coalesce(sp.body, ''))) > 30
       ${filtroPilar}
     order by engajamento desc nulls last, sp.scheduled_for desc
     limit ?`;

  const binds: unknown[] = tagId ? [owner, plataforma, tagId, quantos] : [owner, plataforma, quantos];
  const { results } = await env.DB.prepare(sql)
    .bind(...binds)
    .all<{ legenda: string | null }>();

  const achados = (results ?? []).map((r) => r.legenda ?? '').filter((l) => l.trim().length > 0);
  // Com pilar e sem histórico nele, tenta de novo sem o filtro. Pilar novo é o caso comum (a pessoa
  // acabou de criar), e é justo nele que a ajuda faz mais falta.
  if (achados.length === 0 && tagId) return buscarExemplos(env, owner, plataforma, null, quantos);
  return achados;
}

export class SemIA extends Error {}

/**
 * Gera as sugestões. Tenta cada modelo da lista, em ordem, e só desiste quando todos falharem.
 *
 * Lança `SemIA` quando não há binding (ambiente local sem `[ai]`, ou os testes) ou quando nenhum
 * modelo respondeu — quem chama transforma isso na mensagem pra pessoa.
 */
export async function gerarLegenda(env: Env, pedido: PedidoLegenda): Promise<string[]> {
  if (!env.AI) throw new SemIA('binding AI ausente');

  const prompt = montarPrompt(pedido);
  let ultimoErro: unknown;

  for (const modelo of MODELOS) {
    try {
      const resposta = (await env.AI.run(modelo, {
        messages: [
          {
            role: 'system',
            content:
              'Você escreve legendas de redes sociais em português do Brasil. Responde sempre com um array JSON de strings, nada além disso.',
          },
          { role: 'user', content: prompt },
        ],
        // Teto de saída: 3 legendas cabem folgado nisso, e sem limite um modelo que resolve
        // "explicar" a resposta gasta Neuron à toa (saída custa 3× a entrada).
        max_tokens: 900,
        // Um pouco acima do padrão: legenda repetida entre as três opções não serve de escolha.
        temperature: 0.8,
      })) as { response?: string };

      const sugestoes = lerSugestoes(resposta?.response ?? '');
      if (sugestoes.length > 0) return sugestoes;
      ultimoErro = new Error(`${modelo} devolveu resposta vazia`);
    } catch (err) {
      // Log com o nome do modelo: quando o primeiro cair de vez, é isto que mostra que o fallback
      // está carregando tudo sozinho, em vez de a queda passar despercebida.
      console.error(`[legenda] ${modelo} falhou:`, err);
      ultimoErro = err;
    }
  }

  throw new SemIA(`nenhum modelo respondeu: ${String(ultimoErro)}`);
}

// ---------------------------------------------------------------------------
// Teto diário (tabela ai_usage, migração 0018)
// ---------------------------------------------------------------------------

/** O dia de hoje em UTC, no formato da coluna. */
export function diaDeHoje(agora: Date = new Date()): string {
  return agora.toISOString().slice(0, 10);
}

/**
 * Consome uma unidade do teto do dia. Devolve quantas sobraram, ou `null` quando já estourou.
 *
 * Incrementa e confere na MESMA instrução (`returning`), não em duas: com duas abas abertas, ler
 * "19 usados" nas duas e gravar 20 nas duas passa do teto sem ninguém perceber. O `where` dentro do
 * upsert é o que faz o banco recusar a passagem, não a aplicação.
 */
export async function consumirCota(
  env: Env,
  owner: string,
  agora: Date = new Date(),
  teto: number = TETO_DIARIO
): Promise<number | null> {
  const dia = diaDeHoje(agora);
  const row = await env.DB.prepare(
    `insert into ai_usage (owner_id, dia, usos) values (?, ?, 1)
     on conflict (owner_id, dia) do update set usos = usos + 1
     where ai_usage.usos < ?
     returning usos`
  )
    .bind(owner, dia, teto)
    .first<{ usos: number }>();

  // Sem linha devolvida = o `where` barrou, ou seja, já estava no teto.
  if (!row) return null;
  return teto - row.usos;
}

/**
 * Devolve a unidade consumida quando a geração falhou.
 *
 * A cota é consumida ANTES de chamar o modelo (senão a chamada cara acontece e só depois se
 * descobre que não podia). O preço disso é que uma falha do modelo cobraria da pessoa um erro que
 * não foi dela, e ela veria o contador cair sem receber legenda nenhuma. O `max(0, ...)` evita que
 * uma devolução repetida deixe o contador negativo.
 */
export async function devolverCota(env: Env, owner: string, agora: Date = new Date()): Promise<void> {
  await env.DB.prepare(`update ai_usage set usos = max(0, usos - 1) where owner_id = ? and dia = ?`)
    .bind(owner, diaDeHoje(agora))
    .run();
}
