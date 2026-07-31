import { AnimatePresence, motion } from 'motion/react';
import { InlineAlert } from '@/components/ui/inline-alert';

// Cada dica sabe a qual campo pertence, pra ser renderizada junto dele (o aviso de mídia embaixo do
// seletor de arquivos, o de legenda embaixo do textarea) em vez de tudo amontoado num bloco só.
export interface Hint {
  field: 'caption' | 'media';
  problem: boolean;
  text: string;
}

export function ComposerHints({ hints, field }: { hints: Hint[]; field: Hint['field'] }) {
  const mine = hints.filter((h) => h.field === field);
  if (mine.length === 0) return null;
  const problems = mine.filter((h) => h.problem);
  const counters = mine.filter((h) => !h.problem);

  return (
    <div className="space-y-2">
      {counters.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          {counters.map((h) => (
            <span key={h.text}>{h.text}</span>
          ))}
        </div>
      )}

      <AnimatePresence>
        {problems.length > 0 && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <InlineAlert>
              {problems.map((h) => (
                <p key={h.text}>{h.text}</p>
              ))}
            </InlineAlert>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
