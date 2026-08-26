import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Play } from 'lucide-react';
import type { Platform, QueuedMedia } from '@/lib/types';
import {
  PLATFORM_CAPTION_LIMITS,
  PLATFORM_COLORS,
  PLATFORM_LABELS,
  PLATFORM_ASPECT_RANGE,
  PLATFORM_PREVIEW_SHAPE,
  PLATFORM_RECOMMENDED_MEDIA,
  findFormat,
  isVideoMime,
} from '@/lib/platforms';
import { useMediaUrl, videoPosterUrl } from '@/lib/useMediaUrl';
import { PlatformIcon } from './PlatformIcon';

export interface PreviewInput {
  platform: Platform;
  accountName: string;
  caption: string;
  title?: string;
  media: QueuedMedia[];
  /** Formato escolhido no compositor ('post' | 'reel' | 'story' | 'video' | 'short'). É ele que
   *  define a proporção do preview e o rótulo — não o tipo do arquivo. */
  format?: string;
  /** Imagem de capa escolhida no composer. É o que a rede mostra parado no feed, então tem
   *  prioridade sobre o frame do vídeo na pré-visualização. */
  cover?: File;
}

/** Largura / altura de cada forma, em número — o `aspect-ratio` do CSS aceita número direto. */
const SHAPE_RATIO: Record<string, number> = {
  square: 1,
  story: 9 / 16,
  wide: 16 / 9,
  tall: 3 / 4,
};

/** Teto de altura da mídia. O preview vive numa coluna com scroll, e 9:16 em largura cheia estoura. */
const MEDIA_MAX_H = 340;
/** Largura do card. A mídia nunca passa disso, mesmo quando a altura permitiria. */
const CARD_MAX_W = 300;

/**
 * A largura que faz a mídia caber no teto de altura SEM mentir sobre a proporção.
 *
 * Antes o teto era aplicado como `maxHeight`, e isso não encolhe a largura junto: a caixa ficava
 * 300x340 tanto pro 9:16 quanto pro 3:4, ou seja, Reel, Story, TikTok e Pinterest apareciam todos
 * na MESMA proporção (0,88) e nenhum na sua. Numa tela cujo trabalho é dizer "é assim que vai
 * ficar", errar a proporção é errar a única coisa que ela promete.
 *
 * Limitando a LARGURA, o `aspect-ratio` continua valendo e cada formato aparece no que é de fato.
 */
function larguraDaMidia(ratio: number): number {
  return Math.min(CARD_MAX_W, Math.round(MEDIA_MAX_H * ratio));
}

function MediaFrame({ item, cover }: { item: QueuedMedia | undefined; cover?: File }) {
  const url = useMediaUrl(item);
  const coverUrl = useMediaUrl(cover ? { key: 'cover', file: cover, name: cover.name, mime_type: cover.type } : undefined);
  const [broken, setBroken] = useState(false);
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const video = isVideoMime(item?.mime_type);

  // Trocar de item no carrossel reaproveita este componente — sem isto, o próximo vídeo já
  // apareceria "tocando" (com controles e sem capa) por causa do estado do anterior.
  useEffect(() => {
    setPlaying(false);
    setBroken(false);
  }, [url]);

  async function play() {
    const el = videoRef.current;
    if (!el) return;
    setPlaying(true);
    // O src carrega com #t=0.1 pra render um frame parado (ver videoPosterUrl); ao dar play, volta
    // do começo. E com som: o clique é gesto do usuário, então o navegador permite desmutar.
    el.muted = false;
    el.currentTime = 0;
    try {
      await el.play();
    } catch {
      setPlaying(false);
    }
  }

  if (!item || !url || broken) {
    return <div className="flex h-full items-center justify-center text-xs text-muted-foreground">{video ? 'vídeo' : item ? 'imagem' : 'sem mídia'}</div>;
  }

  if (!video) {
    return <img src={url} alt="" className="h-full w-full object-cover" onError={() => setBroken(true)} />;
  }

  return (
    <div className="relative h-full w-full">
      <video
        ref={videoRef}
        src={videoPosterUrl(url)}
        muted
        playsInline
        preload="metadata"
        controls={playing}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        className="h-full w-full object-cover"
        onError={() => setBroken(true)}
      />

      {/* Parado, o que aparece é a CAPA quando existe — é o que a rede vai mostrar no feed. O play
          toca o vídeo de verdade por baixo dela. */}
      {!playing && coverUrl && (
        <img src={coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
      )}
      {!playing && (
        <button
          type="button"
          aria-label="Reproduzir vídeo"
          onClick={play}
          className="absolute inset-0 grid place-items-center bg-black/10 transition-colors hover:bg-black/25"
        >
          <span className="grid size-12 place-items-center rounded-full bg-black/60 text-white backdrop-blur-sm">
            <Play className="ml-0.5 size-5 fill-current" />
          </span>
        </button>
      )}
    </div>
  );
}

export function PostPreview({ input }: { input: PreviewInput }) {
  const { platform, accountName, caption, title, media, format, cover } = input;
  const color = PLATFORM_COLORS[platform];
  const limit = PLATFORM_CAPTION_LIMITS[platform];
  const over = limit != null && caption.length > limit;
  const shownCaption = useMemo(() => (over ? caption.slice(0, limit) : caption), [over, caption, limit]);
  // Índice do carrossel. Clampado na renderização porque a fila de mídia pode encolher (remover um
  // item) enquanto o índice ainda aponta pro slot antigo.
  const [index, setIndex] = useState(0);
  const safeIndex = Math.min(index, Math.max(0, media.length - 1));
  const current = media[safeIndex];

  // Proporção, rótulo e tamanho ideal vêm do FORMATO escolhido (Reel é 9:16, post de feed é 4:5),
  // não do arquivo — é o formato que decide onde a peça vai parar na rede.
  const spec = findFormat(platform, format);
  const isStory = spec?.id === 'story';
  const label = spec && spec.id !== 'post' && spec.id !== 'video' ? `${PLATFORM_LABELS[platform]} · ${spec.label}` : PLATFORM_LABELS[platform];
  const shape = spec?.shape ?? PLATFORM_PREVIEW_SHAPE[platform];
  const recommended = spec?.recommended ?? PLATFORM_RECOMMENDED_MEDIA[platform];

  /**
   * A proporção que a mídia vai ter DE VERDADE nesta rede.
   *
   * Regra: no feed quem manda é o arquivo (uma foto deitada sai deitada no Facebook), limitado ao
   * que a rede aceita; nos formatos de proporção cravada (Reel, Story, Short, TikTok) quem manda é
   * o formato, e a pré-visualização mostra o recorte que a rede vai aplicar.
   *
   * Sem formato definido a rede tem um só, então a faixa vale direto — é o caso de Facebook,
   * LinkedIn e Pinterest.
   */
  const aspecto = useMemo(() => {
    const doFormato = SHAPE_RATIO[shape] ?? 1;
    const segueArquivo = spec ? spec.seguirArquivo === true : true;
    const faixa = PLATFORM_ASPECT_RANGE[platform];
    if (!segueArquivo || !faixa || !current?.width || !current?.height) return doFormato;
    const real = current.width / current.height;
    return Math.min(faixa.max, Math.max(faixa.min, real));
  }, [shape, spec, platform, current?.width, current?.height]);

  const willCrop = useMemo(() => {
    if (!current?.width || !current?.height) return false;
    const fileRatio = current.width / current.height;
    const targetRatio = recommended.width / recommended.height;
    return Math.abs(fileRatio - targetRatio) > 0.02;
  }, [current?.width, current?.height, recommended.width, recommended.height]);

  return (
    // Só borda, sem sombra deslocada: o preview vive dentro de uma coluna com scroll (composer e
    // dialog), e ali a sombra sólida era cortada pelo overflow, aparecendo como um canto quebrado.
    <div className="w-full max-w-[300px] overflow-hidden rounded-2xl border-2 border-brand bg-card">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <div
          className="grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold text-white"
          style={{ background: color }}
        >
          {accountName.charAt(0).toUpperCase()}
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold">{accountName}</div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <PlatformIcon platform={platform} className="size-3 shrink-0" style={{ color }} />
            {label}
          </div>
        </div>
      </div>

      {media.length > 0 ? (
        <div
          className="group/carousel relative mx-auto w-full overflow-hidden bg-muted"
          style={{ aspectRatio: aspecto, maxWidth: larguraDaMidia(aspecto) }}
        >
          <MediaFrame item={media[safeIndex]} cover={cover} />
          {media.length > 1 && (
            <>
              <div className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white">
                {safeIndex + 1}/{media.length}
              </div>

              {/* Navegação do carrossel: dá pra conferir cada arquivo sem sair da pré-visualização. */}
              {safeIndex > 0 && (
                <button
                  type="button"
                  aria-label="Anterior"
                  onClick={() => setIndex(safeIndex - 1)}
                  className="absolute left-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white opacity-0 transition-opacity hover:bg-black/70 group-hover/carousel:opacity-100"
                >
                  <ChevronLeft className="size-4" />
                </button>
              )}
              {safeIndex < media.length - 1 && (
                <button
                  type="button"
                  aria-label="Próximo"
                  onClick={() => setIndex(safeIndex + 1)}
                  className="absolute right-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white opacity-0 transition-opacity hover:bg-black/70 group-hover/carousel:opacity-100"
                >
                  <ChevronRight className="size-4" />
                </button>
              )}

              <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1">
                {media.map((m, i) => (
                  <button
                    key={m.key}
                    type="button"
                    aria-label={`Ir para o item ${i + 1}`}
                    onClick={() => setIndex(i)}
                    className={`size-1.5 rounded-full transition-colors ${i === safeIndex ? 'bg-white' : 'bg-white/55 hover:bg-white/80'}`}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="flex h-24 items-center justify-center border-y bg-muted/50 text-xs text-muted-foreground">
          sem mídia
        </div>
      )}

      {platform === 'youtube' && title && <div className="px-3 pt-2.5 text-sm font-semibold">{title}</div>}

      {!isStory ? (
        <div className="whitespace-pre-wrap break-words px-3 py-2.5 text-sm leading-snug">
          {platform === 'instagram' && <span className="mr-1.5 font-semibold">{accountName}</span>}
          {shownCaption}
        </div>
      ) : caption ? (
        <div className="px-3 py-2.5 text-xs text-destructive">
          a legenda não aparece num Story — a API só publica a imagem/vídeo
        </div>
      ) : null}

      {over && (
        <div className="px-3 pb-2.5 text-xs text-destructive">
          cortado em {limit} caracteres ({caption.length} escritos)
        </div>
      )}

      <div className="border-t px-3 py-2 text-xs text-muted-foreground">
        <div>
          Ideal: {recommended.width}×{recommended.height}px ({recommended.ratio})
        </div>
        {current?.width && current?.height && (
          <div className={willCrop ? 'text-destructive' : ''}>
            Seu arquivo: {current.width}×{current.height}px{willCrop ? ' — será cortado' : ' ✓'}
          </div>
        )}
      </div>
    </div>
  );
}
