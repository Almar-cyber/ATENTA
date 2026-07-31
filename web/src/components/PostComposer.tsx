import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useScheduler } from '@/store';
import { onPrefill, onPrefillDate, onEdit, onPrefillMedia } from '@/lib/composer-bus';
import { createPost, updatePost, uploadMedia } from '@/lib/api';
import type { CreatePostPayload } from '@/lib/api';
import { fmtBytes, fmtDuration, isoToLocalInput, localToIso } from '@/lib/format';
import { readMediaMetadata } from '@/lib/mediaMetadata';
import { useMediaUrl } from '@/lib/useMediaUrl';
import type { QueuedMedia } from '@/lib/types';
import {
  ALLOWED_MIME_TYPES,
  INSTAGRAM_STORY_VIDEO_LIMITS,
  PLATFORM_CAPTION_LIMITS,
  PLATFORM_COLORS,
  PLATFORM_LABELS,
  PLATFORM_MEDIA_MAX,
  PLATFORM_MULTI_IMAGE_ONLY,
  PLATFORM_REQUIRES_MEDIA,
  PLATFORM_VIDEO_LIMITS,
  YOUTUBE_LONG_VIDEO_WARN_SECONDS,
  isFeedRatioOk,
  isVideoMime,
} from '@/lib/platforms';
import { MediaCropDialog } from './MediaCropDialog';
import type { PreviewInput } from './PostPreview';
import { PostPreview } from './PostPreview';
import { MediaQueueGrid } from './MediaQueueGrid';
import { AccountPicker } from './AccountPicker';
import { SchedulePicker } from './SchedulePicker';
import { ComposerHints } from './ComposerHints';
import type { Hint } from './ComposerHints';
import { EmptyState } from '@/components/ui/empty-state';
import { PlatformIcon } from './PlatformIcon';

// Data reservada pro rascunho salvo sem horário definido: amanhã, 09:00.
function defaultDraftSlot(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T09:00`;
}

function newKey() {
  return crypto.randomUUID();
}

// One entry per selected account, keyed for the parent to render — the composer's own sidebar is
// too narrow to show these side by side, so PostComposer reports them upward instead of rendering
// them itself; see App.tsx's full-width preview strip.
export interface KeyedPreviewInput {
  accountId: string;
  input: PreviewInput;
}

export function PostComposer({
  onRequestOpen,
  onDone,
}: {
  onRequestOpen?: () => void;
  onDone?: () => void;
}) {
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
  const [activeTab, setActiveTab] = useState<string>('all');
  const [pickerOpen, setPickerOpen] = useState(false);
  // Capa do vídeo: imagem própria (YouTube/Instagram) ou frame do vídeo em segundos (TikTok/IG).
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverSeconds, setCoverSeconds] = useState('');
  const coverRef = useRef<HTMLInputElement>(null);
  // Per-account caption customization (Feature B): presence of a key means that account diverges
  // from the shared `body`; absence means it uses `body` as-is.
  const [captionOverrides, setCaptionOverrides] = useState<Record<string, string>>({});
  // Fila de recortes pendentes (keys da fila de mídia). Um por vez: o diálogo mostra o primeiro.
  const [cropQueue, setCropQueue] = useState<string[]>([]);
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
      onRequestOpen?.();
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
      onRequestOpen?.();
    });
  }, []);

  // "Agendar" numa prévia da grade: só a mídia entra na fila (a prévia não tem data nem conta).
  useEffect(() => {
    return onPrefillMedia((m) => {
      setQueue([
        {
          key: newKey(),
          assetId: m.assetId,
          name: m.name,
          mime_type: m.mime_type,
          public_url: m.public_url,
          width: m.width,
          height: m.height,
        },
      ]);
      toast.success('Mídia da prévia carregada — escolha conta e data.');
      onRequestOpen?.();
    });
  }, []);

  // A click on an empty calendar day just sets the datetime.
  useEffect(() => {
    return onPrefillDate((local) => {
      setScheduledLocal(local);
      onRequestOpen?.();
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

    // Foto fora da faixa que a Meta publica: em vez de recusar no envio (o erro só aparecia lá na
    // frente, sem saída), já abre o recorte. A pessoa escolhe o que fica visível arrastando.
    if (needsFeedRatio) {
      const toCrop = add.filter((i) => !isVideoMime(i.mime_type) && !isFeedRatioOk(i.width, i.height)).map((i) => i.key);
      if (toCrop.length) setCropQueue((c) => [...c, ...toCrop]);
    }
  }

  // Replaces the media in one carousel slot without disturbing the others' order — distinct
  // from remove+re-add, which would drop the new file at the end of the queue instead.
  async function replaceMedia(key: string, file: File) {
    const meta = await readMediaMetadata(file);
    setQueue((q) => q.map((item) => (item.key === key ? { key: newKey(), file, name: file.name, mime_type: file.type, ...meta } : item)));
  }

  // Recorte confirmado: troca o arquivo do MESMO slot, preservando a key — assim a posição no
  // carrossel e a fila de recortes pendentes continuam válidas.
  async function applyCrop(key: string, cropped: File) {
    const meta = await readMediaMetadata(cropped);
    setQueue((q) =>
      q.map((item) =>
        item.key === key
          ? // assetId sai: o arquivo agora é outro, e manter o id faria o post reaproveitar a
            // mídia antiga do R2 em vez de subir o recorte.
            { ...item, assetId: undefined, public_url: undefined, file: cropped, name: cropped.name, mime_type: cropped.type, ...meta }
          : item
      )
    );
    setCropQueue((c) => c.filter((k) => k !== key));
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
    setCoverFile(null);
    setCoverSeconds('');
    setCropQueue([]);
  }

  const selectedAccounts = useMemo(
    () => Array.from(selected).map((id) => accountsById[id]).filter(Boolean),
    [selected, accountsById]
  );

  // Object URL da capa, pelo mesmo cache compartilhado da fila de mídia (evita criar/revogar um
  // URL por render, que já quebrou thumbnail antes).
  const coverPreviewUrl = useMediaUrl(
    coverFile ? { key: 'cover', file: coverFile, name: coverFile.name, mime_type: coverFile.type } : undefined
  );

  // Item do recorte em aberto (um por vez, na ordem em que entraram na fila).
  const cropTarget = queue.find((i) => i.key === cropQueue[0]) ?? null;

  // Instagram/Facebook publicam foto de feed só entre 4:5 e 1.91:1 (Story tem regra própria, 9:16,
  // e não passa por aqui).
  const needsFeedRatio = !isStory && selectedAccounts.some((a) => a.platform === 'instagram' || a.platform === 'facebook');

  // Aba ativa do compositor: 'all' edita a legenda compartilhada, ou o id de uma conta pra editar
  // só ela. Se a conta da aba for desmarcada, cai de volta pra 'all'.
  const activeAccount = activeTab === 'all' ? null : (selectedAccounts.find((a) => a.id === activeTab) ?? null);
  const tabAccounts = activeAccount ? [activeAccount] : selectedAccounts;

  // Dicas classificadas por CAMPO, pra cada aviso aparecer junto do campo que o causou (o de
  // mídia embaixo do seletor de arquivos, o de legenda embaixo do textarea) em vez de tudo
  // amontoado num bloco só. Texto imperativo: diz o que fazer, não só o que está errado.
  const hints = useMemo(() => {
    const out: Hint[] = [];
    if (tabAccounts.length === 0) return out;
    const count = queue.length;
    const hasVideo = queue.some((q) => isVideoMime(q.mime_type));
    for (const a of tabAccounts) {
      const name = PLATFORM_LABELS[a.platform];
      const effectiveCaption = captionOverrides[a.id] ?? body;
      const limit = PLATFORM_CAPTION_LIMITS[a.platform];
      if (limit != null) {
        const over = effectiveCaption.length > limit;
        out.push({
          field: 'caption',
          problem: over,
          text: over
            ? `Encurte a legenda do ${name} em ${effectiveCaption.length - limit} caractere(s)`
            : `${name}: ${effectiveCaption.length}/${limit}`,
        });
      }
      const requires = PLATFORM_REQUIRES_MEDIA[a.platform];
      // Mesmo texto pra todas as redes que exigem mídia — assim o Set dedupe e sobra um aviso só.
      if (requires && count === 0) out.push({ field: 'media', problem: true, text: 'Anexe um arquivo' });
      const max = PLATFORM_MEDIA_MAX[a.platform];
      if (count > max) {
        out.push({ field: 'media', problem: true, text: `Remova ${count - max} arquivo(s) — ${name} aceita no máximo ${max}` });
      }
      if (count > 1 && hasVideo && PLATFORM_MULTI_IMAGE_ONLY[a.platform]) {
        out.push({ field: 'media', problem: true, text: `Use só imagens no carrossel do ${name} (vídeo vai sozinho)` });
      }
      if (count > 1 && a.platform === 'instagram' && isStory) {
        out.push({ field: 'media', problem: true, text: 'Deixe só um arquivo para publicar como Story' });
      }
      // Vídeo no Instagram não tem "post de vídeo no feed": a API publica como Reel. Diz isso antes
      // de agendar, senão a pessoa descobre olhando o perfil.
      if (a.platform === 'instagram' && !isStory && hasVideo && count === 1) {
        out.push({ field: 'media', problem: false, text: 'Vídeo no Instagram é publicado como Reel (9:16)' });
      }
      // Só imagem: vídeo tem outra faixa e o corte aqui não se aplica.
      if (needsFeedRatio && (a.platform === 'instagram' || a.platform === 'facebook')) {
        for (const item of queue) {
          if (isVideoMime(item.mime_type) || isFeedRatioOk(item.width, item.height)) continue;
          out.push({
            field: 'media',
            problem: true,
            text: `Recorte a foto ${item.width}×${item.height} — o ${name} publica entre 4:5 e 1.91:1`,
          });
        }
      }

      const videoLimits = a.platform === 'instagram' && isStory ? INSTAGRAM_STORY_VIDEO_LIMITS : PLATFORM_VIDEO_LIMITS[a.platform];
      if (videoLimits) {
        for (const item of queue) {
          if (!isVideoMime(item.mime_type)) continue;
          const dur = item.duration_seconds;
          if (dur != null && videoLimits.minDurationSeconds != null && dur < videoLimits.minDurationSeconds) {
            out.push({ field: 'media', problem: true, text: `Use um vídeo de pelo menos ${fmtDuration(videoLimits.minDurationSeconds)} no ${name}` });
          }
          if (dur != null && videoLimits.maxDurationSeconds != null && dur > videoLimits.maxDurationSeconds) {
            out.push({ field: 'media', problem: true, text: `Corte o vídeo para no máximo ${fmtDuration(videoLimits.maxDurationSeconds)} no ${name}` });
          }
          const size = item.file?.size;
          if (size != null && videoLimits.maxSizeBytes != null && size > videoLimits.maxSizeBytes) {
            out.push({ field: 'media', problem: true, text: `Comprima o vídeo para menos de ${fmtBytes(videoLimits.maxSizeBytes)} no ${name}` });
          }
          if (a.platform === 'youtube' && dur != null && dur > YOUTUBE_LONG_VIDEO_WARN_SECONDS) {
            out.push({ field: 'media', problem: true, text: 'Vídeos acima de 15min precisam de conta verificada no YouTube' });
          }
        }
      }
    }
    // Duas contas da mesma rede geravam a mesma dica duas vezes ("Instagram: 0/2200" repetido).
    const seen = new Set<string>();
    return out.filter((h) => (seen.has(h.text) ? false : (seen.add(h.text), true)));
  }, [tabAccounts, body, queue, isStory, captionOverrides, needsFeedRatio]);

  // O preview segue a aba: 'all' mostra todas as contas, uma aba de conta mostra só ela.
  const previewItems: KeyedPreviewInput[] = useMemo(
    () =>
      tabAccounts.map((a) => ({
        accountId: a.id,
        input: {
          platform: a.platform,
          accountName: a.display_name,
          caption: captionOverrides[a.id] ?? body,
          title,
          media: queue,
          isStory,
          // A capa é o que a rede mostra parado no feed — então é ela que o preview deve mostrar,
          // não um frame do vídeo. Só pra quem aceita imagem de capa (YouTube/Instagram).
          cover: coverFile && (a.platform === 'youtube' || a.platform === 'instagram') ? coverFile : undefined,
        },
      })),
    [tabAccounts, body, captionOverrides, title, queue, isStory, coverFile]
  );

  // Só habilita o que faz sentido no estado atual: agendar exige conta + data + nenhum problema
  // pendente; rascunho exige apenas a conta (rascunho pula a validação de mídia, por design).
  // Quais formas de capa as contas escolhidas suportam.
  const coverImageNetworks = Array.from(
    new Set(selectedAccounts.filter((a) => a.platform === 'youtube' || a.platform === 'instagram').map((a) => PLATFORM_LABELS[a.platform]))
  );
  const coverFrameNetworks = Array.from(
    new Set(selectedAccounts.filter((a) => a.platform === 'tiktok').map((a) => PLATFORM_LABELS[a.platform]))
  );
  const acceptsCoverImage = coverImageNetworks.length > 0;
  const acceptsCoverFrame = coverFrameNetworks.length > 0;

  const hasBlockingProblem = hints.some((h) => h.problem);
  // Conta o que REALMENTE existe: `selected` pode guardar id de conta que sumiu (desconectada
  // enquanto o compositor estava aberto), e aí o botão ficava habilitado com o form vazio.
  const canDraft = selectedAccounts.length > 0;
  const canSchedule = canDraft && !hasBlockingProblem;

  async function submit(asDraft: boolean, whenLocal?: string) {
    if (selectedAccounts.length === 0) return toast.error('Selecione ao menos uma conta de destino.');
    // Rascunho pode não ter data ainda (é justamente capturar antes de decidir); nesse caso vai
    // pro próximo dia às 09:00 como espaço reservado, e a data real se escolhe ao promover pra fila.
    const when = whenLocal ?? scheduledLocal ?? '';
    const effectiveWhen = when || (asDraft ? defaultDraftSlot() : '');
    if (!effectiveWhen) return toast.error('Escolha quando publicar.');

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
      // A capa é um upload próprio (não entra no carrossel do post).
      let coverMediaId: string | undefined;
      if (coverFile) coverMediaId = (await uploadMedia(coverFile)).id;
      const coverMs = coverSeconds.trim() ? Math.round(Number(coverSeconds) * 1000) : undefined;

      const payload: CreatePostPayload = {
        title: title || undefined,
        body,
        scheduled_for: localToIso(effectiveWhen),
        target_account_ids: Array.from(selected),
        media_asset_ids: mediaIds.length ? mediaIds : undefined,
        youtube_privacy_status: ytPrivacy || undefined,
        pinterest_board_id: pinBoard || undefined,
        instagram_as_story: isStory || undefined,
        cover_media_id: coverMediaId,
        cover_timestamp_ms: Number.isFinite(coverMs) ? coverMs : undefined,
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
      onDone?.();
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-5 py-4">
        <h2 className="text-lg font-semibold">{editingPostId ? 'Editar post' : 'Novo post'}</h2>
        <Button type="button" variant="ghost" size="icon-sm" onClick={() => onDone?.()} aria-label="Fechar">
          <X className="size-4" />
        </Button>
      </div>
      {/* Estreito: rola tudo junto (uma barra só). Largo: duas colunas com scroll independente. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
        <div className="min-h-0 flex-1 space-y-4 px-5 py-4 md:overflow-y-auto">
        {editingPostId && (
          <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted px-3 py-2 text-sm">
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

        <div className="space-y-2">
          <Label>Contas de destino</Label>
          <AccountPicker accounts={accounts} selected={selected} onChange={setSelected} />
        </div>

        {selectedAccounts.length === 0 && (
          <EmptyState size="sm" bordered>
            Escolha ao menos uma conta acima para preencher o restante do post.
          </EmptyState>
        )}

        {selectedAccounts.length > 0 && (
          <div className="space-y-4">
        {/* Mídia vem antes da legenda: você escolhe o material e escreve olhando pra ele (é a ordem
            do próprio Instagram, e casa com o princípio "a pré-visualização é o herói"). */}
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
            onRemove={(key) => {
              setQueue((q) => q.filter((i) => i.key !== key));
              setCropQueue((c) => c.filter((k) => k !== key));
            }}
            onReplace={replaceMedia}
            onCrop={(key) => setCropQueue((c) => (c.includes(key) ? c : [key, ...c]))}
          />
          <ComposerHints hints={hints} field="media" />
        </div>

        {/* Capa: só faz sentido com vídeo, e cada rede aceita uma coisa — YouTube e Instagram
            aceitam imagem própria; TikTok só deixa escolher um frame do próprio vídeo. */}
        {queue.some((q) => isVideoMime(q.mime_type)) && (acceptsCoverImage || acceptsCoverFrame) && (
          <div className="space-y-1.5">
            <Label>Capa do vídeo (opcional)</Label>
            {acceptsCoverImage && (
              <>
                <Input
                  ref={coverRef}
                  type="file"
                  accept="image/jpeg,image/png"
                  onChange={(e) => setCoverFile(e.target.files?.[0] ?? null)}
                />
                <p className="text-xs text-muted-foreground">
                  Capa para {coverImageNetworks.join(' e ')} — no Instagram é a capa do Reel. É ela que aparece na pré-visualização.
                </p>
                {coverFile && (
                  <div className="flex items-center gap-2">
                    <img
                      src={coverPreviewUrl ?? undefined}
                      alt=""
                      className="size-16 rounded-lg border object-cover"
                    />
                    <button
                      type="button"
                      className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                      onClick={() => {
                        setCoverFile(null);
                        if (coverRef.current) coverRef.current.value = '';
                      }}
                    >
                      remover capa
                    </button>
                  </div>
                )}
              </>
            )}
            {acceptsCoverFrame && (
              <>
                <Input
                  type="number"
                  min="0"
                  step="0.1"
                  value={coverSeconds}
                  onChange={(e) => setCoverSeconds(e.target.value)}
                  placeholder="ex.: 2.5"
                />
                <p className="text-xs text-muted-foreground">
                  Segundo do vídeo usado como capa em {coverFrameNetworks.join(' e ')} — essas redes não
                  aceitam imagem própria.
                </p>
              </>
            )}
          </div>
        )}

        {/* Abas por conta: 'Todas' edita a legenda compartilhada; cada aba de conta edita só a
            legenda daquela conta (e o preview à direita acompanha). Substitui a lista empilhada de
            "Personalizar legenda", que ficava confusa com várias contas. */}
        {selectedAccounts.length >= 2 && (
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="h-auto flex-wrap">
              <TabsTrigger value="all">Todas</TabsTrigger>
              {selectedAccounts.map((a) => (
                <TabsTrigger key={a.id} value={a.id} className="gap-1.5">
                  <PlatformIcon platform={a.platform} className="size-3 shrink-0" style={{ color: PLATFORM_COLORS[a.platform] }} />
                  {a.display_name}
                  {captionOverrides[a.id] !== undefined && (
                    <span className="size-1.5 rounded-full bg-primary" title="legenda própria" />
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}

        {activeAccount ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="f-body-account">Legenda de {activeAccount.display_name}</Label>
              {captionOverrides[activeAccount.id] !== undefined ? (
                <Button
                  type="button"
                  variant="link"
                  size="xs"
                  className="h-auto p-0"
                  onClick={() =>
                    setCaptionOverrides((prev) => {
                      const next = { ...prev };
                      delete next[activeAccount.id];
                      return next;
                    })
                  }
                >
                  Usar legenda padrão
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">usando a legenda padrão</span>
              )}
            </div>
            <Textarea
              id="f-body-account"
              value={captionOverrides[activeAccount.id] ?? body}
              onChange={(e) => setCaptionOverrides((prev) => ({ ...prev, [activeAccount.id]: e.target.value }))}
              className="min-h-24"
            />
            <ComposerHints hints={hints} field="caption" />
          </div>
        ) : (
        <div className="space-y-1.5">
          <Label htmlFor="f-body">Legenda</Label>
          <Textarea id="f-body" value={body} onChange={(e) => setBody(e.target.value)} className="min-h-24" />
          <ComposerHints hints={hints} field="caption" />
        </div>
        )}

        {selectedAccounts.some((a) => a.platform === 'youtube') && (
          <div className="space-y-1.5">
            <Label htmlFor="f-title">Título do vídeo (YouTube)</Label>
            <Input id="f-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
        )}

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
          </div>
        )}

        </div>

        <div className="min-h-0 shrink-0 space-y-3 overflow-y-auto border-t bg-muted/30 px-5 py-4 md:w-80 md:border-l md:border-t-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pré-visualização</p>
          {previewItems.length > 0 ? (
            <div className="flex flex-col items-center gap-3">
              {previewItems.map(({ accountId, input }) => (
                <PostPreview key={accountId} input={input} />
              ))}
            </div>
          ) : (
            <EmptyState size="sm">
              Selecione ao menos uma conta para ver como o post vai ficar.
            </EmptyState>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3 border-t px-5 py-4">
        <Button size="lg" onClick={() => setPickerOpen(true)} disabled={submitting || !canSchedule}>
          {submitting ? (editingPostId ? 'Salvando…' : 'Agendando…') : editingPostId ? 'Salvar alterações' : 'Agendar post'}
        </Button>
        <Button size="lg" variant="outline" onClick={() => submit(true)} disabled={submitting || !canDraft}>
          Salvar como rascunho
        </Button>
      </div>

      <SchedulePicker
        open={pickerOpen}
        initial={scheduledLocal || undefined}
        confirmLabel={editingPostId ? 'Salvar alterações' : 'Agendar post'}
        onOpenChange={setPickerOpen}
        onConfirm={(local) => {
          setScheduledLocal(local);
          setPickerOpen(false);
          submit(false, local);
        }}
      />

      <MediaCropDialog
        file={cropTarget?.file ?? null}
        onCancel={() => setCropQueue((c) => c.slice(1))}
        onDone={(cropped) => cropTarget && applyCrop(cropTarget.key, cropped)}
      />
    </div>
  );
}
