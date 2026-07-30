import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useScheduler } from '@/store';
import { onPrefill, onPrefillDate, onEdit } from '@/lib/composer-bus';
import { createPost, updatePost, uploadMedia } from '@/lib/api';
import type { CreatePostPayload } from '@/lib/api';
import { fmtBytes, fmtDuration, isoToLocalInput, localToIso } from '@/lib/format';
import { readMediaMetadata } from '@/lib/mediaMetadata';
import type { QueuedMedia } from '@/lib/types';
import {
  ALLOWED_MIME_TYPES,
  INSTAGRAM_STORY_VIDEO_LIMITS,
  PLATFORM_CAPTION_LIMITS,
  PLATFORM_LABELS,
  PLATFORM_MEDIA_MAX,
  PLATFORM_MULTI_IMAGE_ONLY,
  PLATFORM_REQUIRES_MEDIA,
  PLATFORM_VIDEO_LIMITS,
  YOUTUBE_LONG_VIDEO_WARN_SECONDS,
  isVideoMime,
} from '@/lib/platforms';
import { PostPreview } from './PostPreview';
import { MediaQueueGrid } from './MediaQueueGrid';
import { AccountPicker } from './AccountPicker';

function newKey() {
  return crypto.randomUUID();
}

export function PostComposer() {
  const { accounts, accountsById, reload } = useScheduler();

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [scheduledLocal, setScheduledLocal] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [queue, setQueue] = useState<QueuedMedia[]>([]);
  const [isStory, setIsStory] = useState(false);
  const [ytPrivacy, setYtPrivacy] = useState('');
  const [pinBoard, setPinBoard] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  // Per-account caption customization (Feature B): presence of a key means that account diverges
  // from the shared `body`; absence means it uses `body` as-is.
  const [captionOverrides, setCaptionOverrides] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  // Prefill from a "duplicar" request coming out of any view.
  useEffect(() => {
    return onPrefill(({ post, target }) => {
      setTitle(post.title ?? '');
      setBody(target.caption_override ?? post.body ?? '');
      setScheduledLocal('');
      setSelected(new Set([target.account_id]));
      setYtPrivacy((target.options?.privacyStatus as string) ?? '');
      setPinBoard((target.options?.board_id as string) ?? '');
      setIsStory(!!target.options?.as_story);
      setQueue(
        (target.media ?? []).map((m) => ({
          key: newKey(),
          assetId: m.id,
          name: (m.storage_key || 'mídia').replace(/^[0-9a-f-]{36}-/, ''),
          mime_type: m.mime_type,
          public_url: m.public_url,
          duration_seconds: m.duration_seconds ?? undefined,
          width: m.width ?? undefined,
          height: m.height ?? undefined,
        }))
      );
      toast.success('Post duplicado — escolha uma nova data.');
      document.getElementById('composer-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  // Load an existing post into the form for in-place editing ("editar"), across ALL its targets
  // — unlike onPrefill (duplicar) above, which only prefills from the single target clicked.
  useEffect(() => {
    return onEdit(({ post }) => {
      setEditingPostId(post.id);
      setTitle(post.title ?? '');
      setBody(post.body ?? '');
      setScheduledLocal(isoToLocalInput(post.scheduled_for));
      setSelected(new Set(post.targets.map((t) => t.account_id)));
      setYtPrivacy((post.targets.find((t) => t.platform === 'youtube')?.options?.privacyStatus as string) ?? '');
      setPinBoard((post.targets.find((t) => t.platform === 'pinterest')?.options?.board_id as string) ?? '');
      setIsStory(post.targets.some((t) => !!t.options?.as_story));
      setQueue(
        (post.targets[0]?.media ?? []).map((m) => ({
          key: newKey(),
          assetId: m.id,
          name: (m.storage_key || 'mídia').replace(/^[0-9a-f-]{36}-/, ''),
          mime_type: m.mime_type,
          public_url: m.public_url,
          duration_seconds: m.duration_seconds ?? undefined,
          width: m.width ?? undefined,
          height: m.height ?? undefined,
        }))
      );
      setCaptionOverrides(
        Object.fromEntries(
          post.targets.filter((t) => t.caption_override != null).map((t) => [t.account_id, t.caption_override as string])
        )
      );
      toast.success('Editando post — altere e salve.');
      document.getElementById('composer-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  // A click on an empty calendar day just sets the datetime.
  useEffect(() => {
    return onPrefillDate((local) => {
      setScheduledLocal(local);
      document.getElementById('f-body')?.focus();
      document.getElementById('composer-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  async function onPickFiles(files: FileList | null) {
    if (!files) return;
    const rejected: string[] = [];
    const accepted: File[] = [];
    Array.from(files).forEach((file) => {
      if (!ALLOWED_MIME_TYPES.includes(file.type)) {
        rejected.push(`${file.name} (${file.type || 'tipo desconhecido'})`);
        return;
      }
      accepted.push(file);
    });
    if (rejected.length) {
      toast.error(`Não suportado: ${rejected.join(', ')}. Use JPEG, PNG, MP4 ou MOV — RAW de câmera precisa ser exportado antes.`);
    }
    if (fileRef.current) fileRef.current.value = '';
    if (accepted.length === 0) return;
    const add: QueuedMedia[] = await Promise.all(
      accepted.map(async (file) => ({ key: newKey(), file, name: file.name, mime_type: file.type, ...(await readMediaMetadata(file)) }))
    );
    setQueue((q) => [...q, ...add]);
  }

  // Replaces the media in one carousel slot without disturbing the others' order — distinct
  // from remove+re-add, which would drop the new file at the end of the queue instead.
  async function replaceMedia(key: string, file: File) {
    const meta = await readMediaMetadata(file);
    setQueue((q) => q.map((item) => (item.key === key ? { key: newKey(), file, name: file.name, mime_type: file.type, ...meta } : item)));
  }

  function resetForm() {
    setTitle('');
    setBody('');
    setScheduledLocal('');
    setSelected(new Set());
    setQueue([]);
    setIsStory(false);
    setYtPrivacy('');
    setPinBoard('');
    setCaptionOverrides({});
  }

  const selectedAccounts = useMemo(
    () => Array.from(selected).map((id) => accountsById[id]).filter(Boolean),
    [selected, accountsById]
  );

  const hints = useMemo(() => {
    const out: string[] = [];
    if (selectedAccounts.length === 0) return out;
    const count = queue.length;
    const hasVideo = queue.some((q) => isVideoMime(q.mime_type));
    for (const a of selectedAccounts) {
      const name = PLATFORM_LABELS[a.platform];
      const effectiveCaption = captionOverrides[a.id] ?? body;
      const limit = PLATFORM_CAPTION_LIMITS[a.platform];
      if (limit != null) out.push(`${name}: ${effectiveCaption.length}/${limit}${effectiveCaption.length > limit ? ' ⚠' : ''}`);
      const requires = PLATFORM_REQUIRES_MEDIA[a.platform];
      if (requires && count === 0) out.push(`${name} exige ${requires} — anexe um arquivo`);
      const max = PLATFORM_MEDIA_MAX[a.platform];
      if (count > max) out.push(`${name} aceita no máximo ${max} ${max === 1 ? 'arquivo' : 'arquivos'} (você anexou ${count})`);
      if (count > 1 && hasVideo && PLATFORM_MULTI_IMAGE_ONLY[a.platform]) out.push(`${name}: carrossel aceita apenas imagens — vídeo só sozinho`);
      if (count > 1 && a.platform === 'instagram' && isStory) out.push(`${name}: Story aceita apenas um arquivo`);

      const videoLimits = a.platform === 'instagram' && isStory ? INSTAGRAM_STORY_VIDEO_LIMITS : PLATFORM_VIDEO_LIMITS[a.platform];
      if (videoLimits) {
        for (const item of queue) {
          if (!isVideoMime(item.mime_type)) continue;
          const dur = item.duration_seconds;
          if (dur != null && videoLimits.minDurationSeconds != null && dur < videoLimits.minDurationSeconds) {
            out.push(`${name}: vídeo muito curto (${fmtDuration(dur)}, mínimo ${fmtDuration(videoLimits.minDurationSeconds)})`);
          }
          if (dur != null && videoLimits.maxDurationSeconds != null && dur > videoLimits.maxDurationSeconds) {
            out.push(`${name}: vídeo muito longo (${fmtDuration(dur)}, máximo ${fmtDuration(videoLimits.maxDurationSeconds)})`);
          }
          const size = item.file?.size;
          if (size != null && videoLimits.maxSizeBytes != null && size > videoLimits.maxSizeBytes) {
            out.push(`${name}: arquivo muito grande (${fmtBytes(size)}, máximo ${fmtBytes(videoLimits.maxSizeBytes)})`);
          }
          if (a.platform === 'youtube' && dur != null && dur > YOUTUBE_LONG_VIDEO_WARN_SECONDS) {
            out.push(`${name}: vídeos acima de 15min precisam de conta verificada`);
          }
        }
      }
    }
    return out;
  }, [selectedAccounts, body, queue, isStory, captionOverrides]);

  async function submit(asDraft: boolean) {
    if (selected.size === 0) return toast.error('Selecione ao menos uma conta de destino.');
    if (!scheduledLocal) return toast.error('Informe data/hora do agendamento.');

    setSubmitting(true);
    try {
      const mediaIds: string[] = [];
      for (const item of queue) {
        if (item.assetId) mediaIds.push(item.assetId);
        else if (item.file) {
          const meta = { duration_seconds: item.duration_seconds, width: item.width, height: item.height };
          mediaIds.push((await uploadMedia(item.file, meta)).id);
        }
      }
      const payload: CreatePostPayload = {
        title: title || undefined,
        body,
        scheduled_for: localToIso(scheduledLocal),
        target_account_ids: Array.from(selected),
        media_asset_ids: mediaIds.length ? mediaIds : undefined,
        youtube_privacy_status: ytPrivacy || undefined,
        pinterest_board_id: pinBoard || undefined,
        instagram_as_story: isStory || undefined,
        save_as: asDraft ? 'draft' : undefined,
        target_caption_overrides: Object.keys(captionOverrides).length ? captionOverrides : undefined,
      };
      if (editingPostId) {
        await updatePost(editingPostId, payload);
      } else {
        await createPost(payload);
      }
      toast.success(editingPostId ? 'Post atualizado.' : asDraft ? 'Rascunho salvo.' : 'Post agendado com sucesso.');
      resetForm();
      setEditingPostId(null);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card id="composer-card" className="sticky top-4">
      <CardHeader>
        <CardTitle>Novo post</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {editingPostId && (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-500/30 dark:bg-amber-500/10">
            <span>Editando post agendado</span>
            <Button
              type="button"
              variant="link"
              size="xs"
              className="h-auto p-0"
              onClick={() => {
                setEditingPostId(null);
                resetForm();
              }}
            >
              Cancelar edição
            </Button>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="f-title">Título (opcional, usado no YouTube)</Label>
          <Input id="f-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="f-body">Legenda</Label>
          <Textarea id="f-body" value={body} onChange={(e) => setBody(e.target.value)} className="min-h-24" />
          <AnimatePresence>
            {hints.map((h) => (
              <motion.p
                key={h}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className={`text-xs ${h.includes('⚠') || h.includes('exige') || h.includes('máximo') || h.includes('apenas') || h.includes('muito') ? 'font-medium text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}
              >
                {h}
              </motion.p>
            ))}
          </AnimatePresence>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="f-when">Quando publicar</Label>
          <Input id="f-when" type="datetime-local" value={scheduledLocal} onChange={(e) => setScheduledLocal(e.target.value)} />
        </div>

        <div className="space-y-2">
          <Label>Contas de destino</Label>
          <AccountPicker accounts={accounts} selected={selected} onChange={setSelected} />
        </div>

        {selectedAccounts.length >= 2 && (
          <div className="space-y-2 border-t pt-3">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Legendas por conta (opcional)
            </Label>
            <div className="space-y-2">
              {selectedAccounts.map((a) => {
                const override = captionOverrides[a.id];
                const hasOverride = override !== undefined;
                return (
                  <div key={a.id} className="space-y-1">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-muted-foreground">
                        {PLATFORM_LABELS[a.platform]} — {a.display_name}
                      </span>
                      {hasOverride ? (
                        <Button
                          type="button"
                          variant="link"
                          size="xs"
                          className="h-auto p-0"
                          onClick={() =>
                            setCaptionOverrides((prev) => {
                              const next = { ...prev };
                              delete next[a.id];
                              return next;
                            })
                          }
                        >
                          Usar legenda padrão
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="link"
                          size="xs"
                          className="h-auto p-0"
                          onClick={() => setCaptionOverrides((prev) => ({ ...prev, [a.id]: body }))}
                        >
                          Personalizar legenda
                        </Button>
                      )}
                    </div>
                    {hasOverride && (
                      <Textarea
                        value={override}
                        onChange={(e) => setCaptionOverrides((prev) => ({ ...prev, [a.id]: e.target.value }))}
                        className="min-h-16 text-sm"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="f-media">Mídia (imagem ou vídeo, opcional)</Label>
          <Input
            id="f-media"
            ref={fileRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,video/mp4,video/quicktime"
            onChange={(e) => onPickFiles(e.target.files)}
          />
          <p className="text-xs text-muted-foreground">
            Selecione 2+ imagens para criar um carrossel. JPEG, PNG, MP4 ou MOV. Arraste pra
            reordenar, ou passe o mouse num item pra trocar/remover.
          </p>
          <MediaQueueGrid
            items={queue}
            onReorder={setQueue}
            onRemove={(key) => setQueue((q) => q.filter((i) => i.key !== key))}
            onReplace={replaceMedia}
          />
        </div>

        {selectedAccounts.some((a) => a.platform === 'instagram') && (
          <label className="flex items-center gap-2 text-sm font-medium">
            <Checkbox checked={isStory} onCheckedChange={(v) => setIsStory(!!v)} />
            Publicar como Story (Instagram)
          </label>
        )}

        {selectedAccounts.some((a) => a.platform === 'youtube') && (
          <div className="space-y-1.5">
            <Label>Privacidade (YouTube)</Label>
            <Select value={ytPrivacy || 'default'} onValueChange={(v) => setYtPrivacy(v === 'default' ? '' : v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">padrão (unlisted)</SelectItem>
                <SelectItem value="public">public</SelectItem>
                <SelectItem value="unlisted">unlisted</SelectItem>
                <SelectItem value="private">private</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {selectedAccounts.some((a) => a.platform === 'pinterest') && (
          <div className="space-y-1.5">
            <Label htmlFor="f-board">Board ID (Pinterest, opcional)</Label>
            <Input id="f-board" value={pinBoard} onChange={(e) => setPinBoard(e.target.value)} placeholder="usa o board padrão da conta se vazio" />
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <Button onClick={() => submit(false)} disabled={submitting}>
            {submitting ? (editingPostId ? 'Salvando…' : 'Agendando…') : editingPostId ? 'Salvar alterações' : 'Agendar post'}
          </Button>
          <Button variant="outline" onClick={() => submit(true)} disabled={submitting}>
            Salvar como rascunho
          </Button>
        </div>

        <AnimatePresence>
          {selectedAccounts.length > 0 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3 border-t pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pré-visualização</p>
              <div className="flex flex-wrap gap-3">
                {selectedAccounts.map((a) => (
                  <PostPreview
                    key={a.id}
                    input={{
                      platform: a.platform,
                      accountName: a.display_name,
                      caption: captionOverrides[a.id] ?? body,
                      title,
                      media: queue,
                      isStory,
                    }}
                  />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}
