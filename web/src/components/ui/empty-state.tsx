import type * as React from 'react';
import { cn } from '@/lib/utils';

// Estados vazios estavam escritos em 6 lugares com 3 escalas de texto diferentes. Um só formato:
// `sm` pra dentro de um card/coluna, `md` pra área de conteúdo inteira.
export function EmptyState({
  size = 'md',
  bordered = false,
  className,
  children,
}: {
  size?: 'sm' | 'md';
  bordered?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <p
      className={cn(
        'text-center text-muted-foreground',
        size === 'md' ? 'py-10 text-sm' : 'py-6 text-xs',
        bordered && 'rounded-lg border border-dashed px-4',
        className
      )}
    >
      {children}
    </p>
  );
}
