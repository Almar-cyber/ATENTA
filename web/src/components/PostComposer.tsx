import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useScheduler } from '@/store';
import { onPrefill, onPrefillDate, onEdit, onPrefillMedia } from '@/lib/composer-bus';
import { createPost, fetchMediaFile, updatePost, uploadMedia } from '@/lib/api';
import type { CreatePostPayload } from '@/lib/api';
import { fmtBytes, fmtDateTime, fmtDuration, isoToLocalInput, localToIso } from '@/lib/format';
import { readMediaMetadata } from '@/lib/mediaMetadata';
import { useMediaUrl } from '@/lib/useMediaUrl';
import type { QueuedMedia } from '@/lib/types';
import {
  ALLOWED_MIME_TYPES,
  INSTAGRAM_STORY_VIDEO_LIMITS,
  PLATFORM_CAPTION_LIMITS,
  PLATFORM_FORMATS,
  PLATFORM_COLORS,
  PLATFORM_LABELS,
  PLATFORM_MEDIA_MAX,
  PLATFORM_MULTI_IMAGE_ONLY,
  PLATFORM_REQUIRES_MEDIA,
  PLATFORM_VIDEO_LIMITS,
  YOUTUBE_LONG_VIDEO_WARN_SECONDS,
  findFormat,
  isFeedRatioOk,
  isVideoMime,
} from '@/lib/platforms';
import { MediaCropDialog } from './MediaCropDialog';
import { FormatPicker } from './FormatPicker';
import type { PreviewInput } from './PostPreview';
import { PostPreview } from './PostPreview';
import { MediaQueueGrid } from './MediaQueueGrid';
import { AccountPicker } from './AccountPicker';
import { LegendaIA } from './LegendaIA';
import { SchedulePicker } from './SchedulePicker';
import { ComposerHints } from './ComposerHints';
import type { Hint } from './ComposerHints';
import { EmptyState } from '@/components/ui/empty-state';
import { PlatformIcon } from './PlatformIcon';
import { TagPicker } from './TagPicker';

// Data reservada pro rascunho salvo sem horário definido: amanhã, 09:00.
function defaultDraftSlot(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T09:00`;
}

// Formato gravado num target já existente (editar/duplicar). Posts anteriores ao seletor não têm
// `format` — aí vale o `as_story` antigo e, na falta dele, a regra de então: vídeo era Reel.
function igFormatOf(options: Record<string, unknown> | undefined): string {
  const format = options?.format;
  if (format === 'post' || format === 'reel' || format === 'story') return format;
  return options?.as_story ? 'story' : 'post';
}

// Intervalo entre os Stories de uma sequência. O poller varre a cada 10min e publica em lote; sem
// um espaçamento no `scheduled_for`, a ordem em que apareceriam no perfil seria a da consulta, não
// a da fila de mídia.
const STORY_GAP_MINUTES = 1;

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
  aberto,
  onRequestOpen,
  onDone,
}: {
  /** O modal está aberto? Precisa entrar aqui porque o compositor NÃO desmonta ao fechar (ver
   *  ComposerModal em App.tsx): sem isso, fechar no X durante uma edição deixaria `editingPostId`
   *  vivo, e o próximo "Novo post" abriria com os dados do post anterior e o botão dizendo "Salvar
   *  alterações". Antes existia um "Cancelar edição" numa faixa pra isso; a faixa saiu porque
   *  repetia o título do modal e o X, então o reset passou a ser responsabilidade do fechamento. */
  aberto?: boolean;
  onRequestOpen?: () => void;
  onDone?: () => void;
}) {
  const { accounts, accountsById, tags, reload } = useScheduler();

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [scheduledLocal, setScheduledLocal] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [queue, setQueue] = useState<QueuedMedia[]>([]);
  // Formato escolhido por rede (Instagram: post/reel/story; YouTube: video/short). `formatTouched`
  // guarda se a pessoa já mexeu — só enquanto não mexeu é que anexar um vídeo muda o padrão pra Reel.
  const [formats, setFormats] = useState<Record<string, string>>({ instagram: 'post', youtube: 'video' });
  const [formatTouched, setFormatTouched] = useState(false);
  const isStory = formats.instagram === 'story';
  const [ytPrivacy, setYtPrivacy] = useState('');
  const [pinBoard, setPinBoard] = useState('');
  // Sem valor padrão de propósito: a auditoria da Content Posting API do TikTok exige que o app
  // mostre esse seletor sem nada pré-selecionado (ver src/adapters/tiktok.ts).
  const [tiktokPrivacy, setTiktokPrivacy] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Progresso do upload de mídia. `null` = não está enviando arquivo (ou já terminou e agora é a
  // criação do post em si, que é rápida).
  const [uploadProgresso, setUploadProgresso] = useState<{ atual: number; total: number; fracao: number } | null>(null);
  /** Pilar de conteúdo da PEÇA — um só, compartilhado por todos os destinos: o assunto é do
   *  conteúdo, não da rede onde ele sai. */
  const [tagId, setTagId] = useState<string | null>(null);
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
      setTiktokPrivacy((target.options?.privacy_level as string) ?? '');
      setTagId(post.tag?.id ?? null);
      setFormats((f) => ({ ...f, instagram: igFormatOf(target.options) }));
      setFormatTouched(true);
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

  // Fechar o modal encerra a edição. O compositor fica MONTADO quando fecha (pra manter as
  // assinaturas do bus vivas), então sem isto o `editingPostId` sobreviveria: abrir "Novo post"
  // depois de fechar uma edição no X traria os dados do post anterior e o botão "Salvar alterações".
  //
  // Só reseta quando estava editando: um rascunho meio preenchido que a pessoa fechou sem querer
  // continua lá quando ela reabrir, que é o comportamento esperado de um compositor que não desmonta.
  const estavaAberto = useRef(false);
  useEffect(() => {
    if (estavaAberto.current && !aberto && editingPostId) {
      setEditingPostId(null);
      resetForm();
    }
    estavaAberto.current = !!aberto;
  }, [aberto, editingPostId]);

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
      setTiktokPrivacy((post.targets.find((t) => t.platform === 'tiktok')?.options?.privacy_level as string) ?? '');
      setTagId(post.tag?.id ?? null);
      setFormats((f) => ({ ...f, instagram: igFormatOf(post.targets.find((t) => t.platform === 'instagram')?.options) }));
      setFormatTouched(true);
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

  // "Agendar" numa ideia da grade: entra o que ela tem — a arte e/ou o texto. Data e conta a ideia
  // não tem, por definição, e é justamente o que resta escolher aqui.
  useEffect(() => {
    return onPrefillMedia((ideia) => {
      setQueue(
        ideia.media
          ? [
              {
                key: newKey(),
                assetId: ideia.media.assetId,
                name: ideia.media.name,
                mime_type: ideia.media.mime_type,
                public_url: ideia.media.public_url,
                width: ideia.media.width,
                height: ideia.media.height,
              },
            ]
          : []
      );
      if (ideia.body) setBody(ideia.body);
      setTagId(ideia.tagId ?? null);
      toast.success(
        ideia.media ? 'Ideia carregada — escolha conta e data.' : 'Texto da ideia carregado — falta a arte, a conta e a data.'
      );
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

    // Anexou vídeo sem ter tocado no seletor: assume Reel/Short, que é o que quase sempre se quer
    // — mas o seletor está logo acima, visível, pra trocar pra Post.
    if (!formatTouched && add.some((i) => isVideoMime(i.mime_type))) {
      setFormats((f) => ({ ...f, instagram: f.instagram === 'story' ? 'story' : 'reel', youtube: 'video' }));
    }

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

  // Pedido de recorte. Item que veio de post duplicado/editado só tem o id da mídia no R2 — os
  // bytes são baixados pela nossa origem e viram um File, senão o canvas do recorte fica sujo
  // (o domínio público do R2 é outro host e não manda CORS) e o resultado não pode ser exportado.
  async function requestCrop(key: string) {
    const item = queue.find((i) => i.key === key);
    if (!item) return;
    if (!item.file && item.assetId) {
      try {
        const file = await fetchMediaFile(item.assetId, item.name || 'midia.jpg');
        setQueue((q) => q.map((i) => (i.key === key ? { ...i, file } : i)));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
        return;
      }
    }
    setCropQueue((c) => (c.includes(key) ? c : [key, ...c]));
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
    setFormats({ instagram: 'post', youtube: 'video' });
    setFormatTouched(false);
    setYtPrivacy('');
    setPinBoard('');
    setTiktokPrivacy('');
    setCaptionOverrides({});
    setCoverFile(null);
    setCoverSeconds('');
    setCropQueue([]);
    setTagId(null);
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

  // Vários arquivos com formato Story: cada um vira um Story separado (a API publica um arquivo
  // por Story). As contas de Instagram levam a sequência; as outras redes, se houver, ficam com um
  // post normal contendo a fila inteira.
  const storyAccountIds = selectedAccounts.filter((a) => a.platform === 'instagram').map((a) => a.id);
  const nonStoryAccountIds = selectedAccounts.filter((a) => a.platform !== 'instagram').map((a) => a.id);
  const storySequence = isStory && queue.length > 1 && storyAccountIds.length > 0 && !editingPostId;

  // Proporção pra qual a pessoa está recortando: a do formato escolhido (Reel 9:16, post 4:5).
  // Sem isso o recorte abria sempre em 4:5, inclusive pra Reel — e nem oferecia 9:16.
  const cropTargetRatio = (() => {
    for (const a of selectedAccounts) {
      const spec = findFormat(a.platform, formats[a.platform]);
      if (spec) return spec.recommended.width / spec.recommended.height;
    }
    return undefined;
  })();

  // Item do recorte em aberto (um por vez, na ordem em que entraram na fila).
  const cropTarget = queue.find((i) => i.key === cropQueue[0]) ?? null;

  // Instagram/Facebook publicam foto de feed só entre 4:5 e 1.91:1 (Story tem regra própria, 9:16,
  // e não passa por aqui).
  const needsFeedRatio = selectedAccounts.some(
    (a) => (a.platform === 'instagram' && formats.instagram === 'post') || a.platform === 'facebook'
  );

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
      // Regras do FORMATO escolhido (Reel só vídeo, Story um arquivo só, ...), espelhando o
      // validate() do adapter — que continua sendo a autoridade.
      const spec = findFormat(a.platform, formats[a.platform]);
      if (spec && count > 0) {
        if (!spec.multiple && count > 1) {
          // Story é a exceção: não existe Story em carrossel, mas dá pra publicar vários seguidos —
          // então em vez de barrar, o compositor divide em uma sequência (ver storySequence).
          if (spec.id === 'story') {
            out.push({ field: 'media', problem: false, text: `Vão sair ${count} Stories, um a cada ${STORY_GAP_MINUTES}min` });
          } else {
            out.push({ field: 'media', problem: true, text: `Deixe um arquivo só — ${spec.label} não aceita carrossel` });
          }
        }
        if (spec.media === 'video' && !hasVideo) {
          out.push({ field: 'media', problem: true, text: `${spec.label} precisa de um vídeo` });
        }
        if (spec.id === 'post' && hasVideo && count > 1) {
          out.push({ field: 'media', problem: true, text: 'Carrossel do Instagram só aceita imagens — o vídeo vai sozinho' });
        }
      }
      // Foto numa proporção diferente da do formato: publica, mas a rede corta sozinha e o
      // enquadramento sai ao acaso. Não bloqueia — só aponta o ✂ que está ali no tile.
      if (spec && spec.media !== 'video') {
        const alvo = spec.recommended.width / spec.recommended.height;
        for (const item of queue) {
          if (isVideoMime(item.mime_type) || !item.width || !item.height) continue;
          if (Math.abs(item.width / item.height - alvo) < 0.02) continue;
          out.push({
            field: 'media',
            problem: false,
            text: `Recorte pra ${spec.recommended.ratio} (✂ no arquivo) — senão o ${spec.label} corta sozinho`,
          });
        }
      }

      // Só imagem: vídeo tem outra faixa e o corte aqui não se aplica.
      if (needsFeedRatio && ((a.platform === 'instagram' && formats.instagram === 'post') || a.platform === 'facebook')) {
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
    // O TikTok EXIGE nível de privacidade escolhido (auditoria da Content Posting API — por isso o
    // seletor nasce vazio, sem padrão). Isso vive aqui, e não só no `submit`, porque lá era um beco
    // sem saída: o botão ficava habilitado, você abria o seletor de data, escolhia, confirmava — e
    // só ENTÃO tomava um toast de erro. Três passos pra descobrir algo que era sabido desde o
    // começo, contra os princípios "falhar na criação" e "nada de beco sem saída" (design.md §7).
    // Como dica, ela desabilita o botão e aparece junto do campo que a causou.
    if (selectedAccounts.some((a) => a.platform === 'tiktok') && !tiktokPrivacy) {
      out.push({ field: 'rede', problem: true, text: 'Escolha o nível de privacidade do TikTok' });
    }

    // Duas contas da mesma rede geravam a mesma dica duas vezes ("Instagram: 0/2200" repetido).
    const seen = new Set<string>();
    return out.filter((h) => (seen.has(h.text) ? false : (seen.add(h.text), true)));
  }, [tabAccounts, body, queue, formats, captionOverrides, needsFeedRatio, selectedAccounts, tiktokPrivacy]);

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
          format: formats[a.platform],
          // A capa é o que a rede mostra parado no feed — então é ela que o preview deve mostrar,
          // não um frame do vídeo. Só pra quem aceita imagem de capa (YouTube/Instagram).
          cover: coverFile && (a.platform === 'youtube' || a.platform === 'instagram') ? coverFile : undefined,
        },
      })),
    [tabAccounts, body, captionOverrides, title, queue, formats, coverFile]
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

  // Redes das contas escolhidas que têm mais de um formato possível.
  const formatPlatforms = Array.from(new Set(selectedAccounts.map((a) => a.platform))).filter(
    (p) => (PLATFORM_FORMATS[p]?.length ?? 0) > 1
  );

  /** Alguma rede escolhida tem campo próprio? Decide se o bloco "Ajustes por rede" existe. */
  const temAjustesDeRede = selectedAccounts.some(
    (a) => a.platform === 'youtube' || a.platform === 'pinterest' || a.platform === 'tiktok'
  );

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
    // Rascunho pula (mesma lógica de "captura antes de estar pronto" da mídia); só bloqueia ao
    // mandar pra fila de verdade. Sem valor padrão de propósito — ver o comentário no useState.
    if (!asDraft && selectedAccounts.some((a) => a.platform === 'tiktok') && !tiktokPrivacy) {
      return toast.error('Escolha o nível de privacidade do TikTok antes de agendar.');
    }

    setSubmitting(true);
    try {
      const mediaIds: string[] = [];
      // Quantos arquivos ainda precisam SUBIR (os que já têm assetId vieram de um post duplicado e
      // não sobem de novo) — é o denominador de "arquivo 2 de 3" no botão.
      const aEnviar = queue.filter((i) => !i.assetId && i.file).length;
      let enviados = 0;
      for (const item of queue) {
        if (item.assetId) mediaIds.push(item.assetId);
        else if (item.file) {
          const meta = { duration_seconds: item.duration_seconds, width: item.width, height: item.height };
          // Sem isso o botão ficava em "Agendando..." parado durante todo o upload. Num vídeo de um
          // minuto isso é tempo suficiente pra parecer travado e a pessoa recarregar a página — o
          // que aí sim aborta o envio. O callback já existia em uploadMedia e ninguém passava.
          mediaIds.push(
            (
              await uploadMedia(item.file, meta, (fracao) =>
                setUploadProgresso({ atual: enviados + 1, total: aEnviar, fracao })
              )
            ).id
          );
          enviados++;
        }
      }
      setUploadProgresso(null);
      // A capa é um upload próprio (não entra no carrossel do post).
      let coverMediaId: string | undefined;
      if (coverFile) coverMediaId = (await uploadMedia(coverFile)).id;
      const coverMs = coverSeconds.trim() ? Math.round(Number(coverSeconds) * 1000) : undefined;

      const base: Omit<CreatePostPayload, 'scheduled_for' | 'target_account_ids'> = {
        title: title || undefined,
        body,
        youtube_privacy_status: ytPrivacy || undefined,
        pinterest_board_id: pinBoard || undefined,
        tiktok_privacy_level: tiktokPrivacy || undefined,
        instagram_format: formats.instagram,
        cover_media_id: coverMediaId,
        cover_timestamp_ms: Number.isFinite(coverMs) ? coverMs : undefined,
        save_as: asDraft ? 'draft' : undefined,
        tag_id: tagId,
        target_caption_overrides: Object.keys(captionOverrides).length ? captionOverrides : undefined,
      };
      const startedAt = new Date(localToIso(effectiveWhen)).getTime();

      if (editingPostId) {
        await updatePost(editingPostId, {
          ...base,
          scheduled_for: localToIso(effectiveWhen),
          target_account_ids: Array.from(selected),
          media_asset_ids: mediaIds.length ? mediaIds : undefined,
        });
      } else if (storySequence) {
        // Sequência de Stories: a API da Meta publica UM arquivo por Story (não existe Story em
        // carrossel), então cada arquivo vira um post próprio, espaçado — o intervalo é o que
        // garante que saiam na ordem da fila, já que o poller varre em lote.
        for (let i = 0; i < mediaIds.length; i++) {
          await createPost({
            ...base,
            scheduled_for: new Date(startedAt + i * STORY_GAP_MINUTES * 60_000).toISOString(),
            target_account_ids: storyAccountIds,
            media_asset_ids: [mediaIds[i]],
          });
        }
        // As demais redes não têm Story: recebem um post só, com a fila inteira.
        if (nonStoryAccountIds.length) {
          await createPost({
            ...base,
            scheduled_for: localToIso(effectiveWhen),
            target_account_ids: nonStoryAccountIds,
            media_asset_ids: mediaIds,
          });
        }
      } else {
        await createPost({
          ...base,
          scheduled_for: localToIso(effectiveWhen),
          target_account_ids: Array.from(selected),
          media_asset_ids: mediaIds.length ? mediaIds : undefined,
        });
      }
      toast.success(
        editingPostId
          ? 'Post atualizado.'
          : storySequence
            ? `${mediaIds.length} Stories agendados, um a cada ${STORY_GAP_MINUTES}min.`
            : asDraft
              ? 'Rascunho salvo.'
              : 'Post agendado com sucesso.'
      );
      resetForm();
      setEditingPostId(null);
      onDone?.();
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
      // No finally, não só no caminho de sucesso: upload que falha no meio deixaria o botão preso
      // exibindo a porcentagem em que parou.
      setUploadProgresso(null);
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
      {/* pb-4 pra a sombra deslocada dos cards do último bloco não ser cortada pelo scroll. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-4 md:flex-row md:overflow-hidden md:pb-0">
        {/* No mobile a coluna tem altura natural (shrink-0) e quem rola é o container acima — se
            fosse flex-1, ela encolheria abaixo do conteúdo e a mídia transbordava por cima da
            pré-visualização (visível com muitos arquivos). No desktop volta a flex-1 com scroll próprio. */}
        <div className="shrink-0 space-y-4 px-5 py-4 md:min-h-0 md:flex-1 md:overflow-y-auto">
        {/* Sem faixa "Editando post agendado" com um "Cancelar edição" dentro: o título do modal já
            diz "Editar post", e o X do canto já é o cancelar. Eram três elementos diferentes pra
            uma informação e uma ação que já existiam. */}
        {/* Quando publicar, no TOPO e como campo — não no rodapé.
            A data existia só como estado interno, revelada pelo seletor que abre ao clicar no botão
            de agendar. Ao EDITAR isso virava um beco: o botão dizia "Salvar alterações", nada na
            tela mostrava a data atual, e não havia como adivinhar que salvar era também remarcar.
            A primeira tentativa foi mostrá-la no rodapé, mas ali ela ficava espremida entre duas
            ações ("Salvar como rascunho" e "Salvar alterações") e confundia mais do que resolvia:
            informação e ação disputando a mesma linha. Como campo, no topo, ela é o que é. */}
        {scheduledLocal && (
          <div className="space-y-2">
            <Label>Quando publicar</Label>
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="flex w-full items-center justify-between rounded-lg border-2 border-brand bg-card px-3 py-2 text-left transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[3px_3px_0_0_var(--brand)]"
            >
              <span className="font-semibold">{fmtDateTime(localToIso(scheduledLocal))}</span>
              <span className="text-sm font-medium text-accent-foreground">Alterar</span>
            </button>
          </div>
        )}

        <div className="space-y-2">
          <Label>Contas de destino</Label>
          <AccountPicker accounts={accounts} selected={selected} onChange={setSelected} />
        </div>

        {/* Sem estado vazio aqui de propósito: a coluna da direita já diz "Selecione ao menos uma
            conta para ver como o post vai ficar", e as duas apareciam AO MESMO TEMPO, lado a lado,
            dizendo a mesma coisa. Uma mensagem só, no lugar onde o resultado apareceria. */}

        {selectedAccounts.length > 0 && (
          <div className="space-y-4">
        {/* Formato antes de tudo: é ele que define o que a rede aceita como mídia (Reel é um vídeo
            só, carrossel é só imagem) e onde a peça vai parar. Antes isso era adivinhado do arquivo,
            e não dava pra publicar vídeo no feed nem saber, antes de agendar, se ia virar Reel. */}
        {formatPlatforms.map((platform) => (
          <FormatPicker
            key={platform}
            platform={platform}
            value={formats[platform]}
            onChange={(id) => {
              setFormatTouched(true);
              setFormats((f) => ({ ...f, [platform]: id }));
            }}
          />
        ))}

        {/* Mídia vem antes da legenda: você escolhe o material e escreve olhando pra ele (é a ordem
            do próprio Instagram, e casa com o princípio "a pré-visualização é o herói"). */}
        <div className="space-y-1.5">
          <Label>Mídia</Label>
          {/* O `<input type=file>` cru ocupava uma linha inteira do formulário — texto do sistema,
              largura toda — pra fazer o que um tile do tamanho do thumbnail faz. Ele continua aqui,
              escondido, disparado pelo tile pontilhado no fim da grade. */}
          <input
            ref={fileRef}
            type="file"
            hidden
            multiple
            accept="image/jpeg,image/png,video/mp4,video/quicktime"
            onChange={(e) => onPickFiles(e.target.files)}
          />
          <MediaQueueGrid
            items={queue}
            onReorder={setQueue}
            onRemove={(key) => {
              setQueue((q) => q.filter((i) => i.key !== key));
              setCropQueue((c) => c.filter((k) => k !== key));
            }}
            onReplace={replaceMedia}
            onCrop={requestCrop}
            onAdd={() => fileRef.current?.click()}
          />
          <p className="text-xs text-muted-foreground">
            {queue.length > 1 ? 'Arraste pra reordenar. ' : '2+ imagens viram carrossel. '}JPEG, PNG, MP4 ou MOV.
          </p>
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
            {/* h-auto! (com bang) pra vencer o `group-data-horizontal/tabs:h-8` do preset — sem
                isso a pílula ficava presa em 32px e os itens vazavam pra fora ao quebrar linha. */}
            <TabsList className="h-auto! flex-wrap gap-1 py-1">
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
              <div className="flex items-center gap-2">
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
                <LegendaIA
                  valor={captionOverrides[activeAccount.id] ?? body}
                  onEscolher={(t) => setCaptionOverrides((prev) => ({ ...prev, [activeAccount.id]: t }))}
                  plataforma={activeAccount.platform}
                  tagId={tagId}
                />
              </div>
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
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="f-body">Legenda</Label>
            {/* A rede é a da PRIMEIRA conta escolhida. Com contas de redes diferentes, o tom e o
                limite mudam por rede, e escolher a primeira é o mesmo critério que a
                pré-visualização já usa; quem quiser afinar por rede abre a aba daquela conta. */}
            <LegendaIA
              valor={body}
              onEscolher={setBody}
              plataforma={selectedAccounts[0]?.platform ?? null}
              tagId={tagId}
            />
          </div>
          <Textarea id="f-body" value={body} onChange={(e) => setBody(e.target.value)} className="min-h-24" />
          <ComposerHints hints={hints} field="caption" />
        </div>
        )}

        {/* Junto da legenda, e não num campo próprio com rótulo: o pilar é uma etiqueta de uma
            palavra, e dar a ela a mesma presença de "Legenda" ou "Quando" a faria parecer
            obrigatória — ela não é. Fica ao alcance de quem quiser, fora do caminho de quem não. */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Assunto:</span>
          <TagPicker tags={tags} value={tagId} onChange={setTagId} onCreated={() => void reload()} size="sm" />
          <span className="hidden sm:inline">— agrupa o desempenho por tema nos Insights.</span>
        </div>

        {/* AJUSTES POR REDE, num bloco só.
            Antes eram quatro campos soltos no fim de uma lista de dez blocos — sem agrupamento
            nenhum, e com o único OBRIGATÓRIO (privacidade do TikTok) visualmente idêntico ao
            opcional logo acima ("Board ID... opcional"), abaixo da dobra. Juntar o que é da mesma
            natureza é o que a Lei de Miller pede; separar o obrigatório do resto é Von Restorff.
            Ver "Psicologia aplicada" em web/design.md. */}
        {temAjustesDeRede && (
          <div className="space-y-3 rounded-xl border bg-muted/30 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ajustes por rede</p>

            {/* O obrigatório vem PRIMEIRO e com moldura própria: é o único aqui que impede
                agendar, e ficava por último, indistinguível de um campo opcional. */}
            {selectedAccounts.some((a) => a.platform === 'tiktok') && (
              <div className="space-y-1.5 rounded-lg border-2 border-brand bg-card p-2.5">
                <div className="flex items-center gap-1.5">
                  <PlatformIcon platform="tiktok" className="size-3.5 shrink-0" />
                  <Label>Nível de privacidade</Label>
                  <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-bold uppercase text-primary-foreground">
                    obrigatório
                  </span>
                </div>
                {/* Sem opção padrão pré-selecionada — exigência da auditoria da Content Posting API. */}
                <Select value={tiktokPrivacy} onValueChange={setTiktokPrivacy}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Escolha antes de agendar" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PUBLIC_TO_EVERYONE">Público</SelectItem>
                    <SelectItem value="MUTUAL_FOLLOW_FRIENDS">Amigos</SelectItem>
                    <SelectItem value="SELF_ONLY">Só eu</SelectItem>
                  </SelectContent>
                </Select>
                <ComposerHints hints={hints} field="rede" />
              </div>
            )}

            {selectedAccounts.some((a) => a.platform === 'youtube') && (
              <>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <PlatformIcon platform="youtube" className="size-3.5 shrink-0" />
                    <Label htmlFor="f-title">Título do vídeo</Label>
                  </div>
                  <Input id="f-title" value={title} onChange={(e) => setTitle(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <PlatformIcon platform="youtube" className="size-3.5 shrink-0" />
                    <Label>Quem pode ver</Label>
                  </div>
                  {/* Rótulos em português: os valores da API (public/unlisted/private) apareciam
                      crus numa interface inteira em pt-BR. O valor enviado continua o mesmo. */}
                  <Select value={ytPrivacy || 'default'} onValueChange={(v) => setYtPrivacy(v === 'default' ? '' : v)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Padrão (só quem tem o link)</SelectItem>
                      <SelectItem value="public">Público</SelectItem>
                      <SelectItem value="unlisted">Só quem tem o link</SelectItem>
                      <SelectItem value="private">Privado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            {selectedAccounts.some((a) => a.platform === 'pinterest') && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <PlatformIcon platform="pinterest" className="size-3.5 shrink-0" />
                  <Label htmlFor="f-board">Board (opcional)</Label>
                </div>
                <Input
                  id="f-board"
                  value={pinBoard}
                  onChange={(e) => setPinBoard(e.target.value)}
                  placeholder="Deixe vazio para usar o board padrão"
                />
              </div>
            )}
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

      {/* LEI DE HICK: um CTA primário, não dois de mesmo peso. "Agendar" e "Salvar como rascunho"
          eram os dois `size="lg"` lado a lado, disputando o olho — e são ações de importância bem
          diferente. O rascunho vira `ghost`, disponível sem competir.
          A ordem no DESKTOP é [rascunho] [agendar], com o primário à direita (fim da leitura); no
          mobile o primário sobe pro topo da pilha, onde o polegar chega primeiro. */}
      <div className="flex flex-col gap-2 border-t px-5 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
        <Button
          size="lg"
          className="order-1 w-full sm:order-none sm:w-auto"
          onClick={() => setPickerOpen(true)}
          disabled={submitting || !canSchedule}
        >
          {uploadProgresso
            ? // Porcentagem real do arquivo, e "2 de 3" só quando há mais de um: com um arquivo só,
              // "arquivo 1 de 1" é ruído.
              `Enviando ${uploadProgresso.total > 1 ? `${uploadProgresso.atual} de ${uploadProgresso.total} · ` : ''}${Math.round(uploadProgresso.fracao * 100)}%`
            : submitting
              ? editingPostId
                ? 'Salvando…'
                : 'Agendando…'
              : editingPostId
                ? 'Salvar alterações'
                : 'Agendar post'}
        </Button>
        <Button
          size="lg"
          variant="ghost"
          className="order-2 w-full sm:order-first sm:w-auto"
          onClick={() => submit(true)}
          disabled={submitting || !canDraft}
        >
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
        targetRatio={cropTargetRatio}
        onCancel={() => setCropQueue((c) => c.slice(1))}
        onDone={(cropped) => cropTarget && applyCrop(cropTarget.key, cropped)}
      />
    </div>
  );
}
