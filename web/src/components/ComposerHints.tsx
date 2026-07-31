import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle } from 'lucide-react';

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
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
          >
            <AlertCircle className="mt-px size-3.5 shrink-0" />
            <div className="space-y-0.5">
              {problems.map((h) => (
                <p key={h}>{h}</p>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
