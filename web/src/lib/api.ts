import type { Account, GridPreview, Media, Platform, Post, PostStatus } from './types';
import type { MediaMetadata } from './mediaMetadata';

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(path, opts);
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    const msg = (json as { error?: string } | null)?.error ?? `Erro ${res.status}`;
    throw new Error(msg);
  }
  return json as T;
}

export function getAccounts(): Promise<{ accounts: Account[] }> {
  return req('/api/accounts');
}

/**
 * Um pilar de conteúdo ("bastidores", "produto", "viagem").
 *
 * Tabela própria e não texto livre: o destino delas é um agrupamento no Insights, e agrupar por
 * texto digitado quebraria "Viagem" e "viagem" em dois pilares com metade da amostra cada.
 */
export interface Tag {
  id: string;
  name: string;
  /** Chave da paleta (ver `lib/tags.ts`), nunca um hex. */
  color: string;
  /** Quantas peças usam este pilar — pra tela avisar antes de apagar. Só vem na listagem. */
  uso?: number;
}

export function getTags(): Promise<{ tags: Tag[] }> {
  return req('/api/tags');
}

/** Nome repetido (ignorando caixa e espaços) devolve o pilar que já existe, não um erro. */
export function createTag(payload: { name: string; color?: string }): Promise<Tag> {
  return req('/api/tags', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function updateTag(id: string, patch: { name?: string; color?: string }): Promise<Tag> {
  return req(`/api/tags/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

/** Apaga o pilar; as peças dele voltam a "sem pilar" e não são perdidas. */
export function deleteTag(id: string): Promise<{ ok: true }> {
  return req(`/api/tags/${id}`, { method: 'DELETE' });
}

/** Um destino que vai sair, no bloco "Sai a seguir" do painel. */
export interface ProximoPost {
  post_id: string;
  target_id: string;
  platform: Platform;
  status: PostStatus;
  account_name: string;
  scheduled_for: string;
  titulo: string | null;
  formato: string | null;
  media: Media | null;
}

/**
 * O resumo do painel, calculado no servidor.
 *
 * Não dá pra derivar isso de `getPosts()`: aquela chamada é filtrada por status/plataforma e
 * limitada a 300 linhas, então os números mudariam conforme o filtro que ficou ligado na Agenda e
 * o total de publicados seria o teto da página. Ver o comentário de `getSummary` em `src/api.ts`.
 */
export interface Summary {
  /** Destinos por status. Status sem nenhum destino simplesmente não aparece na chave. */
  por_status: Partial<Record<PostStatus, number>>;
  atencao: {
    /** Rascunhos cuja data já passou — não vão publicar sozinhos, e ninguém vai procurá-los. */
    rascunhos_vencidos: number;
    /** Na fila e já passou da tolerância: a varredura devia ter pego. */
    atrasados: number;
  };
  proximos: ProximoPost[];
}

export function getSummary(): Promise<Summary> {
  return req('/api/summary');
}

// Métricas coletadas (Fase A). `null` = a rede não expõe aquela métrica pra esse post.
export interface PostMetricRow {
  target_id: string;
  /** Id do post na própria rede — é por ele que a miniatura ao vivo casa com a métrica. */
  external_post_id: string | null;
  platform: Platform;
  external_url: string | null;
  published_at: string | null;
  account_id: string;
  account_name: string;
  caption: string | null;
  format: string | null;
  /** Pilar de conteúdo — é o que permite agrupar desempenho por assunto. */
  tag_id: string | null;
  tag_name: string | null;
  tag_color: string | null;
  duration_seconds: number | null;
  fetched_at: string;
  impressions: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  video_views: number | null;
  /** Seguidores que ESTE post trouxe. */
  follows: number | null;
  /** Visitas ao perfil originadas nele. */
  profile_visits: number | null;
  interactions: number | null;
  avg_watch_seconds: number | null;
}

export function getMetrics(): Promise<{ metrics: PostMetricRow[] }> {
  return req('/api/metrics');
}

export interface FollowerRow {
  account_id: string;
  platform: Platform;
  display_name: string;
  followers: number | null; // snapshot mais recente
  followers_first: number | null; // primeiro snapshot (pro delta)
  since: string | null;
  /** JSON: seguidores online por hora ('0'..'23'). Null enquanto a rede não devolver. */
  online_followers: string | null;
  /** JSON: faixa etária, gênero, cidade e país de quem segue. */
  demographics: string | null;
}

export function getFollowers(): Promise<{ followers: FollowerRow[] }> {
  return req('/api/metrics/followers');
}

export function getPosts(params: { status?: string; platform?: string; limit?: number } = {}): Promise<{ posts: Post[] }> {
  const q = new URLSearchParams();
  if (params.status) q.set('status', params.status);
  if (params.platform) q.set('platform', params.platform);
  q.set('limit', String(params.limit ?? 300));
  return req(`/api/posts?${q.toString()}`);
}

export interface CreatePostPayload {
  title?: string;
  body: string;
  scheduled_for: string;
  target_account_ids: string[];
  media_asset_ids?: string[];
  youtube_privacy_status?: string;
  pinterest_board_id?: string;
  tiktok_privacy_level?: string;
  instagram_format?: string;
  cover_media_id?: string;
  cover_timestamp_ms?: number;
  save_as?: 'draft';
  /** Pilar de conteúdo. `null` tira. */
  tag_id?: string | null;
  target_caption_overrides?: Record<string, string>;
}

export function createPost(payload: CreatePostPayload): Promise<{ id: string; target_count: number }> {
  return req('/api/posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function updatePost(id: string, payload: Partial<CreatePostPayload>): Promise<{ ok: true }> {
  return req(`/api/posts/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export interface UploadedMedia {
  id: string;
  public_url: string | null;
  mime_type: string;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
}

// Acima disso o upload vai em partes. O Worker tem limite de corpo por requisição (100MB no plano
// free) e de memória (128MB); mandar um vídeo inteiro numa requisição só estourava os dois e a
// criação do post falhava antes de chegar ao banco.
const MULTIPART_THRESHOLD_BYTES = 60 * 1024 * 1024;
// R2 exige que toda parte, menos a última, tenha o mesmo tamanho — e no mínimo 5MB.
const PART_SIZE_BYTES = 10 * 1024 * 1024;

export async function uploadMedia(
  file: File,
  meta: MediaMetadata = {},
  onProgress?: (fraction: number) => void
): Promise<UploadedMedia> {
  if (file.size <= MULTIPART_THRESHOLD_BYTES) {
    const form = new FormData();
    form.append('file', file);
    if (meta.duration_seconds != null) form.append('duration_seconds', String(meta.duration_seconds));
    if (meta.width != null) form.append('width', String(meta.width));
    if (meta.height != null) form.append('height', String(meta.height));
    const res = await req<UploadedMedia>('/api/media', { method: 'POST', body: form });
    onProgress?.(1);
    return res;
  }

  const started = await req<{ id: string; storage_key: string; upload_id: string }>(
    '/api/media/multipart/start',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: file.name, mime_type: file.type }),
    }
  );

  const parts: Array<{ part_number: number; etag: string }> = [];
  const total = Math.ceil(file.size / PART_SIZE_BYTES);
  for (let i = 0; i < total; i++) {
    const chunk = file.slice(i * PART_SIZE_BYTES, (i + 1) * PART_SIZE_BYTES);
    const query = new URLSearchParams({
      key: started.storage_key,
      upload_id: started.upload_id,
      part: String(i + 1),
    });
    const part = await req<{ part_number: number; etag: string }>(`/api/media/multipart/part?${query}`, {
      method: 'PUT',
      body: chunk,
    });
    parts.push(part);
    onProgress?.((i + 1) / total);
  }

  return req<UploadedMedia>('/api/media/multipart/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: started.id,
      storage_key: started.storage_key,
      upload_id: started.upload_id,
      mime_type: file.type,
      size_bytes: file.size,
      parts,
      duration_seconds: meta.duration_seconds ?? null,
      width: meta.width ?? null,
      height: meta.height ?? null,
    }),
  });
}

// Baixa uma mídia já enviada como File, pela nossa origem (o domínio do R2 não manda CORS, e um
// <img> de lá suja o canvas — o recorte no navegador não funcionaria).
export async function fetchMediaFile(id: string, name: string): Promise<File> {
  const res = await fetch(`/api/media/${id}/bytes`);
  if (!res.ok) throw new Error('não consegui baixar a mídia para recortar');
  const blob = await res.blob();
  return new File([blob], name, { type: blob.type });
}

export interface FeedItem {
  id: string;
  thumbnail_url: string | null;
  permalink: string | null;
  caption: string | null;
  published_at: string | null;
  is_video: boolean;
}

// Feed real da conta (busca ao vivo na API da rede). Só Instagram e YouTube.
export function getAccountFeed(accountId: string): Promise<{ items: FeedItem[]; error?: string }> {
  return req(`/api/feed/${accountId}`);
}

/**
 * Quem comentou nos posts desta conta, agregado do que o poller já coletou — ao contrário do feed
 * acima, isto NÃO busca ao vivo: comentário não expira como URL de mídia, então guardar e agregar
 * é seguro (e mais rápido).
 */
export interface Commenter {
  external_user_id: string;
  username: string | null;
  comentarios: number;
  desde: string;
  ultimo: string;
}

export function getCommenters(
  accountId: string
): Promise<{ commenters: Commenter[]; total: { pessoas: number; comentarios: number } }> {
  return req(`/api/accounts/${accountId}/commenters`);
}

// Ideias: um post que ainda não tem data. Ocupa um lugar no planejamento sem virar post agendado.
export function getGridPreviews(platform: Platform): Promise<{ previews: GridPreview[] }> {
  return req(`/api/grid-previews?platform=${platform}`);
}

// Uma das duas — imagem ou texto — precisa vir; o servidor recusa as duas vazias.
export function createGridPreview(payload: {
  platform: Platform;
  media_asset_id?: string;
  note?: string;
  tag_id?: string | null;
  sort_at: string;
}): Promise<GridPreview> {
  return req('/api/grid-previews', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/** Campo ausente = não mexe (é como a reordenação da grade manda só o `sort_at`). */
export function updateGridPreview(
  id: string,
  patch: { sort_at?: string; note?: string | null; media_asset_id?: string | null; tag_id?: string | null }
): Promise<GridPreview> {
  return req(`/api/grid-previews/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

export function deleteGridPreview(id: string): Promise<{ ok: true }> {
  return req(`/api/grid-previews/${id}`, { method: 'DELETE' });
}

export function cancelTarget(id: string): Promise<{ ok: true }> {
  return req(`/api/post-targets/${id}/cancel`, { method: 'POST' });
}

export function queueTarget(id: string): Promise<{ ok: true }> {
  return req(`/api/post-targets/${id}/queue`, { method: 'POST' });
}

// Cancelado/falhou volta pra rascunho (não pra fila — a data original pode já ter passado).
export function reactivateTarget(id: string): Promise<{ ok: true }> {
  return req(`/api/post-targets/${id}/reactivate`, { method: 'POST' });
}

// Apaga o destino; se era o último do post, o post some junto (`post_deleted`).
export function deleteTarget(id: string): Promise<{ ok: true; post_deleted: boolean }> {
  return req(`/api/post-targets/${id}`, { method: 'DELETE' });
}

export function reschedule(orderedPostIds: string[]): Promise<{ ok: true; reordered: number }> {
  return req('/api/posts/reschedule', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ordered_post_ids: orderedPostIds }),
  });
}
