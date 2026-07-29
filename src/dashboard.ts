// Single self-contained HTML page (inline CSS/JS, no bundler, no external requests) served at "/"
// and "/dashboard" — matches the rest of this project's zero-build-step, zero-dependency style.
// Client JS deliberately avoids template literals so this outer TS template string doesn't need
// nested-backtick escaping.
export const DASHBOARD_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Social Scheduler</title>
<style>
  :root {
    color-scheme: light;
    --bg: #f4f5f7;
    --card: #ffffff;
    --border: #e2e4e9;
    --text: #1f2328;
    --muted: #6b7280;
    --accent: #2563eb;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: var(--bg);
    color: var(--text);
  }
  header {
    padding: 20px 24px;
    background: var(--card);
    border-bottom: 1px solid var(--border);
  }
  header h1 { margin: 0 0 4px; font-size: 20px; }
  #accounts-summary { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .chip {
    font-size: 12px;
    padding: 3px 9px 3px 8px;
    border-radius: 999px;
    background: #eef2ff;
    color: #3730a3;
    border: 1px solid #e0e7ff;
    border-left-width: 3px;
  }
  .chip-muted { background: #f3f4f6; color: var(--muted); border-color: var(--border); }
  #alert-banner {
    display: none;
    background: #fef2f2;
    color: #991b1b;
    border-bottom: 1px solid #fecaca;
    padding: 10px 24px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
  #alert-banner:hover { background: #fee2e2; }
  main {
    display: grid;
    grid-template-columns: 340px 1fr;
    gap: 20px;
    padding: 20px 24px;
    align-items: start;
  }
  @media (max-width: 860px) {
    main { grid-template-columns: 1fr; }
  }
  section {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 16px 18px;
    min-width: 0;
  }
  section h2 { margin: 0 0 14px; font-size: 15px; }
  label { display: block; font-size: 13px; font-weight: 600; margin: 12px 0 4px; }
  label:first-of-type { margin-top: 0; }
  input[type="text"], input[type="datetime-local"], textarea, select {
    width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 14px;
    font-family: inherit;
    background: #fff;
    color: var(--text);
  }
  textarea { min-height: 80px; resize: vertical; }
  .hint { font-size: 12px; color: var(--muted); margin-top: 4px; }
  .composer-hint.over { color: #dc2626; font-weight: 600; }
  #media-queue { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; }
  .media-queue-item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    background: #f9fafb;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 6px;
  }
  .media-queue-item .pos { color: var(--muted); font-weight: 700; min-width: 14px; }
  .media-queue-item .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .media-queue-item button {
    border: 1px solid var(--border);
    background: #fff;
    border-radius: 4px;
    cursor: pointer;
    font-size: 11px;
    line-height: 1;
    padding: 3px 6px;
  }
  .media-queue-item button:disabled { opacity: 0.35; cursor: default; }
  #target-accounts { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
  .account-check { display: flex; align-items: center; gap: 8px; font-weight: 400; font-size: 14px; }
  .account-check input { width: auto; margin: 0; }
  .badge {
    display: inline-block;
    font-size: 11px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 999px;
    color: #fff;
    white-space: nowrap;
  }
  .badge.gray { background: #6b7280; }
  .badge.blue { background: #2563eb; }
  .badge.orange { background: #d97706; }
  .badge.purple { background: #7c3aed; }
  .badge.green { background: #16a34a; }
  .badge.red { background: #dc2626; }
  .badge.yellow { background: #ca8a04; }
  .form-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  button[type="submit"], .btn {
    margin-top: 16px;
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: 6px;
    padding: 10px 16px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
  }
  button:disabled { opacity: 0.6; cursor: default; }
  .btn-secondary {
    background: #fff;
    color: var(--text);
    border: 1px solid var(--border);
  }
  .message { margin-top: 10px; font-size: 13px; }
  .message.error { color: #dc2626; }
  .message.success { color: #16a34a; }
  .posts-header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 14px; }
  .posts-header h2 { margin: 0; }
  .filters { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .filters select { width: auto; }
  .view-tabs { display: flex; gap: 4px; margin-right: 4px; }
  .view-tab {
    padding: 6px 12px;
    border: 1px solid var(--border);
    background: #fff;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    color: var(--text);
  }
  .view-tab.active { background: var(--accent); color: #fff; border-color: var(--accent); }
  .platform-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; flex: none; }
  #posts-list { overflow-x: auto; }
  .day-group-header {
    font-size: 12px;
    font-weight: 700;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.02em;
    padding: 14px 0 6px;
    border-top: 1px solid var(--border);
    margin-top: 4px;
    min-width: 1180px;
  }
  .target-row {
    display: grid;
    grid-template-columns: 130px 90px 140px 100px 1fr 100px 140px 190px;
    gap: 10px;
    padding: 10px 0;
    border-bottom: 1px solid var(--border);
    font-size: 13px;
    align-items: center;
    min-width: 1180px;
  }
  .target-row.status-failed { background: #fef8f8; }
  .target-row.status-draft { opacity: 0.85; }
  .target-row-head { font-weight: 600; color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.02em; }
  .col.platform { display: flex; align-items: center; }
  .col.caption { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text); }
  .col.account { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* Carousels can hold up to 20 thumbnails — scroll them inside the cell rather than blowing out
     the grid column width. */
  .col.media { display: flex; gap: 4px; align-items: center; overflow-x: auto; }
  .col.actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .error-text { color: #dc2626; font-size: 12px; }
  .media-thumb { border-radius: 4px; object-fit: cover; display: block; background: #e5e7eb; }
  .btn-link { background: none; border: none; padding: 0; font-size: 12px; cursor: pointer; text-decoration: underline; white-space: nowrap; }
  .btn-link.danger { color: #dc2626; }
  .empty { padding: 20px 0; color: var(--muted); font-size: 14px; text-align: center; }

  .calendar-nav { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
  .calendar-nav .month-label { font-weight: 600; font-size: 14px; min-width: 160px; }
  .calendar-nav button { border: 1px solid var(--border); background: #fff; border-radius: 6px; padding: 4px 10px; cursor: pointer; font-size: 13px; }
  .calendar-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; min-width: 700px; }
  .calendar-weekday { font-size: 11px; font-weight: 600; color: var(--muted); text-transform: uppercase; text-align: center; padding-bottom: 4px; }
  .calendar-day {
    min-height: 92px;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 6px;
    font-size: 12px;
    background: #fff;
    cursor: pointer;
  }
  .calendar-day:hover { border-color: var(--accent); }
  .calendar-day.outside { visibility: hidden; }
  .calendar-day.today { border-color: var(--accent); border-width: 2px; }
  .calendar-day-num { font-weight: 600; margin-bottom: 4px; }
  .calendar-chip {
    display: flex;
    align-items: center;
    border-radius: 3px;
    background: #f3f4f6;
    padding: 2px 5px;
    margin-bottom: 3px;
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
  }
  .calendar-chip:hover { background: #e5e7eb; }
  .calendar-chip.status-failed { background: #fee2e2; }
  .calendar-chip.status-draft { opacity: 0.75; }
  .calendar-more { font-size: 11px; color: var(--muted); cursor: pointer; }

  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(15, 18, 25, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    z-index: 50;
  }
  .modal-box {
    background: #fff;
    border-radius: 10px;
    padding: 20px;
    max-width: 440px;
    width: 100%;
    max-height: 85vh;
    overflow-y: auto;
  }
  .modal-box h3 { margin: 0 0 10px; font-size: 16px; }
  .modal-row { margin-bottom: 10px; font-size: 13px; }
  .modal-row .label { font-weight: 600; display: block; margin-bottom: 2px; color: var(--muted); font-size: 11px; text-transform: uppercase; }
  .modal-media-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 4px; }
  .modal-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 14px; }
  .modal-actions .btn, .modal-actions .btn-secondary { margin-top: 0; }
</style>
</head>
<body>
  <header>
    <h1>Social Scheduler</h1>
    <div id="accounts-summary"></div>
  </header>
  <div id="alert-banner"></div>
  <main>
    <section id="new-post-card">
      <h2>Novo post</h2>
      <form id="new-post-form">
        <label for="f-title">Título (opcional, usado no YouTube)</label>
        <input type="text" id="f-title" name="title">

        <label for="f-body">Legenda</label>
        <textarea id="f-body" name="body" required></textarea>
        <div id="composer-hints"></div>

        <label for="f-scheduled">Quando publicar</label>
        <input type="datetime-local" id="f-scheduled" name="scheduled_for" required>

        <label>Contas de destino</label>
        <div id="target-accounts"></div>

        <label for="f-media">Mídia (imagem ou vídeo, opcional)</label>
        <input type="file" id="f-media" name="media" accept="image/*,video/*" multiple>
        <div class="hint">Selecione 2+ imagens para criar um carrossel. YouTube, TikTok, Instagram e Pinterest exigem mídia (vídeo nos dois primeiros).</div>
        <div id="media-queue"></div>

        <label class="account-check" style="font-weight:600;margin-top:12px">
          <input type="checkbox" id="f-ig-story" name="instagram_as_story">
          <span>Publicar como Story (Instagram)</span>
        </label>

        <label for="f-yt-privacy">Privacidade (YouTube)</label>
        <select id="f-yt-privacy" name="youtube_privacy_status">
          <option value="">padrão (unlisted)</option>
          <option value="public">public</option>
          <option value="unlisted">unlisted</option>
          <option value="private">private</option>
        </select>

        <label for="f-pin-board">Board ID (Pinterest, opcional)</label>
        <input type="text" id="f-pin-board" name="pinterest_board_id" placeholder="usa o board padrão da conta se vazio">

        <div class="form-actions">
          <button type="submit">Agendar post</button>
          <button type="button" id="save-draft-btn" class="btn-secondary" style="margin-top:16px;padding:10px 16px;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer">Salvar como rascunho</button>
        </div>
        <div id="new-post-message" class="message"></div>
      </form>
    </section>

    <section id="posts-card">
      <div class="posts-header">
        <h2>Posts agendados</h2>
        <div class="filters">
          <div class="view-tabs">
            <button type="button" class="view-tab active" id="tab-list">Lista</button>
            <button type="button" class="view-tab" id="tab-calendar">Calendário</button>
          </div>
          <select id="filter-status">
            <option value="">todos os status</option>
            <option value="draft">Rascunho</option>
            <option value="queued">Na fila</option>
            <option value="publishing">Publicando</option>
            <option value="processing">Processando</option>
            <option value="published">Publicado</option>
            <option value="failed">Falhou</option>
            <option value="canceled">Cancelado</option>
            <option value="ambiguous">Indefinido</option>
          </select>
          <select id="filter-platform">
            <option value="">todas as plataformas</option>
            <option value="youtube">YouTube</option>
            <option value="linkedin">LinkedIn</option>
            <option value="instagram">Instagram</option>
            <option value="facebook">Facebook</option>
            <option value="pinterest">Pinterest</option>
            <option value="tiktok">TikTok</option>
          </select>
          <select id="filter-account">
            <option value="">todas as contas</option>
          </select>
          <button type="button" class="btn btn-secondary" id="refresh-btn">Atualizar</button>
        </div>
      </div>
      <div id="view-list"><div id="posts-list"></div></div>
      <div id="view-calendar" style="display:none">
        <div class="calendar-nav">
          <button type="button" id="cal-prev">‹</button>
          <span class="month-label" id="cal-label"></span>
          <button type="button" id="cal-next">›</button>
          <button type="button" id="cal-today">Hoje</button>
        </div>
        <div id="calendar-grid"></div>
      </div>
    </section>
  </main>

<script>
(function () {
  var PLATFORM_LABELS = { youtube: 'YouTube', linkedin: 'LinkedIn', instagram: 'Instagram', facebook: 'Facebook', pinterest: 'Pinterest', tiktok: 'TikTok' };
  var PLATFORM_COLORS = { youtube: '#FF0000', linkedin: '#0A66C2', instagram: '#C13584', facebook: '#1877F2', pinterest: '#E60023', tiktok: '#111827' };
  var PLATFORM_CAPTION_LIMITS = { facebook: 5000, instagram: 2200, linkedin: 3000, pinterest: 500, tiktok: 2200, youtube: 5000 };
  var PLATFORM_REQUIRES_MEDIA = { youtube: 'vídeo', tiktok: 'vídeo', instagram: 'mídia', pinterest: 'mídia' };
  // Mirrors each adapter's validate() so an over-limit carousel is caught before the round trip.
  var PLATFORM_MEDIA_MAX = { instagram: 10, facebook: 10, linkedin: 20, pinterest: 5, youtube: 1, tiktok: 1 };
  // Instagram is the only one whose carousel accepts video alongside images.
  var PLATFORM_MULTI_IMAGE_ONLY = { facebook: true, linkedin: true, pinterest: true };
  var STATUS_META = {
    draft: { label: 'Rascunho', cls: 'gray' },
    queued: { label: 'Na fila', cls: 'blue' },
    publishing: { label: 'Publicando', cls: 'orange' },
    processing: { label: 'Processando', cls: 'purple' },
    published: { label: 'Publicado', cls: 'green' },
    failed: { label: 'Falhou', cls: 'red' },
    canceled: { label: 'Cancelado', cls: 'gray' },
    ambiguous: { label: 'Indefinido', cls: 'yellow' }
  };
  var WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  var MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

  var state = {
    view: 'list',
    posts: [],
    accounts: [],
    accountsById: {},
    // Ordered carousel queue. Entries are either {file: File} (not uploaded yet) or
    // {assetId, name, mime_type} (an already-uploaded asset, reused when duplicating a post).
    // A plain array because FileList is immutable and can't be reordered in place.
    mediaQueue: [],
    calYear: new Date().getFullYear(),
    calMonth: new Date().getMonth()
  };

  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (k === 'class') e.className = attrs[k];
        else if (k === 'text') e.textContent = attrs[k];
        else if (k === 'style') e.style.cssText = attrs[k];
        else e.setAttribute(k, attrs[k]);
      }
    }
    (children || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }

  function platformDot(platform) {
    return el('span', { class: 'platform-dot', style: 'background:' + (PLATFORM_COLORS[platform] || '#9ca3af') });
  }

  function statusRowClass(status) {
    if (status === 'failed' || status === 'ambiguous') return 'status-failed';
    if (status === 'draft') return 'status-draft';
    return '';
  }

  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  }

  function fmtDayHeader(iso) {
    var d = new Date(iso);
    var s = d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function dateKey(d) {
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }

  async function api(path, opts) {
    var res = await fetch(path, opts);
    var json = null;
    try { json = await res.json(); } catch (e) {}
    if (!res.ok) throw new Error((json && json.error) || ('Erro ' + res.status));
    return json;
  }

  async function loadAccounts() {
    var data = await api('/api/accounts');
    state.accounts = data.accounts;
    state.accountsById = {};
    data.accounts.forEach(function (a) { state.accountsById[a.id] = a; });

    var box = document.getElementById('target-accounts');
    var summary = document.getElementById('accounts-summary');
    var accountFilter = document.getElementById('filter-account');

    // Preserve in-progress form state (checked accounts, active filter) across the periodic
    // refresh — a full rebuild would otherwise silently discard whatever the user had selected.
    var previouslyChecked = {};
    Array.prototype.forEach.call(box.querySelectorAll('input[name="target"]:checked'), function (i) { previouslyChecked[i.value] = true; });
    var previousFilterValue = accountFilter.value;

    box.innerHTML = '';
    summary.innerHTML = '';
    accountFilter.innerHTML = '';
    accountFilter.appendChild(el('option', { value: '', text: 'todas as contas' }));

    if (data.accounts.length === 0) {
      box.appendChild(el('div', { class: 'hint', text: 'Nenhuma conta autenticada ainda.' }));
    }

    data.accounts.forEach(function (a) {
      var label = el('label', { class: 'account-check' });
      var input = el('input', { type: 'checkbox', name: 'target', value: a.id });
      input.disabled = a.status !== 'active';
      input.checked = !!previouslyChecked[a.id];
      label.appendChild(platformDot(a.platform));
      var text = document.createElement('span');
      text.textContent = (PLATFORM_LABELS[a.platform] || a.platform) + ' — ' + a.display_name;
      label.appendChild(input);
      label.appendChild(text);
      if (a.status !== 'active') {
        label.appendChild(el('span', { class: 'badge gray', text: a.status === 'needs_reauth' ? 'reautenticar' : 'desativada' }));
      }
      box.appendChild(label);

      var chip = el('span', {
        class: 'chip' + (a.status === 'active' ? '' : ' chip-muted'),
        text: (PLATFORM_LABELS[a.platform] || a.platform) + ': ' + a.display_name,
        style: 'border-left-color:' + (PLATFORM_COLORS[a.platform] || '#9ca3af')
      });
      summary.appendChild(chip);

      accountFilter.appendChild(el('option', { value: a.id, text: (PLATFORM_LABELS[a.platform] || a.platform) + ' — ' + a.display_name }));
    });

    accountFilter.value = previousFilterValue;
    updateComposerHints();
    updateAlertBanner();
  }

  function renderMediaThumb(m, size) {
    var isVideo = m.mime_type && m.mime_type.indexOf('video/') === 0;
    var glyph = isVideo ? '\\uD83C\\uDFAC' : '\\uD83D\\uDDBC';
    if (!m.public_url) return el('span', { text: glyph });

    var dims = 'width:' + size + 'px;height:' + size + 'px';
    var node;
    if (isVideo) {
      node = el('video', { class: 'media-thumb', style: dims, preload: 'metadata' });
      node.muted = true;
      node.src = m.public_url;
    } else {
      node = el('img', { class: 'media-thumb', style: dims, src: m.public_url, alt: 'mídia' });
    }
    // MEDIA_PUBLIC_BASE_URL may point at an R2 custom domain that isn't set up yet (see README
    // Pendências), which would otherwise render as a broken-image icon on every row.
    node.addEventListener('error', function () {
      if (node.parentNode) node.parentNode.replaceChild(el('span', { text: glyph, title: 'mídia não acessível em ' + m.public_url }), node);
    });
    return node;
  }

  function renderMediaCol(mediaList, size) {
    var col = el('div', { class: 'col media' });
    if (!mediaList || mediaList.length === 0) return col;
    mediaList.forEach(function (m) {
      var thumb = renderMediaThumb(m, size || 32);
      if (m.public_url) {
        col.appendChild(el('a', { href: m.public_url, target: '_blank', rel: 'noopener' }, [thumb]));
      } else {
        col.appendChild(thumb);
      }
    });
    return col;
  }

  function renderActionButtons(post, target) {
    var wrap = document.createDocumentFragment();
    if (target.status === 'draft') {
      var queueBtn = el('button', { type: 'button', class: 'btn-link', text: 'Mover p/ fila' });
      queueBtn.addEventListener('click', function () { queueTarget(target.id); });
      wrap.appendChild(queueBtn);
    }
    if (target.status === 'draft' || target.status === 'queued') {
      var cancelBtn = el('button', { type: 'button', class: 'btn-link danger', text: 'Cancelar' });
      cancelBtn.addEventListener('click', function () { cancelTarget(target.id); });
      wrap.appendChild(cancelBtn);
    }
    var cloneBtn = el('button', { type: 'button', class: 'btn-link', text: 'Duplicar' });
    cloneBtn.addEventListener('click', function () { cloneToForm(post, target); });
    wrap.appendChild(cloneBtn);
    return wrap;
  }

  function renderTargetRow(post, target) {
    var rowCls = statusRowClass(target.status);
    var row = el('div', { class: 'target-row' + (rowCls ? ' ' + rowCls : '') });
    var whenCol = el('div', { class: 'col when', text: fmtDate(post.scheduled_for) });
    var platformCol = el('div', { class: 'col platform' }, [platformDot(target.platform), document.createTextNode(PLATFORM_LABELS[target.platform] || target.platform)]);
    var accountCol = el('div', { class: 'col account', text: target.account_name });
    accountCol.title = target.account_name;

    var statusMeta = STATUS_META[target.status] || { label: target.status, cls: 'gray' };
    var statusCol = el('div', { class: 'col status' }, [el('span', { class: 'badge ' + statusMeta.cls, text: statusMeta.label })]);

    var captionText = target.caption_override || post.body || '';
    var captionCol = el('div', { class: 'col caption', text: captionText });
    captionCol.title = captionText;

    var mediaCol = renderMediaCol(target.media, 32);

    var extraCol = el('div', { class: 'col extra' });
    if (target.status === 'published' && target.external_url) {
      extraCol.appendChild(el('a', { href: target.external_url, target: '_blank', rel: 'noopener', text: 'ver post ↗' }));
    } else if (target.last_error) {
      var errSpan = el('span', { class: 'error-text', text: target.last_error });
      errSpan.title = target.last_error;
      extraCol.appendChild(errSpan);
    }

    var actionsCol = el('div', { class: 'col actions' });
    actionsCol.appendChild(renderActionButtons(post, target));

    [whenCol, platformCol, accountCol, statusCol, captionCol, mediaCol, extraCol, actionsCol].forEach(function (c) { row.appendChild(c); });
    return row;
  }

  async function cancelTarget(id) {
    if (!confirm('Cancelar este post para essa conta?')) return;
    try {
      await api('/api/post-targets/' + id + '/cancel', { method: 'POST' });
      closeModal();
      loadPosts();
    } catch (err) {
      alert(err.message);
    }
  }

  async function queueTarget(id) {
    try {
      await api('/api/post-targets/' + id + '/queue', { method: 'POST' });
      closeModal();
      loadPosts();
    } catch (err) {
      alert(err.message);
    }
  }

  function cloneToForm(post, target) {
    closeModal();
    var form = document.getElementById('new-post-form');
    form.title.value = post.title || '';
    form.body.value = target.caption_override || post.body || '';
    form.scheduled_for.value = '';
    Array.prototype.forEach.call(form.querySelectorAll('input[name="target"]'), function (i) { i.checked = false; });
    var match = form.querySelector('input[name="target"][value="' + target.account_id + '"]');
    if (match) match.checked = true;
    form.youtube_privacy_status.value = (target.options && target.options.privacyStatus) || '';
    form.pinterest_board_id.value = (target.options && target.options.board_id) || '';
    form.instagram_as_story.checked = !!(target.options && target.options.as_story);

    // Reuse the already-uploaded R2 assets by id instead of re-uploading anything.
    state.mediaQueue = (target.media || []).map(function (m) {
      return { assetId: m.id, name: (m.storage_key || 'mídia').replace(/^[0-9a-f-]{36}-/, ''), mime_type: m.mime_type };
    });
    document.getElementById('f-media').value = '';
    renderMediaQueue();
    updateComposerHints();
    setMessage(target.media && target.media.length ? 'Post duplicado — mídia original reaproveitada, escolha uma nova data.' : 'Post duplicado — escolha uma nova data.', false);
    document.getElementById('new-post-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function getVisiblePosts() {
    var accountFilter = document.getElementById('filter-account').value;
    if (!accountFilter) return state.posts;
    var filtered = [];
    state.posts.forEach(function (post) {
      var targets = post.targets.filter(function (t) { return t.account_id === accountFilter; });
      if (targets.length > 0) {
        filtered.push({ id: post.id, title: post.title, body: post.body, scheduled_for: post.scheduled_for, created_at: post.created_at, targets: targets });
      }
    });
    return filtered;
  }

  function renderListView() {
    var list = document.getElementById('posts-list');
    list.innerHTML = '';
    var posts = getVisiblePosts();
    if (posts.length === 0) {
      list.appendChild(el('div', { class: 'empty', text: 'Nada por aqui ainda.' }));
      return;
    }

    var header = el('div', { class: 'target-row target-row-head' }, [
      el('div', { class: 'col when', text: 'Quando' }),
      el('div', { class: 'col platform', text: 'Plataforma' }),
      el('div', { class: 'col account', text: 'Conta' }),
      el('div', { class: 'col status', text: 'Status' }),
      el('div', { class: 'col caption', text: 'Legenda' }),
      el('div', { class: 'col media', text: 'Mídia' }),
      el('div', { class: 'col extra', text: '' }),
      el('div', { class: 'col actions', text: '' })
    ]);
    list.appendChild(header);

    var lastDayKey = null;
    posts.forEach(function (post) {
      var d = new Date(post.scheduled_for);
      var dayKey = dateKey(d);
      if (dayKey !== lastDayKey) {
        list.appendChild(el('div', { class: 'day-group-header', text: fmtDayHeader(post.scheduled_for) }));
        lastDayKey = dayKey;
      }
      post.targets.forEach(function (target) {
        list.appendChild(renderTargetRow(post, target));
      });
    });
  }

  function closeModal() {
    var existing = document.getElementById('target-modal');
    if (existing) existing.remove();
  }

  function openTargetModal(post, target) {
    closeModal();
    var statusMeta = STATUS_META[target.status] || { label: target.status, cls: 'gray' };
    var box = el('div', { class: 'modal-box' });

    box.appendChild(el('h3', { text: (PLATFORM_LABELS[target.platform] || target.platform) + ' — ' + target.account_name }));

    var whenRow = el('div', { class: 'modal-row' }, [el('span', { class: 'label', text: 'Quando' }), document.createTextNode(fmtDate(post.scheduled_for))]);
    var statusRow = el('div', { class: 'modal-row' }, [el('span', { class: 'label', text: 'Status' }), el('span', { class: 'badge ' + statusMeta.cls, text: statusMeta.label })]);
    var captionRow = el('div', { class: 'modal-row' }, [el('span', { class: 'label', text: 'Legenda' }), document.createTextNode(target.caption_override || post.body || '')]);
    [whenRow, statusRow, captionRow].forEach(function (r) { box.appendChild(r); });

    if (target.media && target.media.length > 0) {
      var mediaRow = el('div', { class: 'modal-row' }, [el('span', { class: 'label', text: 'Mídia' })]);
      var mediaWrap = el('div', { class: 'modal-media-row' });
      target.media.forEach(function (m) {
        var thumb = renderMediaThumb(m, 120);
        mediaWrap.appendChild(m.public_url ? el('a', { href: m.public_url, target: '_blank', rel: 'noopener' }, [thumb]) : thumb);
      });
      mediaRow.appendChild(mediaWrap);
      box.appendChild(mediaRow);
    }
    if (target.status === 'published' && target.external_url) {
      box.appendChild(el('div', { class: 'modal-row' }, [el('span', { class: 'label', text: 'Link' }), el('a', { href: target.external_url, target: '_blank', rel: 'noopener', text: 'ver post publicado ↗' })]));
    }
    if (target.last_error) {
      box.appendChild(el('div', { class: 'modal-row' }, [el('span', { class: 'label', text: 'Erro' }), el('span', { class: 'error-text', text: target.last_error })]));
    }

    var actions = el('div', { class: 'modal-actions' });
    var closeBtn = el('button', { type: 'button', class: 'btn-secondary', text: 'Fechar' });
    closeBtn.addEventListener('click', closeModal);
    actions.appendChild(closeBtn);
    actions.appendChild(renderActionButtonsAsButtons(post, target));
    box.appendChild(actions);

    var overlay = el('div', { class: 'modal-overlay', id: 'target-modal' }, [box]);
    overlay.addEventListener('click', function (ev) { if (ev.target === overlay) closeModal(); });
    document.body.appendChild(overlay);
  }

  function renderActionButtonsAsButtons(post, target) {
    var wrap = document.createDocumentFragment();
    if (target.status === 'draft') {
      var queueBtn = el('button', { type: 'button', class: 'btn-secondary', text: 'Mover para fila' });
      queueBtn.addEventListener('click', function () { queueTarget(target.id); });
      wrap.appendChild(queueBtn);
    }
    if (target.status === 'draft' || target.status === 'queued') {
      var cancelBtn = el('button', { type: 'button', class: 'btn', style: 'background:#dc2626', text: 'Cancelar post' });
      cancelBtn.addEventListener('click', function () { cancelTarget(target.id); });
      wrap.appendChild(cancelBtn);
    }
    var cloneBtn = el('button', { type: 'button', class: 'btn-secondary', text: 'Duplicar' });
    cloneBtn.addEventListener('click', function () { cloneToForm(post, target); });
    wrap.appendChild(cloneBtn);
    return wrap;
  }

  function prefillScheduledDate(year, month, day) {
    var mm = String(month + 1).padStart(2, '0');
    var dd = String(day).padStart(2, '0');
    document.getElementById('f-scheduled').value = year + '-' + mm + '-' + dd + 'T09:00';
    document.getElementById('f-body').focus();
    document.getElementById('new-post-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderCalendarView() {
    var label = MONTHS[state.calMonth] + ' de ' + state.calYear;
    document.getElementById('cal-label').textContent = label;

    var grid = document.getElementById('calendar-grid');
    grid.innerHTML = '';
    grid.className = 'calendar-grid';

    WEEKDAYS.forEach(function (w) { grid.appendChild(el('div', { class: 'calendar-weekday', text: w })); });

    var byDay = {};
    getVisiblePosts().forEach(function (post) {
      var d = new Date(post.scheduled_for);
      var key = dateKey(d);
      post.targets.forEach(function (target) {
        (byDay[key] = byDay[key] || []).push({ post: post, target: target });
      });
    });

    var firstOfMonth = new Date(state.calYear, state.calMonth, 1);
    var daysInMonth = new Date(state.calYear, state.calMonth + 1, 0).getDate();
    var leadingBlanks = firstOfMonth.getDay();
    var today = new Date();

    for (var i = 0; i < leadingBlanks; i++) {
      grid.appendChild(el('div', { class: 'calendar-day outside' }));
    }

    for (var day = 1; day <= daysInMonth; day++) {
      var cellDate = new Date(state.calYear, state.calMonth, day);
      var isToday = cellDate.toDateString() === today.toDateString();
      var cell = el('div', { class: 'calendar-day' + (isToday ? ' today' : '') });
      cell.appendChild(el('div', { class: 'calendar-day-num', text: String(day) }));

      var entries = byDay[dateKey(cellDate)] || [];
      var shown = entries.slice(0, 3);
      shown.forEach(function (entry) {
        var rowCls = statusRowClass(entry.target.status);
        var borderStyle = entry.target.status === 'draft' ? 'dashed' : 'solid';
        var chipText = entry.target.account_name;
        if (rowCls === 'status-failed') chipText = '\\u26A0 ' + chipText;
        var chip = el('span', {
          class: 'calendar-chip' + (rowCls ? ' ' + rowCls : ''),
          style: 'border-left:3px ' + borderStyle + ' ' + (PLATFORM_COLORS[entry.target.platform] || '#9ca3af'),
          text: chipText
        });
        chip.title = (PLATFORM_LABELS[entry.target.platform] || entry.target.platform) + ' — ' + entry.target.account_name;
        chip.addEventListener('click', function (ev) {
          ev.stopPropagation();
          openTargetModal(entry.post, entry.target);
        });
        cell.appendChild(chip);
      });
      if (entries.length > 3) {
        cell.appendChild(el('span', { class: 'calendar-more', text: '+' + (entries.length - 3) + ' mais' }));
      }

      (function (y, m, d) {
        cell.addEventListener('click', function () { prefillScheduledDate(y, m, d); });
      })(state.calYear, state.calMonth, day);

      grid.appendChild(cell);
    }
  }

  function renderView() {
    if (state.view === 'list') renderListView();
    else renderCalendarView();
    updateAlertBanner();
  }

  function setView(view) {
    state.view = view;
    document.getElementById('tab-list').classList.toggle('active', view === 'list');
    document.getElementById('tab-calendar').classList.toggle('active', view === 'calendar');
    document.getElementById('view-list').style.display = view === 'list' ? '' : 'none';
    document.getElementById('view-calendar').style.display = view === 'calendar' ? '' : 'none';
    renderView();
  }

  function updateAlertBanner() {
    var banner = document.getElementById('alert-banner');
    var failedCount = 0;
    state.posts.forEach(function (post) {
      post.targets.forEach(function (t) { if (t.status === 'failed' || t.status === 'ambiguous') failedCount++; });
    });
    var reauthCount = (state.accounts || []).filter(function (a) { return a.status === 'needs_reauth'; }).length;

    if (failedCount === 0 && reauthCount === 0) {
      banner.style.display = 'none';
      banner.onclick = null;
      return;
    }

    var parts = [];
    if (failedCount > 0) parts.push(failedCount + (failedCount === 1 ? ' post falhou' : ' posts falharam'));
    if (reauthCount > 0) parts.push(reauthCount + (reauthCount === 1 ? ' conta precisa reautenticar' : ' contas precisam reautenticar'));
    banner.textContent = '\\u26A0 ' + parts.join(' · ') + (failedCount > 0 ? ' — ver' : '');
    banner.style.display = 'block';
    banner.onclick = failedCount > 0 ? function () {
      document.getElementById('filter-status').value = 'failed';
      setView('list');
      loadPosts();
    } : null;
  }

  async function loadPosts() {
    var status = document.getElementById('filter-status').value;
    var platform = document.getElementById('filter-platform').value;
    var params = new URLSearchParams();
    if (status) params.set('status', status);
    if (platform) params.set('platform', platform);
    params.set('limit', '300');

    var data = await api('/api/posts?' + params.toString());
    state.posts = data.posts;
    renderView();
  }

  async function uploadMediaFile(file) {
    var form = new FormData();
    form.append('file', file);
    var data = await api('/api/media', { method: 'POST', body: form });
    return data.id;
  }

  function setMessage(text, isError) {
    var box = document.getElementById('new-post-message');
    box.textContent = text;
    box.className = 'message' + (isError ? ' error' : text ? ' success' : '');
  }

  function mediaQueueName(entry) {
    return entry.file ? entry.file.name : (entry.name || 'mídia');
  }

  function mediaQueueMime(entry) {
    return (entry.file ? entry.file.type : entry.mime_type) || '';
  }

  function renderMediaQueue() {
    var box = document.getElementById('media-queue');
    box.innerHTML = '';
    if (state.mediaQueue.length === 0) return;

    state.mediaQueue.forEach(function (entry, idx) {
      var item = el('div', { class: 'media-queue-item' });
      item.appendChild(el('span', { class: 'pos', text: String(idx + 1) }));
      var isVideo = mediaQueueMime(entry).indexOf('video/') === 0;
      item.appendChild(el('span', { text: isVideo ? '\\uD83C\\uDFAC' : '\\uD83D\\uDDBC' }));
      item.appendChild(el('span', { class: 'name', text: mediaQueueName(entry) }));

      var upBtn = el('button', { type: 'button', text: '↑' });
      upBtn.disabled = idx === 0;
      upBtn.addEventListener('click', function () { moveMedia(idx, -1); });
      item.appendChild(upBtn);

      var downBtn = el('button', { type: 'button', text: '↓' });
      downBtn.disabled = idx === state.mediaQueue.length - 1;
      downBtn.addEventListener('click', function () { moveMedia(idx, 1); });
      item.appendChild(downBtn);

      var rmBtn = el('button', { type: 'button', text: '✕' });
      rmBtn.addEventListener('click', function () {
        state.mediaQueue.splice(idx, 1);
        renderMediaQueue();
        updateComposerHints();
      });
      item.appendChild(rmBtn);

      box.appendChild(item);
    });
  }

  function moveMedia(idx, delta) {
    var target = idx + delta;
    if (target < 0 || target >= state.mediaQueue.length) return;
    var tmp = state.mediaQueue[idx];
    state.mediaQueue[idx] = state.mediaQueue[target];
    state.mediaQueue[target] = tmp;
    renderMediaQueue();
  }

  function clearMediaQueue() {
    state.mediaQueue = [];
    document.getElementById('f-media').value = '';
    renderMediaQueue();
  }

  function updateComposerHints() {
    var form = document.getElementById('new-post-form');
    var hints = document.getElementById('composer-hints');
    hints.innerHTML = '';
    var checked = Array.prototype.slice.call(form.querySelectorAll('input[name="target"]:checked'));
    if (checked.length === 0) return;

    var bodyLen = form.body.value.length;
    var mediaCount = state.mediaQueue.length;
    var hasVideo = state.mediaQueue.some(function (e) { return mediaQueueMime(e).indexOf('video/') === 0; });

    checked.forEach(function (input) {
      var account = state.accountsById[input.value];
      if (!account) return;
      var platform = account.platform;
      var name = PLATFORM_LABELS[platform] || platform;

      var limit = PLATFORM_CAPTION_LIMITS[platform];
      if (limit) {
        hints.appendChild(el('div', {
          class: 'hint composer-hint' + (bodyLen > limit ? ' over' : ''),
          text: name + ': ' + bodyLen + '/' + limit
        }));
      }
      if (PLATFORM_REQUIRES_MEDIA[platform] && mediaCount === 0) {
        hints.appendChild(el('div', {
          class: 'hint composer-hint over',
          text: name + ' exige ' + PLATFORM_REQUIRES_MEDIA[platform] + ' — anexe um arquivo'
        }));
      }
      var mediaMax = PLATFORM_MEDIA_MAX[platform];
      if (mediaMax && mediaCount > mediaMax) {
        hints.appendChild(el('div', {
          class: 'hint composer-hint over',
          text: name + ' aceita no máximo ' + mediaMax + (mediaMax === 1 ? ' arquivo' : ' arquivos') + ' (você anexou ' + mediaCount + ')'
        }));
      }
      if (mediaCount > 1 && hasVideo && PLATFORM_MULTI_IMAGE_ONLY[platform]) {
        hints.appendChild(el('div', {
          class: 'hint composer-hint over',
          text: name + ': carrossel aceita apenas imagens — vídeo só sozinho'
        }));
      }
      if (mediaCount > 1 && platform === 'instagram' && form.instagram_as_story.checked) {
        hints.appendChild(el('div', {
          class: 'hint composer-hint over',
          text: name + ': Story aceita apenas um arquivo'
        }));
      }
    });
  }

  async function submitPost(saveAsDraft) {
    var form = document.getElementById('new-post-form');
    setMessage('', false);

    var checkedInputs = Array.prototype.slice.call(form.querySelectorAll('input[name="target"]:checked'));
    var targetIds = checkedInputs.map(function (i) { return i.value; });
    if (targetIds.length === 0) {
      setMessage('Selecione ao menos uma conta de destino.', true);
      return;
    }

    var scheduledLocal = form.scheduled_for.value;
    if (!scheduledLocal) {
      setMessage('Informe data/hora do agendamento.', true);
      return;
    }
    var scheduledIso = new Date(scheduledLocal).toISOString();

    var submitBtn = form.querySelector('button[type="submit"]');
    var draftBtn = document.getElementById('save-draft-btn');
    submitBtn.disabled = true;
    draftBtn.disabled = true;
    if (saveAsDraft) draftBtn.textContent = 'Salvando...';
    else submitBtn.textContent = 'Agendando...';

    try {
      // Upload in queue order so post_target_media.position matches what the user arranged.
      var mediaAssetIds = [];
      for (var i = 0; i < state.mediaQueue.length; i++) {
        var entry = state.mediaQueue[i];
        if (entry.assetId) {
          mediaAssetIds.push(entry.assetId);
        } else {
          if (saveAsDraft) draftBtn.textContent = 'Enviando ' + (i + 1) + '/' + state.mediaQueue.length + '...';
          else submitBtn.textContent = 'Enviando ' + (i + 1) + '/' + state.mediaQueue.length + '...';
          mediaAssetIds.push(await uploadMediaFile(entry.file));
        }
      }

      var payload = {
        title: form.title.value || undefined,
        body: form.body.value,
        scheduled_for: scheduledIso,
        target_account_ids: targetIds,
        media_asset_ids: mediaAssetIds.length ? mediaAssetIds : undefined,
        youtube_privacy_status: form.youtube_privacy_status.value || undefined,
        pinterest_board_id: form.pinterest_board_id.value || undefined,
        instagram_as_story: form.instagram_as_story.checked || undefined,
        save_as: saveAsDraft ? 'draft' : undefined
      };

      await api('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      setMessage(saveAsDraft ? 'Rascunho salvo.' : 'Post agendado com sucesso.', false);
      form.reset();
      clearMediaQueue();
      updateComposerHints();
      loadPosts();
    } catch (err) {
      setMessage(err.message, true);
    } finally {
      submitBtn.disabled = false;
      draftBtn.disabled = false;
      submitBtn.textContent = 'Agendar post';
      draftBtn.textContent = 'Salvar como rascunho';
    }
  }

  document.getElementById('new-post-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    submitPost(false);
  });
  document.getElementById('save-draft-btn').addEventListener('click', function () {
    submitPost(true);
  });
  document.getElementById('f-body').addEventListener('input', updateComposerHints);
  document.getElementById('target-accounts').addEventListener('change', updateComposerHints);
  document.getElementById('f-ig-story').addEventListener('change', updateComposerHints);
  // Append rather than replace, and clear the input so picking the same file again still fires
  // 'change' — lets the queue be built up across several trips to the file dialog.
  document.getElementById('f-media').addEventListener('change', function (ev) {
    Array.prototype.forEach.call(ev.target.files, function (file) {
      state.mediaQueue.push({ file: file });
    });
    ev.target.value = '';
    renderMediaQueue();
    updateComposerHints();
  });

  document.getElementById('filter-status').addEventListener('change', loadPosts);
  document.getElementById('filter-platform').addEventListener('change', loadPosts);
  document.getElementById('filter-account').addEventListener('change', renderView);
  document.getElementById('refresh-btn').addEventListener('click', loadPosts);
  document.getElementById('tab-list').addEventListener('click', function () { setView('list'); });
  document.getElementById('tab-calendar').addEventListener('click', function () { setView('calendar'); });
  document.getElementById('cal-prev').addEventListener('click', function () {
    state.calMonth -= 1;
    if (state.calMonth < 0) { state.calMonth = 11; state.calYear -= 1; }
    renderCalendarView();
  });
  document.getElementById('cal-next').addEventListener('click', function () {
    state.calMonth += 1;
    if (state.calMonth > 11) { state.calMonth = 0; state.calYear += 1; }
    renderCalendarView();
  });
  document.getElementById('cal-today').addEventListener('click', function () {
    var now = new Date();
    state.calYear = now.getFullYear();
    state.calMonth = now.getMonth();
    renderCalendarView();
  });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') closeModal(); });

  loadAccounts();
  loadPosts();
  setInterval(function () { loadAccounts(); loadPosts(); }, 30000);
})();
</script>
</body>
</html>
`;
