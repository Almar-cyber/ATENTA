import type { MediaAsset, PlatformAdapter } from '../lib/types.js';
import { apiError, classifyByKnownCodes } from '../lib/errors.js';
import { fetchWithRetry } from '../lib/http.js';
import { getAccountTokens } from '../lib/tokens.js';
import { checkDuration } from '../lib/videoLimits.js';

const GRAPH_VERSION = 'v21.0';

interface MetaTokens {
  access_token: string; // same Page access token as facebook.ts, stored on this platform's own account row
}

interface AdapterState {
  creation_id?: string;
  [key: string]: unknown;
}

// Carousels: 2-10 items, images and videos may be mixed
// (developers.facebook.com/docs/instagram-platform/content-publishing).
const CAROUSEL_MAX_ITEMS = 10;

const MIN_VIDEO_DURATION_SECONDS = 3;
// Reel e vídeo de feed compartilham o mesmo teto documentado (15min); o Story é bem menor.
const MAX_VIDEO_DURATION_SECONDS = 900;
const MAX_STORY_DURATION_SECONDS = 60;

// Feed/carousel photo aspect-ratio range Meta documents for Content Publishing
// (developers.facebook.com/docs/instagram-platform/content-publishing). Not applied to video:
// every non-Story video this adapter publishes goes out as a Reel (see publish() below), which
// is expected to be vertical — checking it against the feed range would reject normal Reels.
// Not applied to Stories either — no equally solid documented hard range found for those.
const MIN_FEED_ASPECT_RATIO = 4 / 5;
const MAX_FEED_ASPECT_RATIO = 1.91;

// Phase 2. Same non-expiring-in-practice Page token story as facebook.ts — see that file's
// comment. Publish is genuinely asynchronous here (unlike the other five adapters): create a
// media container, then poll it via checkStatus() until Meta finishes processing before calling
// media_publish. image_url/video_url must be publicly fetchable (Meta pulls the bytes itself),
// which is why this is the one adapter that actually needs the R2 custom domain.
// O formato é escolhido no compositor e gravado em `options.format`. Posts criados antes do
// seletor existir não têm esse campo — aí vale o `as_story` antigo e, na falta dele, a regra que
// valia então: vídeo virava Reel, imagem virava post de feed.
type IgFormat = 'post' | 'reel' | 'story';

function igFormat(rawOptions: unknown, media: MediaAsset[]): IgFormat {
  const options = (rawOptions ?? {}) as { format?: string; as_story?: boolean };
  if (options.format === 'post' || options.format === 'reel' || options.format === 'story') return options.format;
  if (options.as_story) return 'story';
  return media.some((m) => m.mime_type.startsWith('video/')) ? 'reel' : 'post';
}

/**
 * Reel de TESTE: sai só pra quem NÃO segue a conta, pra medir o desempenho antes de mostrar aos
 * seguidores. Depois ele "gradua" — passa a valer como Reel normal, entra no feed de quem segue e
 * aparece no perfil.
 *
 * Na API é o mesmo container de Reel (`media_type=REELS`) com um `trial_params` a mais; não é um
 * media_type próprio, e é por isso que aqui é uma OPÇÃO do Reel e não um quarto formato.
 *
 * `graduation_strategy` é o único campo de `trial_params` e a Meta o exige quando ele vem:
 *   MANUAL         — fica em teste até você graduar dentro do app.
 *   SS_PERFORMANCE — a Meta gradua sozinha se o desempenho com não-seguidores justificar.
 *
 * Ausente = Reel comum. Valor fora dos dois é recusado no validate() — mandar um terceiro valor
 * faria a Meta recusar o container depois de já ter subido o vídeo.
 */
export type IgTrialGraduation = 'MANUAL' | 'SS_PERFORMANCE';

const TRIAL_GRADUATIONS: IgTrialGraduation[] = ['MANUAL', 'SS_PERFORMANCE'];

export function igTrialGraduation(rawOptions: unknown): string | undefined {
  const value = (rawOptions as { trial_graduation?: unknown } | null | undefined)?.trial_graduation;
  return typeof value === 'string' && value !== '' ? value : undefined;
}

export const instagramAdapter: PlatformAdapter = {
  platform: 'instagram',

  needsRefresh() {
    return false;
  },

  async ensureFreshToken() {
    throw new Error('instagram: no refresh mechanism implemented — run meta-auth-url again if needs_reauth');
  },

  validate(target, media, _account) {
    if (media.length === 0) throw new Error('instagram: at least one image or video is required');
    if (media.length > CAROUSEL_MAX_ITEMS) {
      throw new Error(`instagram: carousel supports at most ${CAROUSEL_MAX_ITEMS} items (got ${media.length})`);
    }
    const format = igFormat(target.options, media);
    const hasVideo = media.some((m) => m.mime_type.startsWith('video/'));

    if (format === 'story' && media.length > 1) {
      throw new Error('instagram: um Story leva exatamente uma imagem ou vídeo (a API não publica Story em carrossel)');
    }
    if (format === 'reel') {
      if (media.length > 1) throw new Error('instagram: um Reel leva um vídeo só — para vários arquivos, use o formato Post');
      if (!hasVideo) throw new Error('instagram: Reel precisa de um vídeo — para publicar imagem, use o formato Post');
    }

    // Reel de teste. Recusado aqui, na criação, e não lá na publicação: a Meta só reclamaria
    // depois de o vídeo inteiro ter subido, e a mensagem dela não diria qual campo está errado.
    const trial = igTrialGraduation(target.options);
    if (trial) {
      if (format !== 'reel') {
        throw new Error('instagram: só Reel pode sair como teste — Post e Story vão direto pra todo mundo');
      }
      if (!TRIAL_GRADUATIONS.includes(trial as IgTrialGraduation)) {
        throw new Error(`instagram: graduação do Reel de teste inválida ("${trial}") — use MANUAL ou SS_PERFORMANCE`);
      }
    }
    if (format === 'post' && hasVideo && media.length > 1) {
      throw new Error('instagram: carrossel só aceita imagens — o vídeo tem que ir sozinho');
    }

    for (const asset of media) {
      if (!asset.public_url) {
        throw new Error('instagram: media needs a public_url (custom R2 domain) — see README Pendências');
      }
      if (asset.mime_type.startsWith('video/')) {
        checkDuration(
          'instagram',
          asset,
          MIN_VIDEO_DURATION_SECONDS,
          format === 'story' ? MAX_STORY_DURATION_SECONDS : MAX_VIDEO_DURATION_SECONDS
        );
      } else if (format === 'post' && asset.width != null && asset.height != null) {
        const ratio = asset.width / asset.height;
        if (ratio < MIN_FEED_ASPECT_RATIO || ratio > MAX_FEED_ASPECT_RATIO) {
          throw new Error(`instagram: proporção da imagem fora do permitido (${asset.width}x${asset.height}) — use entre 4:5 e 1.91:1`);
        }
      }
    }
  },

  async publish(target, media, account, env) {
    const tokens = await getAccountTokens<MetaTokens>(env.DB, account.id, env.TOKEN_ENCRYPTION_KEY);
    if (!tokens?.access_token) throw new Error('instagram: missing access_token');
    if (!account.external_account_id) throw new Error('instagram: missing ig user id (external_account_id)');

    const igUserId = account.external_account_id;
    const caption = target.caption_override ?? '';
    const format = igFormat(target.options, media);

    let containerId: string;
    if (media.length > 1) {
      // Carousel: one unpublished item container per asset, then a parent CAROUSEL container
      // listing them in `children`. Meta's docs show this sequence without polling the items in
      // between, so we don't either — if a video item isn't processed yet the parent create fails,
      // which classifies as retryable and the whole publish() runs again next cron tick (the
      // abandoned item containers expire on Meta's side on their own).
      const childIds: string[] = [];
      for (const asset of media) {
        const itemBody = new URLSearchParams({ access_token: tokens.access_token, is_carousel_item: 'true' });
        setMediaUrl(itemBody, asset);
        childIds.push(await createContainer(igUserId, itemBody));
      }

      containerId = await createContainer(
        igUserId,
        new URLSearchParams({
          access_token: tokens.access_token,
          caption,
          media_type: 'CAROUSEL',
          children: childIds.join(','),
        })
      );
    } else {
      const asset = media[0];
      const body = new URLSearchParams({ access_token: tokens.access_token, caption });

      // Same container+publish flow for feed posts, Reels, and Stories — only media_type differs.
      // Meta doesn't support interactive Story elements (stickers, links, music) via the API
      // regardless — this only ever posts the base image/video.
      const cover = target.options as { cover_media_id?: string; cover_timestamp_ms?: number };
      if (format === 'story') {
        body.set('media_type', 'STORIES');
      } else if (format === 'reel') {
        body.set('media_type', 'REELS');
        // Capa do Reel: a Meta aceita uma imagem hospedada (cover_url) OU um frame do vídeo
        // (thumb_offset, em ms). cover_url tem prioridade quando as duas vierem preenchidas.
        if (cover.cover_media_id) {
          const row = await env.DB.prepare(`select public_url from media_assets where id = ?`)
            .bind(cover.cover_media_id)
            .first<{ public_url: string | null }>();
          if (row?.public_url) body.set('cover_url', row.public_url);
        } else if (cover.cover_timestamp_ms != null) {
          body.set('thumb_offset', String(cover.cover_timestamp_ms));
        }
        // `trial_params` é um OBJETO num corpo form-encoded — a Graph API lê esses como JSON em
        // string, que é a convenção dela pra parâmetro aninhado. O validate() já garantiu que o
        // valor é um dos dois que a Meta aceita.
        const trial = igTrialGraduation(target.options);
        if (trial) body.set('trial_params', JSON.stringify({ graduation_strategy: trial }));
      } else if (asset.mime_type.startsWith('video/')) {
        // Vídeo no feed (formato Post) é `VIDEO`, não `REELS` — vira um post normal do feed em vez
        // de entrar na aba de Reels. `cover_url` é exclusivo de Reels aqui; capa, se houver, só via
        // frame do próprio vídeo.
        body.set('media_type', 'VIDEO');
        if (cover.cover_timestamp_ms != null) body.set('thumb_offset', String(cover.cover_timestamp_ms));
      }
      setMediaUrl(body, asset);
      containerId = await createContainer(igUserId, body);
    }

    return { state: 'processing', adapterState: { creation_id: containerId } satisfies AdapterState };
  },

  async checkStatus(target, account, env) {
    const tokens = await getAccountTokens<MetaTokens>(env.DB, account.id, env.TOKEN_ENCRYPTION_KEY);
    if (!tokens?.access_token) throw new Error('instagram: missing access_token');

    const state = target.adapter_state as AdapterState;
    if (!state.creation_id) throw new Error('instagram: missing creation_id in adapter_state');

    const statusRes = await fetchWithRetry(
      `https://graph.facebook.com/${GRAPH_VERSION}/${state.creation_id}?fields=status_code&access_token=${encodeURIComponent(tokens.access_token)}`
    );
    if (!statusRes.ok) throw await apiError('instagram: container status check failed', statusRes);
    const statusJson = (await statusRes.json()) as { status_code: string };

    if (statusJson.status_code === 'IN_PROGRESS') {
      return { state: 'processing', adapterState: state };
    }
    if (statusJson.status_code === 'ERROR' || statusJson.status_code === 'EXPIRED') {
      throw new Error(`instagram: container ${state.creation_id} ended in ${statusJson.status_code}`);
    }
    // FINISHED (or PUBLISHED, if Meta ever returns that directly)
    const publishRes = await fetchWithRetry(`https://graph.facebook.com/${GRAPH_VERSION}/${account.external_account_id}/media_publish`, {
      method: 'POST',
      body: new URLSearchParams({ access_token: tokens.access_token, creation_id: state.creation_id }),
    });
    if (!publishRes.ok) throw await apiError('instagram: media_publish failed', publishRes);
    const publishJson = (await publishRes.json()) as { id: string };

    return {
      state: 'published',
      externalId: publishJson.id,
      externalUrl: await permalinkDe(publishJson.id, tokens.access_token),
    };
  },

  /**
   * Os erros deste adapter carregam o STATUS HTTP (viram `ApiError`, via `apiError()`), e é isso
   * que faz a classificação abaixo funcionar de verdade.
   *
   * Antes eram `Error` com só um `code` colado. Sem status, o que não casava na tabela caía no
   * 'retryable' padrão e ia pra cinco tentativas de 15 em 15 minutos — uma hora esperando por uma
   * recusa que nunca ia mudar de resposta (proporção inválida, conta sem o recurso, parâmetro
   * errado). O comentário de `classifyByStatus` já dizia isto: "um 400 tentado 5 vezes são 5
   * falhas garantidas".
   *
   * A TABELA CONTINUA VINDO PRIMEIRO, e é ela que protege o caso perigoso: a Meta responde os
   * erros de limite de requisição (códigos 4, 17, 32, 613) como `OAuthException`, então eles nem
   * chegam à regra por status — continuam classificados exatamente como antes. O que passou a
   * falhar de primeira é o resto do 4xx (`IGApiException`, `GraphMethodException` e afins), que é
   * recusa de conteúdo, não de momento. 5xx segue retryable.
   *
   * Se aparecer na prática um 4xx transitório, o conserto é acrescentar o `type` dele a esta
   * tabela — não devolver tudo pro 'retryable'.
   */
  classifyError(err) {
    return classifyByKnownCodes(err, { OAuthException: 'auth', '190': 'auth' });
  },
};

/**
 * O endereço público do post recém-publicado.
 *
 * O Instagram era a única rede que publicava sem guardar `external_url` (Facebook, Pinterest e
 * YouTube montam a URL a partir do id; aqui não dá — o link do Instagram usa um shortcode que a
 * API não deriva do id). Resultado: o botão "ver no Instagram" no detalhe do post nunca aparecia
 * pra IG, e não havia caminho do app pro post.
 *
 * NUNCA LANÇA, e isso é o ponto: quando chega aqui o post JÁ SAIU. Deixar um erro subir faria o
 * poller tratar a publicação como falha e tentar de novo — publicando duas vezes, que é o pior
 * desfecho possível do projeto (design.md §7, princípio 6). Sem permalink o post fica exatamente
 * como ficava antes: publicado, sem link.
 */
async function permalinkDe(mediaId: string, accessToken: string): Promise<string | undefined> {
  try {
    const res = await fetchWithRetry(
      `https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}?fields=permalink&access_token=${encodeURIComponent(accessToken)}`
    );
    if (!res.ok) return undefined;
    const json = (await res.json()) as { permalink?: unknown };
    return typeof json.permalink === 'string' && json.permalink ? json.permalink : undefined;
  } catch {
    return undefined;
  }
}

function setMediaUrl(body: URLSearchParams, asset: MediaAsset): void {
  body.set(asset.mime_type.startsWith('video/') ? 'video_url' : 'image_url', asset.public_url!);
}

async function createContainer(igUserId: string, body: URLSearchParams): Promise<string> {
  const res = await fetchWithRetry(`https://graph.facebook.com/${GRAPH_VERSION}/${igUserId}/media`, {
    method: 'POST',
    body,
  });
  if (!res.ok) throw await apiError('instagram: container create failed', res);
  return ((await res.json()) as { id: string }).id;
}
