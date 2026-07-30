import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowDown, ArrowUp, X, ImageIcon, Film } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useScheduler } from '@/store';
import { onPrefill, onPrefillDate } from '@/lib/composer-bus';
import { createPost, uploadMedia } from '@/lib/api';
import { localToIso } from '@/lib/format';
import type { QueuedMedia } from '@/lib/types';
import {
  ALLOWED_MIME_TYPES,
  PLATFORM_CAPTION_LIMITS,
  PLATFORM_COLORS,
  PLATFORM_LABELS,
  PLATFORM_MEDIA_MAX,
  PLATFORM_MULTI_IMAGE_ONLY,
  PLATFORM_REQUIRES_MEDIA,
  isVideoMime,
} from '@/lib/platforms';
import { PostPreview } from './PostPreview';

function newKey() {
  return crypto.randomUUID();
}

function PlatformDot({ platform }: { platform: keyof typeof PLATFORM_COLORS }) {
  return <span className="inline-block size-2 shrink-0 rounded-full" style={{ background: PLATFORM_COLORS[platform] }} />;
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
        }))
      );
      toast.success('Post duplicado — escolha uma nova data.');
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

  function toggleAccount(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function onPickFiles(files: FileList | null) {
    if (!files) return;
    const rejected: string[] = [];
    const add: QueuedMedia[] = [];
    Array.from(files).forEach((file) => {
      if (!ALLOWED_MIME_TYPES.includes(file.type)) {
        rejected.push(`${file.name} (${file.type || 'tipo desconhecido'})`);
        return;
      }
      add.push({ key: newKey(), file, name: file.name, mime_type: file.type });
    });
    if (rejected.length) {
      toast.error(`Não suportado: ${rejected.join(', ')}. Use JPEG, PNG, MP4 ou MOV — RAW de câmera precisa ser exportado antes.`);
    }
    if (add.length) setQueue((q) => [...q, ...add]);
    if (fileRef.current) fileRef.current.value = '';
  }

  function moveMedia(idx: number, delta: number) {
    setQueue((q) => {
      const t = idx + delta;
      if (t < 0 || t >= q.length) return q;
      const next = q.slice();
      [next[idx], next[t]] = [next[t], next[idx]];
      return next;
    });
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
      const limit = PLATFORM_CAPTION_LIMITS[a.platform];
      if (limit != null) out.push(`${name}: ${body.length}/${limit}${body.length > limit ? ' ⚠' : ''}`);
      const requires = PLATFORM_REQUIRES_MEDIA[a.platform];
      if (requires && count === 0) out.push(`${name} exige ${requires} — anexe um arquivo`);
      const max = PLATFORM_MEDIA_MAX[a.platform];
      if (count > max) out.push(`${name} aceita no máximo ${max} ${max === 1 ? 'arquivo' : 'arquivos'} (você anexou ${count})`);
      if (count > 1 && hasVideo && PLATFORM_MULTI_IMAGE_ONLY[a.platform]) out.push(`${name}: carrossel aceita apenas imagens — vídeo só sozinho`);
      if (count > 1 && a.platform === 'instagram' && isStory) out.push(`${name}: Story aceita apenas um arquivo`);
    }
    return out;
  }, [selectedAccounts, body, queue, isStory]);

  async function submit(asDraft: boolean) {
    if (selected.size === 0) return toast.error('Selecione ao menos uma conta de destino.');
    if (!scheduledLocal) return toast.error('Informe data/hora do agendamento.');

    setSubmitting(true);
    try {
      const mediaIds: string[] = [];
      for (const item of queue) {
        if (item.assetId) mediaIds.push(item.assetId);
        else if (item.file) mediaIds.push((await uploadMedia(item.file)).id);
      }
      await createPost({
        title: title || undefined,
        body,
        scheduled_for: localToIso(scheduledLocal),
        target_account_ids: Array.from(selected),
        media_asset_ids: mediaIds.length ? mediaIds : undefined,
        youtube_privacy_status: ytPrivacy || undefined,
        pinterest_board_id: pinBoard || undefined,
        instagram_as_story: isStory || undefined,
        save_as: asDraft ? 'draft' : undefined,
      });
      toast.success(asDraft ? 'Rascunho salvo.' : 'Post agendado com sucesso.');
      resetForm();
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
                className={`text-xs ${h.includes('⚠') || h.includes('exige') || h.includes('máximo') || h.includes('apenas') ? 'font-medium text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}
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
          {accounts.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma conta autenticada ainda.</p>}
          {accounts.map((a) => (
            <label key={a.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={selected.has(a.id)}
                disabled={a.status !== 'active'}
                onCheckedChange={() => toggleAccount(a.id)}
              />
              <PlatformDot platform={a.platform} />
              <span>
                {PLATFORM_LABELS[a.platform]} — {a.display_name}
              </span>
              {a.status !== 'active' && (
                <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-[11px] font-medium text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">
                  {a.status === 'needs_reauth' ? 'reautenticar' : 'desativada'}
                </span>
              )}
            </label>
          ))}
        </div>

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
            Selecione 2+ imagens para criar um carrossel. JPEG, PNG, MP4 ou MOV.
          </p>
          <div className="space-y-1.5">
            <AnimatePresence>
              {queue.map((item, idx) => (
                <motion.div
                  key={item.key}
                  layout
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex items-center gap-2 rounded-md border bg-muted/40 px-2 py-1.5 text-xs"
                >
                  <span className="w-4 text-center font-bold text-muted-foreground">{idx + 1}</span>
                  {isVideoMime(item.mime_type) ? <Film className="size-3.5" /> : <ImageIcon className="size-3.5" />}
                  <span className="flex-1 truncate">{item.name}</span>
                  <Button type="button" size="icon" variant="outline" className="size-6" disabled={idx === 0} onClick={() => moveMedia(idx, -1)}>
                    <ArrowUp className="size-3" />
                  </Button>
                  <Button type="button" size="icon" variant="outline" className="size-6" disabled={idx === queue.length - 1} onClick={() => moveMedia(idx, 1)}>
                    <ArrowDown className="size-3" />
                  </Button>
                  <Button type="button" size="icon" variant="outline" className="size-6" onClick={() => setQueue((q) => q.filter((_, i) => i !== idx))}>
                    <X className="size-3" />
                  </Button>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm font-medium">
          <Checkbox checked={isStory} onCheckedChange={(v) => setIsStory(!!v)} />
          Publicar como Story (Instagram)
        </label>

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

        <div className="space-y-1.5">
          <Label htmlFor="f-board">Board ID (Pinterest, opcional)</Label>
          <Input id="f-board" value={pinBoard} onChange={(e) => setPinBoard(e.target.value)} placeholder="usa o board padrão da conta se vazio" />
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <Button onClick={() => submit(false)} disabled={submitting}>
            {submitting ? 'Agendando…' : 'Agendar post'}
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
                      caption: body,
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
