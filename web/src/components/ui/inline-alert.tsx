import type * as React from 'react';
import { AlertCircle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

// Havia cinco vermelhos diferentes pro mesmo estado de erro (bg-red-50, red-100, red-100/70,
// red-500/10, red-500/15) e um azul avulso pro aviso de edição. Um componente, dois tons.
const TONES = {
  danger: {
    box: 'border-destructive/25 bg-destructive/10 text-destructive',
    Icon: AlertCircle,
  },
  info: {
    box: 'border-border bg-muted text-foreground',
    Icon: Info,
  },
} as const;

export function InlineAlert({
  tone = 'danger',
  icon = true,
  className,
  children,
}: {
  tone?: keyof typeof TONES;
  icon?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const { box, Icon } = TONES[tone];
  return (
    <div className={cn('flex gap-2 rounded-lg border px-3 py-2 text-xs', box, className)}>
      {icon && <Icon className="mt-px size-3.5 shrink-0" />}
      <div className="min-w-0 space-y-0.5">{children}</div>
    </div>
  );
}
