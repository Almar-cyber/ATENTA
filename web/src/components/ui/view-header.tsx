import type * as React from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CardHeader, CardTitle } from '@/components/ui/card';

// Cabeçalho das telas de segundo nível (Insights, Conexões, e as que vierem).
//
// POR QUE UM COMPONENTE: cada tela montava o seu, e eles divergiram — em uma o título ficava colado
// na seta, na outra a seta ficava numa linha própria; as descrições tinham escalas diferentes. Nada
// disso era decisão, era repetição envelhecendo em paralelo.
//
// ARMADILHA que motivou isto: o CardHeader do preset é GRID, não flex. Passar `flex-row` muda a
// direção sem mudar o display, e cada filho vira uma LINHA — foi assim que o botão de ação da tela
// de Insights foi parar embaixo do título. Aqui o `flex` é explícito, num lugar só.

export function ViewHeader({
  title,
  description,
  onBack,
  actions,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  onBack?: () => void;
  /** Controles à direita, alinhados com o título na mesma linha. */
  actions?: React.ReactNode;
}) {
  return (
    <CardHeader className="flex items-center gap-3 space-y-0">
      {onBack && (
        <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label="Voltar">
          <ArrowLeft className="size-4" />
        </Button>
      )}
      <div className="min-w-0">
        <CardTitle>{title}</CardTitle>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </CardHeader>
  );
}
