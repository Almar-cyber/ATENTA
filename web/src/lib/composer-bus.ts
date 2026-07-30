import type { Post, Target } from './types';

// Tiny pub-sub so the detail dialog / views can ask the composer to prefill itself with an
// existing post ("duplicar") without threading callbacks through every component.
export interface PrefillPayload {
  post: Post;
  target: Target;
}

type Listener = (p: PrefillPayload) => void;
const listeners = new Set<Listener>();

export function onPrefill(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function requestPrefill(payload: PrefillPayload): void {
  for (const fn of listeners) fn(payload);
}

// Separate channel for "clicked an empty calendar day" → set the composer's datetime only.
type DateListener = (localDateTime: string) => void;
const dateListeners = new Set<DateListener>();

export function onPrefillDate(fn: DateListener): () => void {
  dateListeners.add(fn);
  return () => dateListeners.delete(fn);
}

export function requestPrefillDate(localDateTime: string): void {
  for (const fn of dateListeners) fn(localDateTime);
}
