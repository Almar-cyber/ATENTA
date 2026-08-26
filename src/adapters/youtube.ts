import type { PlatformAdapter } from '../lib/types.js';
import type { Env } from '../lib/env.js';
import { classifyByKnownCodes, safeParseJson } from '../lib/errors.js';
import { fetchWithRetry, toFixedLengthBody } from '../lib/http.js';
import { getAccountTokens, setAccountTokens } from '../lib/tokens.js';
import { nowIso } from '../lib/db.js';
import { checkDuration } from '../lib/videoLimits.js';

interface YoutubeTokens {
  access_token: string;
  refresh_token: string;
}

// developers.google.com — 12h/256GB is YouTube's hard ceiling for every account. The 15min
// soft threshold (unverified accounts) isn't enforced here since a verified account can exceed
// it; that's a client-side-only hint (see web/src/lib/platforms.ts).
const MAX_VIDEO_DURATION_SECONDS = 12 * 60 * 60;

// Upload em PARTES, não num PUT único.
//
// O PUT único já streamava do R2 (sem estourar a memória do Worker), mas mesmo assim morria: um
// vídeo real de 126 MB derrubou a publicação com "Network connection lost" — uma conexão de saída
// aberta por tempo demais, carregando o arquivo inteiro de uma vez. Foi exatamente a falha que o
// TikTok já tinha tido, com o mesmo arquivo, e que o upload em partes resolveu lá.
//
// A diferença pro TikTok é que o Google exige que TODO chunk, menos o último, seja múltiplo de
// 256 KB — por isso este arquivo tem o próprio fatiamento em vez de reusar `tiktokChunking`, que
// divide o tamanho em partes iguais e cairia fora dessa grade.
const CHUNK_BYTES = 16 * 1024 * 1024; // 64 × 256 KB

/**
 * Onde cada pedaço começa e termina (índices inclusivos, como o `Content-Range` pede).
 *
 * Exportada por causa do teste: a aritmética de faixa é o tipo de coisa que erra por um byte e só
 * aparece num vídeo cortado, muito depois — e num vídeo grande de verdade, que é caro de testar
 * à mão.
 */
export function youtubeChunks(sizeBytes: number): { inicio: number; fim: number }[] {
  const partes: { inicio: number; fim: number }[] = [];
  for (let inicio = 0; inicio < sizeBytes; inicio += CHUNK_BYTES) {
    partes.push({ inicio, fim: Math.min(inicio + CHUNK_BYTES, sizeBytes) - 1 });
  }
  return partes;
}
export const youtubeAdapter: PlatformAdapter = {
  platform: 'youtube',

  needsRefresh(account) {
    if (!account.access_token_expires_at) return true;
    return new Date(account.access_token_expires_at).getTime() - Date.now() < 5 * 60_000;
  },

  async ensureFreshToken(account, env) {
    const tokens = await getAccountTokens<YoutubeTokens>(env.DB, account.id, env.TOKEN_ENCRYPTION_KEY);
    if (!tokens?.refresh_token) {
      throw new Error('youtube: no refresh_token on file — run `npm run youtube-auth` again');
    }

    const res = await fetchWithRetry('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.YOUTUBE_CLIENT_ID,
        client_secret: env.YOUTUBE_CLIENT_SECRET,
        refresh_token: tokens.refresh_token,
        grant_type: 'refresh_token',
      }),
    });
    if (!res.ok) throw new Error(`youtube: token refresh failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { access_token: string; expires_in: number };

    await setAccountTokens(env.DB, account.id, { ...tokens, access_token: json.access_token }, env.TOKEN_ENCRYPTION_KEY);
    await env.DB.prepare(`update accounts set access_token_expires_at = ?, updated_at = ? where id = ?`)
      .bind(new Date(Date.now() + json.expires_in * 1000).toISOString(), nowIso(), account.id)
      .run();

    return account;
  },

  validate(_target, media, _account) {
    if (media.length !== 1) throw new Error('youtube: exactly one video file required');
    if (!media[0].mime_type.startsWith('video/')) throw new Error('youtube: media must be a video file');
    checkDuration('youtube', media[0], undefined, MAX_VIDEO_DURATION_SECONDS);
  },

  async publish(target, media, account, env) {
    const tokens = await getAccountTokens<YoutubeTokens>(env.DB, account.id, env.TOKEN_ENCRYPTION_KEY);
    if (!tokens?.access_token) throw new Error('youtube: no access_token on file');

    const video = media[0];

    // NOT using YouTube's native privacyStatus:'private' + publishAt scheduling: the poller
    // (worker.ts) only calls publish() once scheduled_for is already due, so by the time we'd
    // send publishAt it could already be in the past — YouTube rejects that with 400
    // invalidPublishAt. Publishing straight to 'public' here keeps one uniform timing model
    // (the poller's ~10-15min cadence) across all six platforms instead of a second,
    // finer-grained native-scheduling path — see README "Pendências".
    const options = target.options as { categoryId?: string; title?: string; madeForKids?: boolean };
    const metadata = {
      snippet: {
        // target.title vem de scheduled_posts.title (o que o dashboard preenche). options.title é o
        // caminho antigo do CLI. Sem isso, todo vídeo saía "Untitled" mesmo com título preenchido.
        title: options.title ?? target.title ?? target.caption_override?.slice(0, 100) ?? 'Untitled',
        description: target.caption_override ?? '',
        categoryId: options.categoryId ?? '22',
      },
      status: {
        privacyStatus: 'public',
        selfDeclaredMadeForKids: options.madeForKids ?? false,
      },
    };

    const initRes = await fetchWithRetry(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status&notifySubscribers=false',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          'Content-Type': 'application/json',
          'X-Upload-Content-Type': video.mime_type,
          'X-Upload-Content-Length': String(video.size_bytes),
        },
        body: JSON.stringify(metadata),
      }
    );
    if (!initRes.ok) {
      const bodyText = await initRes.text();
      throw Object.assign(new Error(`youtube: upload init failed: ${initRes.status} ${bodyText}`), { code: googleErrorReason(bodyText) });
    }
    const uploadUrl = initRes.headers.get('Location');
    if (!uploadUrl) throw new Error('youtube: no resumable upload URL returned');

    // Um PUT por pedaço, todos na MESMA upload_url, distinguidos pelo Content-Range. Cada pedaço é
    // lido do R2 por FAIXA (`range`), então nem a memória nem a conexão veem o arquivo inteiro.
    const partes = youtubeChunks(video.size_bytes);
    let videoId: string | undefined;

    for (const [i, { inicio, fim }] of partes.entries()) {
      const tamanho = fim - inicio + 1;
      const res = await fetchWithRetry(uploadUrl, async () => {
        const object = await env.MEDIA.get(video.storage_key, { range: { offset: inicio, length: tamanho } });
        if (!object) throw new Error(`youtube: media object not found in R2: ${video.storage_key}`);
        return {
          method: 'PUT',
          headers: {
            'Content-Type': video.mime_type,
            'Content-Range': `bytes ${inicio}-${fim}/${video.size_bytes}`,
          },
          body: toFixedLengthBody(object.body, tamanho),
        };
      });

      // 308 = "recebi este pedaço, manda o próximo". NÃO é erro, e também não é `res.ok` (308 está
      // fora da faixa 2xx) — tratar antes de qualquer checagem de ok é o que impede o caminho feliz
      // de ser lido como falha. O `fetchWithRetry` só repete em 5xx, então ele deixa o 308 passar.
      if (res.status === 308) continue;
      if (res.ok) {
        videoId = ((await res.json()) as { id: string }).id;
        break;
      }
      const bodyText = await res.text();
      throw Object.assign(
        new Error(`youtube: chunk ${i + 1}/${partes.length} upload failed: ${res.status} ${bodyText}`),
        { code: googleErrorReason(bodyText) }
      );
    }

    // Só acontece se o último pedaço voltar 308, o que significaria que o Google conta bytes
    // diferente de nós — melhor falhar alto que devolver um id vazio como se tivesse publicado.
    if (!videoId) throw new Error('youtube: upload terminou sem o id do vídeo (último chunk não fechou)');
    const result = { id: videoId };

    // Capa personalizada (opcional). Falhar aqui não invalida o vídeo já publicado — canais sem
    // verificação não podem definir thumbnail, e isso não deve derrubar o post.
    const coverId = (target.options as { cover_media_id?: string }).cover_media_id;
    if (coverId) {
      try {
        const cover = await env.DB.prepare(`select storage_key, mime_type, size_bytes from media_assets where id = ?`)
          .bind(coverId)
          .first<{ storage_key: string; mime_type: string; size_bytes: number }>();
        if (cover) {
          const obj = await env.MEDIA.get(cover.storage_key);
          if (obj) {
            await fetchWithRetry(
              `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(result.id)}`,
              {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${tokens.access_token}`,
                  'Content-Type': cover.mime_type,
                  'Content-Length': String(cover.size_bytes),
                },
                body: toFixedLengthBody(obj.body, cover.size_bytes),
              }
            );
          }
        }
      } catch (err) {
        console.error('youtube: falha ao definir a capa (vídeo publicado mesmo assim):', err);
      }
    }

    return { state: 'published', externalId: result.id, externalUrl: `https://youtu.be/${result.id}` };
  },

  async checkStatus() {
    throw new Error('youtube: checkStatus is unused — publish() completes synchronously end-to-end');
  },

  classifyError(err) {
    return classifyByKnownCodes(err, {
      quotaExceeded: 'quota',
      invalid_grant: 'auth',
      invalidPublishAt: 'permanent',
    });
  },
};

// Google's standard API error envelope: { error: { code, message, errors: [{ domain, reason,
// message }] } } (developers.google.com/youtube/v3/errors) — `errors[0].reason` (e.g.
// "quotaExceeded") is the machine-readable field matching classifyError's table keys. Still the
// same googleapis.com JSON envelope on the resumable-upload PUT, not a third-party signed URL, so
// this applies there too.
function googleErrorReason(bodyText: string): string | undefined {
  const parsed = safeParseJson(bodyText) as { error?: { errors?: Array<{ reason?: string }> } } | undefined;
  return parsed?.error?.errors?.[0]?.reason;
}
