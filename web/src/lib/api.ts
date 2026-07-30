import type { Account, Post } from './types';

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
  instagram_as_story?: boolean;
  save_as?: 'draft';
}

export function createPost(payload: CreatePostPayload): Promise<{ id: string; target_count: number }> {
  return req('/api/posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function uploadMedia(file: File): Promise<{ id: string; public_url: string | null; mime_type: string }> {
  const form = new FormData();
  form.append('file', file);
  return req('/api/media', { method: 'POST', body: form });
}

export function cancelTarget(id: string): Promise<{ ok: true }> {
  return req(`/api/post-targets/${id}/cancel`, { method: 'POST' });
}

export function queueTarget(id: string): Promise<{ ok: true }> {
  return req(`/api/post-targets/${id}/queue`, { method: 'POST' });
}

export function reschedule(orderedPostIds: string[]): Promise<{ ok: true; reordered: number }> {
  return req('/api/posts/reschedule', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ordered_post_ids: orderedPostIds }),
  });
}
