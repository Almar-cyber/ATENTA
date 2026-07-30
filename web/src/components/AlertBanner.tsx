import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle } from 'lucide-react';
import { useScheduler } from '@/store';

export function AlertBanner({ onSeeFailures }: { onSeeFailures: () => void }) {
  const { posts, accounts } = useScheduler();

  let failed = 0;
  for (const p of posts) for (const t of p.targets) if (t.status === 'failed' || t.status === 'ambiguous') failed++;
  const reauth = accounts.filter((a) => a.status === 'needs_reauth').length;

  const parts: string[] = [];
  if (failed > 0) parts.push(`${failed} ${failed === 1 ? 'post falhou' : 'posts falharam'}`);
  if (reauth > 0) parts.push(`${reauth} ${reauth === 1 ? 'conta precisa reautenticar' : 'contas precisam reautenticar'}`);
  const show = parts.length > 0;

  return (
    <AnimatePresence>
      {show && (
        <motion.button
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          onClick={() => failed > 0 && onSeeFailures()}
          className="flex w-full items-center gap-2 border-b border-red-200 bg-red-50 px-6 py-2.5 text-sm font-medium text-red-800 hover:bg-red-100 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
        >
          <AlertTriangle className="size-4" />
          {parts.join(' · ')}
          {failed > 0 && <span className="underline">— ver</span>}
        </motion.button>
      )}
    </AnimatePresence>
  );
}
