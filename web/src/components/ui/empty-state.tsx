import type * as React from 'react';
import { cn } from '@/lib/utils';

// Estados vazios estavam escritos em 6 lugares com 3 escalas de texto diferentes. Um só formato:
// `sm` pra dentro de um card/coluna, `md` pra área de conteúdo inteira.
//
// ILUSTRAÇÃO: tela vazia é o primeiro contato de quem acabou de entrar, e uma linha de texto cinza
// no meio do branco parece defeito. O doodle diz "está tudo certo, é só cedo". São os mesmos Open
// Doodles da landing (CC0, recoloridos pro par roxo/amarelo) — ver web/doodles-license.md.
//
// A arte fica sobre um DISCO de cor: solta no branco ela pairava sem pertencer a nada, e o disco a
// apoia e a liga à paleta. É o mesmo papel que a moldura faz no vídeo da tela de entrar.
//
// SVG com animação em CSS, e não GIF: pesa uma fração, escala sem serrilhar e — o que importa mais
// — obedece a `prefers-reduced-motion`. GIF não tem como parar.
//
// HIERARQUIA: título grande em tinta cheia, descrição menor e apagada, com LARGURA LIMITADA. Sem o
// limite, a descrição atravessava a tela inteira num monitor largo, e linha longa demais é o
// jeito mais fácil de tornar um texto curto cansativo de ler.

/** Qual doodle, nomeado pelo MOMENTO e não pelo desenho — o desenho pode ser trocado depois. */
export type EmptyArt = 'comecando' | 'esperando' | 'conectar' | 'comemorando';

const ART_FILE: Record<EmptyArt, string> = {
  comecando: '/doodles/unboxing.svg',
  esperando: '/doodles/sitting-reading.svg',
  conectar: '/doodles/selfie.svg',
  comemorando: '/doodles/dancing.svg',
};

export function EmptyState({
  size = 'md',
  bordered = false,
  art,
  title,
  action,
  className,
  children,
}: {
  size?: 'sm' | 'md';
  bordered?: boolean;
  art?: EmptyArt;
  /** A frase principal. Sem ela o bloco continua como antes: só o texto de `children`. */
  title?: React.ReactNode;
  /** O próximo passo. Um vazio que não diz o que fazer resolve metade do problema. */
  action?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  const showArt = !!art;

  return (
    <div
      className={cn(
        'text-center',
        size === 'md' ? 'px-4 py-12' : 'py-6 text-xs',
        bordered && 'rounded-lg border border-dashed px-4',
        className
      )}
    >
      {showArt && (
        <div
          className={cn(
            'relative mx-auto grid place-items-center',
            size === 'md' ? 'mb-6 size-40 sm:size-48' : 'mb-3 size-24'
          )}
        >
          <div aria-hidden className="absolute inset-0 rounded-full bg-secondary" />
          {/* alt vazio + aria-hidden: é decoração. O texto abaixo carrega a informação, e descrever
              o desenho só faria o leitor de tela repetir o assunto. */}
          <img
            src={ART_FILE[art]}
            alt=""
            aria-hidden
            draggable={false}
            className={cn(
              'animate-float relative w-auto select-none',
              size === 'md' ? 'h-28 sm:h-32' : 'h-16'
            )}
          />
        </div>
      )}

      {title && (
        <p className={cn('font-semibold text-foreground', size === 'md' ? 'text-lg' : 'text-sm')}>{title}</p>
      )}
      {children && (
        <div
          className={cn(
            'mx-auto max-w-md text-muted-foreground',
            size === 'md' ? 'text-sm' : 'text-xs',
            title && 'mt-1.5'
          )}
        >
          {children}
        </div>
      )}
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}
