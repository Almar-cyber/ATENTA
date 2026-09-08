// Imports RELATIVOS, não pelo alias `@/`: este módulo é coberto por teste, e o vitest da raiz roda
// no pool de Workers sem os aliases do Vite do `web/`. Os dois primeiros são `import type` e somem
// na compilação; o de `platforms` é valor, e por isso a cadeia dele também precisa ser relativa.
import type { GridPreview, Post, Target } from './types';
import type { FeedItem } from './api';
import { igFormatOf, igTrialOf } from './platforms';

// A montagem da grade do Instagram: quais peças entram, em que ordem, e quais podem se mover.
//
// Fica fora do componente pelo mesmo motivo de `gridOrder.ts`: é a parte que erra em SILÊNCIO.
// Nada estoura quando uma peça entra na grade sem dever — ela só ocupa um quadrado que o perfil
// não vai ter, e a pessoa planeja a estética contra um feed que não existe. Foi assim que um Story
// publicado passou a aparecer no meio do feed.

// Most recent published posts to anchor the grid against — enough to fill several rows of
// context without letting the grid grow unbounded over the account's lifetime.
const MAX_PUBLISHED_ENTRIES = 18;

// As três espécies de peça da grade. Só `post` (não publicado) e `preview` se movem; publicado —
// nosso registro ou o que veio do feed real — é âncora.
export type Tile =
  | {
      kind: 'post';
      key: string;
      domainId: string;
      at: string;
      movable: boolean;
      post: Post;
      target: Target;
      /**
       * Capa vinda do feed do Instagram, pra quando a NOSSA cópia do arquivo já não existe.
       *
       * O poller apaga mídia publicada depois de 30 dias (MEDIA_RETENTION_DAYS), então todo post
       * com mais de um mês tem `public_url` apontando pra um objeto que não está mais no R2 — e a
       * grade, cuja única função é mostrar como o feed fica, virava um tabuleiro de quadrados
       * cinzas. O feed sempre teve essa imagem; ela só estava sendo jogada fora na deduplicação
       * logo abaixo, que fica com o nosso registro (clicável, sabe a data) e descarta o item do
       * feed inteiro em vez de aproveitar a capa dele.
       */
      feedThumb?: string | null;
    }
  | { kind: 'feed'; key: string; domainId: string; at: string; movable: false; item: FeedItem }
  | { kind: 'preview'; key: string; domainId: string; at: string; movable: true; preview: GridPreview };

// Published entries anchor on when they actually went out; everything still in play anchors on
// its (re)schedulable slot.
function postTimestamp(post: Post, target: Target): string {
  return target.status === 'published' ? target.published_at ?? post.scheduled_for : post.scheduled_for;
}

// Monta a grade inteira numa lista só, ordenada pelo mesmo eixo de tempo: agendados (futuro) no
// topo, publicados e ideias no meio do caminho conforme a posição de cada um — que é como o
// perfil vai realmente ficar, mais novo no canto superior esquerdo.
export function buildTiles(posts: Post[], feed: FeedItem[], previews: GridPreview[]): Tile[] {
  const upcoming: Tile[] = [];
  const published: Tile[] = [];
  const publishedExternalIds = new Set<string>();

  // Capa por id externo. Montado ANTES do laço porque é o laço que decide descartar o item do feed
  // — e é justamente a imagem dele que falta no nosso registro depois do purge de 30 dias.
  const capaDoFeed = new Map<string, string>();
  for (const item of feed) if (item.thumbnail_url) capaDoFeed.set(item.id, item.thumbnail_url);

  // A JANELA DO FEED: até onde a resposta da API enxerga (ela vem paginada, hoje 24 itens). Serve
  // pro Reel de teste logo abaixo — dentro da janela, ausência é informação; fora dela, não é.
  let maisAntigoDoFeed: string | undefined;
  for (const item of feed) {
    if (item.published_at && (maisAntigoDoFeed === undefined || item.published_at < maisAntigoDoFeed)) {
      maisAntigoDoFeed = item.published_at;
    }
  }
  const idsDoFeed = new Set(feed.map((item) => item.id));

  for (const post of posts) {
    for (const target of post.targets) {
      if (target.platform !== 'instagram') continue;
      if (target.status === 'canceled' || target.status === 'failed') continue;
      // STORY NÃO ENTRA NA GRADE. Ele nunca aparece no perfil — some em 24h e vive noutra
      // superfície do app do Instagram. Ficava aqui só porque este laço filtrava por rede e por
      // status, nunca por formato: um Story publicado virava âncora imóvel no meio do feed
      // planejado, empurrando as peças de verdade pra posições que o perfil não vai ter. Um Story
      // agendado é pior ainda — entra na permutação de horários do arrastar e leva junto um
      // `scheduled_for` que não tem nada a ver com a ordem do feed.
      if (igFormatOf(target.options) === 'story') continue;
      const at = postTimestamp(post, target);
      // REEL DE TESTE. Enquanto está em teste ele sai só pra quem não segue a conta e NÃO aparece
      // no perfil; quando gradua, passa a aparecer. Nosso registro não sabe dizer em qual dos dois
      // estados ele está — a graduação acontece dentro do app do Instagram (MANUAL) ou sozinha
      // (SS_PERFORMANCE), sem nos avisar. Quem sabe é o FEED REAL do perfil, que já buscamos.
      //
      // Daí a regra em três passos, e a ordem importa:
      //  1. não publicado  → não está no perfil, ponto.
      //  2. no feed        → graduou. Entra, com a mesma dedup dos outros publicados.
      //  3. fora do feed   → só significa "ainda em teste" se ele CABIA na janela que a API nos
      //     devolveu. Mais antigo que o item mais velho do feed, a ausência não diz nada — e aí a
      //     grade MOSTRA. Esconder um post que existe é o erro pior: é exatamente o defeito do
      //     Story, com o sinal trocado.
      if (igTrialOf(target.options)) {
        if (target.status !== 'published') continue;
        const noFeed = !!target.external_post_id && idsDoFeed.has(target.external_post_id);
        const cabiaNaJanela = maisAntigoDoFeed !== undefined && at >= maisAntigoDoFeed;
        if (!noFeed && cabiaNaJanela) continue;
      }
      const isPublished = target.status === 'published';
      if (isPublished && target.external_post_id) publishedExternalIds.add(target.external_post_id);
      const tile: Tile = {
        kind: 'post',
        key: `post:${post.id}`,
        domainId: post.id,
        at,
        movable: !isPublished,
        post,
        target,
        feedThumb: target.external_post_id ? capaDoFeed.get(target.external_post_id) ?? null : null,
      };
      (isPublished ? published : upcoming).push(tile);
    }
  }
  published.sort((a, b) => (a.at < b.at ? 1 : -1));

  const feedTiles: Tile[] = feed
    // O que publicamos daqui volta no feed da API também — fica com o nosso registro, que é
    // clicável e sabe a data agendada, em vez de aparecer duas vezes na grade.
    .filter((item) => !publishedExternalIds.has(item.id))
    .map((item) => ({
      kind: 'feed' as const,
      key: `feed:${item.id}`,
      domainId: item.id,
      at: item.published_at ?? '',
      movable: false as const,
      item,
    }));

  // Só ideia COM ARTE entra na grade. A grade existe pra mostrar como o feed vai ficar, e uma ideia
  // ainda em palavras não tem nada a dizer sobre isso — viraria um quadrado cinza atrapalhando
  // justamente a leitura que a tela serve pra dar. Ela vive na lista ao lado até ganhar imagem.
  const previewTiles: Tile[] = previews
    .filter((preview) => !!preview.media_asset_id)
    .map((preview) => ({
      kind: 'preview' as const,
      key: `preview:${preview.id}`,
      domainId: preview.id,
      at: preview.sort_at,
      movable: true as const,
      preview,
    }));

  const all = upcoming.concat(published.slice(0, MAX_PUBLISHED_ENTRIES), feedTiles, previewTiles);
  all.sort((a, b) => (a.at < b.at ? 1 : -1));
  return all;
}
