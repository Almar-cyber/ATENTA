import type { MediaAsset, PlatformAdapter } from '../lib/types.js';
import { classifyByKnownCodes, safeParseJson } from '../lib/errors.js';
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
const MAX_REELS_DURATION_SECONDS = 900;
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
export const instagramAdapter: PlatformAdapter = {
  platform: 'instagram',

  needsRefresh() {
    return false;
  },

  async ensureFreshToken() {
    throw new Error('instagram: no refresh mechanism implemented — run meta-auth-url again if needs_reauth');
  },

  validate(target, media) {
    if (media.length === 0) throw new Error('instagram: at least one image or video is required');
    if (media.length > CAROUSEL_MAX_ITEMS) {
      throw new Error(`instagram: carousel supports at most ${CAROUSEL_MAX_ITEMS} items (got ${media.length})`);
    }
    const options = target.options as { as_story?: boolean };
    if (options.as_story && media.length > 1) {
      throw new Error('instagram: a Story takes exactly one image or video (no carousel Stories via the API)');
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
          options.as_story ? MAX_STORY_DURATION_SECONDS : MAX_REELS_DURATION_SECONDS
        );
      } else if (!options.as_story && asset.width != null && asset.height != null) {
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
    const options = target.options as { as_story?: boolean };

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
      if (options.as_story) {
        body.set('media_type', 'STORIES');
      } else if (asset.mime_type.startsWith('video/')) {
        body.set('media_type', 'REELS');
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
    if (!statusRes.ok) {
      const bodyText = await statusRes.text();
      throw Object.assign(new Error(`instagram: container status check failed: ${statusRes.status} ${bodyText}`), {
        code: metaErrorType(bodyText),
      });
    }
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
    if (!publishRes.ok) {
      const bodyText = await publishRes.text();
      throw Object.assign(new Error(`instagram: media_publish failed: ${publishRes.status} ${bodyText}`), {
        code: metaErrorType(bodyText),
      });
    }
    const publishJson = (await publishRes.json()) as { id: string };

    return { state: 'published', externalId: publishJson.id };
  },

  classifyError(err) {
    return classifyByKnownCodes(err, { OAuthException: 'auth', '190': 'auth' });
  },
};

function setMediaUrl(body: URLSearchParams, asset: MediaAsset): void {
  body.set(asset.mime_type.startsWith('video/') ? 'video_url' : 'image_url', asset.public_url!);
}

async function createContainer(igUserId: string, body: URLSearchParams): Promise<string> {
  const res = await fetchWithRetry(`https://graph.facebook.com/${GRAPH_VERSION}/${igUserId}/media`, {
    method: 'POST',
    body,
  });
  if (!res.ok) {
    const bodyText = await res.text();
    throw Object.assign(new Error(`instagram: container create failed: ${res.status} ${bodyText}`), {
      code: metaErrorType(bodyText),
    });
  }
  return ((await res.json()) as { id: string }).id;
}

// Graph API error envelope: { error: { message, type, code, error_subcode?, fbtrace_id } }. `type`
// (e.g. "OAuthException") is used over the numeric `code` since it covers the whole family of
// token-invalid codes (190, 102, ...) that classifyError's 'OAuthException' key is meant to catch,
// not just the specific 190 case. Same shape/reasoning as facebook.ts's own copy of this helper.
function metaErrorType(bodyText: string): string | undefined {
  const parsed = safeParseJson(bodyText) as { error?: { type?: string } } | undefined;
  return parsed?.error?.type;
}
