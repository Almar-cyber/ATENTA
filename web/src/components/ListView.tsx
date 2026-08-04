import { Fragment, useMemo } from 'react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import type { Post, Target } from '@/lib/types';
import { PLATFORM_LABELS, STATUS_META } from '@/lib/platforms';
import { fmtDateTime, fmtDayHeader, dayKey } from '@/lib/format';
import { cancelTarget, deleteTarget, queueTarget, reactivateTarget } from '@/lib/api';
import { Plus } from 'lucide-react';
import { requestPrefill, requestPrefillDate } from '@/lib/composer-bus';
import { useScheduler } from '@/store';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Thumb } from './Thumb';
import { EmptyState } from '@/components/ui/empty-state';
import { PlatformAvatar } from './PlatformAvatar';
import type { DialogSelection } from './PostDialog';

// Status que dá pra trazer de volta pra rascunho. 'ambiguous' entra porque é exatamente o caso em
// que não se sabe se publicou: a pessoa confere na rede e decide reativar ou excluir.
const REVIVABLE = new Set<Target['status']>(['canceled', 'failed', 'ambiguous']);

export function ListView({ posts, onOpen }: { posts: Post[]; onOpen: (s: DialogSelection) => void }) {
  const { reload } = useScheduler();

  const rows = useMemo(() => {
    const out: Array<{ dayHeader?: string; post: Post; target: Target }> = [];
    let lastDay = '';
    for (const post of posts) {
      const k = dayKey(new Date(post.scheduled_for));
      let headerUsed = false;
      for (const target of post.targets) {
        const entry: { dayHeader?: string; post: Post; target: Target } = { post, target };
        if (!headerUsed && k !== lastDay) {
          entry.dayHeader = fmtDayHeader(post.scheduled_for);
          lastDay = k;
          headerUsed = true;
        }
        out.push(entry);
      }
    }
    return out;
  }, [posts]);

  async function act(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      toast.success(ok);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  if (posts.length === 0) {
    // O botão reaproveita o mesmo caminho do clique num dia vazio do calendário: pedir uma data
    // abre o compositor. Um vazio que não oferece o próximo passo resolve metade do problema.
    const daqui = new Date(Date.now() + 60 * 60 * 1000);
    const local = new Date(daqui.getTime() - daqui.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    return (
      <EmptyState
        art="comecando"
        title="Nada agendado ainda"
        action={
          <Button size="lg" onClick={() => requestPrefillDate(local)}>
            <Plus className="size-4" />
            Criar o primeiro post
          </Button>
        }
      >
        O que você agendar aparece aqui, agrupado por dia — com a prévia de como vai ficar em cada
        rede.
      </EmptyState>
    );
  }

  return (
    <div className="h-full space-y-4 overflow-y-auto pb-2 pr-0.5">
      {rows.map(({ dayHeader, post, target }, i) => (
        <Fragment key={target.id}>
          {dayHeader && (
            <div className={`text-sm font-semibold text-foreground ${i === 0 ? '' : 'pt-2'}`}>{dayHeader}</div>
          )}
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i * 0.015, 0.3) }}
            className={`group/row flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg px-3 py-3 transition-colors ${target.status === 'failed' || target.status === 'ambiguous' ? 'bg-destructive/10 hover:bg-destructive/15' : 'bg-muted/60 hover:bg-muted'}`}
          >
            <PlatformAvatar platform={target.platform} />
            <div className="min-w-0 flex-1">
              <button
                onClick={() => onOpen({ post, target })}
                className="block max-w-full truncate text-left text-sm font-medium hover:underline"
                title={target.caption_override ?? post.body ?? ''}
              >
                {target.caption_override ?? post.body ?? <span className="text-muted-foreground">(sem legenda)</span>}
              </button>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {fmtDateTime(post.scheduled_for)} · {PLATFORM_LABELS[target.platform]}
              </div>
            </div>
            <div className="flex w-12 shrink-0 items-center gap-1">
              {target.media.slice(0, 1).map((m) => (
                <Thumb key={m.id} media={m} />
              ))}
              {target.media.length > 1 && <span className="text-xs text-muted-foreground">+{target.media.length - 1}</span>}
            </div>
            {/* Badge + ações num grupo: no mobile ocupa a largura toda (desce pra 2ª linha) e o
                conjunto flui/quebra alinhado à direita; no desktop fica inline à direita como antes. */}
            <div className="flex w-full flex-wrap items-center justify-end gap-x-2 gap-y-1 sm:w-auto">
            <Badge className={`${STATUS_META[target.status].className} shrink-0`} variant="secondary">
              {STATUS_META[target.status].label}
            </Badge>
            {/* Ações são terciárias: no desktop ficam discretas e só ganham cor no hover da linha;
                no mobile ficam sempre visíveis (não há hover no touch). Antes o "Cancelar"
                (destrutivo, raro) era o mais pesado da linha e o "Duplicar" quase sumia. */}
            <div className="flex flex-wrap justify-end gap-1 opacity-100 transition-opacity sm:opacity-60 sm:group-hover/row:opacity-100">
              {target.status === 'draft' && (
                <Button size="sm" variant="ghost" onClick={() => act(() => queueTarget(target.id), 'Movido para a fila.')}>
                  p/ fila
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => requestPrefill({ post, target })}>
                Duplicar
              </Button>
              {(target.status === 'draft' || target.status === 'queued') && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => act(() => cancelTarget(target.id), 'Cancelado.')}
                >
                  Cancelar
                </Button>
              )}
              {/* Cancelado/falhou não é fim de linha: dá pra trazer de volta como rascunho, ou
                  apagar de vez — antes ficava parado na lista sem nenhuma das duas saídas. */}
              {REVIVABLE.has(target.status) && (
                <Button size="sm" variant="ghost" onClick={() => act(() => reactivateTarget(target.id), 'De volta como rascunho.')}>
                  Reativar
                </Button>
              )}
              {target.status !== 'publishing' && target.status !== 'processing' && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => act(() => deleteTarget(target.id), 'Excluído.')}
                >
                  Excluir
                </Button>
              )}
            </div>
            </div>
          </motion.div>
        </Fragment>
      ))}
    </div>
  );
}
