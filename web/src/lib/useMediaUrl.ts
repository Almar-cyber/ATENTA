import type { QueuedMedia } from './types';

// Um object URL por File, criado uma única vez e compartilhado por todos os componentes que
// exibem aquele arquivo (tile da fila + um preview por conta selecionada).
//
// Antes cada componente criava o seu e revogava no cleanup do efeito — ao reordenar/remover, um
// componente revogava um URL que outro ainda estava usando e a imagem quebrava ("imagem" no lugar
// da foto). O WeakMap deixa o navegador recuperar a entrada quando o File some do queue.
const urlCache = new WeakMap<File, string>();

function fileUrl(file: File): string {
  let url = urlCache.get(file);
  if (!url) {
    url = URL.createObjectURL(file);
    urlCache.set(file, url);
  }
  return url;
}

// Resolve um QueuedMedia pra URL exibível: object URL pro arquivo ainda não enviado, `public_url`
// pro que já foi upload. Sem estado nem efeito — o valor é derivado direto do item, então não há
// render intermediário com url nula (que fazia a mídia "piscar" a cada reordenação).
export function useMediaUrl(item: QueuedMedia | undefined): string | null {
  if (!item) return null;
  if (item.file) return fileUrl(item.file);
  return item.public_url ?? null;
}
