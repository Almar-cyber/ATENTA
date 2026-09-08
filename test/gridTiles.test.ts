import { describe, expect, it } from 'vitest';
import { buildTiles } from '../web/src/lib/gridTiles.js';
import type { Post, PostStatus, Target } from '../web/src/lib/types.js';
import type { FeedItem } from '../web/src/lib/api.js';

// Quem entra na grade 3-colunas do Instagram — e, principalmente, quem NÃO entra.
//
// Este arquivo nasceu de um defeito relatado: um Story publicado apareceu no meio do feed
// planejado. Ele não estoura nada, e é aí que dói: a grade existe pra mostrar como o perfil vai
// ficar, então uma peça a mais só desloca todas as outras pra posições que o perfil não vai ter, e
// a pessoa planeja a estética contra um feed que não existe.

function target(over: Partial<Target> = {}): Target {
  return {
    id: 't1',
    platform: 'instagram',
    account_id: 'a1',
    account_name: '@conta',
    status: 'queued' as PostStatus,
    caption_override: null,
    options: {},
    external_url: null,
    external_post_id: null,
    attempt_count: 0,
    last_error: null,
    published_at: null,
    updated_at: '2026-09-01T10:00:00Z',
    media: [],
    ...over,
  };
}

function post(id: string, at: string, targets: Target[]): Post {
  return { id, title: null, body: null, scheduled_for: at, created_at: at, tag: null, targets } as Post;
}

const semFeed: FeedItem[] = [];

describe('buildTiles — o Story nunca ocupa quadrado na grade', () => {
  it('deixa o Story publicado de fora', () => {
    const tiles = buildTiles(
      [
        post('p1', '2026-09-01T10:00:00Z', [
          target({ id: 't1', status: 'published', published_at: '2026-09-01T10:00:00Z', options: { format: 'story' } }),
        ]),
      ],
      semFeed,
      []
    );
    expect(tiles).toHaveLength(0);
  });

  it('deixa o Story agendado de fora — senão ele entra na permutação de horários do arrastar', () => {
    const tiles = buildTiles(
      [post('p1', '2026-09-10T10:00:00Z', [target({ options: { format: 'story' } })])],
      semFeed,
      []
    );
    expect(tiles).toHaveLength(0);
  });

  it('reconhece o Story dos posts anteriores ao seletor de formato (`as_story`)', () => {
    const tiles = buildTiles(
      [post('p1', '2026-09-10T10:00:00Z', [target({ options: { as_story: true } })])],
      semFeed,
      []
    );
    expect(tiles).toHaveLength(0);
  });

  it('mas Post e Reel entram — os dois aparecem no perfil', () => {
    const tiles = buildTiles(
      [
        post('p1', '2026-09-10T10:00:00Z', [target({ id: 't1', options: { format: 'post' } })]),
        post('p2', '2026-09-11T10:00:00Z', [target({ id: 't2', options: { format: 'reel' } })]),
        // Sem `format` nenhum: post antigo de feed, que sempre apareceu e tem que continuar aparecendo.
        post('p3', '2026-09-12T10:00:00Z', [target({ id: 't3' })]),
      ],
      semFeed,
      []
    );
    expect(tiles.map((t) => t.domainId)).toEqual(['p3', 'p2', 'p1']);
  });

  it('um post com Story E feed na mesma peça mantém só o destino que vai pro perfil', () => {
    // Acontece de verdade: a mesma arte sai como Reel e como Story, em contas diferentes.
    const tiles = buildTiles(
      [
        post('p1', '2026-09-10T10:00:00Z', [
          target({ id: 't-story', account_id: 'a1', options: { format: 'story' } }),
          target({ id: 't-reel', account_id: 'a2', options: { format: 'reel' } }),
        ]),
      ],
      semFeed,
      []
    );
    expect(tiles).toHaveLength(1);
    expect(tiles[0].kind === 'post' && tiles[0].target.id).toBe('t-reel');
  });
});

describe('buildTiles — o resto das regras que já valiam', () => {
  it('ignora outras redes, cancelado e falhou', () => {
    const tiles = buildTiles(
      [
        post('p1', '2026-09-10T10:00:00Z', [target({ id: 't1', platform: 'youtube' })]),
        post('p2', '2026-09-11T10:00:00Z', [target({ id: 't2', status: 'canceled' })]),
        post('p3', '2026-09-12T10:00:00Z', [target({ id: 't3', status: 'failed' })]),
      ],
      semFeed,
      []
    );
    expect(tiles).toHaveLength(0);
  });

  it('publicado é âncora (não arrasta); agendado se move', () => {
    const tiles = buildTiles(
      [
        post('p1', '2026-09-01T10:00:00Z', [
          target({ id: 't1', status: 'published', published_at: '2026-09-01T10:00:00Z' }),
        ]),
        post('p2', '2026-09-20T10:00:00Z', [target({ id: 't2' })]),
      ],
      semFeed,
      []
    );
    expect(tiles.map((t) => [t.domainId, t.movable])).toEqual([
      ['p2', true],
      ['p1', false],
    ]);
  });

  it('o que já publicamos não volta duplicado pelo feed da API', () => {
    const feed: FeedItem[] = [
      { id: 'ig-1', thumbnail_url: 'https://cdn/1.jpg', permalink: null, published_at: '2026-09-01T10:00:00Z', caption: null },
      { id: 'ig-2', thumbnail_url: 'https://cdn/2.jpg', permalink: null, published_at: '2026-08-01T10:00:00Z', caption: null },
    ];
    const tiles = buildTiles(
      [
        post('p1', '2026-09-01T10:00:00Z', [
          target({ id: 't1', status: 'published', published_at: '2026-09-01T10:00:00Z', external_post_id: 'ig-1' }),
        ]),
      ],
      feed,
      []
    );
    expect(tiles.map((t) => t.domainId)).toEqual(['p1', 'ig-2']);
    // A capa do feed é aproveitada no NOSSO registro, pro post velho não virar quadrado cinza
    // depois que o purge de 30 dias apaga a nossa cópia do arquivo.
    expect(tiles[0].kind === 'post' && tiles[0].feedThumb).toBe('https://cdn/1.jpg');
  });

  it('ideia só de texto fica fora da grade; com arte, entra', () => {
    const base = { id: '', instagram_position: 0, sort_at: '2026-09-15T10:00:00Z', text: 'oi', media_asset_id: null } as never;
    const tiles = buildTiles([], semFeed, [
      { ...(base as object), id: 'g1', media_asset_id: null } as never,
      { ...(base as object), id: 'g2', media_asset_id: 'md-1' } as never,
    ]);
    expect(tiles.map((t) => t.domainId)).toEqual(['g2']);
  });
});

describe('buildTiles — Reel de teste só entra quando o perfil confirma', () => {
  // O Reel de teste sai só pra quem NÃO segue a conta e não aparece no perfil; quando gradua,
  // passa a aparecer. Nosso registro não sabe em qual dos dois estados ele está — a graduação
  // acontece dentro do app (MANUAL) ou sozinha (SS_PERFORMANCE), sem nos avisar. Quem sabe é o
  // feed real do perfil, que a grade já busca.
  const trial = { format: 'reel', trial_graduation: 'MANUAL' };

  function feedItem(id: string, at: string): FeedItem {
    return { id, thumbnail_url: `https://cdn/${id}.jpg`, permalink: null, published_at: at, caption: null };
  }

  it('agendado, ainda não publicado: fora — não está no perfil e não vai estar ao publicar', () => {
    const tiles = buildTiles(
      [post('p1', '2026-09-20T10:00:00Z', [target({ options: trial })])],
      [feedItem('ig-velho', '2026-09-01T10:00:00Z')],
      []
    );
    expect(tiles.map((t) => t.domainId)).toEqual(['ig-velho']);
  });

  it('publicado e ausente do feed, dentro da janela: fora — ainda está em teste', () => {
    const tiles = buildTiles(
      [
        post('p1', '2026-09-10T10:00:00Z', [
          target({ status: 'published', published_at: '2026-09-10T10:00:00Z', external_post_id: 'ig-1', options: trial }),
        ]),
      ],
      [feedItem('ig-outro', '2026-09-01T10:00:00Z')],
      []
    );
    expect(tiles.map((t) => t.domainId)).toEqual(['ig-outro']);
  });

  it('publicado e presente no feed: entra, uma vez só — graduou', () => {
    const tiles = buildTiles(
      [
        post('p1', '2026-09-10T10:00:00Z', [
          target({ status: 'published', published_at: '2026-09-10T10:00:00Z', external_post_id: 'ig-1', options: trial }),
        ]),
      ],
      [feedItem('ig-1', '2026-09-10T10:00:00Z')],
      []
    );
    // O nosso registro, não o item do feed: é ele que é clicável e sabe a data.
    expect(tiles).toHaveLength(1);
    expect(tiles[0].kind).toBe('post');
    expect(tiles[0].kind === 'post' && tiles[0].feedThumb).toBe('https://cdn/ig-1.jpg');
  });

  it('publicado ANTES da janela que o feed devolveu: entra — a ausência ali não prova nada', () => {
    // A resposta do feed é paginada. Esconder um post que existe é o erro pior: seria o defeito do
    // Story com o sinal trocado.
    const tiles = buildTiles(
      [
        post('p1', '2026-01-05T10:00:00Z', [
          target({ status: 'published', published_at: '2026-01-05T10:00:00Z', external_post_id: 'ig-1', options: trial }),
        ]),
      ],
      [feedItem('ig-novo', '2026-09-01T10:00:00Z')],
      []
    );
    expect(tiles.map((t) => t.domainId)).toEqual(['ig-novo', 'p1']);
  });

  it('feed vazio (conta caiu, sem permissão): o publicado entra — não dá pra afirmar que está em teste', () => {
    const tiles = buildTiles(
      [
        post('p1', '2026-09-10T10:00:00Z', [
          target({ status: 'published', published_at: '2026-09-10T10:00:00Z', external_post_id: 'ig-1', options: trial }),
        ]),
      ],
      semFeed,
      []
    );
    expect(tiles.map((t) => t.domainId)).toEqual(['p1']);
  });

  it('Reel COMUM segue entrando sem depender do feed', () => {
    const tiles = buildTiles(
      [post('p1', '2026-09-20T10:00:00Z', [target({ options: { format: 'reel' } })])],
      semFeed,
      []
    );
    expect(tiles.map((t) => t.domainId)).toEqual(['p1']);
  });
});
