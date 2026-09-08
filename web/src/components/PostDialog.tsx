import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { MoreHorizontal } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { Post, Target } from '@/lib/types';
import { PLATFORM_LABELS, STATUS_META, igFormatOf, igTrialOf } from '@/lib/platforms';
import { fmtDateTime } from '@/lib/format';
import { cancelTarget, deleteTarget, queueTarget, reactivateTarget } from '@/lib/api';
import { requestPrefill, requestEdit } from '@/lib/composer-bus';
import { useScheduler } from '@/store';
import { PostPreview } from './PostPreview';
import { PlatformAvatar } from './PlatformAvatar';
import { InlineAlert } from '@/components/ui/inline-alert';

export interface DialogSelection {
  post: Post;
  target: Target;
}

// Espelha o guard do PATCH no servidor: cancelado e falhou continuam editáveis de propósito — é o
// caso de reaproveitar a peça em vez de refazer.
const EDITABLE = new Set<Target['status']>(['draft', 'queued', 'canceled', 'failed']);
const REVIVABLE = new Set<Target['status']>(['canceled', 'failed', 'ambiguous']);

export function PostDialog({ selection, onClose }: { selection: DialogSelection | null; onClose: () => void }) {
  const { reload } = useScheduler();
  const open = selection !== null;
  const post = selection?.post;
  const target = selection?.target;
  const status = target ? STATUS_META[target.status] : null;
  // Same status logic as the server's PATCH guard — never show an edit affordance for a post
  // the server would reject anyway (one target past 'queued' locks the whole post).
  const canEdit = post ? post.targets.every((t) => EDITABLE.has(t.status)) : false;
  const revivable = target ? REVIVABLE.has(target.status) : false;

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
          {/* NO CELULAR ROLA O MODAL INTEIRO; no desktop cada coluna rola por dentro. Empilhado,
              as duas colunas tinham scroll próprio e a de baixo era `shrink-0` — o que passasse de
              88vh ficava CORTADO, sem jeito de alcançar: o rodapé da pré-visualização sumia atrás
              da borda e girar o aparelho não ajudava (a orientação costuma estar travada). Mesmo
              padrão que o `PostComposer` já usa. */}
        {post && target && status && (
          <div className="flex max-h-[88vh] flex-col overflow-y-auto md:flex-row md:overflow-hidden">
            {/* Left: details + actions */}
            <div className="flex min-w-0 flex-col md:min-h-0 md:flex-1">
              <DialogHeader className="border-b px-5 py-4">
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  <PlatformAvatar platform={target.platform} size="sm" />
                  <span className="truncate">{PLATFORM_LABELS[target.platform]} — {target.account_name}</span>
                  <Badge className={status.className} variant="secondary">
                    {status.label}
                  </Badge>
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4 px-5 py-4 md:min-h-0 md:flex-1 md:overflow-y-auto">
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

                {/* REEL DE TESTE. Sem isto, a pendência do Painel abriria um post que parece
                    qualquer outro — e o passo que falta (abrir pra todo mundo) acontece FORA daqui,
                    dentro do app do Instagram, porque a API não expõe a graduação. Dizer isso é o
                    que evita a pessoa procurar no ATENTA um botão que não pode existir. */}
                {igTrialOf(target.options) && target.status === 'published' && (
                  <InlineAlert tone="info">
                    <p className="font-semibold">Reel de teste</p>
                    <p>
                      Está saindo só pra quem não te segue
                      {target.published_at ? ` desde ${fmtDateTime(target.published_at)}` : ''}, e por isso não
                      aparece no seu perfil nem na grade.
                    </p>
                    <p>
                      {igTrialOf(target.options) === 'SS_PERFORMANCE'
                        ? 'O próprio Instagram abre pra todo mundo se o desempenho justificar — não há nada a fazer aqui.'
                        : 'Abrir pra todo mundo é um passo dentro do app do Instagram: a API não expõe essa ação. Lá também ficam os números do teste comparados aos seus Reels de sempre.'}
                    </p>
                  </InlineAlert>
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

              <div className="flex items-center gap-2 border-t px-5 py-4">
                {/* Hierarquia: UMA ação principal à esquerda (a que faz sentido no estado do
                    post), e as raras/destrutivas num menu "⋯" à direita — antes eram quatro botões
                    concorrendo e quebrando em duas linhas. */}
                {revivable ? (
                  <Button onClick={() => act(() => reactivateTarget(target.id), 'De volta como rascunho.')}>
                    Reativar
                  </Button>
                ) : target.status === 'draft' ? (
                  <Button onClick={() => act(() => queueTarget(target.id), 'Movido para a fila.')}>
                    Mover para fila
                  </Button>
                ) : canEdit ? (
                  <Button
                    onClick={() => {
                      requestEdit({ post });
                      onClose();
                    }}
                  >
                    Editar
                  </Button>
                ) : (
                  <Button onClick={() => requestPrefill({ post, target })}>Duplicar</Button>
                )}

                {(target.status === 'draft' || revivable) && canEdit && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      requestEdit({ post });
                      onClose();
                    }}
                  >
                    Editar
                  </Button>
                )}

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="ml-auto" aria-label="Mais ações">
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {(target.status === 'draft' || canEdit) && (
                      <DropdownMenuItem onClick={() => requestPrefill({ post, target })}>Duplicar</DropdownMenuItem>
                    )}
                    {(target.status === 'draft' || target.status === 'queued') && (
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => act(() => cancelTarget(target.id), 'Post cancelado.')}
                      >
                        Cancelar post
                      </DropdownMenuItem>
                    )}
                    {target.status !== 'publishing' && target.status !== 'processing' && (
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => act(() => deleteTarget(target.id), 'Excluído.')}
                      >
                        Excluir de vez
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Right: preview */}
            <div className="flex shrink-0 flex-col border-t bg-muted/30 px-5 py-4 md:w-80 md:border-l md:border-t-0">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Como vai ficar</div>
              <div className="flex flex-1 items-start justify-center md:overflow-y-auto">
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
                    format: igFormatOf(target.options),
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
