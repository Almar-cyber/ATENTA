import { AnimatePresence, motion } from 'motion/react';
import { InlineAlert } from '@/components/ui/inline-alert';

// Dicas de validação do compositor. Antes era um <p> solto por mensagem, com as classes decididas
// por `includes()` no meio do JSX — o que destoava do resto (parecia texto sem estilo).
// Aqui a separação é explícita: contadores de caracteres ficam discretos numa linha só, e os
// problemas viram um bloco de alerta com ícone, no mesmo tratamento do AlertBanner/PostDialog.
const PROBLEM_MARKERS = ['⚠', 'exige', 'máximo', 'apenas', 'muito'];

function isProblem(hint: string): boolean {
  return PROBLEM_MARKERS.some((m) => hint.includes(m));
}

export function ComposerHints({ hints }: { hints: string[] }) {
  if (hints.length === 0) return null;
  const problems = hints.filter(isProblem);
  const counters = hints.filter((h) => !isProblem(h));

  return (
    <div className="space-y-2">
      {counters.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          {counters.map((h) => (
            <span key={h}>{h}</span>
          ))}
        </div>
      )}

      <AnimatePresence>
        {problems.length > 0 && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <InlineAlert>
              {problems.map((h) => (
                <p key={h}>{h}</p>
              ))}
            </InlineAlert>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
