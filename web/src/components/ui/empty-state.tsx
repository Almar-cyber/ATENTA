import type * as React from 'react';
import { cn } from '@/lib/utils';

// Estados vazios estavam escritos em 6 lugares com 3 escalas de texto diferentes. Um só formato:
// `sm` pra dentro de um card/coluna, `md` pra área de conteúdo inteira.
//
// ILUSTRAÇÃO: uma tela vazia é o primeiro contato de quem acabou de entrar, e uma linha de texto
// cinza no meio do branco parece defeito. O doodle diz "está tudo certo, é só cedo". São os mesmos
// Open Doodles da landing (CC0, recoloridos pro par roxo/amarelo) — ver web/doodles-license.md.
//
// SVG COM ANIMAÇÃO EM CSS, e não GIF: pesa uma fração, escala sem serrilhar e — o que importa mais
// — obedece a `prefers-reduced-motion`. GIF não tem como parar.
//
// Só no tamanho `md`: dentro de um card ou de uma coluna estreita a arte espremeria o texto.

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
  className,
  children,
}: {
  size?: 'sm' | 'md';
  bordered?: boolean;
  art?: EmptyArt;
  className?: string;
  children: React.ReactNode;
}) {
  const showArt = art && size === 'md';

  return (
    <div
      className={cn(
        'text-center text-muted-foreground',
        size === 'md' ? 'py-10 text-sm' : 'py-6 text-xs',
        bordered && 'rounded-lg border border-dashed px-4',
        className
      )}
    >
      {showArt && (
        // alt vazio + aria-hidden: é decoração. O texto logo abaixo é que carrega a informação, e
        // descrever o desenho só faria o leitor de tela repetir o assunto.
        <img
          src={ART_FILE[art]}
          alt=""
          aria-hidden
          draggable={false}
          className="animate-float mx-auto mb-5 h-28 w-auto select-none sm:h-32"
        />
      )}
      {children}
    </div>
  );
}
