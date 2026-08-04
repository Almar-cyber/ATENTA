// Sonda de histórico: até onde a rede devolve MÉTRICA de post antigo?
//
// POR QUE ISSO EXISTE E É TEMPORÁRIO: trazer insights de posts publicados antes do ATENTA! exige
// uma migração no schema (post_metrics hoje exige post_target_id, e post antigo não tem destino
// nosso). Antes de mexer no schema vale saber o tamanho do prêmio — e ele não dá pra deduzir da
// documentação, porque a disponibilidade de insights do Instagram depende de QUANDO a conta virou
// Business/Creator, o que é diferente em cada perfil.
//
// Roda dentro do Worker de propósito: é onde TOKEN_ENCRYPTION_KEY existe. Nenhum token sai daqui.
//
// Não guarda nada. Só olha e conta.
import { getAccountTokens } from '../lib/tokens.js';
import { fetchWithRetry } from '../lib/http.js';
import type { Env } from '../lib/env.js';
import type { Account } from '../lib/types.js';

const GRAPH = 'https://graph.facebook.com/v21.0';

/** Quantas páginas de mídia percorrer no máximo — teto pra sonda não virar varredura infinita. */
const MAX_PAGES = 12;
const PAGE_SIZE = 50;

interface Amostra {
  id: string;
  publicado_em: string | null;
  tipo: string | null;
  metricas?: Record<string, number>;
  conjunto_que_funcionou?: string;
  erro?: string;
}

// Escada de conjuntos de métrica, do mais rico ao mais básico.
//
// POR QUE ESCADA: o Instagram mudou o vocabulário de insights ao longo dos anos — `likes`,
// `comments` e `shares` como métrica só existem para mídia recente; antes disso havia `engagement`.
// E UM nome inválido derruba a chamada INTEIRA com "(#100) Invalid parameter", mesmo que as outras
// métricas do pedido estivessem disponíveis. Sem descer a escada, um post de 2019 que tem `reach`
// perfeitamente legível é contado como "a API recusa" — que foi a conclusão errada da versão
// anterior desta sonda.
const ESCADA_DE_METRICAS = [
  'reach,saved,likes,comments,shares',
  'reach,saved,engagement',
  'reach,saved',
  'reach',
];

export interface ResultadoSonda {
  comentarios?: {
    lidos: number;
    com_autor: number;
    exemplo_autor: string | null;
    erro: string | null;
    veredito: string;
  };
  posts_com_metrica: number;
  corte_em: string | null;
  conta: string;
  permissoes_concedidas: string[];
  falta_permissao_de_insights: boolean;
  total_de_posts_encontrados: number;
  paginas_lidas: number;
  chegou_ao_fim: boolean;
  mais_antigo: string | null;
  mais_novo: string | null;
  amostras: Amostra[];
  veredito: string;
}

/**
 * Os escopos que ESTE token carrega, via /debug_token.
 *
 * A lista que PEDIMOS no consentimento (oauth-urls.ts) não é a que o token TEM: escopo novo só
 * entra em token novo. Sem olhar isto, um erro de permissão se disfarça de "a rede não fornece esse
 * dado" — foi o que a primeira versão desta sonda concluiu, errado.
 *
 * E /debug_token em vez de /me/permissions porque o que guardamos aqui é token de PÁGINA, não de
 * usuário: em token de Página o /me resolve pra Página, que não tem lista de permissões, e a
 * resposta volta vazia. Vazio ali significa "endpoint errado", não "nenhuma permissão" — e foi
 * assim que a segunda versão desta sonda quase errou de novo. O /debug_token aceita qualquer token.
 */
async function permissoesConcedidas(token: string, env: Env): Promise<string[]> {
  const appToken = `${env.META_APP_ID}|${env.META_APP_SECRET}`;
  const res = await fetchWithRetry(
    `${GRAPH}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(appToken)}`
  );
  if (!res.ok) return [];
  const json = (await res.json()) as { data?: { scopes?: string[] } };
  return json.data?.scopes ?? [];
}

/**
 * Lista a mídia do perfil, paginando, e tenta ler insights de uma AMOSTRA espalhada no tempo
 * (mais novo, 25%, 50%, 75%, mais antigo). Amostra em vez de tudo porque o objetivo é achar o
 * ponto de corte, não coletar — e uma conta com mil posts geraria mil chamadas à toa.
 */
export async function probeInstagramHistory(account: Account, env: Env): Promise<ResultadoSonda> {
  const tokens = await getAccountTokens<{ access_token: string }>(env.DB, account.id, env.TOKEN_ENCRYPTION_KEY);
  if (!tokens?.access_token || !account.external_account_id) {
    throw new Error('conta do Instagram sem token ou sem id externo');
  }
  const token = tokens.access_token;

  const permissoes = await permissoesConcedidas(token, env);
  const faltaInsights = !permissoes.includes('instagram_manage_insights');

  const posts: Array<{ id: string; timestamp?: string; media_type?: string }> = [];
  let next: string | null =
    `${GRAPH}/${account.external_account_id}/media?fields=id,timestamp,media_type&limit=${PAGE_SIZE}` +
    `&access_token=${encodeURIComponent(token)}`;
  let paginas = 0;

  while (next && paginas < MAX_PAGES) {
    const res = await fetchWithRetry(next);
    if (!res.ok) throw new Error(`listagem de mídia: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as {
      data?: Array<{ id: string; timestamp?: string; media_type?: string }>;
      paging?: { next?: string };
    };
    posts.push(...(json.data ?? []));
    next = json.paging?.next ?? null;
    paginas++;
  }

  // A listagem vem do mais novo pro mais antigo — ou seja, se o post i tem métrica, todos os mais
  // novos que ele também têm. Isso torna o corte monotônico e permite achá-lo por busca binária,
  // em ~log2(n) chamadas em vez de uma por post.
  //
  // POR QUE existe um corte: insights do Instagram só valem para mídia publicada DEPOIS que o
  // perfil virou Business/Creator. Antes disso o dado nunca foi gerado — não é a API recusando,
  // é ausência de origem. Testei a hipótese alternativa (nomes de métrica obsoletos, via a escada
  // acima) e ela caiu: mesmo `metric=reach` sozinho falha nos antigos.
  let baixo = 0;
  let alto = posts.length - 1;
  let ultimoComMetrica = -1;
  while (baixo <= alto) {
    const meio = Math.floor((baixo + alto) / 2);
    if (await temMetrica(posts[meio].id, token)) {
      ultimoComMetrica = meio;
      baixo = meio + 1;
    } else {
      alto = meio - 1;
    }
  }
  const postsComMetrica = ultimoComMetrica + 1;
  const corteEm = ultimoComMetrica >= 0 ? (posts[ultimoComMetrica].timestamp ?? null) : null;

  const indices = amostrar(posts.length);
  const amostras: Amostra[] = [];

  for (const i of indices) {
    const post = posts[i];
    const amostra: Amostra = {
      id: post.id,
      publicado_em: post.timestamp ?? null,
      tipo: post.media_type ?? null,
    };
    for (const conjunto of ESCADA_DE_METRICAS) {
      try {
        const url =
          `${GRAPH}/${post.id}/insights?metric=${conjunto}&access_token=${encodeURIComponent(token)}`;
        const res = await fetchWithRetry(url);
        const json = (await res.json()) as {
          data?: Array<{ name: string; values?: Array<{ value: number }> }>;
          error?: { message?: string; code?: number };
        };
        if (!res.ok || json.error) {
          amostra.erro = `${json.error?.code ?? res.status}: ${json.error?.message ?? 'sem detalhe'}`;
          continue; // desce um degrau
        }
        const lidas = Object.fromEntries((json.data ?? []).map((m) => [m.name, m.values?.[0]?.value ?? 0]));
        if (Object.keys(lidas).length > 0) {
          amostra.metricas = lidas;
          amostra.conjunto_que_funcionou = conjunto;
          delete amostra.erro;
          break;
        }
      } catch (err) {
        amostra.erro = err instanceof Error ? err.message : String(err);
      }
    }
    amostras.push(amostra);
  }

  const comMetrica = amostras.filter((a) => a.metricas && Object.keys(a.metricas).length > 0);
  const maisAntigaComMetrica = comMetrica.at(-1)?.publicado_em ?? null;

  return {
    conta: account.display_name,
    comentarios: await sondarComentarios(posts.slice(0, 5).map((p) => p.id), token),
    posts_com_metrica: postsComMetrica,
    corte_em: corteEm,
    permissoes_concedidas: permissoes,
    falta_permissao_de_insights: faltaInsights,
    total_de_posts_encontrados: posts.length,
    paginas_lidas: paginas,
    chegou_ao_fim: !next,
    mais_antigo: posts.at(-1)?.timestamp ?? null,
    mais_novo: posts[0]?.timestamp ?? null,
    amostras,
    veredito:
      // A ordem importa: a falta de permissão explica QUALQUER erro nas amostras, e concluir
      // "a rede não fornece" sem checar isso antes foi o engano da primeira versão.
      faltaInsights
        ? 'o token desta conta NÃO tem instagram_manage_insights — reconecte pelo botão Conectar ' +
          'para conceder o escopo, e rode a sonda de novo. Nada dá pra concluir sobre histórico até lá.'
        : comMetrica.length === 0
        ? 'permissão existe, mas nenhuma amostra devolveu métrica — aí sim é limite da rede'
        : postsComMetrica === 0
        ? 'nenhum post tem métrica — o perfil provavelmente virou Business depois do último post'
        : `${postsComMetrica} dos ${posts.length} posts têm métrica, do mais novo até ${corteEm}. ` +
          'Os anteriores são de antes do perfil virar Business/Creator — o dado nunca existiu.',
  };
}

/** Este post tem insights? Só o `reach`, que é o denominador comum de todos os tipos de mídia. */
async function temMetrica(mediaId: string, token: string): Promise<boolean> {
  try {
    const res = await fetchWithRetry(
      `${GRAPH}/${mediaId}/insights?metric=reach&access_token=${encodeURIComponent(token)}`
    );
    if (!res.ok) return false;
    const json = (await res.json()) as { data?: unknown[]; error?: unknown };
    return !json.error && (json.data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * O `from.username` do comentário volta?
 *
 * A pergunta que decide se "quem conversa comigo" é construível. Desde ago/2024 o campo `username`
 * exige `instagram_manage_comments`, e a doc diz que contas com papel no Business Manager podem
 * precisar TAMBÉM de ads_read/ads_management — permissão difícil de justificar num agendador. Em
 * Development Mode dá pra descobrir isso antes de submeter, em vez de depois.
 */
async function sondarComentarios(
  mediaIds: string[],
  token: string
): Promise<ResultadoSonda['comentarios']> {
  let lidos = 0;
  let comAutor = 0;
  let exemplo: string | null = null;
  let erro: string | null = null;

  for (const id of mediaIds) {
    try {
      const res = await fetchWithRetry(
        `${GRAPH}/${id}/comments?fields=id,text,timestamp,from{id,username}&limit=25` +
          `&access_token=${encodeURIComponent(token)}`
      );
      const json = (await res.json()) as {
        data?: Array<{ from?: { username?: string } }>;
        error?: { message?: string; code?: number };
      };
      if (!res.ok || json.error) {
        erro = `${json.error?.code ?? res.status}: ${json.error?.message ?? 'sem detalhe'}`;
        continue;
      }
      for (const c of json.data ?? []) {
        lidos++;
        if (c.from?.username) {
          comAutor++;
          exemplo ??= c.from.username;
        }
      }
    } catch (err) {
      erro = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    lidos,
    com_autor: comAutor,
    exemplo_autor: exemplo,
    erro,
    veredito:
      lidos === 0
        ? erro
          ? `nenhum comentário lido — ${erro}`
          : 'nenhum comentário nos posts recentes (sem erro: a permissão pode estar OK)'
        : comAutor === 0
          ? 'comentários vêm, mas SEM autor — falta instagram_manage_comments (ou ads_read, se a Página for de Portfólio)'
          : `${comAutor} de ${lidos} comentários vieram com autor. "Quem conversa comigo" é construível.`,
  };
}

/** Índices espalhados no tempo: mais novo, 25%, 50%, 75% e mais antigo. */
function amostrar(total: number): number[] {
  if (total === 0) return [];
  const brutos = [0, Math.floor(total * 0.25), Math.floor(total * 0.5), Math.floor(total * 0.75), total - 1];
  return [...new Set(brutos)].filter((i) => i >= 0 && i < total);
}


// ---------------------------------------------------------------------------
// YouTube
//
// Aqui NÃO existe o portão que trava o Instagram: `statistics` acompanha todo vídeo desde sempre,
// sem depender de conversão de perfil. A expectativa é 100% dos vídeos — e é justamente por isso
// que vale medir antes de decidir a migração: se o Instagram rende 14 e o YouTube rende tudo, o
// trabalho se paga pelo segundo, não pelo primeiro.
// ---------------------------------------------------------------------------

const YT = 'https://www.googleapis.com/youtube/v3';

export async function probeYoutubeHistory(account: Account, env: Env): Promise<ResultadoSonda> {
  const tokens = await getAccountTokens<{ access_token: string }>(env.DB, account.id, env.TOKEN_ENCRYPTION_KEY);
  if (!tokens?.access_token) throw new Error('conta do YouTube sem token');
  const auth = { Authorization: `Bearer ${tokens.access_token}` };

  // O canal guarda o id da playlist "uploads", que é por onde se lista tudo que já foi publicado.
  const canalRes = await fetchWithRetry(`${YT}/channels?part=contentDetails&mine=true`, { headers: auth });
  if (!canalRes.ok) throw new Error(`canal: ${canalRes.status} ${await canalRes.text()}`);
  const canal = (await canalRes.json()) as {
    items?: Array<{ contentDetails?: { relatedPlaylists?: { uploads?: string } } }>;
  };
  const uploads = canal.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) throw new Error('canal sem playlist de uploads');

  const videos: Array<{ id: string; publicado?: string }> = [];
  let pageToken: string | undefined;
  let paginas = 0;
  do {
    const url =
      `${YT}/playlistItems?part=contentDetails&maxResults=50&playlistId=${uploads}` +
      (pageToken ? `&pageToken=${pageToken}` : '');
    const res = await fetchWithRetry(url, { headers: auth });
    if (!res.ok) throw new Error(`uploads: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as {
      items?: Array<{ contentDetails?: { videoId?: string; videoPublishedAt?: string } }>;
      nextPageToken?: string;
    };
    for (const item of json.items ?? []) {
      if (item.contentDetails?.videoId) {
        videos.push({ id: item.contentDetails.videoId, publicado: item.contentDetails.videoPublishedAt });
      }
    }
    pageToken = json.nextPageToken;
    paginas++;
  } while (pageToken && paginas < MAX_PAGES);

  // Uma chamada cobre 50 vídeos, então amostrar não economizaria nada relevante — e conferir TODOS
  // dá a contagem exata em vez de estimativa.
  let comEstatistica = 0;
  const amostras: Amostra[] = [];
  for (let i = 0; i < videos.length; i += 50) {
    const lote = videos.slice(i, i + 50);
    const res = await fetchWithRetry(`${YT}/videos?part=statistics&id=${lote.map((v) => v.id).join(',')}`, {
      headers: auth,
    });
    if (!res.ok) continue;
    const json = (await res.json()) as {
      items?: Array<{ id: string; statistics?: Record<string, string> }>;
    };
    for (const item of json.items ?? []) {
      if (!item.statistics) continue;
      comEstatistica++;
      if (amostras.length < 3) {
        amostras.push({
          id: item.id,
          publicado_em: videos.find((v) => v.id === item.id)?.publicado ?? null,
          tipo: 'VIDEO',
          conjunto_que_funcionou: 'statistics',
          metricas: Object.fromEntries(
            Object.entries(item.statistics).map(([k, v]) => [k, Number(v) || 0])
          ),
        });
      }
    }
  }

  return {
    conta: account.display_name,
    posts_com_metrica: comEstatistica,
    corte_em: comEstatistica === videos.length ? null : 'parcial',
    permissoes_concedidas: ['(o YouTube não expõe lista de escopos)'],
    falta_permissao_de_insights: false,
    total_de_posts_encontrados: videos.length,
    paginas_lidas: paginas,
    chegou_ao_fim: !pageToken,
    mais_antigo: videos.at(-1)?.publicado ?? null,
    mais_novo: videos[0]?.publicado ?? null,
    amostras,
    veredito:
      videos.length === 0
        ? 'nenhum vídeo no canal'
        : comEstatistica === videos.length
          ? `TODOS os ${videos.length} vídeos têm estatística — o histórico inteiro do YouTube é recuperável`
          : `${comEstatistica} dos ${videos.length} vídeos têm estatística`,
  };
}
