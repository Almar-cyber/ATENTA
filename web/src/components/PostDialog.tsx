import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { Post, Target } from '@/lib/types';
import { PLATFORM_LABELS, STATUS_META } from '@/lib/platforms';
import { fmtDateTime } from '@/lib/format';
import { cancelTarget, queueTarget } from '@/lib/api';
import { requestPrefill, requestEdit } from '@/lib/composer-bus';
import { useScheduler } from '@/store';
import { PostPreview } from './PostPreview';
import { PlatformAvatar } from './PlatformAvatar';
import { InlineAlert } from '@/components/ui/inline-alert';

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
  // Same status logic as the server's PATCH guard — never show an edit affordance for a post
  // the server would reject anyway (one target past 'queued' locks the whole post).
  const canEdit = post ? post.targets.every((t) => t.status === 'draft' || t.status === 'queued') : false;

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
      <DialogContent className="max-h-[88vh] overflow-hidden p-0 sm:max-w-2xl">
        {post && target && status && (
          <div className="flex max-h-[88vh] flex-col md:flex-row">
            {/* Left: details + actions */}
            <div className="flex min-w-0 flex-1 flex-col">
              <DialogHeader className="border-b px-5 py-4">
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  <PlatformAvatar platform={target.platform} size="sm" />
                  <span className="truncate">{PLATFORM_LABELS[target.platform]} — {target.account_name}</span>
                  <Badge className={status.className} variant="secondary">
                    {status.label}
                  </Badge>
                </DialogTitle>
              </DialogHeader>

              <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
                <div className="text-sm">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quando</div>
                  <div className="mt-0.5">{fmtDateTime(post.scheduled_for)}</div>
                </div>

                {(target.caption_override ?? post.body) && (
                  <div className="text-sm">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Legenda</div>
                    <p className="mt-0.5 whitespace-pre-wrap break-words">{target.caption_override ?? post.body}</p>
                  </div>
                )}

                {target.status === 'published' && target.external_url && (
                  <a href={target.external_url} target="_blank" rel="noopener noreferrer" className="inline-block text-sm font-medium text-accent-foreground underline">
                    ver post publicado ↗
                  </a>
                )}
                {target.last_error && (
                  <InlineAlert>{target.last_error}</InlineAlert>
                )}
              </div>

              <div className="flex flex-wrap gap-2 border-t px-5 py-4">
                {canEdit && (
                  <Button
                    onClick={() => {
                      requestEdit({ post });
                      onClose();
                    }}
                  >
                    Editar
                  </Button>
                )}
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
                    Cancelar
                  </Button>
                )}
              </div>
            </div>

            {/* Right: preview */}
            <div className="flex shrink-0 flex-col border-t bg-muted/30 px-5 py-4 md:w-80 md:border-l md:border-t-0">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Como vai ficar</div>
              <div className="flex flex-1 items-start justify-center overflow-y-auto">
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
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
