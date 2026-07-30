import { toast } from 'sonner';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { Post, Target } from '@/lib/types';
import { PLATFORM_LABELS, STATUS_META } from '@/lib/platforms';
import { fmtDateTime } from '@/lib/format';
import { cancelTarget, queueTarget } from '@/lib/api';
import { requestPrefill } from '@/lib/composer-bus';
import { useScheduler } from '@/store';
import { PostPreview } from './PostPreview';

export interface DialogSelection {
  post: Post;
  target: Target;
}

export function PostDialog({ selection, onClose }: { selection: DialogSelection | null; onClose: () => void }) {
  const { reload } = useScheduler();
  const open = selection !== null;
  const post = selection?.post;
  const target = selection?.target;
  const status = target ? STATUS_META[target.status] : null;

  async function act(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      toast.success(ok);
      onClose();
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        {post && target && status && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {PLATFORM_LABELS[target.platform]} — {target.account_name}
                <Badge className={status.className} variant="secondary">
                  {status.label}
                </Badge>
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-3">
              <div className="text-sm">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quando</span>
                <div>{fmtDateTime(post.scheduled_for)}</div>
              </div>

              <div>
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Como vai ficar</span>
                <div className="mt-1.5">
                  <PostPreview
                    input={{
                      platform: target.platform,
                      accountName: target.account_name,
                      caption: target.caption_override ?? post.body ?? '',
                      title: post.title ?? undefined,
                      media: (target.media ?? []).map((m) => ({
                        key: m.id,
                        assetId: m.id,
                        name: m.storage_key,
                        mime_type: m.mime_type,
                        public_url: m.public_url,
                      })),
                      isStory: !!target.options?.as_story,
                    }}
                  />
                </div>
              </div>

              {target.status === 'published' && target.external_url && (
                <a href={target.external_url} target="_blank" rel="noopener noreferrer" className="inline-block text-sm text-primary underline">
                  ver post publicado ↗
                </a>
              )}
              {target.last_error && <p className="text-xs text-red-600 dark:text-red-400">{target.last_error}</p>}
            </div>

            <DialogFooter className="flex-wrap gap-2 sm:justify-start">
              <Button variant="outline" onClick={onClose}>
                Fechar
              </Button>
              <Button variant="outline" onClick={() => requestPrefill({ post, target })}>
                Duplicar
              </Button>
              {target.status === 'draft' && (
                <Button variant="secondary" onClick={() => act(() => queueTarget(target.id), 'Movido para a fila.')}>
                  Mover para fila
                </Button>
              )}
              {(target.status === 'draft' || target.status === 'queued') && (
                <Button variant="destructive" onClick={() => act(() => cancelTarget(target.id), 'Post cancelado.')}>
                  Cancelar post
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
