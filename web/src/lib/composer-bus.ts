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

// Separate channel for "editar" — operates on the WHOLE POST (every target), unlike onPrefill
// (duplicar) which only carries the single target that was clicked, since editing needs to
// show/preserve all of a post's destination accounts.
export interface EditPayload {
  post: Post;
}

type EditListener = (p: EditPayload) => void;
const editListeners = new Set<EditListener>();

export function onEdit(fn: EditListener): () => void {
  editListeners.add(fn);
  return () => editListeners.delete(fn);
}

export function requestEdit(payload: EditPayload): void {
  for (const fn of editListeners) fn(payload);
}

// Canal do planejador de grade: "esta ideia vira post". Leva o que a ideia tem — a arte (já no R2)
// e/ou o texto; data e contas continuam sendo escolhidas no compositor, porque ideia não tem
// nenhum dos dois.
//
// Os dois campos são opcionais porque a ideia pode ser só imagem ou só texto (migração 0013), mas
// nunca nenhum dos dois — quem garante isso é o `check` da tabela.
export interface PrefillMediaPayload {
  /** A nota da ideia, que vira o rascunho da legenda. */
  body?: string;
  /** O pilar de conteúdo. Vai junto porque é o que fecha o ciclo até o Insights: uma ideia marcada
   *  que perde o pilar ao virar post não conta pra nenhuma estatística de assunto. */
  tagId?: string | null;
  media?: {
    assetId: string;
    name: string;
    mime_type: string;
    public_url: string | null;
    width?: number;
    height?: number;
  };
}

type MediaListener = (p: PrefillMediaPayload) => void;
const mediaListeners = new Set<MediaListener>();

export function onPrefillMedia(fn: MediaListener): () => void {
  mediaListeners.add(fn);
  return () => mediaListeners.delete(fn);
}

export function requestPrefillMedia(payload: PrefillMediaPayload): void {
  for (const fn of mediaListeners) fn(payload);
}

// ---------------------------------------------------------------------------
// "Quero conectar uma conta"
//
// Nasce do estado vazio do AccountPicker, que fica DENTRO do modal do compositor: pra levar a
// pessoa até Conexões é preciso fechar o modal e trocar a tela, e as duas coisas moram no App.
// Passar callback por prop atravessaria PostComposer só de passagem — o mesmo prop-drilling que
// este barramento existe pra evitar.
// ---------------------------------------------------------------------------

type ConnectListener = () => void;
const connectListeners = new Set<ConnectListener>();

export function onConnectRequest(fn: ConnectListener): () => void {
  connectListeners.add(fn);
  return () => connectListeners.delete(fn);
}

export function requestConnections(): void {
  connectListeners.forEach((fn) => fn());
}
