const $ = (sel) => document.querySelector(sel);

// Absolute file:// URL for the note webview preload script
const _notePreloadUrl = window.api.notePreloadUrl;

const welcomeEl = $("#welcome");
const appEl = $("#app");
const noteListEl = $("#note-list");
const workspaceNameEl = $("#workspace-name");
const aiInput = $("#ai-input");
const aiSend = $("#ai-send");
const aiCancel = $("#ai-cancel");
const aiForm = $("#ai-form");
const aiPanel = $("#ai-panel");
const aiExpandToggle = $("#ai-expand-toggle");
const aiCollapseBtn = $("#ai-collapse-btn");
const aiNew = $("#ai-new");
const aiChatTitle = $("#ai-chat-title");
const aiMessages = $("#ai-messages");
const aiEmptyState = $("#ai-empty-state");
const aiAttachments = $("#ai-attachments");
const aiAttach = $("#ai-attach");
const aiContextBar = $("#ai-context-bar");
const sidebarMoreBtn = $("#sidebar-more-btn");
const sidebarMoreMenu = $("#sidebar-more-menu");
const searchInputEl = $("#search-input");
const searchClearEl = $("#search-clear");
// searchModeToggleEl removed — unified search has no mode toggle
const sidebarSearchEl = document.querySelector('.sidebar-search');
const sidebarResizeEl = $("#sidebar-resize");
const outlinePanelResizeEl = $("#outline-panel-resize");
const sidebarEl = $("#sidebar");
const contextMenuEl = $("#context-menu");
const aiDropOverlay = $("#ai-drop-overlay");
const aiScrollBottom = $("#ai-scroll-bottom");
const aiScrollSentinel = $("#ai-scroll-sentinel");
const aiHistory = $("#ai-history");
const aiActiveNoteToggle = $("#ai-active-note-toggle");
const aiUseTemplate = $("#ai-use-template");
const aiHistoryPanel = $("#ai-history-panel");
const aiHistorySearch = $("#ai-history-search");
const aiHistoryList = $("#ai-history-list");
const aiProviderSelect = $("#ai-provider-select");
const aiModelSelect = $("#ai-model-select");
const aiEffortSelect = $("#ai-effort-select");
const aiPermissionSelect = $("#ai-permission-select");
const atDropdown = $("#at-dropdown");

// ─── Custom Select Wrapper (design-system compliant dropdowns) ───────────────
class CustomSelect {
  constructor(nativeSelect) {
    this._select = nativeSelect;

    // Wrap the native select
    const wrap = document.createElement('div');
    wrap.className = 'custom-select-wrap';
    nativeSelect.parentNode.insertBefore(wrap, nativeSelect);
    wrap.appendChild(nativeSelect);
    nativeSelect.classList.add('custom-select-native');
    this._wrap = wrap;

    // Trigger button
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'custom-select-trigger';
    trigger.innerHTML = '<span class="custom-select-label"></span><span class="custom-select-chevron">&#x25BE;</span>';
    wrap.appendChild(trigger);
    this._trigger = trigger;

    // Dropdown panel (appended to body to escape overflow:hidden parents)
    const panel = document.createElement('div');
    panel.className = 'custom-select-panel glass';
    document.body.appendChild(panel);
    this._panel = panel;

    this._isOpen = false;

    // ── Events ──
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if (nativeSelect.disabled) return;
      this._isOpen ? this._close() : this._open();
    });

    panel.addEventListener('click', (e) => {
      const item = e.target.closest('.custom-select-item');
      if (!item) return;
      nativeSelect.value = item.dataset.value;
      nativeSelect.dispatchEvent(new Event('change'));
      this._close();
      this._syncTrigger();
    });

    panel.addEventListener('mousemove', (e) => {
      const item = e.target.closest('.custom-select-item');
      if (!item) return;
      panel.querySelectorAll('.custom-select-item').forEach(el =>
        el.classList.toggle('active', el === item));
    });

    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target) && !panel.contains(e.target)) this._close();
    });

    document.addEventListener('keydown', (e) => {
      if (!this._isOpen) return;
      if (e.key === 'Escape') { this._close(); e.stopPropagation(); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const items = [...panel.querySelectorAll('.custom-select-item')];
        const cur = items.findIndex(el => el.classList.contains('active'));
        const next = e.key === 'ArrowDown'
          ? Math.min(cur + 1, items.length - 1)
          : Math.max(cur - 1, 0);
        items.forEach((el, i) => el.classList.toggle('active', i === next));
        items[next]?.scrollIntoView({ block: 'nearest' });
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const active = panel.querySelector('.custom-select-item.active');
        if (active) active.click();
      }
    });

    // ── Auto-sync via MutationObserver ──
    this._observer = new MutationObserver(() => this._sync());
    this._observer.observe(nativeSelect, {
      childList: true,
      attributes: true,
      attributeFilter: ['style', 'disabled'],
    });

    // Intercept value setter so trigger label stays in sync
    const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    const self = this;
    Object.defineProperty(nativeSelect, 'value', {
      get() { return desc.get.call(this); },
      set(v) { desc.set.call(this, v); self._syncTrigger(); },
    });

    this._sync();
  }

  _sync() {
    // Visibility: propagate native display to wrapper
    const hidden = this._select.style.display === 'none';
    this._wrap.style.display = hidden ? 'none' : '';
    if (hidden) this._close();

    // Disabled
    this._trigger.disabled = this._select.disabled;

    // Rebuild panel items from native options
    this._panel.innerHTML = '';
    for (const opt of this._select.options) {
      const item = document.createElement('div');
      item.className = 'custom-select-item';
      item.dataset.value = opt.value;
      item.textContent = opt.textContent;
      this._panel.appendChild(item);
    }

    this._syncTrigger();
  }

  _syncTrigger() {
    const sel = this._select.options[this._select.selectedIndex];
    this._trigger.querySelector('.custom-select-label').textContent =
      sel ? sel.textContent : '';
  }

  _open() {
    // Close any other open custom selects first
    document.querySelectorAll('.custom-select-panel.open').forEach(p => {
      p.classList.remove('open');
    });
    document.querySelectorAll('.custom-select-trigger.open').forEach(t => {
      t.classList.remove('open');
    });

    this._isOpen = true;
    this._trigger.classList.add('open');
    this._panel.classList.add('open');

    // Mark current value as active
    const curVal = this._select.value;
    this._panel.querySelectorAll('.custom-select-item').forEach(el =>
      el.classList.toggle('active', el.dataset.value === curVal));

    // Position below trigger
    this._position();
  }

  _close() {
    if (!this._isOpen) return;
    this._isOpen = false;
    this._trigger.classList.remove('open');
    this._panel.classList.remove('open');
  }

  _position() {
    const rect = this._trigger.getBoundingClientRect();
    const panelH = this._panel.scrollHeight;
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const openAbove = panelH > spaceBelow && rect.top > spaceBelow;

    this._panel.style.left = rect.left + 'px';
    this._panel.style.minWidth = rect.width + 'px';
    if (openAbove) {
      this._panel.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
      this._panel.style.top = 'auto';
    } else {
      this._panel.style.top = (rect.bottom + 4) + 'px';
      this._panel.style.bottom = 'auto';
    }
  }
}

// Wrap the four AI toolbar selects
[aiProviderSelect, aiModelSelect, aiEffortSelect, aiPermissionSelect]
  .forEach(sel => new CustomSelect(sel));

// ─── Responsive placeholder for chat input ──────────────────────────────────
{
  const _placeholderTiers = [
    [380, "Describe what to create or change\u2026 (Shift+Enter for new line)"],
    [280, "Describe what to create or change\u2026"],
    [0,   "Ask AI\u2026"],
  ];
  new ResizeObserver(([entry]) => {
    const w = entry.contentRect.width;
    for (const [minW, text] of _placeholderTiers) {
      if (w >= minW) { aiInput.placeholder = text; break; }
    }
  }).observe(aiInput);
}

const titleBarEl = $('#title-bar');
if (titleBarEl) {
  titleBarEl.addEventListener('dblclick', () => {
    if (window.api && window.api.windowMaximize) {
      window.api.windowMaximize();
    }
  });
}

// Feature 120: favorites sidebar section DOM refs
const favoritesSectionEl       = $('#favorites-section');
const favoritesSectionHeaderEl = $('#favorites-section-header');
const favoritesSectionBodyEl   = $('#favorites-section-body');
const favoritesSectionToggleEl = $('#favorites-section-toggle');
const favoritesCountBadgeEl    = $('#favorites-count-badge');
const favoritesListEl          = $('#favorites-list');

// Notes section DOM refs (collapsible)
const notesSectionHeaderEl = $('#notes-section-header');
const notesSectionBodyEl   = $('#notes-section-body');
const notesSectionToggleEl = $('#notes-section-toggle');
const notesSectionTitleEl  = $('#notes-section-title');
const notesCountBadgeEl    = $('#notes-count-badge');

// Feature 122: persistent drop indicator for favorites reordering
const favDropIndicatorEl = document.createElement('div');
favDropIndicatorEl.className = 'fav-drop-indicator';
favoritesListEl.appendChild(favDropIndicatorEl);

// Feature 99: per-file tags cache for sidebar pills
// Map<absoluteFilePath, string[]>
let fileTagsCache = new Map();

let currentFavorites = []; // Feature 120: favorites sidebar section
let favAutoCollapsedBySearch = false; // true when search auto-collapsed favorites

// Map of absolute note path → { shareId, shareUrl, visibility } for published notes.
// Refreshed on workspace load, after publish/unpublish, and on tree refresh.
let publishedNotes = new Map();
function isPublished(notePath) { return publishedNotes.has(notePath); }
async function refreshPublishedNotes() {
  try {
    const map = await window.api.listPublishedNotes();
    publishedNotes = new Map(Object.entries(map || {}));
  } catch {
    publishedNotes = new Map();
  }
}
async function copyShareLink(notePath) {
  const info = publishedNotes.get(notePath);
  const url = info && info.shareUrl;
  if (!url) {
    _showSyncToast('No share link found');
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    _showSyncToast('Share link copied');
  } catch (err) {
    _showSyncToast(`Copy failed: ${err.message || err}`);
  }
}
function buildPublishIndicator(notePath) {
  const span = document.createElement('span');
  span.className = 'tree-publish-indicator';
  span.title = 'Published — click to copy link';
  span.innerHTML = ICONS.link45;
  span.addEventListener('click', (e) => {
    e.stopPropagation();
    copyShareLink(notePath);
  });
  return span;
}

// ─── File-category extension sets ─────────────────────────────────────────────

const TEXT_EXTENSIONS = new Set([
  '.md', '.txt', '.css', '.js', '.json', '.xml',
  '.yaml', '.yml', '.toml', '.log', '.sh', '.py', '.ts',
  '.jsx', '.tsx', '.sql', '.env', '.ini', '.cfg', '.conf',
  '.rb', '.rs', '.go', '.java', '.c', '.cpp', '.h', '.hpp',
  '.swift', '.kt', '.lua', '.r', '.pl', '.php', '.bat',
  '.ps1', '.zsh', '.bash', '.fish', '.gitignore', '.editorconfig',
]);

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.ico', '.avif',
]);

const PDF_EXTENSIONS = new Set(['.pdf']);
const SPREADSHEET_EXTENSIONS = new Set(['.xlsx', '.xls', '.ods']);
const CSV_EXTENSIONS = new Set(['.csv', '.tsv']);

// ─── Outline state storage ────────────────────────────────────────────────────

const _outlineTrees = new Map();          // panelId → OutlineEntry[]
const _outlineGeneration = new Map();     // panelId → number (staleness guard)
const _webviewGuestReady = new Map();     // panelId → Promise<void> (initial about:blank load)
const _outlineFlatEntries = new Map();    // panelId → FlatEntry[]
const _activeHeadingId = new Map();       // panelId → headingId|null
const _outlineCollapsedIds = new Map();   // filePath → Set<headingId>
const _searchHighlightState = new Map(); // panelId → { total, currentIndex, query, widgetEl }
let _outlineMaxLevel = 6;                  // max heading depth to render (1–6); 6 = all
let _rightPanelVisible = false;            // unified right panel toggle
let _rightPanelActiveTab = 'outline';      // 'outline' | 'storage' | 'memory' | 'scripts' | 'logs'

// ─── Cached security settings (for webview creation) ─────────────────────────
let _cachedSecuritySettings = null; // populated on workspace load

// ─── Backlinks state ──────────────────────────────────────────────────────────

// Cache: filePath → string[] (absolute backlink paths).
// Invalidated on 'backlinks:changed' or explicit clear.
const _backlinksCache = new Map();

// Staleness guard for async renderBacklinksSection calls.
let _backlinksRenderGen = 0;

// ─── Storage Inspector state ──────────────────────────────────────────────────

// _storagePanelVisible removed — now driven by _rightPanelActiveTab === 'storage'
let _storageRenderGen = 0;             // staleness guard for async renderStorageSection
let _scriptsRenderGen = 0;             // staleness guard for async renderScriptsPanel
let _scriptsRunningTimer = null;       // interval for elapsed time updates
let _scriptsRunningCache = [];         // cached running list for elapsed time updates
let _logsRenderGen = 0;               // staleness guard for async renderLogsPanel
let _logsRefreshTimer = null;          // interval for auto-refresh
let _logsSelectedFile = null;          // currently selected log file name
let _loggingEnabled = true;            // global logging toggle (synced with main process)

// Per-section collapse states (loaded from localStorage on workspace open)
let _storageKvCollapsed = false;
let _storageFilesCollapsed = false;
let _storageSqlCollapsed = false;
const _expandedKvKeys = new Set();     // tracks which KV keys are currently expanded
const _expandedSqlTables = new Set();   // which table schemas are expanded
let _sqlBrowsing = null;                // current browse state: { noteId, table, page, pageSize, totalRows, columns, rows } | null
let _sqlQueryState = null;              // last query state: { sql, columns, rows, error } | null

// ─── Graph view state ─────────────────────────────────────────────────────────

let _graphSimulation = null; // active D3 force simulation, stopped on close

// ─── Injected script constants (webview communication) ───────────────────────

const EXTRACT_HEADINGS_SCRIPT = `(function() {
  const headings = document.querySelectorAll('h1,h2,h3,h4,h5,h6');
  const result = [];
  let autoId = 0;
  for (const el of headings) {
    if (el.closest('pre,code,template,svg,script,style')) continue;
    const text = el.textContent.trim();
    if (!text) continue;
    if (!el.id) { el.id = 'outline-heading-' + autoId++; }
    result.push({ level: parseInt(el.tagName[1], 10), text, id: el.id });
  }
  return result;
})()`;

const SCROLL_TRACKER_SCRIPT = `(function() {
  if (!window.noteAPI || !window.noteAPI.sendToHost) return;
  let ticking = false;
  document.addEventListener('scroll', function() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function() {
      const headings = document.querySelectorAll(
        '[id^="outline-heading-"], h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]'
      );
      let activeId = null;
      for (const h of headings) {
        if (h.getBoundingClientRect().top <= 0) activeId = h.id;
        else break;
      }
      window.noteAPI.sendToHost('outline-scroll', { activeHeadingId: activeId });
      ticking = false;
    });
  }, { passive: true });
})()`;

const SELECTION_LISTENER_SCRIPT = `(function() {
  if (!window.noteAPI || !window.noteAPI.sendToHost) return;
  function reportSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.toString().trim() === '') {
      window.noteAPI.sendToHost('selection-changed', null);
      return;
    }
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    window.noteAPI.sendToHost('selection-changed', {
      text: sel.toString(),
      rangeRect: { top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height }
    });
  }
  document.addEventListener('mouseup', reportSelection);
  document.addEventListener('keyup', function(e) { if (e.shiftKey) reportSelection(); });
  document.addEventListener('scroll', function() {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) reportSelection();
  }, { passive: true });
})()`;

const LINK_CLICK_HANDLER_SCRIPT = `(function() {
  if (!window.noteAPI || !window.noteAPI.sendToHost) return;
  document.addEventListener('click', function(event) {
    const anchor = event.target.closest('a[href]');
    if (!anchor) return;
    const href = anchor.getAttribute('href');
    if (!href) return;

    // External links: open in system browser.
    if (href.startsWith('http://') || href.startsWith('https://')) {
      event.preventDefault();
      window.noteAPI.sendToHost('link-click', { type: 'external', url: href });
      return;
    }

    // Anchor-only links (#section): let the browser handle natively.
    if (href.startsWith('#')) return;

    // Internal .html links (relative, ending in .html before query/fragment).
    const hrefPath = href.split('?')[0].split('#')[0];
    if (hrefPath.endsWith('.html')) {
      event.preventDefault();
      window.noteAPI.sendToHost('link-click', { type: 'internal', href: href });
      return;
    }

    // All other links (mailto:, javascript:, non-.html files): prevent navigation
    // to avoid unintentional webview URL changes.
    if (!href.startsWith('note://')) {
      event.preventDefault();
    }
  }, true); // capture phase so it fires before any inline onclick handlers
})()`;

// These helper functions are injected into webview via .toString() — do not call directly.
// Must use function declarations (not arrow functions) to ensure toString() works correctly.

function _searchHighlightFn(terms) {
  // Clear any existing search state
  if (window.__searchHL) {
    window.__searchHL.marks.forEach(function(m) {
      const p = m.parentNode;
      if (p) { while (m.firstChild) p.insertBefore(m.firstChild, m); p.removeChild(m); }
    });
    document.body && document.body.normalize();
    if (window.__searchHL.styleEl) window.__searchHL.styleEl.remove();
    window.__searchHL = null;
  }

  const body = document.body;
  if (!body || terms.length === 0) return { total: 0 };

  const styleEl = document.createElement('style');
  styleEl.setAttribute('data-search-hl', '');
  // TODO(165): migrate search highlight box-shadow rgba values to tokens when note viewer theming lands
  styleEl.textContent = [
    'mark.search-hl { background: var(--highlight-search); color: inherit; border-radius: 2px; padding: 0; box-shadow: 0 0 0 1px rgba(255,213,79,0.3); }',
    'mark.search-hl.current { background: var(--highlight-search-current); box-shadow: 0 0 0 2px rgba(255,152,0,0.5); }'
  ].join('\n');
  (document.head || document.documentElement).appendChild(styleEl);

  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
    acceptNode: function(node) {
      if (node.parentElement && node.parentElement.closest('script,style,noscript,textarea')) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  const lowerTerms = terms.map(function(t) { return t.toLowerCase(); });
  const marks = [];

  for (let n = 0; n < textNodes.length; n++) {
    const textNode = textNodes[n];
    const text = textNode.textContent;
    if (!text) continue;
    const lowerText = text.toLowerCase();

    const spans = [];
    for (let t = 0; t < lowerTerms.length; t++) {
      const lowerTerm = lowerTerms[t];
      const termLen = terms[t].length;
      let pos = 0;
      while (pos < lowerText.length) {
        const idx = lowerText.indexOf(lowerTerm, pos);
        if (idx === -1) break;
        spans.push({ start: idx, end: idx + termLen });
        pos = idx + 1;
      }
    }
    if (spans.length === 0) continue;

    spans.sort(function(a, b) { return a.start - b.start; });
    const nonOverlapping = [];
    let lastEnd = -1;
    for (let s = 0; s < spans.length; s++) {
      if (spans[s].start >= lastEnd) {
        nonOverlapping.push(spans[s]);
        lastEnd = spans[s].end;
      }
    }

    const fragment = document.createDocumentFragment();
    let offset = 0;
    for (let s = 0; s < nonOverlapping.length; s++) {
      const span = nonOverlapping[s];
      if (span.start > offset) fragment.appendChild(document.createTextNode(text.slice(offset, span.start)));
      const mark = document.createElement('mark');
      mark.className = 'search-hl';
      mark.appendChild(document.createTextNode(text.slice(span.start, span.end)));
      fragment.appendChild(mark);
      marks.push(mark);
      offset = span.end;
    }
    if (offset < text.length) fragment.appendChild(document.createTextNode(text.slice(offset)));
    textNode.parentNode.replaceChild(fragment, textNode);
  }

  if (marks.length === 0) { styleEl.remove(); return { total: 0 }; }

  window.__searchHL = { marks: marks, currentIndex: 0, styleEl: styleEl };
  marks[0].classList.add('current');
  marks[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
  return { total: marks.length };
}

function _searchNavFn(delta) {
  const state = window.__searchHL;
  if (!state || state.marks.length === 0) return null;
  state.marks[state.currentIndex].classList.remove('current');
  state.currentIndex = (state.currentIndex + delta + state.marks.length) % state.marks.length;
  state.marks[state.currentIndex].classList.add('current');
  state.marks[state.currentIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
  return { currentIndex: state.currentIndex, total: state.marks.length };
}

function _searchClearFn() {
  const state = window.__searchHL;
  if (!state) return;
  state.marks.forEach(function(m) {
    const p = m.parentNode;
    if (p) { while (m.firstChild) p.insertBefore(m.firstChild, m); p.removeChild(m); }
  });
  document.body && document.body.normalize();
  if (state.styleEl) state.styleEl.remove();
  window.__searchHL = null;
}

// ─── Search highlight helpers (feature 85, updated for webview in feature 93) ─

function clearSearchHighlights(panelId) {
  const state = _searchHighlightState.get(panelId);
  if (!state) return;

  const webviewEl = getWebviewForPanel(panelId);
  if (webviewEl) {
    webviewEl.executeJavaScript(`(${_searchClearFn.toString()})()`).catch(() => {});
  }

  state.widgetEl?.remove();
  _searchHighlightState.delete(panelId);
}

function clearAllPanelHighlights() {
  for (const panel of TabState.getState().panels) {
    clearSearchHighlights(panel.id);
  }
}

async function navigateSearchHighlight(panelId, delta) {
  const state = _searchHighlightState.get(panelId);
  if (!state || state.total === 0) return;

  const webviewEl = getWebviewForPanel(panelId);
  if (!webviewEl) return;

  const result = await webviewEl.executeJavaScript(
    `(${_searchNavFn.toString()})(${delta})`
  ).catch(() => null);

  if (result) {
    state.currentIndex = result.currentIndex;
    const countEl = state.widgetEl?.querySelector('.search-nav-count');
    if (countEl) countEl.textContent = `${result.currentIndex + 1} of ${result.total}`;
  }
}

async function applySearchHighlights(webviewEl, panelId, query) {
  clearSearchHighlights(panelId);

  // --- Parse positive terms (same logic as before) ---
  let terms;
  if (query && /["']|-\S|type:\S/i.test(query)) {
    let normalised = query.replace(/[\u201C\u201D]/g, '"');
    const highlightTerms = [];
    let rem = '';
    let qi = 0;
    while (qi < normalised.length) {
      if (normalised[qi] === '"') {
        const close = normalised.indexOf('"', qi + 1);
        if (close === -1) { rem += normalised.slice(qi + 1); break; }
        const phrase = normalised.slice(qi + 1, close).trim();
        if (phrase) highlightTerms.push(...phrase.split(/\s+/).filter(Boolean));
        qi = close + 1;
      } else {
        rem += normalised[qi];
        qi++;
      }
    }
    for (const tok of rem.trim().split(/\s+/).filter(Boolean)) {
      if (/^-/.test(tok) || /^type:/i.test(tok)) continue;
      highlightTerms.push(tok);
    }
    terms = highlightTerms;
  } else {
    terms = query.trim().split(/\s+/).filter(Boolean);
  }
  if (terms.length === 0) return;

  const result = await webviewEl.executeJavaScript(
    `(${_searchHighlightFn.toString()})(${JSON.stringify(terms)})`
  ).catch(() => null);

  if (!result || result.total === 0) return;

  // Build renderer-side navigation widget
  const panelEl = document.querySelector(`.panel[data-panel-id="${panelId}"]`);
  const contentEl = panelEl?.querySelector('.panel-content');

  const widgetEl = document.createElement('div');
  widgetEl.className = 'search-nav-widget';

  const countEl = document.createElement('span');
  countEl.className = 'search-nav-count';
  countEl.textContent = `1 of ${result.total}`;

  const prevBtn = document.createElement('button');
  prevBtn.className = 'search-nav-btn search-nav-prev';
  prevBtn.title = 'Previous match (Shift+Enter)';
  prevBtn.textContent = '▲';

  const nextBtn = document.createElement('button');
  nextBtn.className = 'search-nav-btn search-nav-next';
  nextBtn.title = 'Next match (Enter)';
  nextBtn.textContent = '▼';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'search-nav-btn search-nav-close';
  closeBtn.title = 'Close highlights (Escape)';
  closeBtn.textContent = '✕';

  widgetEl.appendChild(countEl);
  widgetEl.appendChild(prevBtn);
  widgetEl.appendChild(nextBtn);
  widgetEl.appendChild(closeBtn);
  if (contentEl) contentEl.appendChild(widgetEl);

  _searchHighlightState.set(panelId, { total: result.total, currentIndex: 0, query, widgetEl });

  nextBtn.addEventListener('click', () => navigateSearchHighlight(panelId, 1));
  prevBtn.addEventListener('click', () => navigateSearchHighlight(panelId, -1));
  closeBtn.addEventListener('click', () => clearSearchHighlights(panelId));
}

// ─── Webview IPC handlers ─────────────────────────────────────────────────────

function handleOutlineScrollIPC(panelId, data) {
  const tab = TabState.getActiveTab(panelId);
  if (!tab) return;
  _activeHeadingId.set(tab.id, data ? data.activeHeadingId : null);
  updateOutlineHighlight(panelId);
}

function handleSelectionIPC(panelId, data) {
  if (!data) {
    if (currentSelection !== null) {
      currentSelection = null;
      _notifySelectionChange(null);
    }
    return;
  }

  const tab = TabState.getActiveTab(panelId);
  if (!tab || !tab.filePath) {
    if (currentSelection !== null) {
      currentSelection = null;
      _notifySelectionChange(null);
    }
    return;
  }

  currentSelection = {
    text: data.text,
    path: tab.filePath,
    noteTitle: tab.title || tab.filePath,
    panelId: panelId,
    rangeRect: data.rangeRect,
  };
  _notifySelectionChange(currentSelection);
}

function handleLinkClickIPC(panelId, data) {
  if (!data) return;

  if (data.type === 'external') {
    if (typeof data.url === 'string' && (data.url.startsWith('http://') || data.url.startsWith('https://'))) {
      window.api.openExternal(data.url);
    }
    return;
  }

  if (data.type === 'internal') {
    const href = data.href;
    if (typeof href !== 'string' || !href) return;

    const activeTab = TabState.getActiveTab(panelId);
    if (!activeTab) return;
    const resolvedPath = resolveInternalLink(activeTab.filePath, href);

    const node = findNodeByPath(currentTree, resolvedPath);
    if (!node || node.type !== 'file') {
      const missingName = resolvedPath.split('/').pop();
      _showSyncToast(`Note not found: ${missingName}`);
      return;
    }

    TabState.setFocusedPanel(panelId);
    selectNote(resolvedPath, null);
  }
}

// ─── Panel DOM creation ───────────────────────────────────────────────────────

function createPanelElement(panelId) {
  const panelData = TabState.getPanel(panelId);
  const panelEl = document.createElement('div');
  panelEl.className = 'panel';
  panelEl.dataset.panelId = panelId;
  panelEl.style.flex = panelData ? panelData.sizeRatio : 1;

  panelEl.addEventListener('mousedown', () => {
    if (TabState.getState().focusedPanelId !== panelId) {
      TabState.setFocusedPanel(panelId);
    }
  });

  const tabBarEl = document.createElement('div');
  tabBarEl.className = 'tab-bar';

  const contentEl = document.createElement('div');
  contentEl.className = 'panel-content';

  const emptyStateEl = document.createElement('div');
  emptyStateEl.className = 'empty-state';
  emptyStateEl.textContent = 'Select a note or ask AI to create one';

  const webviewContainerEl = document.createElement('div');
  webviewContainerEl.className = 'webview-container';

  contentEl.appendChild(emptyStateEl);
  contentEl.appendChild(webviewContainerEl);

  const conflictPanelContainerEl = document.createElement('div');
  conflictPanelContainerEl.className = 'conflict-panel-container hidden';
  contentEl.appendChild(conflictPanelContainerEl);

  const breadcrumbEl = document.createElement('div');
  breadcrumbEl.className = 'breadcrumb-bar breadcrumb-empty';

  panelEl.appendChild(tabBarEl);
  panelEl.appendChild(breadcrumbEl);
  panelEl.appendChild(contentEl);
  return panelEl;
}

function getWebviewForPanel(panelId) {
  return getActiveWebviewForPanel(panelId);
}

// ─── Per-tab webview management ──────────────────────────────────────────────

const _tabWebviews = new Map(); // tabId → webview element

function createWebviewForTab(tabId, panelId) {
  const panelEl = document.querySelector(`.panel[data-panel-id="${panelId}"]`);
  if (!panelEl) return null;
  const containerEl = panelEl.querySelector('.webview-container');
  if (!containerEl) return null;

  const wv = document.createElement('webview');
  wv.className = 'note-frame hidden';
  wv.setAttribute('data-tab-id', tabId);
  wv.setAttribute('preload', _notePreloadUrl);
  wv.setAttribute('webpreferences', 'contextIsolation=yes');
  wv.setAttribute('src', 'about:blank');

  // Inject CSS and theme on every navigation
  wv.addEventListener('dom-ready', () => {
    // Web-clipped pages have their own inlined CSS — skip note-viewer styles
    // to avoid overriding the archived page's original appearance.
    wv.executeJavaScript(
      `!!document.querySelector('meta[name="source-url"]')`
    ).then(isClip => {
      if (!isClip) wv.insertCSS(NOTE_CSS).catch(() => {});
    }).catch(() => {
      wv.insertCSS(NOTE_CSS).catch(() => {});
    });
    if (document.documentElement.getAttribute('data-theme') === 'light') {
      wv.executeJavaScript(
        `document.documentElement.setAttribute('data-theme', 'light')`
      ).catch(() => {});
    }
  });

  // IPC — resolve panelId dynamically so tab-move works without re-attaching
  wv.addEventListener('ipc-message', (event) => {
    const currentPanelId = wv.closest('.panel')?.dataset?.panelId;
    if (!currentPanelId) return;
    if (event.channel === 'outline-scroll') {
      handleOutlineScrollIPC(currentPanelId, event.args[0]);
    } else if (event.channel === 'selection-changed') {
      handleSelectionIPC(currentPanelId, event.args[0]);
    } else if (event.channel === 'link-click') {
      handleLinkClickIPC(currentPanelId, event.args[0]);
    }
  });

  // Track initial about:blank load completion
  _webviewGuestReady.set(tabId, new Promise(resolve => {
    wv.addEventListener('dom-ready', resolve, { once: true });
  }));

  containerEl.appendChild(wv);
  _tabWebviews.set(tabId, wv);
  return wv;
}

function cleanupTabWebview(tabId) {
  const wv = _tabWebviews.get(tabId);
  if (wv) {
    wv.remove();
    _tabWebviews.delete(tabId);
  }
  _outlineTrees.delete(tabId);
  _outlineGeneration.delete(tabId);
  _webviewGuestReady.delete(tabId);
  _outlineFlatEntries.delete(tabId);
  _activeHeadingId.delete(tabId);
  _searchHighlightState.delete(tabId);
}

function getWebviewForTab(tabId) {
  return _tabWebviews.get(tabId) || null;
}

function getActiveWebviewForPanel(panelId) {
  const tab = TabState.getActiveTab(panelId);
  return tab ? getWebviewForTab(tab.id) : null;
}

function createDividerElement() {
  const divEl = document.createElement('div');
  divEl.className = 'divider';
  return divEl;
}

function updateViewerDirection(direction) {
  const viewerEl = document.getElementById('viewer');
  viewerEl.classList.toggle('vertical', direction === 'vertical');
}

function addPanelToDOM(panelId, insertBeforePanelId = null) {
  const viewerEl = document.getElementById('viewer');
  const newPanelEl = createPanelElement(panelId);

  if (insertBeforePanelId) {
    const targetEl = viewerEl.querySelector(`.panel[data-panel-id="${insertBeforePanelId}"]`);
    if (targetEl) {
      // Insert: [..., newPanelEl, dividerEl, targetEl, ...]
      const divEl = createDividerElement();
      setupDividerDrag(divEl);
      viewerEl.insertBefore(newPanelEl, targetEl);
      viewerEl.insertBefore(divEl, targetEl);
      return;
    }
  }

  // Default: append at end
  if (viewerEl.querySelector('.panel')) {
    const divEl = createDividerElement();
    setupDividerDrag(divEl);
    viewerEl.appendChild(divEl);
  }
  viewerEl.appendChild(newPanelEl);
}

function removePanelFromDOM(panelId) {
  const panelEl = document.querySelector(`.panel[data-panel-id="${panelId}"]`);
  if (!panelEl) return;
  // Remove the adjacent divider (prefer the preceding one)
  const prev = panelEl.previousElementSibling;
  if (prev && prev.classList.contains('divider')) {
    prev.remove();
  } else {
    const next = panelEl.nextElementSibling;
    if (next && next.classList.contains('divider')) next.remove();
  }
  panelEl.remove();
}

function updatePanelFocusIndicator(snapshot) {
  const panels = document.querySelectorAll('.panel');
  const showIndicator = snapshot.panels.length > 1;
  for (const panelEl of panels) {
    const isFocused = showIndicator && panelEl.dataset.panelId === snapshot.focusedPanelId;
    panelEl.classList.toggle('focused', isFocused);
  }
}

function rebuildAllPanelsDOM() {
  const viewerEl = document.getElementById('viewer');
  while (viewerEl.firstChild) viewerEl.removeChild(viewerEl.firstChild);

  const state = TabState.getState();
  updateViewerDirection(state.splitDirection);

  for (let i = 0; i < state.panels.length; i++) {
    if (i > 0) {
      const divEl = createDividerElement();
      setupDividerDrag(divEl);
      viewerEl.appendChild(divEl);
    }
    viewerEl.appendChild(createPanelElement(state.panels[i].id));
  }

  updatePanelFocusIndicator(state);

  for (const panel of state.panels) {
    renderTabBar(panel.id);
    loadContentForTab(panel.id);
  }
  renderOutlinePanel();
  renderBacklinksSection();
  renderTitleBarSplitActions();
}

// ─── Divider drag-to-resize ───────────────────────────────────────────────────

const MIN_PANEL_PX = 100; // minimum panel size in pixels during drag

function setupDividerDrag(divEl) {
  divEl.addEventListener('mousedown', (e) => {
    e.preventDefault();

    const viewerEl = document.getElementById('viewer');
    const isVertical = viewerEl.classList.contains('vertical');

    const prevPanel = divEl.previousElementSibling;
    const nextPanel = divEl.nextElementSibling;
    if (!prevPanel || !nextPanel) return;

    const prevPanelId = prevPanel.dataset.panelId;
    const nextPanelId = nextPanel.dataset.panelId;

    const startPos = isVertical ? e.clientY : e.clientX;
    const containerSize = isVertical
      ? viewerEl.getBoundingClientRect().height
      : viewerEl.getBoundingClientRect().width;

    const prevStartFlex = parseFloat(prevPanel.style.flex) || 1;
    const nextStartFlex = parseFloat(nextPanel.style.flex) || 1;
    const totalFlex = prevStartFlex + nextStartFlex;
    const minFlex = (MIN_PANEL_PX / containerSize) * totalFlex;

    divEl.classList.add('dragging');
    document.body.style.userSelect = 'none';
    // Disable pointer-events on all iframes to prevent event capture
    document.querySelectorAll('.panel .note-frame').forEach(f => { f.style.pointerEvents = 'none'; });

    let newPrevFlex = prevStartFlex;
    let newNextFlex = nextStartFlex;

    function onMouseMove(e) {
      const delta = (isVertical ? e.clientY : e.clientX) - startPos;
      const deltaFlex = (delta / containerSize) * totalFlex;
      newPrevFlex = Math.max(minFlex, prevStartFlex + deltaFlex);
      newNextFlex = Math.max(minFlex, nextStartFlex - deltaFlex);
      prevPanel.style.flex = newPrevFlex;
      nextPanel.style.flex = newNextFlex;
    }

    function onMouseUp() {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      divEl.classList.remove('dragging');
      document.body.style.userSelect = '';
      document.querySelectorAll('.panel .note-frame').forEach(f => { f.style.pointerEvents = ''; });
      // Persist final sizes to TabState (data only; DOM already updated by drag)
      TabState.setPanelSize(prevPanelId, newPrevFlex);
      TabState.setPanelSize(nextPanelId, newNextFlex);
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
}

// ─── Startup: create panel elements from initial TabState ─────────────────────

(function initPanels() {
  const viewerEl = document.getElementById('viewer');
  const state = TabState.getState();
  updateViewerDirection(state.splitDirection);
  for (const panel of state.panels) {
    viewerEl.appendChild(createPanelElement(panel.id));
  }
  updatePanelFocusIndicator(state);
})();

let currentTree = null;
let selectedPath = null;
let _saveTimeout = null;
let isBusy = false;
let thinkingIndicator = null;
let expandedPaths = new Set();
let currentWorkspacePath = null;
function noteIdFromPath(filePath) {
  const rel = (currentWorkspacePath && filePath.startsWith(currentWorkspacePath + '/'))
    ? filePath.slice(currentWorkspacePath.length + 1)
    : filePath.split('/').pop();
  return rel.replace(/\/index\.html$/, '');
}
let attachments = []; // { blob, filename, mimeType, objectUrl }
let isFiltering = false;
let savedExpandedPaths = null;
let filenameMatchCollapsed = false;
let contentMatchCollapsed = false;

// Tags sidebar panel (feature 98)
let allTags = [];                // [{ tag, count }] — last fetched list
let tagsSortMode = 'alpha';      // 'alpha' | 'count'
let activeTagFilters = new Set();// Set<string> of selected tag names
let tagFilterLogic = 'AND';      // 'AND' | 'OR'
let tagFilterPaths = null;       // Set<string> of file paths matching current filter
let lastContentParsed = null;    // parsed query object from last content search
let contentSearchResults = null; // cached results or null
let searchDebounceTimer = null;  // debounce handle
let contextMenuTarget = null; // { path, type: 'file'|'folder', li }
let inlineEditActive = false; // true when an inline rename/create input is visible
let streamingBubble = null;   // the current in-progress assistant bubble during streaming
let streamingText = "";       // accumulated raw Markdown text for the streaming bubble
let streamingContent = null;  // the .msg-content child div of streamingBubble
let isAtBottom = true;  // false when user has scrolled up; gates auto-scroll

// ─── Conflict State (feature 73) ─────────────────────────────────────────────
let _conflictPaths = new Set();   // relative filePaths currently in conflict
let _conflictData = [];           // full objects: { filePath, localContent, remoteContent }
let currentConversation = null; // { id, sessionId, title, createdAt, updatedAt, messages: [] }
let pendingAssistantText = "";  // accumulates non-streaming assistant text before save
let historyItems = [];          // cached list from last listConversations() call

// --- Context state ---
let contextItems = []; // { type, content?, path?, noteTitle? }
let activeNoteToggleOn = false;
let currentSelection = null;
// Shape when populated:
// { text: string, path: string, noteTitle: string, panelId: string }
// null when no selection is active

let _selectionChangeCallback = null;

function setOnSelectionChange(callback) {
  _selectionChangeCallback = callback;
}

function _notifySelectionChange(sel) {
  if (typeof _selectionChangeCallback === 'function') {
    _selectionChangeCallback(sel);
  }
}

// --- @ trigger state ---
let atTrigger = null;
// Shape when active: { active: true, query: string, atIndex: number }
// null when inactive

let _atTriggerChangeCallback = null;

function setOnAtTriggerChange(callback) {
  _atTriggerChangeCallback = callback;
}

function _notifyAtTriggerChange() {
  if (typeof _atTriggerChangeCallback === 'function') {
    _atTriggerChangeCallback(atTrigger);
  }
}

function updateAtTrigger() {
  const cursorPos = aiInput.selectionStart;
  const textBeforeCursor = aiInput.value.slice(0, cursorPos);

  // Scan backward for the last '@' before the cursor
  const atPos = textBeforeCursor.lastIndexOf('@');

  if (atPos === -1) {
    if (atTrigger !== null) {
      atTrigger = null;
      _notifyAtTriggerChange();
    }
    return;
  }

  // Validate: '@' must be at position 0 or preceded by whitespace
  if (atPos > 0 && !/\s/.test(textBeforeCursor[atPos - 1])) {
    if (atTrigger !== null) {
      atTrigger = null;
      _notifyAtTriggerChange();
    }
    return;
  }

  // Extract query: text between '@' and cursor
  const query = textBeforeCursor.slice(atPos + 1);

  // If query contains whitespace, the trigger has closed naturally
  if (/\s/.test(query)) {
    if (atTrigger !== null) {
      atTrigger = null;
      _notifyAtTriggerChange();
    }
    return;
  }

  // Activate or update trigger
  const newTrigger = { active: true, query, atIndex: atPos };
  const changed =
    atTrigger === null ||
    atTrigger.query !== query ||
    atTrigger.atIndex !== atPos;
  if (changed) {
    atTrigger = newTrigger;
    _notifyAtTriggerChange();
  }
}

// --- @ dropdown helpers ---

function flattenNoteTree(node) {
  const files = [];
  function walk(n) {
    if (n.type === 'file') {
      const baseName = (n.name || '').replace(/\.[^.]+$/, '');
      files.push({ name: baseName, path: n.path, title: n.title || null, mtime: n.mtime || 0 });
    } else if (n.type === 'note') {
      files.push({ name: n.name || '', path: n.path, title: n.title || null, mtime: n.mtime || 0 });
    }
    if (n.children) {
      for (const child of n.children) walk(child);
    }
  }
  if (Array.isArray(node)) {
    for (const child of node) walk(child);
  } else {
    walk(node);
  }
  files.sort((a, b) => b.mtime - a.mtime);
  return files;
}

function filterNotes(notes, query) {
  if (!query) return notes.slice(0, 50);
  const q = query.toLowerCase();
  const results = notes.filter((n) => {
    const name = (n.name || '').toLowerCase();
    const title = (n.title || '').toLowerCase();
    return name.includes(q) || title.includes(q);
  });
  results.sort((a, b) => {
    const aLabel = (a.title || a.name).toLowerCase();
    const bLabel = (b.title || b.name).toLowerCase();
    const aPfx = aLabel.startsWith(q) ? 0 : 1;
    const bPfx = bLabel.startsWith(q) ? 0 : 1;
    if (aPfx !== bPfx) return aPfx - bPfx;
    return b.mtime - a.mtime;
  });
  return results;
}

// --- @ dropdown state and lifecycle ---

let dropdownNotes = [];
let dropdownFiltered = [];
let dropdownSelectedIndex = 0;

let _onNoteSelectedCallback = null;

function setOnNoteSelected(callback) {
  _onNoteSelectedCallback = callback;
}

function renderDropdown() {
  atDropdown.innerHTML = '';
  if (dropdownFiltered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'at-dropdown-empty';
    empty.textContent = 'No matching notes';
    atDropdown.appendChild(empty);
    return;
  }
  const limit = Math.min(dropdownFiltered.length, 8);
  for (let i = 0; i < limit; i++) {
    const note = dropdownFiltered[i];
    const item = document.createElement('div');
    item.className = 'at-dropdown-item' + (i === dropdownSelectedIndex ? ' active' : '');
    item.dataset.index = i;
    const label = note.title || note.name;
    const labelSpan = document.createElement('span');
    labelSpan.textContent = label;
    item.appendChild(labelSpan);
    if (note.title && note.title !== note.name) {
      const sub = document.createElement('span');
      sub.className = 'at-dropdown-item-sub';
      sub.textContent = note.name;
      item.appendChild(sub);
    }
    atDropdown.appendChild(item);
  }
  const activeEl = atDropdown.querySelector('.at-dropdown-item.active');
  if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
}

async function showDropdown(triggerState) {
  const tree = await window.api.listNotes();
  dropdownNotes = flattenNoteTree(tree);
  dropdownFiltered = filterNotes(dropdownNotes, triggerState.query);
  dropdownSelectedIndex = 0;
  renderDropdown();
  atDropdown.classList.remove('hidden');
}

function updateDropdown(query) {
  dropdownFiltered = filterNotes(dropdownNotes, query);
  dropdownSelectedIndex = 0;
  renderDropdown();
}

function hideDropdown() {
  atDropdown.classList.add('hidden');
  atDropdown.innerHTML = '';
  dropdownNotes = [];
  dropdownFiltered = [];
  dropdownSelectedIndex = 0;
}

function selectDropdownItem(index) {
  const note = dropdownFiltered[index];
  if (!note) return;
  const atIndex = atTrigger ? atTrigger.atIndex : undefined;
  const query = atTrigger ? atTrigger.query : undefined;
  atTrigger = null;
  _notifyAtTriggerChange(); // fires callback → hideDropdown()
  if (typeof _onNoteSelectedCallback === 'function') {
    _onNoteSelectedCallback({ note, atIndex, query });
  }
}

// type: "selection" | "note-ref" | "active-note"
// selection: content (string), path (string), noteTitle (string)
// note-ref: path (string), noteTitle (string)
// active-note: path (string), noteTitle (string)

function onContextItemsChanged() {
  renderContextBar();
  // Push quote selections to .context/ folder for external tools
  _pushContextQuotes();
}

function _pushContextQuotes() {
  const quotes = contextItems.filter(ci => ci.type === 'selection');
  window.api.updateContextQuotes(quotes);
}

function _pushContextCurrentNote() {
  const focusedPanel = TabState.getFocusedPanel();
  const activeTab = focusedPanel ? TabState.getActiveTab(focusedPanel.id) : null;
  if (activeTab && activeTab.filePath) {
    window.api.updateContextCurrentNote({
      path: activeTab.filePath,
      noteTitle: activeTab.title || activeTab.filePath,
      noteId: noteIdFromPath(activeTab.filePath),
    });
  } else {
    window.api.updateContextCurrentNote(null);
  }
}

function addContextItem(item) {
  // Deduplicate: for note-ref and active-note, skip if same path already present
  // Exception: active-note replaces note-ref (persistent replaces transient)
  if (item.type === 'note-ref' || item.type === 'active-note') {
    const existingIndex = contextItems.findIndex(
      (ci) => (ci.type === 'note-ref' || ci.type === 'active-note') && ci.path === item.path
    );
    if (existingIndex !== -1) {
      if (item.type === 'active-note' && contextItems[existingIndex].type === 'note-ref') {
        contextItems.splice(existingIndex, 1);
      } else {
        return;
      }
    }
  }
  if (item.type === 'selection') {
    const duplicate = contextItems.some(
      (ci) => ci.type === 'selection' && ci.content === item.content && ci.path === item.path
    );
    if (duplicate) return;
  }
  contextItems.push(item);
  onContextItemsChanged();
}

function removeContextItem(index) {
  if (index >= 0 && index < contextItems.length) {
    contextItems.splice(index, 1);
    onContextItemsChanged();
  }
}

function clearContextItems() {
  contextItems = [];
  onContextItemsChanged();
}

function clearTransientContextItems() {
  contextItems = contextItems.filter((ci) => ci.type === 'active-note');
  onContextItemsChanged();
}

function updateActiveNoteToggleUI() {
  aiActiveNoteToggle.classList.toggle('active', activeNoteToggleOn);
  aiActiveNoteToggle.setAttribute('aria-pressed', String(activeNoteToggleOn));
}

function saveActiveNoteToggle() {
  if (!currentWorkspacePath) return;
  localStorage.setItem('activeNoteToggle:' + currentWorkspacePath, JSON.stringify(activeNoteToggleOn));
}

function loadActiveNoteToggle(wsPath) {
  const raw = localStorage.getItem('activeNoteToggle:' + wsPath);
  activeNoteToggleOn = raw ? JSON.parse(raw) === true : false;
  updateActiveNoteToggleUI();
}

function getContextItems() {
  return contextItems;
}

// Track last-sent context parts to avoid resending unchanged data
let _lastSentContext = { selections: '', noteRefs: '', kvSchema: '', memory: '', location: '' };

function resetLastSentContext() {
  _lastSentContext = { selections: '', noteRefs: '', kvSchema: '', memory: '', location: '' };
}

function buildContextBlock(items, perNoteContext, locationNoteId) {
  if (items.length === 0 && !perNoteContext && !locationNoteId) return '';

  const selections = items.filter((ci) => ci.type === 'selection');
  const noteRefs = items.filter((ci) => ci.type === 'note-ref' || ci.type === 'active-note');

  // Build each part independently
  let selBlock = '';
  for (const sel of selections) {
    selBlock += `\n<selected-text note="${sel.noteTitle}" path="${sel.path}">\n${sel.content}\n</selected-text>`;
  }

  let refBlock = '';
  if (noteRefs.length > 0) {
    const refList = noteRefs.map((ref) => `- ${ref.path}`).join('\n');
    refBlock = `\n<referenced-notes instruction="These are notes the user currently has open. Read these files for context.">\n${refList}\n</referenced-notes>`;
  }

  let kvBlock = '';
  if (perNoteContext && perNoteContext.kvSchema) {
    const kvList = Object.entries(perNoteContext.kvSchema).map(([key, type]) => `- ${key}: ${type}`).join('\n');
    kvBlock = `\n<kv-schema note="${perNoteContext.noteTitle}">\n${kvList}\n</kv-schema>`;
  }

  let memBlock = '';
  if (perNoteContext && perNoteContext.memory) {
    memBlock = `\n<note-memory note="${perNoteContext.noteTitle}">\n${perNoteContext.memory}\n</note-memory>`;
  }

  let locBlock = '';
  if (locationNoteId) {
    locBlock = `\n[user is in ${locationNoteId}]`;
  }

  // Only include parts that changed since last send
  const parts = [];
  if (locBlock !== _lastSentContext.location) parts.push(locBlock);
  if (selBlock !== _lastSentContext.selections) parts.push(selBlock);
  if (refBlock !== _lastSentContext.noteRefs) parts.push(refBlock);
  if (kvBlock !== _lastSentContext.kvSchema) parts.push(kvBlock);
  if (memBlock !== _lastSentContext.memory) parts.push(memBlock);

  // Update last-sent state
  _lastSentContext = { selections: selBlock, noteRefs: refBlock, kvSchema: kvBlock, memory: memBlock, location: locBlock };

  const changed = parts.filter(Boolean);
  if (changed.length === 0) return '';

  return '<notes-app-context>' + changed.join('') + '\n</notes-app-context>';
}

// --- Drag & drop state ---
let dragSourcePath = null;   // full filesystem path of the item being dragged
let dragSourceType = null;   // 'file' or 'folder'
let currentDropTarget = null; // DOM element currently highlighted as drop target
let dragExpandTimer = null;   // setTimeout ID for auto-expand on hover
let dragExpandPath = null;    // path of the folder being hovered for auto-expand
let dragScrollRAF = null;     // requestAnimationFrame ID for auto-scroll
let dragFileCounter = 0;     // tracks dragenter/dragleave balance for file drops

// --- Tab drag state ---
let tabDragSourceId = null;      // tab.id of the tab being dragged
let tabDragPanelId = null;       // panelId of the dragged tab
let tabDragOriginalIndex = -1;   // index of the tab before drag started
let tabDragIsPinned = false;     // whether the dragged tab is pinned
let tabDragScrollRAF = null;     // requestAnimationFrame ID for tab-bar auto-scroll

// --- Favorites drag state ---
let favDragSourceRelPath = null; // relPath of the favorite being dragged
let favDragSourceEl = null;      // the <li> element being dragged
let favDragScrollRAF = null;     // requestAnimationFrame ID for favorites auto-scroll

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MIN_SIDEBAR_WIDTH = 140;

function updateChatTitle(title, fullTitle) {
  const text = title || 'New conversation';
  aiChatTitle.textContent = text;
  aiChatTitle.title = fullTitle || text;
}

function newConversationObj() {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    sessionId: null,
    title: null,
    createdAt: now,
    updatedAt: now,
    messages: [],
    provider: aiProviderSelect.value || 'openclaw',
    model: aiModelSelect.value || null,
    effort: aiEffortSelect.value || null,
    permissionMode: aiPermissionSelect.value || null,
  };
}

async function saveCurrentConversationIfNeeded() {
  if (currentConversation && currentConversation.messages.length > 0) {
    await window.api.saveConversation(currentConversation);
  }
}

// --- Scroll-to-bottom observer ---

const scrollSentinelObserver = new IntersectionObserver(
  ([entry]) => {
    isAtBottom = entry.isIntersecting;
    aiScrollBottom.classList.toggle("hidden", isAtBottom);
  },
  { root: aiMessages, rootMargin: "0px 0px 40px 0px" }
);
scrollSentinelObserver.observe(aiScrollSentinel);

aiScrollBottom.addEventListener("click", () => {
  aiMessages.scrollTo({ top: aiMessages.scrollHeight, behavior: "smooth" });
});
const MAX_SIDEBAR_WIDTH = 500;
const MIN_RIGHT_PANEL_WIDTH = 120;
const MAX_RIGHT_PANEL_WIDTH = 500;

// --- File type icons (inline SVG, 16x16, Bootstrap Icons — MIT license) ---

const ICONS = {
  folder: '<svg fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M9.828 3h3.982a2 2 0 0 1 1.992 2.181l-.637 7A2 2 0 0 1 13.174 14H2.825a2 2 0 0 1-1.991-1.819l-.637-7a2 2 0 0 1 .342-1.31L.5 3a2 2 0 0 1 2-2h3.672a2 2 0 0 1 1.414.586l.828.828A2 2 0 0 0 9.828 3m-8.322.12q.322-.119.684-.12h5.396l-.707-.707A1 1 0 0 0 6.172 2H2.5a1 1 0 0 0-1 .981z"/></svg>',
  folderOpen: '<svg fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h2.764c.958 0 1.76.56 2.311 1.184C7.985 3.648 8.48 4 9 4h4.5A1.5 1.5 0 0 1 15 5.5v.64c.57.265.94.876.856 1.546l-.64 5.124A2.5 2.5 0 0 1 12.733 15H3.266a2.5 2.5 0 0 1-2.481-2.19l-.64-5.124A1.5 1.5 0 0 1 1 6.14zM2 6h12v-.5a.5.5 0 0 0-.5-.5H9c-.964 0-1.71-.629-2.174-1.154C6.374 3.334 5.82 3 5.264 3H2.5a.5.5 0 0 0-.5.5zm-.367 1a.5.5 0 0 0-.496.562l.64 5.124A1.5 1.5 0 0 0 3.266 14h9.468a1.5 1.5 0 0 0 1.489-1.314l.64-5.124A.5.5 0 0 0 14.367 7z"/></svg>',
  html: '<svg fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M9.293 0H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.707A1 1 0 0 0 13.707 4L10 .293A1 1 0 0 0 9.293 0M9.5 3.5v-2l3 3h-2a1 1 0 0 1-1-1M6.646 7.646a.5.5 0 1 1 .708.708L5.707 10l1.647 1.646a.5.5 0 0 1-.708.708l-2-2a.5.5 0 0 1 0-.708zm2.708 0 2 2a.5.5 0 0 1 0 .708l-2 2a.5.5 0 0 1-.708-.708L10.293 10 8.646 8.354a.5.5 0 1 1 .708-.708"/></svg>',
  markdown: '<svg fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M0 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2zm11.5 1a.5.5 0 0 0-.5.5v3.793L9.854 8.146a.5.5 0 1 0-.708.708l2 2a.5.5 0 0 0 .708 0l2-2a.5.5 0 0 0-.708-.708L12 9.293V5.5a.5.5 0 0 0-.5-.5M3.56 7.01h.056l1.428 3.239h.774l1.42-3.24h.056V11h1.073V5.001h-1.2l-1.71 3.894h-.039l-1.71-3.894H2.5V11h1.06z"/></svg>',
  image: '<svg fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 0h5.293A1 1 0 0 1 10 .293L13.707 4a1 1 0 0 1 .293.707v5.586l-2.73-2.73a1 1 0 0 0-1.52.127l-1.889 2.644-1.769-1.062a1 1 0 0 0-1.222.15L2 12.292V2a2 2 0 0 1 2-2m5.5 1.5v2a1 1 0 0 0 1 1h2zm-1.498 4a1.5 1.5 0 1 0-3 0 1.5 1.5 0 0 0 3 0"/><path d="M10.564 8.27 14 11.708V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-.293l3.578-3.577 2.56 1.536 2.426-3.395z"/></svg>',
  text: '<svg fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M9.293 0H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.707A1 1 0 0 0 13.707 4L10 .293A1 1 0 0 0 9.293 0M9.5 3.5v-2l3 3h-2a1 1 0 0 1-1-1M4.5 9a.5.5 0 0 1 0-1h7a.5.5 0 0 1 0 1zM4 10.5a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5m.5 2.5a.5.5 0 0 1 0-1h4a.5.5 0 0 1 0 1z"/></svg>',
  generic: '<svg fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 0h5.293A1 1 0 0 1 10 .293L13.707 4a1 1 0 0 1 .293.707V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2m5.5 1.5v2a1 1 0 0 0 1 1h2z"/></svg>',
  copy: '<svg fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 1.5H3a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3.5a2 2 0 0 0-2-2h-1v1h1a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1h1z"/><path d="M9.5 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5zm-3-1A1.5 1.5 0 0 0 5 1.5v1A1.5 1.5 0 0 0 6.5 4h3A1.5 1.5 0 0 0 11 2.5v-1A1.5 1.5 0 0 0 9.5 0z"/></svg>',
  check: '<svg fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0"/></svg>',
  edit: '<svg fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M12.854.146a.5.5 0 0 0-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 0 0 0-.708zm.646 6.061L9.793 2.5 3.293 9H3.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.207zm-7.468 7.468A.5.5 0 0 1 6 13.5V13h-.5a.5.5 0 0 1-.5-.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.5-.5V10h-.5a.499.499 0 0 1-.175-.032l-.179.178a.5.5 0 0 0-.11.168l-2 5a.5.5 0 0 0 .65.65l5-2a.5.5 0 0 0 .168-.11z"/></svg>',
  regenerate: '<svg fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path fill-rule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2z"/><path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466"/></svg>',
  quote: '<svg fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M12 12a1 1 0 0 0 1-1V8.558a1 1 0 0 0-1-1h-1.388q0-.527.062-1.054.093-.558.31-.992t.559-.683q.34-.279.868-.279V3q-.868 0-1.52.372a3.3 3.3 0 0 0-1.085.992 4.9 4.9 0 0 0-.62 1.458A7.7 7.7 0 0 0 9 7.558V11a1 1 0 0 0 1 1zm-6 0a1 1 0 0 0 1-1V8.558a1 1 0 0 0-1-1H4.612q0-.527.062-1.054.094-.558.31-.992.217-.434.559-.683.34-.279.868-.279V3q-.868 0-1.52.372a3.3 3.3 0 0 0-1.085.992 4.9 4.9 0 0 0-.62 1.458A7.7 7.7 0 0 0 3 7.558V11a1 1 0 0 0 1 1z"/></svg>',
  fileEarmark: '<svg fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 0h5.293A1 1 0 0 1 10 .293L13.707 4a1 1 0 0 1 .293.707V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2m5.5 1.5v2a1 1 0 0 0 1 1h2z"/></svg>',
  eye: '<svg fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M16 8s-3-5.5-8-5.5S0 8 0 8s3 5.5 8 5.5S16 8 16 8M1.173 8a13 13 0 0 1 1.66-2.043C4.12 4.668 5.88 3.5 8 3.5s3.879 1.168 5.168 2.457A13 13 0 0 1 14.828 8q-.086.13-.195.288c-.335.48-.83 1.12-1.465 1.755C11.879 11.332 10.119 12.5 8 12.5s-3.879-1.168-5.168-2.457A13 13 0 0 1 1.172 8z"/><path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5M4.5 8a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0"/></svg>',
  starOutline: '<svg fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.866 14.85c-.078.444.36.791.746.593l4.39-2.256 4.389 2.256c.386.198.824-.149.746-.592l-.83-4.73 3.522-3.356c.33-.314.16-.888-.282-.95l-4.898-.696L8.465.792a.513.513 0 0 0-.927 0L5.354 5.12l-4.898.696c-.441.062-.612.636-.283.95l3.523 3.356-.83 4.73zm4.905-2.767-3.686 1.894.694-3.957a.56.56 0 0 0-.163-.505L1.71 6.745l4.052-.576a.53.53 0 0 0 .393-.288L8 2.223l1.847 3.658a.53.53 0 0 0 .393.288l4.052.575-2.906 2.77a.56.56 0 0 0-.163.506l.694 3.957-3.686-1.894a.5.5 0 0 0-.46 0z"/></svg>',
  starFilled: '<svg fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.612 15.443c-.386.198-.824-.149-.746-.592l.83-4.73L.173 6.765c-.329-.314-.158-.888.283-.95l4.898-.696L7.538.792c.197-.39.73-.39.927 0l2.184 4.327 4.898.696c.441.062.612.636.282.95l-3.522 3.356.83 4.73c.078.443-.36.79-.746.592L8 13.187l-4.389 2.256z"/></svg>',
  link45: '<svg fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.715 6.542 3.343 7.914a3 3 0 1 0 4.243 4.243l1.828-1.829A3 3 0 0 0 8.586 5.5L8 6.086a1 1 0 0 0-.154.199 2 2 0 0 1 .861 3.337L6.88 11.45a2 2 0 1 1-2.83-2.83l.793-.792a4 4 0 0 1-.128-1.287z"/><path d="M6.586 4.672A3 3 0 0 0 7.414 9.5l.775-.776a2 2 0 0 1-.896-3.346L9.12 3.55a2 2 0 1 1 2.83 2.83l-.793.792c.112.42.155.855.128 1.287l1.372-1.372a3 3 0 1 0-4.243-4.243z"/></svg>',
  pdf: '<svg fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M5.523 12.424q.21-.124.459-.238a8 8 0 0 1-.45.606c-.28.337-.498.516-.635.572l-.035.012a.3.3 0 0 1-.026-.044c-.056-.11-.054-.216.04-.36.106-.165.319-.354.647-.548m2.455-1.647q-.178.037-.356.078a21 21 0 0 0 .5-1.05 12 12 0 0 0 .51.858q-.326.048-.654.114m2.525.939a4 4 0 0 1-.435-.41q.344.007.612.054c.317.057.466.147.518.209a.1.1 0 0 1 .026.064.44.44 0 0 1-.06.2.3.3 0 0 1-.094.124.1.1 0 0 1-.069.015c-.09-.003-.258-.066-.498-.256M8.278 6.97c-.04.244-.108.524-.2.829a5 5 0 0 1-.089-.346c-.076-.353-.087-.63-.046-.822.038-.177.11-.248.196-.283a.5.5 0 0 1 .145-.04c.013.03.028.092.032.198q.008.183-.038.465z"/><path fill-rule="evenodd" d="M4 0h5.293A1 1 0 0 1 10 .293L13.707 4a1 1 0 0 1 .293.707V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2m5.5 1.5v2a1 1 0 0 0 1 1h2zM4.165 13.668c.09.18.23.343.438.419.207.075.412.04.58-.03.318-.13.635-.436.926-.786.333-.401.683-.927 1.021-1.51a11.7 11.7 0 0 1 1.997-.406c.3.383.61.713.91.95.28.22.603.403.934.417a.86.86 0 0 0 .51-.138c.155-.101.27-.247.354-.416.09-.181.145-.37.138-.563a.84.84 0 0 0-.2-.518c-.226-.27-.596-.4-.96-.465a5.8 5.8 0 0 0-1.335-.05 11 11 0 0 1-.98-1.686c.25-.66.437-1.284.52-1.794.036-.218.055-.426.048-.614a1.24 1.24 0 0 0-.127-.538.7.7 0 0 0-.477-.365c-.202-.043-.41 0-.601.077-.377.15-.576.47-.651.823-.073.34-.04.736.046 1.136.088.406.238.848.43 1.295a20 20 0 0 1-1.062 2.227 7.7 7.7 0 0 0-1.482.645c-.37.22-.699.48-.897.787-.21.326-.275.714-.08 1.103"/></svg>',
  spreadsheet: '<svg fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 12v-2h3v2z"/><path d="M9.293 0H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.707A1 1 0 0 0 13.707 4L10 .293A1 1 0 0 0 9.293 0M9.5 3.5v-2l3 3h-2a1 1 0 0 1-1-1M3 9h10v1h-3v2h3v1h-3v2H9v-2H6v2H5v-2H3v-1h2v-2H3z"/></svg>',
};

// --- Sort comparators ---

const SORT_COMPARATORS = {
  name: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  mtime: (a, b) => (b.mtime || 0) - (a.mtime || 0) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  type: (a, b) => {
    const extA = a.name.lastIndexOf('.') !== -1 ? a.name.slice(a.name.lastIndexOf('.')).toLowerCase() : '';
    const extB = b.name.lastIndexOf('.') !== -1 ? b.name.slice(b.name.lastIndexOf('.')).toLowerCase() : '';
    if (extA !== extB) {
      if (!extA) return 1;
      if (!extB) return -1;
      return extA.localeCompare(extB);
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  },
};

function sortTree(children, mode) {
  const cmp = SORT_COMPARATORS[mode] || SORT_COMPARATORS.name;
  children.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return cmp(a, b);
  });
  for (const child of children) {
    if (child.type === 'folder' && child.children) {
      sortTree(child.children, mode);
    }
  }
}

let _currentSortMode = 'name';

function getSortMode() {
  return _currentSortMode;
}

function _updateSortChecks() {
  document.querySelectorAll('.sidebar-sub-menu [data-sort]').forEach(el => {
    const check = el.querySelector('.sort-check');
    if (check) check.classList.toggle('active', el.dataset.sort === _currentSortMode);
  });
}

// Restore saved sort mode
(function initSortMode() {
  const saved = localStorage.getItem('sortMode');
  if (saved && SORT_COMPARATORS[saved]) {
    _currentSortMode = saved;
  }
  _updateSortChecks();
})();

// Restore saved sidebar width
(function initSidebarWidth() {
  const saved = localStorage.getItem('sidebarWidth');
  if (saved) {
    const w = parseInt(saved, 10);
    if (w >= MIN_SIDEBAR_WIDTH && w <= MAX_SIDEBAR_WIDTH) {
      sidebarEl.style.width = w + 'px';
    }
  }
})();

// Restore saved outline filter level
(function initOutlineFilterLevel() {
  const filterSelect = document.getElementById('outline-level-filter');
  if (!filterSelect) return;
  _outlineMaxLevel = loadOutlineFilterLevel();
  filterSelect.value = String(_outlineMaxLevel);
  filterSelect.addEventListener('change', () => {
    _outlineMaxLevel = parseInt(filterSelect.value, 10);
    saveOutlineFilterLevel(_outlineMaxLevel);
    renderOutlinePanel();
    renderBacklinksSection();
  });
})();

// Restore saved right panel state (with backward compat migration)
(function initRightPanelState() {
  // Migrate old localStorage keys if present
  const oldOutline = localStorage.getItem('outlinePanelVisible');
  const oldStorage = localStorage.getItem('storagePanelVisible');
  if (oldOutline !== null && localStorage.getItem('rightPanelVisible') === null) {
    const wasOutlineOpen = oldOutline === '1';
    const wasStorageOpen = oldStorage === '1';
    if (wasOutlineOpen || wasStorageOpen) {
      localStorage.setItem('rightPanelVisible', '1');
      localStorage.setItem('rightPanelActiveTab', wasStorageOpen ? 'storage' : 'outline');
    }
    localStorage.removeItem('outlinePanelVisible');
    localStorage.removeItem('storagePanelVisible');
  }

  _rightPanelVisible = localStorage.getItem('rightPanelVisible') === '1';
  _rightPanelActiveTab = localStorage.getItem('rightPanelActiveTab') || 'outline';

  const panel = document.getElementById('outline-panel');
  if (panel && !_rightPanelVisible) {
    panel.classList.add('outline-hidden');
  }
  if (outlinePanelResizeEl && !_rightPanelVisible) {
    outlinePanelResizeEl.classList.add('outline-hidden');
  }
  // Restore saved right panel width
  const savedRPW = localStorage.getItem('outlinePanelWidth');
  if (savedRPW && panel) {
    const w = parseInt(savedRPW, 10);
    if (w >= MIN_RIGHT_PANEL_WIDTH && w <= MAX_RIGHT_PANEL_WIDTH) {
      panel.style.width = w + 'px';
    }
  }
  _applyRightPanelTab();
})();

// Right panel bar icon buttons + bar click-to-close
(function() {
  const bar = document.getElementById('right-panel-bar');
  const collapseBtn = document.getElementById('right-bar-collapse');
  const outlineBtn = document.getElementById('right-bar-outline');
  const storageBtn = document.getElementById('right-bar-storage');
  const memoryBtn = document.getElementById('right-bar-memory');
  const scriptsBtn = document.getElementById('right-bar-scripts');
  if (collapseBtn) collapseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (_rightPanelVisible) setRightPanel(_rightPanelActiveTab); // toggle off
  });
  if (outlineBtn) outlineBtn.addEventListener('click', (e) => { e.stopPropagation(); setRightPanel('outline'); });
  if (storageBtn) storageBtn.addEventListener('click', (e) => { e.stopPropagation(); setRightPanel('storage'); });
  if (memoryBtn) memoryBtn.addEventListener('click', (e) => { e.stopPropagation(); setRightPanel('memory'); });
  if (scriptsBtn) scriptsBtn.addEventListener('click', (e) => { e.stopPropagation(); setRightPanel('scripts'); });
  const logsBtn2 = document.getElementById('right-bar-logs');
  if (logsBtn2) logsBtn2.addEventListener('click', (e) => { e.stopPropagation(); setRightPanel('logs'); });
  // Clicking the bar itself (not an icon) toggles the panel with the active tab
  if (bar) bar.addEventListener('click', () => {
    setRightPanel(_rightPanelActiveTab);
  });
})();

// Storage section collapse handlers
(function() {
  const kvHeaderEl = document.getElementById('storage-kv-header');
  if (kvHeaderEl) {
    kvHeaderEl.addEventListener('click', () => _setStorageKvCollapsed(!_storageKvCollapsed));
    kvHeaderEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _setStorageKvCollapsed(!_storageKvCollapsed); }
    });
  }

  const filesHeaderEl = document.getElementById('storage-files-header');
  if (filesHeaderEl) {
    filesHeaderEl.addEventListener('click', () => _setStorageFilesCollapsed(!_storageFilesCollapsed));
    filesHeaderEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _setStorageFilesCollapsed(!_storageFilesCollapsed); }
    });
  }

  const sqlHeaderEl = document.getElementById('storage-sql-header');
  if (sqlHeaderEl) {
    sqlHeaderEl.addEventListener('click', () => _setStorageSqlCollapsed(!_storageSqlCollapsed));
    sqlHeaderEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _setStorageSqlCollapsed(!_storageSqlCollapsed); }
    });
  }
})();

// --- Note CSS — single source of truth is note-viewer.css, loaded via preload ---
const NOTE_CSS = window.api.noteCss;

// --- Tree helpers ---

function flattenFiles(node) {
  if (!node) return [];
  const files = [];
  if (node.type === 'file' || node.type === 'note') {
    files.push(node);
  }
  if (node.children) {
    for (const child of node.children) {
      files.push(...flattenFiles(child));
    }
  }
  return files;
}

function resolveInternalLink(currentFilePath, href) {
  const hrefPath = href.split('?')[0].split('#')[0];
  if (hrefPath.startsWith('/')) {
    return hrefPath.replace(/^\/+/, '').replace(/\/index\.html$/, '');
  }
  const baseParts = currentFilePath.split('/');
  baseParts.pop();
  const parts = [...baseParts, ...hrefPath.split('/')];
  const resolved = [];
  for (const part of parts) {
    if (part === '..') {
      resolved.pop();
    } else if (part !== '.') {
      resolved.push(part);
    }
  }
  let result = resolved.join('/');
  // Map to canonical note path if this resolves to index.html
  if (result.endsWith('/index.html')) {
    result = result.slice(0, -'/index.html'.length);
  }
  return result;
}

function expandAncestors(filePath, node) {
  if (!node || !node.children) return false;
  for (const child of node.children) {
    if ((child.type === 'file' || child.type === 'note') && child.path === filePath) {
      expandedPaths.add(node.path);
      return true;
    }
    if (child.type === 'folder' && expandAncestors(filePath, child)) {
      expandedPaths.add(node.path);
      return true;
    }
  }
  return false;
}

function expandAncestorsInSet(filePath, node, targetSet) {
  if (!node || !node.children) return false;
  for (const child of node.children) {
    if ((child.type === 'file' || child.type === 'note') && child.path === filePath) {
      targetSet.add(node.path);
      return true;
    }
    if (child.type === 'folder' && expandAncestorsInSet(filePath, child, targetSet)) {
      targetSet.add(node.path);
      return true;
    }
  }
  return false;
}

function expandAllFolders(node) {
  if (node.type === 'folder') {
    expandedPaths.add(node.path);
    if (node.children) {
      for (const child of node.children) {
        expandAllFolders(child);
      }
    }
  }
}

function collectFolderPaths(node) {
  const paths = new Set();
  if (node.type === 'folder') {
    paths.add(node.path);
    if (node.children) {
      for (const child of node.children) {
        for (const p of collectFolderPaths(child)) {
          paths.add(p);
        }
      }
    }
  }
  return paths;
}

function collectAllFilePaths(node) {
  const paths = new Set();
  if (node.type === 'file' || node.type === 'note') {
    paths.add(node.path);
  } else if (node.type === 'folder' && node.children) {
    for (const child of node.children) {
      for (const p of collectAllFilePaths(child)) {
        paths.add(p);
      }
    }
  }
  return paths;
}

function filterTree(tree, query) {
  if (!query || !tree || !tree.children) return tree;
  const lowerQuery = query.toLowerCase();
  const filteredChildren = tree.children
    .map(child => filterNode(child, lowerQuery))
    .filter(Boolean);
  return { ...tree, children: filteredChildren };
}

function filterNode(node, query) {
  if (node.type === 'file' || node.type === 'note') {
    const label = (node.title || node.name).toLowerCase();
    return label.includes(query) ? node : null;
  }
  if (node.type === 'folder') {
    const filteredChildren = (node.children || [])
      .map(child => filterNode(child, query))
      .filter(Boolean);
    const folderMatches = node.name.toLowerCase().includes(query);
    if (filteredChildren.length > 0 || folderMatches) {
      return { ...node, children: filteredChildren };
    }
    return null;
  }
  return null;
}

// Tag-based tree filter (feature 98) — keeps files whose path is in pathSet
function filterTreeByTagPaths(tree, pathSet) {
  if (!tree || !tree.children) return tree;
  const filteredChildren = tree.children
    .map(child => _filterNodeByTagPaths(child, pathSet))
    .filter(Boolean);
  return { ...tree, children: filteredChildren };
}

function _filterNodeByTagPaths(node, pathSet) {
  if (node.type === 'file' || node.type === 'note') {
    return pathSet.has(node.path) ? node : null;
  }
  if (node.type === 'folder') {
    const filteredChildren = (node.children || [])
      .map(child => _filterNodeByTagPaths(child, pathSet))
      .filter(Boolean);
    return filteredChildren.length > 0 ? { ...node, children: filteredChildren } : null;
  }
  return null;
}

function saveExpandedPaths() {
  if (!currentWorkspacePath) return;
  if (isFiltering) return;
  const key = 'expandedPaths:' + currentWorkspacePath;
  localStorage.setItem(key, JSON.stringify([...expandedPaths]));
}

function loadExpandedPaths(wsPath, tree) {
  const key = 'expandedPaths:' + wsPath;
  const raw = localStorage.getItem(key);
  if (!raw) return false;
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return false;
    const validPaths = collectFolderPaths(tree);
    for (const p of arr) {
      if (validPaths.has(p)) {
        expandedPaths.add(p);
      }
    }
    return true;
  } catch {
    return false;
  }
}

// ─── Outline collapse state persistence ───────────────────────────────────────

function saveOutlineCollapseState(filePath) {
  const key = 'outlineCollapsed:' + filePath;
  const ids = _outlineCollapsedIds.get(filePath);
  if (!ids || ids.size === 0) {
    localStorage.removeItem(key);
  } else {
    localStorage.setItem(key, JSON.stringify([...ids]));
  }
}

function loadOutlineCollapseState(filePath) {
  const key = 'outlineCollapsed:' + filePath;
  const raw = localStorage.getItem(key);
  if (!raw) return new Set();
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr) : new Set();
  } catch {
    return new Set();
  }
}

// ─── Outline filter level persistence ─────────────────────────────────────────

function saveOutlineFilterLevel(maxLevel) {
  localStorage.setItem('outlineFilterLevel', String(maxLevel));
}

function loadOutlineFilterLevel() {
  const raw = localStorage.getItem('outlineFilterLevel');
  if (!raw) return 6;
  const n = parseInt(raw, 10);
  return (n >= 1 && n <= 6) ? n : 6;
}

// ─── Outline panel visibility persistence ─────────────────────────────────────

function _saveRightPanelState() {
  localStorage.setItem('rightPanelVisible', _rightPanelVisible ? '1' : '0');
  localStorage.setItem('rightPanelActiveTab', _rightPanelActiveTab);
}

function _applyRightPanelTab() {
  const outlineTab = document.getElementById('outline-tab-content');
  const storageTab = document.getElementById('storage-tab-content');
  const memoryTab = document.getElementById('memory-tab-content');
  const scriptsTab = document.getElementById('scripts-tab-content');
  const logsTab = document.getElementById('logs-tab-content');
  const levelFilter = document.getElementById('outline-level-filter');
  const titleEl = document.querySelector('.outline-title');
  const outlineBtn = document.getElementById('right-bar-outline');
  const storageBtn = document.getElementById('right-bar-storage');
  const memoryBtn = document.getElementById('right-bar-memory');
  const scriptsBtn = document.getElementById('right-bar-scripts');
  const logsBtn = document.getElementById('right-bar-logs');

  const active = _rightPanelActiveTab;
  if (outlineTab) outlineTab.classList.toggle('hidden', active !== 'outline');
  if (storageTab) storageTab.classList.toggle('hidden', active !== 'storage');
  if (memoryTab) memoryTab.classList.toggle('hidden', active !== 'memory');
  if (scriptsTab) scriptsTab.classList.toggle('hidden', active !== 'scripts');
  if (logsTab) logsTab.classList.toggle('hidden', active !== 'logs');
  if (levelFilter) levelFilter.style.display = active === 'outline' ? '' : 'none';
  if (titleEl) titleEl.textContent = active === 'outline' ? 'Outline' : active === 'storage' ? 'Storage' : active === 'memory' ? 'Memory' : active === 'scripts' ? 'Scripts' : 'Logs';
  const memEditBtn = document.getElementById('memory-edit-btn');
  if (memEditBtn) memEditBtn.classList.toggle('hidden', active !== 'memory');
  const collapseBtn = document.getElementById('right-bar-collapse');
  if (collapseBtn) collapseBtn.classList.toggle('hidden', !_rightPanelVisible);
  if (outlineBtn) outlineBtn.classList.toggle('active', _rightPanelVisible && active === 'outline');
  if (storageBtn) storageBtn.classList.toggle('active', _rightPanelVisible && active === 'storage');
  if (memoryBtn) memoryBtn.classList.toggle('active', _rightPanelVisible && active === 'memory');
  if (scriptsBtn) scriptsBtn.classList.toggle('active', _rightPanelVisible && active === 'scripts');
  if (logsBtn) logsBtn.classList.toggle('active', _rightPanelVisible && active === 'logs');
  // Stop elapsed-time timer when leaving scripts tab
  if (active !== 'scripts' || !_rightPanelVisible) _stopScriptsRunningTimer();
  // Stop logs refresh when leaving logs tab
  if (active !== 'logs' || !_rightPanelVisible) _stopLogsRefresh();
}

function setRightPanel(tab) {
  if (_rightPanelVisible && _rightPanelActiveTab === tab) {
    // Close panel
    _rightPanelVisible = false;
  } else {
    // Open panel (or switch tab)
    _rightPanelVisible = true;
    _rightPanelActiveTab = tab;
  }

  const panel = document.getElementById('outline-panel');
  if (panel) panel.classList.toggle('outline-hidden', !_rightPanelVisible);
  if (outlinePanelResizeEl) outlinePanelResizeEl.classList.toggle('outline-hidden', !_rightPanelVisible);
  _applyRightPanelTab();
  _saveRightPanelState();

  if (_rightPanelVisible && _rightPanelActiveTab === 'outline') {
    renderOutlinePanel();
    renderBacklinksSection();
  }
  if (_rightPanelVisible && _rightPanelActiveTab === 'storage') {
    renderStorageSection();
  }
  if (_rightPanelVisible && _rightPanelActiveTab === 'memory') {
    renderMemoryPanel();
  }
  if (_rightPanelVisible && _rightPanelActiveTab === 'scripts') {
    renderScriptsPanel();
  }
  if (_rightPanelVisible && _rightPanelActiveTab === 'logs') {
    renderLogsPanel();
  }
}

// Legacy compat wrapper
function setOutlinePanelVisible(visible) {
  if (visible && !(_rightPanelVisible && _rightPanelActiveTab === 'outline')) {
    setRightPanel('outline');
  } else if (!visible && _rightPanelVisible && _rightPanelActiveTab === 'outline') {
    setRightPanel('outline'); // toggle off
  }
}

function saveTabState() {
  if (!currentWorkspacePath) return;
  const state = TabState.getState();
  localStorage.setItem('tabState:' + currentWorkspacePath, JSON.stringify(state));
}

function debouncedSaveTabState() {
  clearTimeout(_saveTimeout);
  _saveTimeout = setTimeout(saveTabState, 500);
}

function loadTabState(wsPath, tree) {
  const raw = localStorage.getItem('tabState:' + wsPath);
  if (!raw) return false;
  let saved;
  try {
    saved = JSON.parse(raw);
  } catch {
    return false;
  }

  const validFiles = collectAllFilePaths(tree);
  if (!saved || !Array.isArray(saved.panels)) return false;

  for (const panel of saved.panels) {
    if (!Array.isArray(panel.tabs)) continue;
    const prunedTabs = panel.tabs.filter(t => validFiles.has(t.filePath));
    // Backfill tab.type for note-folder tabs restored from old saved state
    for (const t of prunedTabs) {
      if (!t.type) {
        const node = findNodeByPath(tree, t.filePath);
        if (node && node.type === 'note') t.type = 'note';
      }
    }
    if (panel.activeTabId && !prunedTabs.find(t => t.id === panel.activeTabId)) {
      panel.activeTabId = prunedTabs.length > 0 ? prunedTabs[0].id : null;
    }
    panel.tabs = prunedTabs;
  }

  if (saved.panels.length > 1) {
    saved.panels = saved.panels.filter(p => p.tabs.length > 0);
  }
  if (saved.panels.length === 0) return false;

  const remainingIds = new Set(saved.panels.map(p => p.id));
  if (!remainingIds.has(saved.focusedPanelId)) {
    saved.focusedPanelId = saved.panels[0].id;
  }

  return TabState.restoreState(saved);
}

// --- Workspace ---

// ─── Unified Sync Settings Modal ─────────────────────────────────────────────
// Single tabbed modal that consolidates GitHub, AWS S3, SSH/SFTP, and Remotes config.
const SyncSettingsModal = (() => {
  let _modal = null;
  let _tabsEl = null;
  let _contentEl = null;
  let _activeTab = 'github';

  // ── Helpers ────────────────────────────────────────────────────────────────
  function _esc(s) {
    const d = document.createElement('span');
    d.textContent = s;
    return d.innerHTML;
  }

  function _show(tab) {
    _activeTab = tab || _activeTab || 'github';
    if (!_modal) return;
    _modal.classList.remove('hidden');
    _setActiveTab(_activeTab);
  }

  function _hide() {
    if (_modal) _modal.classList.add('hidden');
  }

  function _setActiveTab(tab) {
    _activeTab = tab;
    _tabsEl.querySelectorAll('.sync-tab').forEach(btn => {
      btn.classList.toggle('sync-tab--active', btn.dataset.tab === tab);
    });
    _renderTabContent(tab);
  }

  // ── Tab status badges ──────────────────────────────────────────────────────
  function _updateTabStatuses() {
    // GitHub
    const gitEl = document.getElementById('sync-tab-status-github');
    if (gitEl) {
      const gs = window.SyncSettingsModal?._gitState || 'not-configured';
      const labels = { 'not-configured': 'Not set up', idle: 'Synced', syncing: 'Syncing…', error: 'Error', conflict: 'Conflict', paused: 'Paused' };
      gitEl.textContent = labels[gs] || gs;
    }
    // Cloud
    const cloudEl = document.getElementById('sync-tab-status-cloud');
    if (cloudEl) {
      const cs = window.SyncSettingsModal?._awsState || 'disabled';
      const labels = { disabled: 'Off', idle: 'Up to date', syncing: 'Syncing…', offline: 'Offline', error: 'Error', paused: 'Paused' };
      cloudEl.textContent = labels[cs] || cs;
    }
    // Server
    const serverEl = document.getElementById('sync-tab-status-server');
    if (serverEl) {
      const ss = window.SyncSettingsModal?._serverState || 'disabled';
      const labels = { disabled: 'Off', idle: 'Synced', syncing: 'Syncing…', offline: 'Offline', error: 'Error', paused: 'Paused' };
      serverEl.textContent = labels[ss] || ss;
    }
  }

  // ── Tab content renderers ──────────────────────────────────────────────────
  function _renderTabContent(tab) {
    _updateTabStatuses();
    switch (tab) {
      case 'github':  _renderGithubTab(); break;
      case 'cloud':   _renderCloudTab(); break;
      case 'server':  _renderServerTab(); break;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // GitHub tab — embeds the wizard flow
  // ──────────────────────────────────────────────────────────────────────────
  let _wizCurrentStep = 1;
  let _wizStartStep = 1;
  let _wizCompleted = new Set();
  let _wizRemoteUrl = '';
  let _wizGitStatus = null;
  let _wizBusy = false;

  async function _renderGithubTab() {
    const gitState = SyncSettingsModal._gitState || 'not-configured';
    const isConfigured = gitState !== 'not-configured';

    if (isConfigured) {
      // Show status + actions for already-configured git sync
      const paused = SyncSettingsModal._gitPaused;
      const effectiveState = (paused && gitState === 'idle') ? 'paused' : gitState;
      const stateLabels = { idle: 'Synced', syncing: 'Syncing…', error: 'Error', conflict: 'Conflict', paused: 'Paused' };
      _contentEl.innerHTML = `
        <div class="ssc-status">
          <span class="ssc-status-dot ssc-status-dot--${effectiveState}"></span>
          <span class="ssc-status-text">${stateLabels[effectiveState] || effectiveState}</span>
        </div>
        <p style="font-size:var(--typescale-body-md-size);color:var(--text-dim);margin-bottom:var(--spacing-4);line-height:1.5">
          Git sync is configured and ${effectiveState === 'paused' ? 'paused' : 'active'}. Your notes are synced to a GitHub repository.
        </p>
        <div class="ssc-actions">
          <button class="ssc-btn" id="ssc-git-pause">${paused ? 'Resume' : 'Pause'}</button>
          <button class="ssc-btn" id="ssc-git-log">View Sync Log</button>
          <button class="ssc-btn ssc-btn--danger" id="ssc-git-reconfigure">Reconfigure</button>
        </div>
        <div id="ssc-git-syncignore-section" class="ssm-syncignore-section">
          <button type="button" class="ssm-syncignore-toggle">Sync Rules (.syncignore) <span class="ssm-syncignore-arrow">&#x25B6;</span></button>
          <div class="ssm-syncignore-body hidden">
            <textarea class="ssm-syncignore-textarea" rows="8" spellcheck="false" placeholder="Loading..."></textarea>
            <button type="button" class="ssm-syncignore-save">Save</button>
          </div>
        </div>
      `;
      document.getElementById('ssc-git-pause')?.addEventListener('click', () => {
        if (SyncSettingsModal._gitPaused) { window.api.resumeSync?.(); }
        else { window.api.pauseSync?.(); }
      });
      document.getElementById('ssc-git-log')?.addEventListener('click', () => {
        _hide();
        SyncLogPanel.toggle();
      });
      document.getElementById('ssc-git-reconfigure')?.addEventListener('click', () => {
        _startWizard();
      });
      // Syncignore
      const igSection = document.getElementById('ssc-git-syncignore-section');
      _bindSyncignore(igSection, 'git');
    } else {
      // Show wizard
      _startWizard();
    }
  }

  async function _startWizard() {
    _wizGitStatus = await window.api.getSyncStatus();
    _wizCompleted = new Set();
    _wizRemoteUrl = (_wizGitStatus && _wizGitStatus.remoteUrl) || '';
    _wizBusy = false;

    if (_wizGitStatus && !_wizGitStatus.gitInstalled) {
      _contentEl.innerHTML = `
        <p style="font-size:var(--typescale-body-md-size);color:var(--text-dim);line-height:1.5">Git is not installed on this system. Please install Git and restart the app.</p>
      `;
      return;
    }

    let startStep = 1;
    if (_wizGitStatus && _wizGitStatus.isRepo) {
      _wizCompleted.add(1);
      startStep = 2;
    }
    if (_wizGitStatus && _wizGitStatus.isRepo && _wizGitStatus.hasRemote) {
      _wizCompleted.add(2);
      startStep = 3;
    }
    _wizStartStep = startStep;
    _wizCurrentStep = startStep;
    _renderWizard();
  }

  function _renderWizard() {
    _contentEl.innerHTML = `
      <div class="ssc-wizard-steps">
        <span class="ssc-wizard-step" data-step="1">1</span>
        <span class="ssc-wizard-step-line"></span>
        <span class="ssc-wizard-step" data-step="2">2</span>
        <span class="ssc-wizard-step-line"></span>
        <span class="ssc-wizard-step" data-step="3">3</span>
        <span class="ssc-wizard-step-line"></span>
        <span class="ssc-wizard-step" data-step="4">4</span>
      </div>
      <div id="ssc-wiz-content"></div>
      <div class="ssc-wizard-actions">
        <button class="ssc-btn" id="ssc-wiz-back">Back</button>
        <span class="spacer"></span>
        <button class="ssc-btn" id="ssc-wiz-cancel">Cancel</button>
        <button class="ssc-btn ssc-btn--primary" id="ssc-wiz-next">Continue</button>
      </div>
    `;
    _updateWizProgress();
    _renderWizStep(_wizCurrentStep);
    _updateWizNav();
  }

  function _updateWizProgress() {
    _contentEl.querySelectorAll('.ssc-wizard-step').forEach(el => {
      const n = parseInt(el.dataset.step, 10);
      el.classList.remove('ssc-wizard-step--active', 'ssc-wizard-step--done', 'ssc-wizard-step--error');
      if (n === _wizCurrentStep) {
        el.classList.add('ssc-wizard-step--active');
        el.textContent = String(n);
      } else if (_wizCompleted.has(n)) {
        el.classList.add('ssc-wizard-step--done');
        el.textContent = '✓';
      } else {
        el.textContent = String(n);
      }
    });
    _contentEl.querySelectorAll('.ssc-wizard-step-line').forEach((line, i) => {
      line.classList.toggle('ssc-wizard-step-line--done', _wizCompleted.has(i + 1));
    });
  }

  function _updateWizNav() {
    const backBtn = document.getElementById('ssc-wiz-back');
    const cancelBtn = document.getElementById('ssc-wiz-cancel');
    const nextBtn = document.getElementById('ssc-wiz-next');
    if (backBtn) backBtn.classList.toggle('hidden', _wizCurrentStep <= _wizStartStep);
    if (backBtn) backBtn.onclick = () => {
      let prev = _wizCurrentStep - 1;
      while (prev > _wizStartStep && _wizCompleted.has(prev)) prev--;
      _wizCurrentStep = prev;
      _updateWizProgress();
      _renderWizStep(_wizCurrentStep);
      _updateWizNav();
    };
    if (cancelBtn) cancelBtn.onclick = () => _renderGithubTab();
  }

  function _renderWizStep(step) {
    const content = document.getElementById('ssc-wiz-content');
    const nextBtn = document.getElementById('ssc-wiz-next');
    if (!content || !nextBtn) return;
    nextBtn.textContent = 'Continue';
    nextBtn.disabled = false;

    switch (step) {
      case 1: {
        const wsPath = (_wizGitStatus && _wizGitStatus.isRepo !== undefined) ? (currentWorkspacePath || '') : '';
        content.innerHTML = `
          <p style="font-size:var(--typescale-body-md-size);color:var(--text-dim);margin-bottom:var(--spacing-3);line-height:1.5">Your workspace needs a Git repository to enable sync.</p>
          <label class="field-label">Workspace</label>
          <input type="text" value="${wsPath.replace(/"/g, '&quot;')}" readonly
            style="background:var(--bg-input);border:1px solid var(--ghost-border);color:var(--text-dim);padding:var(--spacing-1-5) var(--spacing-3);border-radius:6px;font-size:var(--typescale-label-md-size);outline:none;" />
          <div id="ssc-step1-status" style="visibility:hidden;margin-top:var(--spacing-2);font-size:var(--typescale-label-md-size);color:var(--text-dim)">
            <span id="ssc-step1-msg"></span>
          </div>
        `;
        if (_wizCompleted.has(1)) {
          document.getElementById('ssc-step1-status').style.visibility = 'visible';
          document.getElementById('ssc-step1-msg').textContent = 'Git repository already initialized.';
          nextBtn.onclick = () => _wizAdvance(2);
          return;
        }
        nextBtn.textContent = 'Initialize';
        nextBtn.onclick = async () => {
          nextBtn.disabled = true;
          document.getElementById('ssc-step1-status').style.visibility = 'visible';
          document.getElementById('ssc-step1-msg').textContent = 'Initializing git repository…';
          const result = await window.api.initRepo();
          if (result.ok) {
            _wizCompleted.add(1);
            _wizAdvance(2);
          } else {
            document.getElementById('ssc-step1-msg').textContent = `Error: ${result.error}`;
            nextBtn.disabled = false;
          }
        };
        break;
      }
      case 2: {
        content.innerHTML = `
          <p style="font-size:var(--typescale-body-md-size);color:var(--text-dim);margin-bottom:var(--spacing-3);line-height:1.5">Enter the URL of your GitHub repository.</p>
          <label class="field-label" for="ssc-remote-url">Repository URL</label>
          <input type="text" id="ssc-remote-url" placeholder="https://github.com/user/repo.git"
            value="${_wizRemoteUrl.replace(/"/g, '&quot;')}" autocomplete="off" />
          <p class="sync-step-error hidden" id="ssc-step2-error" style="color:var(--color-error);font-size:var(--typescale-label-md-size);margin-top:var(--spacing-1-5)"></p>
        `;
        document.getElementById('ssc-remote-url')?.focus();
        nextBtn.onclick = async () => {
          const input = document.getElementById('ssc-remote-url');
          const url = input.value.trim();
          const errorEl = document.getElementById('ssc-step2-error');
          if (!url) { errorEl.textContent = 'Please enter a repository URL.'; errorEl.classList.remove('hidden'); return; }
          if (!/^(https?:\/\/|git@|ssh:\/\/)/.test(url)) { errorEl.textContent = 'URL must start with https://, http://, git@, or ssh://'; errorEl.classList.remove('hidden'); return; }
          errorEl.classList.add('hidden');
          nextBtn.disabled = true;
          const result = await window.api.addRemote(url);
          if (result.ok) {
            _wizRemoteUrl = url;
            _wizCompleted.add(2);
            _wizAdvance(3);
          } else {
            errorEl.textContent = result.error || 'Failed to add remote.';
            errorEl.classList.remove('hidden');
            nextBtn.disabled = false;
          }
        };
        break;
      }
      case 3: {
        content.innerHTML = `
          <p style="font-size:var(--typescale-body-md-size);color:var(--text-dim);margin-bottom:var(--spacing-3);line-height:1.5">Checking authentication with your repository…</p>
          <div id="ssc-step3-guidance"></div>
        `;
        nextBtn.disabled = true;
        const runCheck = async () => {
          const guidanceEl = document.getElementById('ssc-step3-guidance');
          if (!guidanceEl) return;
          guidanceEl.innerHTML = '<div style="font-size:var(--typescale-label-md-size);color:var(--text-dim)">Checking connection…</div>';
          const result = await window.api.checkAuth(_wizRemoteUrl);
          if (!document.getElementById('ssc-step3-guidance')) return;
          if (result.ok) {
            guidanceEl.innerHTML = `
              <div class="sync-guidance sync-guidance--success">
                <div class="sync-guidance-title">Connection successful</div>
                <div class="sync-guidance-message">Authentication is working correctly.</div>
              </div>
            `;
            _wizCompleted.add(3);
            nextBtn.disabled = false;
            nextBtn.onclick = () => _wizAdvance(4);
          } else {
            const g = result.guidance || {};
            const stepsHtml = (g.steps || []).map(s => `<li>${s}</li>`).join('');
            guidanceEl.innerHTML = `
              <div class="sync-guidance sync-guidance--error">
                <div class="sync-guidance-title">${g.title || 'Connection failed'}</div>
                <div class="sync-guidance-message">${g.message || ''}</div>
                ${stepsHtml ? `<ol class="sync-guidance-steps">${stepsHtml}</ol>` : ''}
              </div>
              <button class="ssc-btn" id="ssc-step3-retry" style="margin-top:var(--spacing-3)">Retry</button>
            `;
            document.getElementById('ssc-step3-retry')?.addEventListener('click', runCheck);
            nextBtn.disabled = true;
          }
        };
        runCheck();
        break;
      }
      case 4: {
        content.innerHTML = `
          <p style="font-size:var(--typescale-body-md-size);color:var(--text-dim);margin-bottom:var(--spacing-3);line-height:1.5">We'll create an initial commit with your notes and push them to the repository.</p>
          <div id="ssc-step4-status"></div>
        `;
        nextBtn.textContent = 'Sync Now';
        nextBtn.onclick = async () => {
          const statusEl = document.getElementById('ssc-step4-status');
          nextBtn.disabled = true;
          document.getElementById('ssc-wiz-back')?.classList.add('hidden');
          statusEl.innerHTML = `<div style="font-size:var(--typescale-label-md-size);color:var(--text-dim)">Creating .gitignore… Staging files… Committing… Pushing…</div>`;
          const result = await window.api.initialCommitAndPush();
          if (result.ok) {
            statusEl.innerHTML = `
              <div class="sync-guidance sync-guidance--success">
                <div class="sync-guidance-title">Sync complete!</div>
                <div class="sync-guidance-message">Your notes have been pushed to the repository.</div>
              </div>
            `;
            nextBtn.textContent = 'Done';
            nextBtn.disabled = false;
            nextBtn.onclick = async () => {
              await window.api.reinitializeSync();
              SyncSettingsModal._gitState = 'idle';
              _renderGithubTab();
            };
          } else {
            statusEl.innerHTML = `
              <div class="sync-guidance sync-guidance--error">
                <div class="sync-guidance-title">Push failed</div>
                <div class="sync-guidance-message">${result.error || 'An error occurred.'}</div>
              </div>
            `;
            nextBtn.textContent = 'Retry';
            nextBtn.disabled = false;
            document.getElementById('ssc-wiz-back')?.classList.remove('hidden');
          }
        };
        break;
      }
    }
  }

  function _wizAdvance(step) {
    _wizCurrentStep = step;
    _updateWizProgress();
    _renderWizStep(_wizCurrentStep);
    _updateWizNav();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Cloud (AWS S3) tab
  // ──────────────────────────────────────────────────────────────────────────
  function _renderCloudTab() {
    const state = SyncSettingsModal._awsState || 'disabled';
    const loggedIn = SyncSettingsModal._awsLoggedIn;
    const lastSync = SyncSettingsModal._awsLastSync;

    if (!loggedIn) {
      _contentEl.innerHTML = `
        <div class="ssc-status">
          <span class="ssc-status-dot ssc-status-dot--off"></span>
          <span class="ssc-status-text">Sign in to enable</span>
        </div>
        <p class="ssc-empty">Cloud sync requires an account to enable AWS S3 sync.</p>
        <div class="ssc-auth-actions">
          <button class="auth-signin-btn" id="ssc-auth-signin">Sign in</button>
          <button class="auth-signup-btn" id="ssc-auth-signup">Create account</button>
        </div>
      `;
      document.getElementById('ssc-auth-signin')?.addEventListener('click', () => window.api.authLogin());
      document.getElementById('ssc-auth-signup')?.addEventListener('click', () => window.api.authSignup());
      return;
    }

    const enabled = state !== 'disabled';
    const paused = state === 'paused';
    const stateLabels = { disabled: 'Off', idle: 'Up to date', syncing: 'Syncing…', offline: 'Offline', error: 'Error', paused: 'Paused' };
    const dotState = enabled ? state : 'disabled';

    _contentEl.innerHTML = `
      <div class="ssc-status">
        <span class="ssc-status-dot ssc-status-dot--${dotState}"></span>
        <span class="ssc-status-text">${stateLabels[state] || state}</span>
      </div>
      <label class="oc-checkbox-label">
        <input type="checkbox" id="ssc-aws-enable" ${enabled ? 'checked' : ''} />
        Enable sync
      </label>
      <div id="ssc-aws-controls" class="${enabled ? '' : 'hidden'}">
        <div class="ssc-actions">
          <button class="ssc-btn" id="ssc-aws-pause">${paused ? 'Resume' : 'Pause'}</button>
          <button class="ssc-btn ${paused ? 'hidden' : ''}" id="ssc-aws-sync-now">Sync Now</button>
          <button class="ssc-btn ssc-btn--danger" id="ssc-aws-unlink">Unlink</button>
        </div>
        <div id="ssc-aws-syncignore" class="ssm-syncignore-section">
          <button type="button" class="ssm-syncignore-toggle">Sync Rules (.syncignore) <span class="ssm-syncignore-arrow">&#x25B6;</span></button>
          <div class="ssm-syncignore-body hidden">
            <textarea class="ssm-syncignore-textarea" rows="8" spellcheck="false" placeholder="Loading..."></textarea>
            <button type="button" class="ssm-syncignore-save">Save</button>
          </div>
        </div>
      </div>
      <div class="ssc-footer">Last sync: ${lastSync ? new Date(lastSync).toLocaleTimeString() : 'never'}</div>
    `;

    // Enable/disable
    document.getElementById('ssc-aws-enable')?.addEventListener('change', async (e) => {
      if (e.target.checked) {
        const s = await window.api.awsSyncEnable?.();
        if (s) { SyncSettingsModal._awsState = s.state; if (s.lastSync) SyncSettingsModal._awsLastSync = s.lastSync; }
      } else {
        const s = await window.api.awsSyncDisable?.();
        if (s) { SyncSettingsModal._awsState = s.state; if (s.lastSync) SyncSettingsModal._awsLastSync = s.lastSync; }
      }
      _renderCloudTab();
    });

    // Pause/Resume
    document.getElementById('ssc-aws-pause')?.addEventListener('click', async () => {
      const s = (state === 'paused') ? await window.api.awsSyncResume?.() : await window.api.awsSyncPause?.();
      if (s) { SyncSettingsModal._awsState = s.state; if (s.lastSync) SyncSettingsModal._awsLastSync = s.lastSync; }
      _renderCloudTab();
    });

    // Sync Now
    document.getElementById('ssc-aws-sync-now')?.addEventListener('click', async () => {
      const btn = document.getElementById('ssc-aws-sync-now');
      if (btn) { btn.disabled = true; btn.textContent = '…'; }
      const s = await window.api.awsSyncNow?.();
      if (s) { SyncSettingsModal._awsState = s.state; if (s.lastSync) SyncSettingsModal._awsLastSync = s.lastSync; }
      _renderCloudTab();
    });

    // Unlink
    document.getElementById('ssc-aws-unlink')?.addEventListener('click', () => {
      AwsSyncUnlinkModal.show(async (opts) => {
        const s = await window.api.awsSyncUnlink?.(opts);
        if (s) { SyncSettingsModal._awsState = s.state; if (s.lastSync) SyncSettingsModal._awsLastSync = s.lastSync; }
        _renderCloudTab();
      });
    });

    // Syncignore
    _bindSyncignore(document.getElementById('ssc-aws-syncignore'), 'sync');
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Server Sync (SSH/SFTP) tab
  // ──────────────────────────────────────────────────────────────────────────
  async function _renderServerTab() {
    const endpoints = await window.api.getSshSyncEndpoints();
    const statusMap = await window.api.serverSyncGetStatus?.() || {};

    if (!endpoints || endpoints.length === 0) {
      _contentEl.innerHTML = `
        <div class="ssc-empty">
          <p>No SSH sync endpoints configured.</p>
          <button class="ssc-btn ssc-btn--primary ssm-add-endpoint-btn">+ Add SSH Endpoint</button>
        </div>
      `;
      _contentEl.querySelector('.ssm-add-endpoint-btn')?.addEventListener('click', async () => {
        const id = crypto.randomUUID();
        await window.api.addSshSyncEndpoint({ id, label: 'My Server', syncEnabled: false, sshAuthMethod: 'agent' });
        _renderServerTab();
      });
      return;
    }

    let html = '';
    for (const ep of endpoints) {
      const s = statusMap[ep.id] || {};
      const stateLabel = { disabled: 'Off', idle: 'Up to date', syncing: 'Syncing…', offline: 'Offline', error: 'Error' }[s.state] || 'Off';
      const stateClass = s.state || 'disabled';

      html += `
        <div class="ssc-card" data-ep-id="${_esc(ep.id)}">
          <div class="ssc-card-header">
            <input type="text" class="ssc-card-label ssm-label-input" value="${_esc(ep.label || '')}" placeholder="Endpoint name" style="border:none;background:transparent;font-weight:600;font-size:inherit;padding:0;color:inherit;width:100%" />
            <span class="ssc-card-state ssm-state--${stateClass}">${stateLabel}</span>
          </div>
          <div class="ssm-card-body">
            <label class="oc-checkbox-label">
              <input type="checkbox" class="ssm-enable" ${ep.syncEnabled ? 'checked' : ''} />
              Enable file sync
            </label>
            <div class="ssm-fields ${ep.syncEnabled ? '' : 'hidden'}">
              <label>
                <span class="oc-label-row">SSH Host <button type="button" class="oc-help-btn ssm-help-toggle" data-panel="ssm-help-host" title="What to enter">?</button></span>
                <input type="text" class="ssm-host" value="${_esc(ep.sshHost || '')}" placeholder="my-server.com" autocomplete="off" />
              </label>
              <div class="oc-help-panel ssm-help-host hidden">
                <div class="oc-help-content">
                  <p>The hostname or IP address of your server.</p>
                  <table class="oc-help-table">
                    <tr><td>Domain name</td><td><code>my-server.com</code></td></tr>
                    <tr><td>IP address</td><td><code>203.0.113.10</code></td></tr>
                    <tr><td>Tailscale / private network</td><td><code>my-machine</code></td></tr>
                    <tr><td>Local / Docker</td><td><code>localhost</code></td></tr>
                  </table>
                </div>
              </div>
              <div class="ssm-row-2col">
                <label>Port <span class="oc-optional-hint">(default: 22)</span>
                  <input type="number" class="ssm-port" value="${ep.sshPort || 22}" min="1" max="65535" />
                </label>
                <label>
                  <span class="oc-label-row">Username <button type="button" class="oc-help-btn ssm-help-toggle" data-panel="ssm-help-user" title="Which user">?</button></span>
                  <input type="text" class="ssm-username" value="${_esc(ep.sshUsername || '')}" placeholder="user" autocomplete="off" />
                </label>
              </div>
              <div class="oc-help-panel ssm-help-user hidden">
                <div class="oc-help-content">
                  <p>The SSH login user — the same one from your <code>ssh user@host</code> command.</p>
                </div>
              </div>
              <label>
                <span class="oc-label-row">Auth Method <button type="button" class="oc-help-btn ssm-help-toggle" data-panel="ssm-help-auth" title="Which method">?</button></span>
                <select class="ssm-auth-method">
                  <option value="agent" ${(ep.sshAuthMethod || 'agent') === 'agent' ? 'selected' : ''}>SSH Agent</option>
                  <option value="key" ${ep.sshAuthMethod === 'key' ? 'selected' : ''}>Private Key</option>
                  <option value="password" ${ep.sshAuthMethod === 'password' ? 'selected' : ''}>Password</option>
                </select>
              </label>
              <div class="oc-help-panel ssm-help-auth hidden">
                <div class="oc-help-content">
                  <p><strong>SSH Agent</strong> — Uses your running SSH agent (recommended).</p>
                  <p><strong>Private Key</strong> — Path to your SSH private key file.</p>
                  <p><strong>Password</strong> — Stored encrypted via macOS Keychain.</p>
                </div>
              </div>
              <label class="ssm-key-label ${(ep.sshAuthMethod || 'agent') === 'key' ? '' : 'hidden'}">Key Path
                <input type="text" class="ssm-key-path" value="${_esc(ep.sshKeyPath || '')}" placeholder="Path to private key" autocomplete="off" />
              </label>
              <label class="ssm-password-label ${ep.sshAuthMethod === 'password' ? '' : 'hidden'}">SSH Password
                <input type="password" class="ssm-password" value="" placeholder="${ep.sshAuthMethod === 'password' ? 'Saved — blank to keep' : 'Enter SSH password'}" autocomplete="off" />
              </label>
              <label>
                <span class="oc-label-row">Remote Path <button type="button" class="oc-help-btn ssm-help-toggle" data-panel="ssm-help-path" title="Which folder">?</button></span>
                <input type="text" class="ssm-remote-path" value="${_esc(ep.sshRemotePath || '')}" placeholder="/home/<user>/notes" autocomplete="off" />
              </label>
              <div class="oc-help-panel ssm-help-path hidden">
                <div class="oc-help-content">
                  <p>The <strong>absolute path on the host</strong> where note files will be synced.</p>
                </div>
              </div>
              <div class="ssc-actions">
                <button class="ssc-btn ssm-test-btn">Test SSH</button>
                <button class="ssc-btn ssc-btn--primary ssm-save-btn">Save</button>
                <button class="ssc-btn ssm-sync-btn ${ep.syncEnabled ? '' : 'hidden'}">Sync Now</button>
                <button class="ssc-btn ssm-delete-btn" style="margin-left:auto;color:var(--danger)">Remove</button>
                <span class="ssc-test-result"></span>
              </div>
              <div class="ssm-info" style="font-size:var(--typescale-label-sm-size);color:var(--text-dim);margin-top:var(--spacing-1-5)">
                ${s.fileCount ? s.fileCount + ' files synced' : ''}${s.lastSyncTimestamp ? ' — last sync ' + new Date(s.lastSyncTimestamp).toLocaleTimeString() : ''}
              </div>
            </div>
          </div>
        </div>
      `;
    }

    // Add endpoint button
    html += `<div style="padding:var(--spacing-2) var(--spacing-3)"><button class="ssc-btn ssm-add-endpoint-btn">+ Add SSH Endpoint</button></div>`;

    // Syncignore section
    html += `
      <div class="ssm-syncignore-section" id="ssc-server-syncignore">
        <button type="button" class="ssm-syncignore-toggle">Sync Rules (.syncignore) <span class="ssm-syncignore-arrow">&#x25B6;</span></button>
        <div class="ssm-syncignore-body hidden">
          <textarea class="ssm-syncignore-textarea" rows="8" spellcheck="false" placeholder="Loading..."></textarea>
          <button type="button" class="ssm-syncignore-save">Save</button>
        </div>
      </div>
    `;

    _contentEl.innerHTML = html;

    // Bind events for each card
    _contentEl.querySelectorAll('.ssc-card').forEach(card => {
      const epId = card.dataset.epId;
      const ep = endpoints.find(e => e.id === epId);
      if (!ep) return;

      // Help toggles
      card.querySelectorAll('.ssm-help-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
          const panelCls = btn.getAttribute('data-panel');
          const panel = card.querySelector('.' + panelCls);
          if (!panel) return;
          const isOpen = !panel.classList.contains('hidden');
          card.querySelectorAll('.oc-help-panel').forEach(p => p.classList.add('hidden'));
          card.querySelectorAll('.ssm-help-toggle').forEach(b => b.classList.remove('active'));
          if (!isOpen) { panel.classList.remove('hidden'); btn.classList.add('active'); }
        });
      });

      // Enable checkbox
      const enableCb = card.querySelector('.ssm-enable');
      const fieldsEl = card.querySelector('.ssm-fields');
      enableCb.addEventListener('change', () => fieldsEl.classList.toggle('hidden', !enableCb.checked));

      // Auth method
      const authSelect = card.querySelector('.ssm-auth-method');
      const keyLabel = card.querySelector('.ssm-key-label');
      const pwLabel = card.querySelector('.ssm-password-label');
      authSelect.addEventListener('change', () => {
        keyLabel.classList.toggle('hidden', authSelect.value !== 'key');
        pwLabel.classList.toggle('hidden', authSelect.value !== 'password');
      });

      // Test SSH
      card.querySelector('.ssm-test-btn').addEventListener('click', async (e) => {
        const btn = e.target;
        const resultEl = card.querySelector('.ssc-test-result');
        const config = _collectSshConfig(card);
        if (!config.host || !config.username || !config.remotePath) {
          resultEl.textContent = 'Host, username, and remote path required.';
          resultEl.className = 'ssc-test-result ssc-test-error';
          return;
        }
        btn.disabled = true; btn.textContent = '…'; resultEl.textContent = '';
        try {
          const r = await window.api.serverSyncTestSsh(config);
          if (r.ok) {
            resultEl.textContent = `✓ ${r.fileCount} file${r.fileCount !== 1 ? 's' : ''} (${r.latencyMs}ms)`;
            resultEl.className = 'ssc-test-result ssc-test-ok';
          } else {
            resultEl.textContent = r.error || 'Failed';
            resultEl.className = 'ssc-test-result ssc-test-error';
          }
        } catch (err) {
          resultEl.textContent = err.message;
          resultEl.className = 'ssc-test-result ssc-test-error';
        }
        btn.disabled = false; btn.textContent = 'Test SSH';
      });

      // Save
      card.querySelector('.ssm-save-btn').addEventListener('click', async (e) => {
        const btn = e.target;
        const config = _collectSshConfig(card);
        const enabled = enableCb.checked;
        if (enabled && (!config.host || !config.username || !config.remotePath)) {
          const resultEl = card.querySelector('.ssc-test-result');
          resultEl.textContent = 'Host, username, and remote path required.';
          resultEl.className = 'ssc-test-result ssc-test-error';
          return;
        }
        btn.disabled = true; btn.textContent = 'Saving…';
        const labelInput = card.querySelector('.ssm-label-input');
        const update = {
          id: ep.id,
          label: labelInput ? labelInput.value.trim() : ep.label,
          syncEnabled: enabled,
          sshHost: config.host || undefined,
          sshPort: config.port,
          sshUsername: config.username || undefined,
          sshAuthMethod: config.authMethod,
          sshKeyPath: config.authMethod === 'key' ? config.privateKeyPath : undefined,
          sshRemotePath: config.remotePath || undefined,
        };
        if (config.authMethod === 'password' && config.password) update.sshPassword = config.password;
        await window.api.updateSshSyncEndpoint(update);
        if (enabled) { await window.api.serverSyncEnable?.(ep.id); } else { await window.api.serverSyncDisable?.(ep.id); }
        btn.textContent = 'Saved!';
        setTimeout(() => { btn.textContent = 'Save'; btn.disabled = false; }, 1500);
      });

      // Sync Now
      card.querySelector('.ssm-sync-btn')?.addEventListener('click', async (e) => {
        const btn = e.target;
        btn.disabled = true; btn.textContent = '…';
        await window.api.serverSyncNow?.(ep.id);
        btn.textContent = 'Sync Now'; btn.disabled = false;
        await _renderServerTab();
      });

      // Delete
      card.querySelector('.ssm-delete-btn')?.addEventListener('click', async () => {
        if (!confirm(`Remove SSH endpoint "${ep.label || ep.sshHost || ep.id}"?`)) return;
        await window.api.removeSshSyncEndpoint(ep.id);
        await _renderServerTab();
      });
    });

    // Add endpoint button
    _contentEl.querySelector('.ssm-add-endpoint-btn')?.addEventListener('click', async () => {
      const id = crypto.randomUUID();
      await window.api.addSshSyncEndpoint({ id, label: 'My Server', syncEnabled: false, sshAuthMethod: 'agent' });
      _renderServerTab();
    });

    // Syncignore
    _bindSyncignore(document.getElementById('ssc-server-syncignore'), 'sync');
  }

  function _collectSshConfig(card) {
    const host = card.querySelector('.ssm-host').value.trim();
    const port = parseInt(card.querySelector('.ssm-port').value, 10) || 22;
    const username = card.querySelector('.ssm-username').value.trim();
    const authMethod = card.querySelector('.ssm-auth-method').value;
    const remotePath = card.querySelector('.ssm-remote-path').value.trim();
    const config = { host, port, username, remotePath, authMethod };
    if (authMethod === 'agent') config.agent = true;
    else if (authMethod === 'key') config.privateKeyPath = card.querySelector('.ssm-key-path').value.trim();
    else if (authMethod === 'password') config.password = card.querySelector('.ssm-password').value;
    return config;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Remotes tab
  // ──────────────────────────────────────────────────────────────────────────
  // ── Shared syncignore binding ──────────────────────────────────────────────
  function _bindSyncignore(section, channel) {
    if (!section) return;
    const toggle = section.querySelector('.ssm-syncignore-toggle');
    const body = section.querySelector('.ssm-syncignore-body');
    const arrow = section.querySelector('.ssm-syncignore-arrow');
    const textarea = section.querySelector('.ssm-syncignore-textarea');
    const saveBtn = section.querySelector('.ssm-syncignore-save');
    toggle?.addEventListener('click', async () => {
      const opening = body.classList.contains('hidden');
      body.classList.toggle('hidden');
      arrow.textContent = opening ? '▼' : '▶';
      if (opening) {
        textarea.value = await window.api.syncIgnoreRead(channel) || '';
      }
    });
    saveBtn?.addEventListener('click', async () => {
      await window.api.syncIgnoreWrite(channel, textarea.value);
      saveBtn.textContent = 'Saved';
      setTimeout(() => { saveBtn.textContent = 'Save'; }, 1500);
    });
  }

  // ── State (populated by UnifiedSyncIndicator) ──────────────────────────────
  // These are written from outside and read by tab renderers
  // _gitState, _gitPaused, _awsState, _awsLoggedIn, _awsLastSync, _serverState

  // ── Public API ─────────────────────────────────────────────────────────────
  return {
    _gitState: 'not-configured',
    _gitPaused: false,
    _awsState: 'disabled',
    _awsLoggedIn: false,
    _awsLastSync: null,
    _serverState: 'disabled',

    init() {
      _modal = document.getElementById('sync-settings-modal');
      if (!_modal) return;
      _tabsEl = document.getElementById('sync-settings-tabs');
      _contentEl = document.getElementById('sync-settings-content');

      // Close button & backdrop
      document.getElementById('sync-settings-close')?.addEventListener('click', _hide);
      _modal.querySelector('.modal-backdrop')?.addEventListener('click', _hide);

      // Tab clicks
      _tabsEl.querySelectorAll('.sync-tab').forEach(btn => {
        btn.addEventListener('click', () => _setActiveTab(btn.dataset.tab));
      });
    },

    show(tab) { _show(tab); },
    hide() { _hide(); },

    refreshActiveTab() {
      if (_modal && !_modal.classList.contains('hidden')) {
        _renderTabContent(_activeTab);
      }
    },
  };
})();

// ─── Unified Sync Indicator ──────────────────────────────────────────────────
// Consolidates git, AWS S3, and SSH/SFTP sync status into a single bar + dropdown.
const UnifiedSyncIndicator = (() => {
  // Internal per-method state
  const _methods = {
    git:    { state: 'not-configured', lastSync: null, paused: false, visible: true },
    aws:    { state: 'disabled', lastSync: null, paused: false, visible: true, loggedIn: false, conflictCount: 0 },
    server: { state: 'disabled', lastSync: null, visible: false, statusMap: null },
  };

  // Returns the user-visible state for a method, folding in conflict counts and paused flags.
  function _effectiveState(key, m) {
    if (key === 'aws' && (m.conflictCount || 0) > 0) return 'conflict';
    return (m.paused && m.state === 'idle') ? 'paused' : m.state;
  }

  // DOM refs
  let _root = null;
  let _bar = null;
  let _dropdown = null;
  let _labelEl = null;
  let _iconEl = null;

  // State labels for the bar (aggregate fallback)
  const _BAR_LABELS = {
    off: 'Set up sync',
    synced: 'Synced',
    syncing: 'Syncing\u2026',
    error: 'Sync error',
    conflict: 'Conflict',
    offline: 'Offline',
    paused: 'Paused',
  };

  // Short display names for each sync method
  const _METHOD_NAMES = { git: 'GitHub', aws: 'AWS', server: 'SSH' };

  // Per-source state labels (shorter than bar labels)
  const _SOURCE_LABELS = {
    idle: 'Synced',
    syncing: 'Syncing\u2026',
    error: 'Error',
    conflict: 'Conflict',
    offline: 'Offline',
    paused: 'Paused',
  };

  // Status text for the dropdown header
  const _STATUS_TEXT = {
    off: 'Off',
    synced: 'All synced',
    syncing: 'Syncing\u2026',
    error: 'Error',
    conflict: 'Conflict',
    offline: 'Offline',
    paused: 'Paused',
  };

  function _formatTime(ts) {
    if (!ts) return 'never';
    const ago = Date.now() - ts;
    const mins = Math.floor(ago / 60000);
    if (mins < 1) return 'just now';
    if (mins === 1) return '1 min ago';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs === 1) return '1 hr ago';
    if (hrs < 24) return `${hrs} hrs ago`;
    return new Date(ts).toLocaleDateString();
  }

  function _computeAggregate() {
    // Collect states from all visible methods
    const active = [];
    if (_methods.git.visible && _methods.git.state !== 'not-configured') {
      active.push(['git', _methods.git]);
    }
    if (_methods.aws.loggedIn && (_methods.aws.state !== 'disabled' || _methods.aws.conflictCount > 0)) {
      active.push(['aws', _methods.aws]);
    }
    if (_methods.server.visible && _methods.server.state !== 'disabled') {
      active.push(['server', _methods.server]);
    }

    if (active.length === 0) return { state: 'off', lastSync: null, activeKeys: [] };

    const states = active.map(([k, m]) => _effectiveState(k, m));

    // Priority: error/conflict > syncing > offline > paused > synced(idle) > off
    let agg;
    if (states.includes('error'))         agg = 'error';
    else if (states.includes('conflict')) agg = 'conflict';
    else if (states.includes('syncing'))  agg = 'syncing';
    else if (states.includes('offline'))  agg = 'offline';
    else if (states.includes('paused'))   agg = 'paused';
    else if (states.includes('idle'))     agg = 'synced';
    else                                  agg = 'off';

    const syncs = active.map(([, m]) => m.lastSync).filter(Boolean);
    const lastSync = syncs.length ? Math.max(...syncs) : null;

    // Collect active method keys for per-source labels
    const activeKeys = active.map(([k]) => k);

    return { state: agg, lastSync, activeKeys };
  }

  function _render() {
    if (!_root) return;
    const { state, lastSync, activeKeys } = _computeAggregate();

    // Update root state class
    for (const cls of [..._root.classList]) {
      if (cls.startsWith('unified-sync--')) _root.classList.remove(cls);
    }
    _root.classList.add(`unified-sync--${state}`);

    // Per-method indicator dots inline with labels
    if (_iconEl) _iconEl.innerHTML = '';
    if (_labelEl) _labelEl.innerHTML = '';

    if (activeKeys.length === 0) {
      // No active methods — single dim dot + fallback label
      if (_iconEl) {
        const dot = document.createElement('span');
        dot.className = 'sync-method-dot';
        dot.dataset.state = 'off';
        _iconEl.appendChild(dot);
      }
      if (_labelEl) _labelEl.textContent = _BAR_LABELS[state] || 'Sync';
    } else {
      // Hide the leading icon container; dots go inline in the label
      if (_iconEl) _iconEl.style.display = 'none';
      if (_labelEl) {
        activeKeys.forEach((key, i) => {
          if (i > 0) {
            const sep = document.createElement('span');
            sep.className = 'sync-method-sep';
            sep.textContent = ' · ';
            _labelEl.appendChild(sep);
          }
          const dot = document.createElement('span');
          dot.className = 'sync-method-dot';
          const m = _methods[key];
          const st = _effectiveState(key, m);
          dot.dataset.state = st;
          dot.title = _METHOD_NAMES[key] || key;
          _labelEl.appendChild(dot);

          const text = document.createElement('span');
          let sourceLabel = _SOURCE_LABELS[st] || st;
          if (key === 'aws' && st === 'conflict') {
            const n = m.conflictCount || 0;
            sourceLabel = `${n} conflict${n === 1 ? '' : 's'}`;
          }
          text.textContent = ` ${_METHOD_NAMES[key]}: ${sourceLabel}`;
          _labelEl.appendChild(text);
        });
      }
    }

    // Re-show the icon container when no active methods
    if (activeKeys.length === 0 && _iconEl) {
      _iconEl.style.display = '';
    }

    // Dropdown header
    const statusDot = document.getElementById('usd-status-dot');
    const statusText = document.getElementById('usd-status-text');
    const lastSyncEl = document.getElementById('usd-last-sync');
    if (statusText) statusText.textContent = _STATUS_TEXT[state] || state;
    if (lastSyncEl) lastSyncEl.textContent = `Last synced: ${_formatTime(lastSync)}`;

    // Git row
    _renderGitRow();
    // AWS row
    _renderAwsRow();
    // Server row
    _renderServerRow();

    // Pipe state to SyncSettingsModal
    if (typeof SyncSettingsModal !== 'undefined') {
      SyncSettingsModal._gitState = _methods.git.state;
      SyncSettingsModal._gitPaused = !!_methods.git.paused;
      SyncSettingsModal._awsState = _methods.aws.state;
      SyncSettingsModal._awsLoggedIn = !!_methods.aws.loggedIn;
      SyncSettingsModal._awsLastSync = _methods.aws.lastSync;
      SyncSettingsModal._serverState = _methods.server.state;
      SyncSettingsModal.refreshActiveTab();
    }
  }

  function _renderGitRow() {
    const row = document.getElementById('usd-method-git');
    const check = document.getElementById('usd-git-check');
    const status = document.getElementById('usd-git-status');
    if (!row) return;

    const g = _methods.git;
    const notConfigured = g.state === 'not-configured';
    row.classList.toggle('usd-method--not-configured', notConfigured);
    const effectiveState = (g.paused && g.state === 'idle') ? 'paused' : g.state;
    const labels = {
      'not-configured': 'Not set up', idle: 'Synced', syncing: 'Syncing\u2026',
      conflict: 'Conflict', error: 'Error', paused: 'Paused',
    };
    if (check) {
      check.textContent = notConfigured ? '' : (g.paused ? '⏸' : '●');
      check.dataset.state = effectiveState;
    }
    if (status) status.textContent = labels[effectiveState] || effectiveState;
  }

  function _renderAwsRow() {
    const row = document.getElementById('usd-method-aws');
    const check = document.getElementById('usd-aws-check');
    const status = document.getElementById('usd-aws-status');
    const gear = document.getElementById('usd-aws-gear');
    const resolveBtn = document.getElementById('usd-aws-resolve');
    if (!row) return;

    const a = _methods.aws;
    const notConfigured = !a.loggedIn;
    row.classList.toggle('usd-method--not-configured', notConfigured);
    row.style.opacity = '';
    if (gear) gear.disabled = false;

    const conflictCount = a.conflictCount || 0;
    if (resolveBtn) resolveBtn.classList.toggle('hidden', conflictCount === 0);

    if (notConfigured) {
      if (check) check.textContent = '';
      if (status) status.textContent = 'Sign in to enable';
      return;
    }

    const effectiveState = _effectiveState('aws', a);
    const labels = {
      disabled: 'Off', idle: 'Synced', syncing: 'Syncing\u2026',
      offline: 'Offline', error: 'Error', paused: 'Paused',
    };
    if (check) {
      check.textContent = (a.state !== 'disabled' || conflictCount > 0) ? (a.paused ? '⏸' : '●') : '';
      check.dataset.state = effectiveState;
    }
    if (status) {
      if (effectiveState === 'conflict') {
        status.textContent = `${conflictCount} conflict${conflictCount === 1 ? '' : 's'}`;
      } else {
        status.textContent = labels[effectiveState] || effectiveState;
      }
    }
  }

  function _renderServerRow() {
    const row = document.getElementById('usd-method-server');
    const check = document.getElementById('usd-server-check');
    const status = document.getElementById('usd-server-status');
    if (!row) return;

    const s = _methods.server;
    const notConfigured = !s.visible;
    row.classList.toggle('usd-method--not-configured', notConfigured);

    if (notConfigured) {
      if (check) check.textContent = '';
      if (status) status.textContent = 'Not configured';
      return;
    }

    const labels = {
      disabled: 'Off', idle: 'Synced', syncing: 'Syncing\u2026',
      offline: 'Offline', error: 'Error', paused: 'Paused',
    };
    const isPaused = s.paused || s.state === 'paused';
    if (check) {
      check.textContent = isPaused ? '⏸' : '●';
      check.dataset.state = isPaused ? 'paused' : s.state;
    }
    if (status) status.textContent = labels[s.state] || s.state;
  }


  function _toggleDropdown() {
    if (!_dropdown) return;
    if (_dropdown.classList.contains('hidden')) {
      _dropdown.classList.remove('hidden');
      setTimeout(() => {
        document.addEventListener('click', _onClickOutside, { once: false });
      }, 0);
    } else {
      _hideDropdown();
    }
  }

  function _hideDropdown() {
    if (_dropdown) _dropdown.classList.add('hidden');
    document.removeEventListener('click', _onClickOutside);
  }

  function _onClickOutside(e) {
    if (!_root || (_dropdown && _dropdown.classList.contains('hidden'))) {
      document.removeEventListener('click', _onClickOutside);
      return;
    }
    if (!_root.contains(e.target)) {
      _hideDropdown();
    }
  }

  // Public API
  return {
    init() {
      _root = document.getElementById('unified-sync');
      _bar = document.getElementById('unified-sync-bar');
      _dropdown = document.getElementById('unified-sync-dropdown');
      _labelEl = document.getElementById('unified-sync-label');
      _iconEl = document.getElementById('unified-sync-icon');
      if (!_root) return;

      // Bar click → toggle dropdown
      _bar?.addEventListener('click', (e) => {
        _toggleDropdown();
        e.stopPropagation();
      });

      // --- Git sync events ---
      window.api.onSyncStatusChanged(async (event) => {
        if (window.SyncState) window.SyncState._lastSyncEvent = event;

        _methods.git.state = event.state;
        _methods.git.paused = !!event.paused;
        if (event.state === 'idle' && event.timestamp) {
          _methods.git.lastSync = event.timestamp;
        }

        if (SyncLogPanel._visible) SyncLogPanel._refresh();

        // Recovery modal on corruption
        if (event.state === 'error' && event.error && event.error.corruption && !event.error.corruption.healthy) {
          SyncRecoveryModal.open(event.error.corruption);
        }

        // Conflict handling
        if (event.state === 'conflict') {
          _conflictData = await window.api.getConflicts();
          _conflictPaths = new Set(_conflictData.map(c => c.filePath));
          ConflictBanner.show(_conflictData.length);
          renderFilteredTree();
        } else if (event.previousState === 'conflict') {
          _conflictData = [];
          _conflictPaths = new Set();
          ConflictBanner.hide();
          renderFilteredTree();
          _refreshAllConflictPanels();
        }

        _render();
      });

      // --- AWS sync events ---
      window.api.onAwsSyncStatusChanged?.((data) => {
        _methods.aws.state = data.state;
        _methods.aws.paused = data.paused ?? (data.state === 'paused');
        if (data.lastSync) _methods.aws.lastSync = data.lastSync;
        _render();
      });

      // AWS login state
      window.api.onAuthStateChanged?.((user) => {
        _methods.aws.loggedIn = !!user;
        _render();
      });
      window.api.authIsLoggedIn?.().then((loggedIn) => {
        _methods.aws.loggedIn = !!loggedIn;
        _render();
      });

      // Initial AWS status
      window.api.awsSyncGetStatus?.().then((s) => {
        if (s) {
          _methods.aws.state = s.state;
          _methods.aws.paused = s.paused ?? (s.state === 'paused');
          if (s.lastSync) _methods.aws.lastSync = s.lastSync;
          _render();
        }
      });

      // --- Server sync events ---
      window.api.onServerSyncStatusChanged?.(() => {
        window.api.serverSyncGetStatus?.().then(statusMap => {
          _updateServerFromStatusMap(statusMap);
          _render();
        });
      });
      window.api.serverSyncGetStatus?.().then(statusMap => {
        _updateServerFromStatusMap(statusMap);
        _render();
      });

      // Server row visibility
      async function checkServerVisibility() {
        const endpoints = await window.api.getSshSyncEndpoints?.();
        _methods.server.visible = !!(endpoints && endpoints.length > 0);
        _render();
      }
      checkServerVisibility();
      window.api.onSshSyncEndpointsChanged?.(() => checkServerVisibility());
      window.api.onProvidersUpdated?.(() => checkServerVisibility());

      // --- Method row clicks (toggle pause/resume/enable) ---
      document.getElementById('usd-method-git')?.addEventListener('click', (e) => {
        if (e.target.closest('.usd-method-gear')) return;
        if (_methods.git.state === 'not-configured') return;
        const g = _methods.git;
        const effectiveState = (g.paused && g.state === 'idle') ? 'paused' : g.state;
        if (effectiveState === 'paused') {
          window.api.resumeSync?.();
        } else {
          window.api.pauseSync?.();
        }
      });

      document.getElementById('usd-method-aws')?.addEventListener('click', (e) => {
        if (e.target.closest('.usd-method-gear')) return;
        if (!_methods.aws.loggedIn) return;
        const a = _methods.aws;
        if (a.state === 'disabled') {
          window.api.awsSyncEnable?.();
        } else if (a.state === 'paused' || (a.paused && a.state === 'idle')) {
          window.api.awsSyncResume?.();
        } else {
          window.api.awsSyncPause?.();
        }
      });

      document.getElementById('usd-method-server')?.addEventListener('click', async (e) => {
        if (e.target.closest('.usd-method-gear')) return;
        if (!_methods.server.visible) return;
        const s = _methods.server;
        if (s.state === 'disabled') {
          // Re-enable all endpoints
          const endpoints = await window.api.getSshSyncEndpoints?.() || [];
          for (const ep of endpoints) {
            window.api.serverSyncEnable?.(ep.id);
          }
        } else if (s.state === 'paused') {
          window.api.serverSyncResumeAll?.();
        } else {
          window.api.serverSyncPauseAll?.();
        }
      });

      // --- Gear icon clicks (open unified sync settings) ---
      document.getElementById('usd-git-gear')?.addEventListener('click', (e) => {
        e.stopPropagation();
        SyncSettingsModal.show('github');
        _hideDropdown();
      });

      document.getElementById('usd-aws-gear')?.addEventListener('click', (e) => {
        e.stopPropagation();
        SyncSettingsModal.show('cloud');
        _hideDropdown();
      });

      document.getElementById('usd-server-gear')?.addEventListener('click', (e) => {
        e.stopPropagation();
        SyncSettingsModal.show('server');
        _hideDropdown();
      });

      // AWS conflict "Resolve" button
      document.getElementById('usd-aws-resolve')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof _showConflictResolveModal === 'function') _showConflictResolveModal();
      });

      // Header gear → open sync settings with smart tab selection
      document.getElementById('usd-header-gear')?.addEventListener('click', (e) => {
        e.stopPropagation();
        // Priority: first currently-on method > first configured method > first method
        const tabMap = { git: 'github', aws: 'cloud', server: 'server' };
        const order = ['git', 'aws', 'server'];
        const isOn = (k) => {
          const m = _methods[k];
          return m.state !== 'disabled' && m.state !== 'not-configured' && m.state !== 'off';
        };
        const isConfigured = (k) => {
          const m = _methods[k];
          if (k === 'git') return m.state !== 'not-configured';
          if (k === 'aws') return m.loggedIn;
          if (k === 'server') return m.visible;
          return false;
        };
        const pick = order.find(isOn) || order.find(isConfigured) || 'git';
        SyncSettingsModal.show(tabMap[pick]);
        _hideDropdown();
      });

      // Initial git state
      Promise.all([window.api.getSyncState(), window.api.isSyncPaused()])
        .then(([state, paused]) => {
          if (state) {
            _methods.git.state = state;
            _methods.git.paused = !!paused;
          }
          _render();
        });
    },

    refresh() {
      // Called on workspace switch to re-fetch git state
      Promise.all([window.api.getSyncState(), window.api.isSyncPaused()])
        .then(([state, paused]) => {
          if (state) {
            _methods.git.state = state;
            _methods.git.paused = !!paused;
          }
          _render();
        });
    },

    setAwsConflictCount(n) {
      _methods.aws.conflictCount = Math.max(0, n | 0);
      _render();
    },
  };

  function _updateServerFromStatusMap(statusMap) {
    _methods.server.statusMap = statusMap;
    const entries = Object.entries(statusMap || {});
    if (entries.length === 0) {
      _methods.server.state = 'disabled';
      _methods.server.lastSync = null;
      return;
    }
    const states = entries.map(([, s]) => s.state);
    if (states.includes('syncing'))       _methods.server.state = 'syncing';
    else if (states.includes('error'))    _methods.server.state = 'error';
    else if (states.includes('offline'))  _methods.server.state = 'offline';
    else if (states.includes('idle'))     _methods.server.state = 'idle';
    else if (states.includes('paused'))   _methods.server.state = 'paused';
    else                                  _methods.server.state = 'disabled';

    const syncs = entries.map(([, s]) => s.lastSyncTimestamp).filter(Boolean);
    _methods.server.lastSync = syncs.length ? Math.max(...syncs) : null;
  }
})();

// ─── AWS Sync Settings Modal ─────────────────────────────────────────────────
// Replaces the old AwsSyncPopover — same controls in a proper modal.
const AwsSyncSettingsModal = (() => {
  let _modal = null;
  let _toggleEl = null;
  let _controlsEl = null;
  let _pauseBtn = null;
  let _syncNowBtn = null;
  let _unlinkBtn = null;
  let _statusEl = null;
  let _lastSyncEl = null;
  let _state = 'disabled';
  let _lastSync = null;

  function _updateUI(state, lastSync) {
    _state = state;
    if (lastSync) _lastSync = lastSync;
    if (!_modal) return;

    const enabled = state !== 'disabled';
    const paused = state === 'paused';

    if (_toggleEl) _toggleEl.checked = enabled;
    if (_controlsEl) _controlsEl.classList.toggle('hidden', !enabled);
    if (_pauseBtn) _pauseBtn.textContent = paused ? 'Resume' : 'Pause';
    if (_syncNowBtn) _syncNowBtn.classList.toggle('hidden', paused);

    const stateLabels = {
      disabled: 'Off', idle: 'Up to date', syncing: 'Syncing\u2026',
      offline: 'Offline', error: 'Error', paused: 'Paused'
    };
    if (_statusEl) _statusEl.textContent = stateLabels[state] || state;

    if (_lastSyncEl) {
      const ts = _lastSync ? new Date(_lastSync).toLocaleTimeString() : 'never';
      _lastSyncEl.textContent = `Last sync: ${ts}`;
    }
    // Show syncignore section when enabled
    const ignoreEl = document.getElementById('aws-settings-syncignore');
    if (ignoreEl) ignoreEl.classList.toggle('hidden', !enabled);
  }

  function show() {
    if (_modal) _modal.classList.remove('hidden');
  }

  function hide() {
    if (_modal) _modal.classList.add('hidden');
  }

  return {
    init() {
      _modal = document.getElementById('aws-sync-settings-modal');
      if (!_modal) return;
      _toggleEl = document.getElementById('aws-settings-enable-toggle');
      _controlsEl = document.getElementById('aws-settings-controls');
      _pauseBtn = document.getElementById('aws-settings-pause-btn');
      _syncNowBtn = document.getElementById('aws-settings-sync-now-btn');
      _unlinkBtn = document.getElementById('aws-settings-unlink-btn');
      _statusEl = document.getElementById('aws-settings-status-text');
      _lastSyncEl = document.getElementById('aws-settings-last-sync');

      // Close button & backdrop
      document.getElementById('aws-settings-close-btn')?.addEventListener('click', hide);
      _modal.querySelector('.modal-backdrop')?.addEventListener('click', hide);

      // Enable/disable toggle
      _toggleEl?.addEventListener('change', async () => {
        if (_toggleEl.checked) {
          const s = await window.api.awsSyncEnable?.();
          if (s) _updateUI(s.state, s.lastSync);
        } else {
          const s = await window.api.awsSyncDisable?.();
          if (s) _updateUI(s.state, s.lastSync);
        }
      });

      // Pause/Resume
      _pauseBtn?.addEventListener('click', async () => {
        let s;
        if (_state === 'paused') {
          s = await window.api.awsSyncResume?.();
        } else {
          s = await window.api.awsSyncPause?.();
        }
        if (s) _updateUI(s.state, s.lastSync);
      });

      // Sync Now
      _syncNowBtn?.addEventListener('click', async () => {
        const s = await window.api.awsSyncNow?.();
        if (s) _updateUI(s.state, s.lastSync);
      });

      // Unlink
      _unlinkBtn?.addEventListener('click', () => {
        AwsSyncUnlinkModal.show(async (opts) => {
          const s = await window.api.awsSyncUnlink?.(opts);
          if (s) _updateUI(s.state, s.lastSync);
          hide();
        });
      });

      // Live status updates
      window.api.onAwsSyncStatusChanged?.((data) => _updateUI(data.state, data.lastSync));

      // Syncignore section
      const igSection = document.getElementById('aws-settings-syncignore');
      if (igSection) {
        const igToggle = igSection.querySelector('.ssm-syncignore-toggle');
        const igBody = igSection.querySelector('.ssm-syncignore-body');
        const igArrow = igSection.querySelector('.ssm-syncignore-arrow');
        const igTextarea = igSection.querySelector('.ssm-syncignore-textarea');
        const igSave = igSection.querySelector('.ssm-syncignore-save');
        igToggle.addEventListener('click', async () => {
          const opening = igBody.classList.contains('hidden');
          igBody.classList.toggle('hidden');
          igArrow.textContent = opening ? '\u25BC' : '\u25B6';
          if (opening) {
            igTextarea.value = await window.api.syncIgnoreRead('sync') || '';
          }
        });
        igSave.addEventListener('click', async () => {
          await window.api.syncIgnoreWrite('sync', igTextarea.value);
          igSave.textContent = 'Saved';
          setTimeout(() => { igSave.textContent = 'Save'; }, 1500);
        });
      }

      // Initial state
      window.api.awsSyncGetStatus?.().then((s) => {
        if (s) _updateUI(s.state, s.lastSync);
      });
    },
    show,
    hide,
    update: _updateUI,
  };
})();

const ServerSyncPopover = (() => {
  let _modal = null;
  let _listEl = null;

  function _esc(s) { const d = document.createElement('span'); d.textContent = s; return d.innerHTML; }

  async function _render() {
    if (!_listEl) return;
    const endpoints = await window.api.getOpenclawRemoteEndpoints();
    const statusMap = await window.api.serverSyncGetStatus?.() || {};

    if (!endpoints || endpoints.length === 0) {
      _listEl.innerHTML = '<div class="ssm-empty">No OpenClaw remote endpoints configured.<br>Add one from Settings \u2192 Endpoint Settings.</div>';
      return;
    }

    _listEl.innerHTML = '';
    for (const ep of endpoints) {
      const s = statusMap[ep.id] || {};
      const stateLabel = { disabled: 'Off', idle: 'Up to date', syncing: 'Syncing\u2026', offline: 'Offline', error: 'Error' }[s.state] || 'Off';

      const card = document.createElement('div');
      card.className = 'ssm-card';
      card.innerHTML = `
        <div class="ssm-card-header">
          <span class="ssm-card-label">${_esc(ep.label)}</span>
          <span class="ssm-card-state ssm-state--${s.state || 'disabled'}">${stateLabel}</span>
        </div>
        <div class="ssm-card-body">
          <label class="oc-checkbox-label">
            <input type="checkbox" class="ssm-enable" ${ep.syncEnabled ? 'checked' : ''} />
            Enable file sync
          </label>
          <div class="ssm-fields ${ep.syncEnabled ? '' : 'hidden'}">
            <label>
              <span class="oc-label-row">SSH Host <button type="button" class="oc-help-btn ssm-help-toggle" data-panel="ssm-help-host" title="What to enter">?</button></span>
              <input type="text" class="ssm-host" value="${_esc(ep.sshHost || '')}" placeholder="my-server.com" autocomplete="off" />
            </label>
            <div class="oc-help-panel ssm-help-host hidden">
              <div class="oc-help-content">
                <p>The hostname or IP address of your OpenClaw server. This is the same machine you SSH into.</p>
                <table class="oc-help-table">
                  <tr><td>Domain name</td><td><code>my-server.com</code></td></tr>
                  <tr><td>IP address</td><td><code>203.0.113.10</code></td></tr>
                  <tr><td>Tailscale / private network</td><td><code>my-machine</code></td></tr>
                  <tr><td>Local / Docker</td><td><code>localhost</code></td></tr>
                </table>
              </div>
            </div>
            <div class="ssm-row-2col">
              <label>Port <span class="oc-optional-hint">(default: 22)</span>
                <input type="number" class="ssm-port" value="${ep.sshPort || 22}" min="1" max="65535" />
              </label>
              <label>
                <span class="oc-label-row">Username <button type="button" class="oc-help-btn ssm-help-toggle" data-panel="ssm-help-user" title="Which user to connect as">?</button></span>
                <input type="text" class="ssm-username" value="${_esc(ep.sshUsername || '')}" placeholder="user" autocomplete="off" />
              </label>
            </div>
            <div class="oc-help-panel ssm-help-user hidden">
              <div class="oc-help-content">
                <p>The SSH login user \u2014 the same one from your <code>ssh</code> command:</p>
                <p><code>ssh <strong>user</strong>@my-server.com</code></p>
                <p>Check your cloud provider for the default username, or use whatever account you normally SSH in with.</p>
              </div>
            </div>
            <label>
              <span class="oc-label-row">Auth Method <button type="button" class="oc-help-btn ssm-help-toggle" data-panel="ssm-help-auth" title="Which method to choose">?</button></span>
              <select class="ssm-auth-method">
                <option value="agent" ${(ep.sshAuthMethod || 'agent') === 'agent' ? 'selected' : ''}>SSH Agent</option>
                <option value="key" ${ep.sshAuthMethod === 'key' ? 'selected' : ''}>Private Key</option>
                <option value="password" ${ep.sshAuthMethod === 'password' ? 'selected' : ''}>Password</option>
              </select>
            </label>
            <div class="oc-help-panel ssm-help-auth hidden">
              <div class="oc-help-content">
                <p><strong>SSH Agent</strong> \u2014 Uses your running SSH agent (recommended). Works automatically if you can <code>ssh user@host</code> from your terminal without entering a password.</p>
                <p><strong>Private Key</strong> \u2014 Path to your SSH private key file. The app only stores the path, not the key itself. Use this if you don't run an SSH agent or if the app can't find your agent socket.</p>
                <p><strong>Password</strong> \u2014 Authenticate with a password. The password is stored encrypted on disk via macOS Keychain. Least recommended \u2014 prefer keys when possible.</p>
              </div>
            </div>
            <label class="ssm-key-label ${(ep.sshAuthMethod || 'agent') === 'key' ? '' : 'hidden'}">Key Path <span class="oc-optional-hint">(only for Private Key auth)</span>
              <input type="text" class="ssm-key-path" value="${_esc(ep.sshKeyPath || '')}" placeholder="Path to your private key" autocomplete="off" />
            </label>
            <label class="ssm-password-label ${ep.sshAuthMethod === 'password' ? '' : 'hidden'}">SSH Password <span class="oc-optional-hint">(only for Password auth)</span>
              <input type="password" class="ssm-password" value="" placeholder="${ep.sshAuthMethod === 'password' ? 'Saved \u2014 blank to keep' : 'Enter SSH password'}" autocomplete="off" />
            </label>
            <label>
              <span class="oc-label-row">Remote Path <button type="button" class="oc-help-btn ssm-help-toggle" data-panel="ssm-help-path" title="Which folder to sync">?</button></span>
              <input type="text" class="ssm-remote-path" value="${_esc(ep.sshRemotePath || '')}" placeholder="/home/&lt;user&gt;/notes" autocomplete="off" />
            </label>
            <div class="oc-help-panel ssm-help-path hidden">
              <div class="oc-help-content">
                <p>The <strong>absolute path on the host</strong> where your <code>.html</code> note files will be synced. SFTP does not expand <code>~</code>, so use the full path (e.g. <code>/home/&lt;user&gt;/...</code>).</p>
                <p><code>~/</code> corresponds to <code>/home/<strong>&lt;your-ssh-username&gt;</strong>/</code></p>
                <table class="oc-help-table">
                  <tr><td>OpenClaw workspace (Docker)</td><td><code>/home/&lt;user&gt;/.openclaw/workspace</code></td></tr>
                  <tr><td>Custom sync folder</td><td><code>/home/&lt;user&gt;/my-notes</code></td></tr>
                  <tr><td>Docker volume</td><td>Check your <code>volumes:</code> mapping and use the <strong>left</strong> (host) side</td></tr>
                </table>
                <p>The folder will be <strong>created automatically</strong> if it doesn't exist. Only <code>.html</code> files are synced; dot-folders like <code>.git</code> are ignored.</p>
              </div>
            </div>
            <div class="ssm-actions">
              <button class="ssm-test-btn aws-sync-popover-btn">Test SSH</button>
              <button class="ssm-save-btn aws-sync-popover-btn">Save</button>
              <button class="ssm-sync-btn aws-sync-popover-btn ${ep.syncEnabled ? '' : 'hidden'}">Sync Now</button>
              <span class="ssm-test-result"></span>
            </div>
            <div class="ssm-info">
              ${s.fileCount ? s.fileCount + ' files synced' : ''}${s.lastSyncTimestamp ? ' \u2014 last sync ' + new Date(s.lastSyncTimestamp).toLocaleTimeString() : ''}
            </div>
          </div>
        </div>`;

      // Bind events

      // Help icon toggles
      card.querySelectorAll('.ssm-help-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
          const panelCls = btn.getAttribute('data-panel');
          const panel = card.querySelector('.' + panelCls);
          if (!panel) return;
          const isOpen = !panel.classList.contains('hidden');
          // Close all help panels in this card first
          card.querySelectorAll('.oc-help-panel').forEach(p => p.classList.add('hidden'));
          card.querySelectorAll('.ssm-help-toggle').forEach(b => b.classList.remove('active'));
          if (!isOpen) {
            panel.classList.remove('hidden');
            btn.classList.add('active');
          }
        });
      });

      const enableCb = card.querySelector('.ssm-enable');
      const fieldsEl = card.querySelector('.ssm-fields');
      enableCb.addEventListener('change', () => fieldsEl.classList.toggle('hidden', !enableCb.checked));

      const authSelect = card.querySelector('.ssm-auth-method');
      const keyLabel = card.querySelector('.ssm-key-label');
      const pwLabel = card.querySelector('.ssm-password-label');
      authSelect.addEventListener('change', () => {
        keyLabel.classList.toggle('hidden', authSelect.value !== 'key');
        pwLabel.classList.toggle('hidden', authSelect.value !== 'password');
      });

      card.querySelector('.ssm-test-btn').addEventListener('click', async (e) => {
        const btn = e.target;
        const resultEl = card.querySelector('.ssm-test-result');
        const config = _collectConfig(card);
        if (!config.host || !config.username || !config.remotePath) {
          resultEl.textContent = 'Host, username, and remote path required.';
          resultEl.className = 'ssm-test-result ssm-test-error';
          return;
        }
        btn.disabled = true;
        btn.textContent = '\u2026';
        resultEl.textContent = '';
        try {
          const r = await window.api.serverSyncTestSsh(config);
          if (r.ok) {
            resultEl.textContent = `\u2713 ${r.fileCount} file${r.fileCount !== 1 ? 's' : ''} (${r.latencyMs}ms)`;
            resultEl.className = 'ssm-test-result ssm-test-ok';
          } else {
            resultEl.textContent = r.error || 'Failed';
            resultEl.className = 'ssm-test-result ssm-test-error';
          }
        } catch (err) {
          resultEl.textContent = err.message;
          resultEl.className = 'ssm-test-result ssm-test-error';
        }
        btn.disabled = false;
        btn.textContent = 'Test SSH';
      });

      card.querySelector('.ssm-save-btn').addEventListener('click', async (e) => {
        const btn = e.target;
        const config = _collectConfig(card);
        const enabled = enableCb.checked;

        if (enabled && (!config.host || !config.username || !config.remotePath)) {
          const resultEl = card.querySelector('.ssm-test-result');
          resultEl.textContent = 'Host, username, and remote path required.';
          resultEl.className = 'ssm-test-result ssm-test-error';
          return;
        }

        btn.disabled = true;
        btn.textContent = 'Saving\u2026';

        const all = await window.api.getOpenclawRemoteEndpoints();
        const updated = all.map(e2 => {
          if (e2.id !== ep.id) return e2;
          const u = { ...e2,
            syncEnabled: enabled,
            sshHost: config.host || undefined,
            sshPort: config.port,
            sshUsername: config.username || undefined,
            sshAuthMethod: config.authMethod,
            sshKeyPath: config.authMethod === 'key' ? config.privateKeyPath : undefined,
            sshRemotePath: config.remotePath || undefined,
          };
          if (config.authMethod === 'password' && config.password) {
            u.sshPassword = config.password;
          }
          return u;
        });
        await window.api.setOpenclawRemoteEndpoints(updated);

        // Enable/disable sync on the backend
        if (enabled) {
          await window.api.serverSyncEnable?.(ep.id);
        } else {
          await window.api.serverSyncDisable?.(ep.id);
        }

        btn.textContent = 'Saved!';
        setTimeout(() => { btn.textContent = 'Save'; btn.disabled = false; }, 1500);

        // Status refresh is handled by UnifiedSyncIndicator via onServerSyncStatusChanged
      });

      card.querySelector('.ssm-sync-btn').addEventListener('click', async (e) => {
        const btn = e.target;
        btn.disabled = true;
        btn.textContent = '\u2026';
        await window.api.serverSyncNow?.(ep.id);
        btn.textContent = 'Sync Now';
        btn.disabled = false;
        await _render(); // refresh state
      });

      _listEl.appendChild(card);
    }

    // Sync Rules (.syncignore) editor
    const ignoreSection = document.createElement('div');
    ignoreSection.className = 'ssm-syncignore-section';
    ignoreSection.innerHTML = `
      <button type="button" class="ssm-syncignore-toggle">Sync Rules (.syncignore) <span class="ssm-syncignore-arrow">\u25B6</span></button>
      <div class="ssm-syncignore-body hidden">
        <textarea class="ssm-syncignore-textarea" rows="8" spellcheck="false" placeholder="Loading..."></textarea>
        <button type="button" class="ssm-syncignore-save">Save</button>
      </div>
    `;
    const toggleBtn = ignoreSection.querySelector('.ssm-syncignore-toggle');
    const body = ignoreSection.querySelector('.ssm-syncignore-body');
    const arrow = ignoreSection.querySelector('.ssm-syncignore-arrow');
    const textarea = ignoreSection.querySelector('.ssm-syncignore-textarea');
    const saveBtn = ignoreSection.querySelector('.ssm-syncignore-save');
    toggleBtn.addEventListener('click', async () => {
      const opening = body.classList.contains('hidden');
      body.classList.toggle('hidden');
      arrow.textContent = opening ? '\u25BC' : '\u25B6';
      if (opening) {
        textarea.value = await window.api.syncIgnoreRead('sync') || '';
      }
    });
    saveBtn.addEventListener('click', async () => {
      await window.api.syncIgnoreWrite('sync', textarea.value);
      saveBtn.textContent = 'Saved';
      setTimeout(() => { saveBtn.textContent = 'Save'; }, 1500);
    });
    _listEl.appendChild(ignoreSection);
  }

  function _collectConfig(card) {
    const host = card.querySelector('.ssm-host').value.trim();
    const port = parseInt(card.querySelector('.ssm-port').value, 10) || 22;
    const username = card.querySelector('.ssm-username').value.trim();
    const authMethod = card.querySelector('.ssm-auth-method').value;
    const remotePath = card.querySelector('.ssm-remote-path').value.trim();
    const config = { host, port, username, remotePath };
    if (authMethod === 'agent') {
      config.agent = true;
    } else if (authMethod === 'key') {
      config.privateKeyPath = card.querySelector('.ssm-key-path').value.trim();
    } else if (authMethod === 'password') {
      config.password = card.querySelector('.ssm-password').value;
    }
    config.authMethod = authMethod;
    return config;
  }

  function show() {
    if (!_modal) return;
    _render();
    _modal.classList.remove('hidden');
  }

  function hide() {
    if (!_modal) return;
    _modal.classList.add('hidden');
  }

  function toggle() {
    if (!_modal) return;
    _modal.classList.contains('hidden') ? show() : hide();
  }

  return {
    init() {
      _modal = document.getElementById('server-sync-modal');
      if (!_modal) return;
      _listEl = document.getElementById('server-sync-modal-list');
      document.getElementById('server-sync-modal-close').addEventListener('click', hide);
      _modal.querySelector('.modal-backdrop').addEventListener('click', hide);

      // Overview help toggle
      const overviewBtn = document.getElementById('ssm-overview-toggle');
      const overviewPanel = document.getElementById('ssm-overview-panel');
      if (overviewBtn && overviewPanel) {
        overviewBtn.addEventListener('click', () => {
          const isOpen = !overviewPanel.classList.contains('hidden');
          overviewPanel.classList.toggle('hidden');
          overviewBtn.classList.toggle('active', !isOpen);
        });
      }

      // Status refresh is handled by UnifiedSyncIndicator via onServerSyncStatusChanged
    },
    toggle,
    show,
    hide,
  };
})();

// AWS Sync unlink confirmation modal
const AwsSyncUnlinkModal = (() => {
  let _modal = null;
  let _localCb = null;
  let _cloudCb = null;
  let _confirmBtn = null;
  let _cancelBtn = null;
  let _onConfirm = null;

  function _updateConfirmBtn() {
    if (_confirmBtn) {
      _confirmBtn.disabled = !_localCb?.checked && !_cloudCb?.checked;
    }
  }

  function hide() {
    if (_modal) _modal.classList.add('hidden');
    _onConfirm = null;
  }

  function show(onConfirm) {
    if (!_modal) return;
    _onConfirm = onConfirm;
    if (_localCb) _localCb.checked = true;
    if (_cloudCb) _cloudCb.checked = false;
    _updateConfirmBtn();
    _modal.classList.remove('hidden');
  }

  return {
    init() {
      _modal = document.getElementById('aws-sync-unlink-modal');
      if (!_modal) return;
      _localCb = document.getElementById('aws-sync-unlink-local');
      _cloudCb = document.getElementById('aws-sync-unlink-cloud');
      _confirmBtn = document.getElementById('aws-sync-unlink-confirm');
      _cancelBtn = document.getElementById('aws-sync-unlink-cancel');

      _localCb?.addEventListener('change', _updateConfirmBtn);
      _cloudCb?.addEventListener('change', _updateConfirmBtn);

      _cancelBtn?.addEventListener('click', hide);

      _confirmBtn?.addEventListener('click', async () => {
        const opts = {
          clearLocal: !!_localCb?.checked,
          purgeCloud: !!_cloudCb?.checked,
        };
        const cb = _onConfirm;
        hide();
        if (cb) await cb(opts);
      });
    },
    show,
    hide,
  };
})();

// AWS Sync first-run consent modal (feature 149)
const AwsSyncConsentModal = (() => {
  let _modal = null;
  let _enableBtn = null;
  let _skipBtn = null;

  function hide() {
    if (_modal) _modal.classList.add('hidden');
  }

  function show() {
    if (!_modal) return;
    _modal.classList.remove('hidden');
  }

  async function checkAndShow() {
    const shown = await window.api.getAwsSyncPromptShown?.();
    if (shown) return;
    const isLoggedIn = await window.api.authIsLoggedIn?.();
    if (!isLoggedIn) return;
    show();
  }

  return {
    init() {
      _modal = document.getElementById('aws-sync-consent-modal');
      if (!_modal) return;
      _enableBtn = document.getElementById('aws-sync-consent-enable');
      _skipBtn = document.getElementById('aws-sync-consent-skip');

      _enableBtn?.addEventListener('click', async () => {
        await window.api.awsSyncEnable?.();
        await window.api.setAwsSyncPromptShown?.(true);
        hide();
      });

      _skipBtn?.addEventListener('click', async () => {
        await window.api.awsSyncDisable?.();
        await window.api.setAwsSyncPromptShown?.(true);
        hide();
      });
    },
    checkAndShow,
  };
})();
window.AwsSyncConsentModal = AwsSyncConsentModal;

// ─── Conflict Banner (feature 73) ────────────────────────────────────────────

const ConflictBanner = {
  _el: null,

  _countText(n) {
    return `Sync conflict \u2014 ${n} file${n !== 1 ? 's' : ''} need${n !== 1 ? '' : 's'} resolution`;
  },

  show(count) {
    const viewer = document.getElementById('viewer');
    if (!viewer) return;
    if (!this._el) {
      const el = document.createElement('div');
      el.id = 'conflict-banner';
      el.innerHTML =
        '<span class="conflict-banner-text"></span>' +
        '<div class="conflict-banner-actions">' +
        '<button class="conflict-banner-review">Review Conflicts</button>' +
        '<button class="conflict-banner-abort">Abort Merge</button>' +
        '</div>';
      el.querySelector('.conflict-banner-review').addEventListener('click', () => {
        if (_conflictData.length > 0) _selectConflictFile(_conflictData[0].filePath);
      });
      el.querySelector('.conflict-banner-abort').addEventListener('click', async () => {
        if (!confirm('Abort the merge? All unresolved conflicts will be discarded.')) return;
        await window.api.abortMerge();
      });
      this._el = el;
      viewer.insertBefore(el, viewer.firstChild);
    }
    this._el.querySelector('.conflict-banner-text').textContent = this._countText(count);
    this._el.classList.remove('hidden');
  },

  hide() {
    if (this._el) this._el.classList.add('hidden');
  },

  updateCount(count) {
    if (!this._el || this._el.classList.contains('hidden')) return;
    this._el.querySelector('.conflict-banner-text').textContent = this._countText(count);
  },
};

// ─── Sync Setup Wizard (feature 68) ──────────────────────────────────────────

const SyncSetupWizard = {
  _currentStep: 1,
  _startStep: 1,
  _completedSteps: new Set(),
  _remoteUrl: '',
  _gitStatus: null,
  _busy: false,

  async open() {
    const modal = document.getElementById('sync-setup-modal');
    if (!modal || this._busy) return;

    // Fetch current git status to determine starting step
    this._gitStatus = await window.api.getSyncStatus();
    this._completedSteps = new Set();
    this._remoteUrl = (this._gitStatus && this._gitStatus.remoteUrl) || '';
    this._busy = false;

    // Determine starting step based on what's already set up
    if (this._gitStatus && !this._gitStatus.gitInstalled) {
      this._showNoGit(modal);
      return;
    }

    let startStep = 1;
    if (this._gitStatus && this._gitStatus.isRepo) {
      this._completedSteps.add(1);
      startStep = 2;
    }
    if (this._gitStatus && this._gitStatus.isRepo && this._gitStatus.hasRemote) {
      this._completedSteps.add(2);
      startStep = 3;
    }

    this._startStep = startStep;
    this._currentStep = startStep;
    modal.classList.remove('hidden');
    this._render();
  },

  close() {
    const modal = document.getElementById('sync-setup-modal');
    if (modal) modal.classList.add('hidden');
    this._busy = false;
  },

  _showNoGit(modal) {
    const content = document.getElementById('sync-step-content');
    content.innerHTML = `
      <p class="sync-step-desc">Git is not installed on this system.</p>
      <p class="sync-step-desc">Please install Git and restart the app to use sync.</p>
    `;
    document.getElementById('sync-back').classList.add('hidden');
    document.getElementById('sync-next').disabled = true;
    const cancelBtn = document.getElementById('sync-cancel');
    cancelBtn.onclick = () => this.close();
    modal.classList.remove('hidden');
  },

  _render() {
    this._updateProgress();
    this._renderStepContent(this._currentStep);
    this._updateNavButtons();
  },

  _updateProgress() {
    const steps = document.querySelectorAll('.sync-step');
    const lines = document.querySelectorAll('.sync-step-line');
    steps.forEach(el => {
      const n = parseInt(el.dataset.step, 10);
      el.classList.remove('sync-step--active', 'sync-step--done', 'sync-step--error');
      if (n === this._currentStep) {
        el.classList.add('sync-step--active');
        el.textContent = String(n);
      } else if (this._completedSteps.has(n)) {
        el.classList.add('sync-step--done');
        el.textContent = '✓';
      } else {
        el.textContent = String(n);
      }
    });
    lines.forEach((line, i) => {
      // Line i connects step i+1 to step i+2 (0-indexed)
      line.classList.toggle('sync-step-line--done', this._completedSteps.has(i + 1));
    });
  },

  _updateNavButtons() {
    const backBtn = document.getElementById('sync-back');
    const cancelBtn = document.getElementById('sync-cancel');
    const nextBtn = document.getElementById('sync-next');
    // Back: hidden on the starting step (no earlier step to return to)
    backBtn.classList.toggle('hidden', this._currentStep <= this._startStep);
    backBtn.onclick = () => this._goBack();
    cancelBtn.onclick = () => this.close();
    // Next label and state are set per step in _renderStepContent
  },

  _goBack() {
    if (this._currentStep <= this._startStep) return;
    // Step back to previous non-completed step
    let prev = this._currentStep - 1;
    while (prev > this._startStep && this._completedSteps.has(prev)) prev--;
    this._currentStep = prev;
    this._render();
  },

  _renderStepContent(step) {
    const content = document.getElementById('sync-step-content');
    const nextBtn = document.getElementById('sync-next');
    nextBtn.textContent = 'Continue';
    nextBtn.disabled = false;
    nextBtn.onclick = null;

    switch (step) {
      case 1: this._renderStep1(content, nextBtn); break;
      case 2: this._renderStep2(content, nextBtn); break;
      case 3: this._renderStep3(content, nextBtn); break;
      case 4: this._renderStep4(content, nextBtn); break;
    }
  },

  _renderStep1(content, nextBtn) {
    const wsPath = (this._gitStatus && this._gitStatus.isRepo !== undefined)
      ? (currentWorkspacePath || '')
      : '';
    content.innerHTML = `
      <p class="sync-step-desc">Your workspace needs a Git repository to enable sync.</p>
      <label class="field-label">Workspace</label>
      <input type="text" value="${wsPath.replace(/"/g, '&quot;')}" readonly
        style="width:100%;background:var(--bg-input);border:1px solid var(--ghost-border);
               color:var(--text-dim);padding:var(--spacing-1-5) var(--spacing-3);border-radius:6px;
               font-size:var(--typescale-label-md-size);outline:none;box-sizing:border-box;" />
      <div id="step1-status" class="sync-status-line" style="visibility:hidden">
        <span id="step1-msg"></span>
      </div>
    `;
    if (this._completedSteps.has(1)) {
      document.getElementById('step1-status').style.visibility = 'visible';
      document.getElementById('step1-msg').textContent = 'Git repository already initialized.';
      nextBtn.textContent = 'Continue';
      nextBtn.onclick = () => this._advanceTo(2);
      return;
    }
    nextBtn.textContent = 'Initialize';
    nextBtn.onclick = async () => {
      nextBtn.disabled = true;
      const statusLine = document.getElementById('step1-status');
      const msgEl = document.getElementById('step1-msg');
      statusLine.style.visibility = 'visible';
      msgEl.textContent = 'Initializing git repository…';

      const result = await window.api.initRepo();
      if (result.ok) {
        this._completedSteps.add(1);
        this._advanceTo(2);
      } else {
        msgEl.textContent = `Error: ${result.error}`;
        nextBtn.disabled = false;
      }
    };
  },

  _renderStep2(content, nextBtn) {
    content.innerHTML = `
      <p class="sync-step-desc">Enter the URL of your GitHub repository.</p>
      <label class="field-label" for="sync-remote-url">Repository URL</label>
      <input type="text" id="sync-remote-url"
        placeholder="https://github.com/user/repo.git"
        value="${this._remoteUrl.replace(/"/g, '&quot;')}" autocomplete="off" />
      <p class="sync-step-error hidden" id="step2-error"></p>
    `;
    document.getElementById('sync-remote-url').focus();
    nextBtn.onclick = async () => {
      const input = document.getElementById('sync-remote-url');
      const url = input.value.trim();
      const errorEl = document.getElementById('step2-error');

      // Client-side validation
      if (!url) {
        input.classList.add('invalid');
        errorEl.textContent = 'Please enter a repository URL.';
        errorEl.classList.remove('hidden');
        return;
      }
      if (!/^(https?:\/\/|git@|ssh:\/\/)/.test(url)) {
        input.classList.add('invalid');
        errorEl.textContent = 'URL must start with https://, http://, git@, or ssh://';
        errorEl.classList.remove('hidden');
        return;
      }
      input.classList.remove('invalid');
      errorEl.classList.add('hidden');

      nextBtn.disabled = true;
      const result = await window.api.addRemote(url);
      if (result.ok) {
        this._remoteUrl = url;
        this._completedSteps.add(2);
        this._advanceTo(3);
      } else {
        errorEl.textContent = result.error || 'Failed to add remote.';
        errorEl.classList.remove('hidden');
        nextBtn.disabled = false;
      }
    };
  },

  _renderStep3(content, nextBtn) {
    content.innerHTML = `
      <p class="sync-step-desc">Checking authentication with your repository…</p>
      <div id="step3-guidance"></div>
    `;
    nextBtn.disabled = true;

    const runCheck = async () => {
      const guidanceEl = document.getElementById('step3-guidance');
      if (!guidanceEl) return;
      guidanceEl.innerHTML = '<div class="sync-status-line"><span>Checking connection…</span></div>';

      const result = await window.api.checkAuth(this._remoteUrl);
      if (!document.getElementById('step3-guidance')) return; // navigated away

      if (result.ok) {
        guidanceEl.innerHTML = `
          <div class="sync-guidance sync-guidance--success">
            <div class="sync-guidance-title">Connection successful</div>
            <div class="sync-guidance-message">Authentication is working correctly.</div>
          </div>
        `;
        this._completedSteps.add(3);
        nextBtn.disabled = false;
        nextBtn.onclick = () => this._advanceTo(4);
      } else {
        const g = result.guidance || {};
        const stepsHtml = (g.steps || []).map(s => `<li>${s}</li>`).join('');
        guidanceEl.innerHTML = `
          <div class="sync-guidance sync-guidance--error">
            <div class="sync-guidance-title">${g.title || 'Connection failed'}</div>
            <div class="sync-guidance-message">${g.message || ''}</div>
            ${stepsHtml ? `<ol class="sync-guidance-steps">${stepsHtml}</ol>` : ''}
          </div>
          <div class="modal-actions sync-wizard-actions" style="margin-top:var(--spacing-3);padding:0">
            <button id="step3-retry" class="btn-secondary" style="padding:var(--spacing-1-5) var(--spacing-4);border-radius:6px;font-size:var(--typescale-label-md-size);cursor:pointer">Retry</button>
          </div>
        `;
        const retryBtn = document.getElementById('step3-retry');
        if (retryBtn) retryBtn.onclick = runCheck;
        nextBtn.disabled = true;
      }
    };

    nextBtn.onclick = () => this._advanceTo(4); // will be overridden by runCheck on success
    runCheck();
  },

  _renderStep4(content, nextBtn) {
    content.innerHTML = `
      <p class="sync-step-desc">We'll create an initial commit with your notes and push them to the repository.</p>
      <div id="step4-status"></div>
    `;
    nextBtn.textContent = 'Sync Now';
    nextBtn.onclick = async () => {
      const statusEl = document.getElementById('step4-status');
      nextBtn.disabled = true;
      document.getElementById('sync-back').classList.add('hidden');

      const steps = [
        { step: 'gitignore', label: 'Creating .gitignore…' },
        { step: 'add',       label: 'Staging files…' },
        { step: 'commit',    label: 'Committing files…' },
        { step: 'push',      label: 'Pushing to remote…' },
      ];

      // Show "running" state
      statusEl.innerHTML = steps.map(s =>
        `<div class="sync-status-line" id="step4-op-${s.step}"><span>${s.label}</span></div>`
      ).join('');

      const result = await window.api.initialCommitAndPush();

      if (result.ok) {
        statusEl.innerHTML = `
          <div class="sync-guidance sync-guidance--success">
            <div class="sync-guidance-title">Sync complete!</div>
            <div class="sync-guidance-message">Your notes have been pushed to the repository.</div>
          </div>
        `;
        nextBtn.textContent = 'Done';
        nextBtn.disabled = false;
        nextBtn.onclick = async () => {
          this.close();
          await window.api.reinitializeSync();
        };
      } else {
        const stepLabel = steps.find(s => s.step === result.step)?.label || 'Operation';
        statusEl.innerHTML = `
          <div class="sync-guidance sync-guidance--error">
            <div class="sync-guidance-title">${stepLabel.replace('…', '')} failed</div>
            <div class="sync-guidance-message">${result.error || 'An error occurred.'}</div>
          </div>
        `;
        nextBtn.textContent = 'Retry';
        nextBtn.disabled = false;
        document.getElementById('sync-back').classList.remove('hidden');
      }
    };
  },

  _advanceTo(step) {
    this._currentStep = step;
    this._render();
  },
};

// ─── Clone Modal (feature 76) ─────────────────────────────────────────────────

const CloneModal = {
  _busy: false,
  _parentDir: null,      // selected parent directory (from browseDirectory)
  _derivedTarget: null,  // full clone target path (<parentDir>/<repoName>)

  open() {
    document.getElementById('clone-remote-url').value = '';
    document.getElementById('clone-target-dir').value = '';
    document.getElementById('clone-path-preview').textContent = '';
    document.getElementById('clone-path-preview').classList.add('hidden');
    document.getElementById('clone-dir-warning').classList.add('hidden');
    document.getElementById('clone-auth-guidance').classList.add('hidden');
    document.getElementById('clone-auth-guidance').innerHTML = '';
    document.getElementById('clone-progress').classList.add('hidden');
    document.getElementById('clone-error').classList.add('hidden');
    document.getElementById('clone-confirm').disabled = true;
    this._busy = false;
    this._parentDir = null;
    this._derivedTarget = null;
    document.getElementById('clone-modal').classList.remove('hidden');
    document.getElementById('clone-remote-url').focus();
    this._prefillFromClipboard();
  },

  close() {
    document.getElementById('clone-modal').classList.add('hidden');
  },

  async _prefillFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (text && /^(https:\/\/github\.com\/|git@github\.com:)/.test(text.trim())) {
        document.getElementById('clone-remote-url').value = text.trim();
        this._onUrlChange();
      }
    } catch {
      // Clipboard access denied or unavailable — silently ignore
    }
  },

  _repoNameFromUrl(url) {
    // Extract repo name: last path segment, strip .git suffix
    const segment = url.replace(/\.git$/, '').split('/').pop().split(':').pop();
    return segment || 'repo';
  },

  _validateUrl(url) {
    return /^(https?:\/\/|git@|ssh:\/\/)/.test(url.trim());
  },

  _onUrlChange() {
    const url = document.getElementById('clone-remote-url').value.trim();
    const valid = this._validateUrl(url);
    // Update derived target if parent dir is already chosen
    if (this._parentDir && valid) {
      this._derivedTarget = this._parentDir + '/' + this._repoNameFromUrl(url);
      document.getElementById('clone-path-preview').textContent = 'Will clone to: ' + this._derivedTarget;
      document.getElementById('clone-path-preview').classList.remove('hidden');
    } else {
      document.getElementById('clone-path-preview').classList.add('hidden');
      this._derivedTarget = null;
    }
    this._updateConfirmButton();
  },

  async _onBrowse() {
    if (this._busy) return;
    const dir = await window.api.browseDirectory();
    if (!dir) return;
    this._parentDir = dir;
    document.getElementById('clone-target-dir').value = dir;

    const url = document.getElementById('clone-remote-url').value.trim();
    if (this._validateUrl(url)) {
      this._derivedTarget = dir + '/' + this._repoNameFromUrl(url);
      document.getElementById('clone-path-preview').textContent = 'Will clone to: ' + this._derivedTarget;
      document.getElementById('clone-path-preview').classList.remove('hidden');
      await this._checkTarget(this._derivedTarget);
    } else {
      this._derivedTarget = null;
      document.getElementById('clone-path-preview').classList.add('hidden');
    }
    this._updateConfirmButton();
  },

  async _checkTarget(targetPath) {
    document.getElementById('clone-dir-warning').classList.add('hidden');
    const info = await window.api.checkTargetDir(targetPath);
    if (!info.exists || info.isEmpty) {
      // Fine — directory doesn't exist yet or is empty
      return;
    }
    const warn = document.getElementById('clone-dir-warning');
    if (info.hasGit) {
      warn.textContent = 'This folder is already a git repository. Choose a different parent folder.';
    } else {
      warn.textContent = `This folder already exists and contains ${info.entries} item(s). Choose a different parent folder or ensure the folder name from the URL is not taken.`;
    }
    warn.classList.remove('hidden');
  },

  _updateConfirmButton() {
    const url = document.getElementById('clone-remote-url').value.trim();
    const hasUrl = this._validateUrl(url);
    const hasDir = !!this._parentDir;
    document.getElementById('clone-confirm').disabled = !(hasUrl && hasDir) || this._busy;
  },

  _showProgress(text) {
    document.getElementById('clone-progress-text').textContent = text;
    document.getElementById('clone-progress').classList.remove('hidden');
    document.getElementById('clone-error').classList.add('hidden');
    document.getElementById('clone-auth-guidance').classList.add('hidden');
  },

  _hideProgress() {
    document.getElementById('clone-progress').classList.add('hidden');
  },

  _showError(text) {
    document.getElementById('clone-error').textContent = text;
    document.getElementById('clone-error').classList.remove('hidden');
  },

  _showAuthGuidance(guidance) {
    const el = document.getElementById('clone-auth-guidance');
    let html = `<div class="sync-guidance-title">${guidance.title}</div>`;
    html += `<div class="sync-guidance-message">${guidance.message}</div>`;
    if (guidance.steps && guidance.steps.length > 0) {
      html += '<ol class="sync-guidance-steps">';
      for (const step of guidance.steps) {
        html += `<li>${step}</li>`;
      }
      html += '</ol>';
    }
    el.innerHTML = html;
    el.classList.remove('hidden');
  },

  async _onConfirm() {
    if (this._busy) return;
    const url = document.getElementById('clone-remote-url').value.trim();
    if (!this._validateUrl(url) || !this._parentDir || !this._derivedTarget) return;

    this._busy = true;
    document.getElementById('clone-confirm').disabled = true;

    // Step 1: Auth check
    this._showProgress('Checking authentication…');
    const authResult = await window.api.checkAuth(url);
    if (!authResult.ok) {
      this._hideProgress();
      if (authResult.guidance) {
        this._showAuthGuidance(authResult.guidance);
      } else {
        this._showError('Authentication failed: ' + (authResult.error || authResult.errorType));
      }
      this._busy = false;
      document.getElementById('clone-confirm').disabled = false;
      return;
    }

    // Step 2: Clone
    this._showProgress('Cloning repository…');
    const cloneResult = await window.api.cloneProject({ remoteUrl: url, targetPath: this._derivedTarget });
    if (!cloneResult.ok) {
      this._hideProgress();
      this._showError('Clone failed: ' + (cloneResult.error || 'Unknown error'));
      this._busy = false;
      document.getElementById('clone-confirm').disabled = false;
      return;
    }

    // On success: openWorkspace() was called in main.js, which sends workspace:loaded.
    // The workspace:loaded handler in app.js will hide the welcome screen and show the app.
    // The modal can close itself — the workspace:loaded event will take over.
    this.close();
  },
};

// Clone modal event wiring
document.getElementById('clone-remote-url').addEventListener('input', () => CloneModal._onUrlChange());
document.getElementById('clone-browse').addEventListener('click', () => CloneModal._onBrowse());
document.getElementById('clone-confirm').addEventListener('click', () => CloneModal._onConfirm());
document.getElementById('clone-cancel').addEventListener('click', () => CloneModal.close());
document.querySelector('#clone-modal .modal-backdrop').addEventListener('click', () => {
  if (!CloneModal._busy) CloneModal.close();
});

// ─── Sync Log Panel (feature 74) ─────────────────────────────────────────────

const SyncLogPanel = {
  _el: null,
  _visible: false,
  _settingsVisible: false,

  _ensureEl() {
    if (this._el) return;
    this._el = document.createElement('div');
    this._el.id = 'sync-log-panel';
    this._el.className = 'sync-log-panel';
    this._el.innerHTML = `
      <div class="sync-log-header">
        <span class="sync-log-title">Sync Activity</span>
        <div class="sync-log-actions">
          <button class="sync-log-copy" title="Copy log to clipboard">Copy</button>
          <button class="sync-log-close" title="Close">&#x2715;</button>
        </div>
      </div>
      <div class="sync-log-toolbar">
        <button class="sync-log-syncnow" title="Sync now">Sync Now</button>
        <button class="sync-log-pauseresume" title="Pause or resume sync">Pause</button>
        <button class="sync-log-settings" title="Sync settings">&#x2699;</button>
        <button class="sync-log-disconnect" title="Remove remote and stop sync">Disconnect</button>
      </div>
      <div class="sync-log-entries"></div>
      <div class="sync-settings-panel" style="display:none">
        <div class="sync-settings-row">
          <label class="sync-settings-label">Commit debounce</label>
          <input type="range" class="sync-setting-input sync-setting-commitDebounce" min="10" max="300" step="5" value="30">
          <span class="sync-settings-value">30s</span>
        </div>
        <div class="sync-settings-row">
          <label class="sync-settings-label">Push interval</label>
          <input type="range" class="sync-setting-input sync-setting-pushInterval" min="60" max="1800" step="30" value="300">
          <span class="sync-settings-value">5m</span>
        </div>
        <div class="sync-settings-row">
          <label class="sync-settings-label">Sync on focus</label>
          <input type="checkbox" class="sync-setting-input sync-setting-syncOnFocus" checked>
        </div>
        <div class="sync-settings-row">
          <label class="sync-settings-label">Pause during AI activity</label>
          <input type="checkbox" class="sync-setting-input sync-setting-pauseDuringClaude" checked>
        </div>
        <div class="sync-settings-footer">
          <button class="sync-settings-reset">Reset to defaults</button>
        </div>
        <div class="ssm-syncignore-section" style="margin-top:var(--spacing-2)">
          <button type="button" class="ssm-syncignore-toggle">Sync Rules (.gitignore) <span class="ssm-syncignore-arrow">&#x25B6;</span></button>
          <div class="ssm-syncignore-body hidden">
            <textarea class="ssm-syncignore-textarea sync-gitignore-textarea" rows="8" spellcheck="false" placeholder="Loading..."></textarea>
            <button type="button" class="ssm-syncignore-save sync-gitignore-save">Save</button>
          </div>
        </div>
      </div>
    `;
    document.querySelector('.sidebar-footer').appendChild(this._el);

    this._el.querySelector('.sync-log-close').addEventListener('click', () => this.close());
    this._el.querySelector('.sync-log-copy').addEventListener('click', () => this._copyLog());
    this._el.querySelector('.sync-log-syncnow').addEventListener('click', () => this._onSyncNow());
    this._el.querySelector('.sync-log-pauseresume').addEventListener('click', () => this._onPauseResume());
    this._el.querySelector('.sync-log-disconnect').addEventListener('click', () => this._onDisconnect());
    this._el.querySelector('.sync-log-settings').addEventListener('click', () => this._toggleSettingsPanel());
    this._el.querySelector('.sync-settings-reset').addEventListener('click', () => this._onResetSettings());

    // Gitignore editor
    const giToggle = this._el.querySelector('.ssm-syncignore-toggle');
    const giBody = this._el.querySelector('.ssm-syncignore-body');
    const giArrow = this._el.querySelector('.ssm-syncignore-arrow');
    const giTextarea = this._el.querySelector('.sync-gitignore-textarea');
    const giSave = this._el.querySelector('.sync-gitignore-save');
    if (giToggle) {
      giToggle.addEventListener('click', async () => {
        const opening = giBody.classList.contains('hidden');
        giBody.classList.toggle('hidden');
        giArrow.textContent = opening ? '\u25BC' : '\u25B6';
        if (opening) {
          giTextarea.value = await window.api.syncIgnoreRead('git') || '';
        }
      });
      giSave.addEventListener('click', async () => {
        await window.api.syncIgnoreWrite('git', giTextarea.value);
        giSave.textContent = 'Saved';
        setTimeout(() => { giSave.textContent = 'Save'; }, 1500);
      });
    }

    // Live value display for range sliders
    this._el.querySelector('.sync-setting-commitDebounce').addEventListener('input', (e) => {
      e.target.closest('.sync-settings-row').querySelector('.sync-settings-value').textContent =
        this._formatSeconds(Number(e.target.value));
    });
    this._el.querySelector('.sync-setting-pushInterval').addEventListener('input', (e) => {
      e.target.closest('.sync-settings-row').querySelector('.sync-settings-value').textContent =
        this._formatSeconds(Number(e.target.value));
    });

    // Save on change (slider released or checkbox toggled)
    this._el.querySelectorAll('.sync-setting-input').forEach(input => {
      input.addEventListener('change', () => this._onSettingChanged());
    });

    document.addEventListener('click', this._onOutsideClick = (e) => {
      if (this._skipOutsideClick) return;
      if (this._visible && !this._el.contains(e.target) && !e.target.closest('#sync-status-badge')) {
        this.close();
      }
    });
    document.addEventListener('keydown', this._onKeyDown = (e) => {
      if (e.key === 'Escape' && this._visible) this.close();
    });
  },

  async open() {
    this._ensureEl();
    this._visible = true;
    this._skipOutsideClick = true;
    requestAnimationFrame(() => { this._skipOutsideClick = false; });
    this._el.classList.add('sync-log-panel--visible');
    await this._refresh();
    await this._updateToolbar();
  },

  close() {
    if (!this._el) return;
    this._visible = false;
    this._el.classList.remove('sync-log-panel--visible');
    // Reset settings panel state
    if (this._settingsVisible) {
      this._settingsVisible = false;
      this._el.querySelector('.sync-log-entries').style.display = '';
      this._el.querySelector('.sync-settings-panel').style.display = 'none';
      this._el.querySelector('.sync-log-settings').classList.remove('sync-log-settings--active');
    }
  },

  toggle() {
    if (this._visible) this.close();
    else this.open();
  },

  async _refresh() {
    const entries = await window.api.getActivityLog();
    this._render(entries);
  },

  _render(entries) {
    const container = this._el.querySelector('.sync-log-entries');
    if (entries.length === 0) {
      container.innerHTML = '<div class="sync-log-empty">No sync activity yet</div>';
      return;
    }
    const reversed = [...entries].reverse();
    container.innerHTML = reversed.map(e => `
      <div class="sync-log-entry sync-log-entry--${e.result}">
        <span class="sync-log-time" title="${new Date(e.timestamp).toISOString()}">${this._formatTimestamp(e.timestamp)}</span>
        <span class="sync-log-action sync-log-action--${e.action}">${this._actionLabel(e.action)}</span>
        <span class="sync-log-details">${escapeHtml(e.details)}</span>
      </div>
    `).join('');
  },

  _actionLabel(action) {
    const LABELS = {
      'commit':      '&#x2191; commit',
      'pull':        '&#x2193; pull',
      'push':        '&#x2191; push',
      'conflict':    '&#x26A0; conflict',
      'error':       '&#x2715; error',
      'auth-fail':   '&#x1F512; auth',
      'recovery':    '&#x2713; recovery',
      'pause':       '&#x23F8; pause',
      'resume':      '&#x25B6; resume',
      'disconnect':  '&#x2296; disconnect',
    };
    return LABELS[action] || action;
  },

  async _onSyncNow() {
    const btn = this._el.querySelector('.sync-log-syncnow');
    btn.disabled = true;
    btn.textContent = 'Syncing\u2026';
    try {
      await window.api.syncNow();
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sync Now';
      await this._refresh();
    }
  },

  async _onPauseResume() {
    const paused = await window.api.isSyncPaused();
    if (paused) {
      await window.api.resumeSync();
    } else {
      await window.api.pauseSync();
    }
    await this._refresh();
    await this._updateToolbar();
  },

  async _onDisconnect() {
    const confirmed = confirm(
      'Your notes will no longer sync. Local git history will be preserved.\n\nDisconnect sync?'
    );
    if (!confirmed) return;
    await window.api.disconnectSync();
    this.close();
  },

  async _updateToolbar() {
    if (!this._el) return;
    const state = await window.api.getSyncState();
    const paused = await window.api.isSyncPaused();
    const isConfigured = state && state !== 'not-configured';
    const syncNowBtn = this._el.querySelector('.sync-log-syncnow');
    const pauseResumeBtn = this._el.querySelector('.sync-log-pauseresume');
    const toolbar = this._el.querySelector('.sync-log-toolbar');
    if (!isConfigured) {
      toolbar.classList.add('sync-log-toolbar--hidden');
      // Also hide settings panel if open
      if (this._settingsVisible) {
        this._settingsVisible = false;
        this._el.querySelector('.sync-log-entries').style.display = '';
        this._el.querySelector('.sync-settings-panel').style.display = 'none';
        this._el.querySelector('.sync-log-settings').classList.remove('sync-log-settings--active');
      }
      return;
    }
    toolbar.classList.remove('sync-log-toolbar--hidden');
    syncNowBtn.disabled = (state === 'conflict' || state === 'error' || state === 'syncing');
    pauseResumeBtn.textContent = paused ? 'Resume' : 'Pause';
    pauseResumeBtn.disabled = (state === 'conflict' || state === 'syncing');
  },

  _formatTimestamp(ts) {
    const diff = Date.now() - ts;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    return new Date(ts).toLocaleDateString();
  },

  async _copyLog() {
    const entries = await window.api.getActivityLog();
    const text = entries.map(e =>
      `[${new Date(e.timestamp).toISOString()}] ${e.action.toUpperCase()} ${e.result.toUpperCase()} — ${e.details}`
    ).join('\n');
    await navigator.clipboard.writeText(text);
  },

  async _toggleSettingsPanel() {
    this._settingsVisible = !this._settingsVisible;
    const entriesEl = this._el.querySelector('.sync-log-entries');
    const settingsEl = this._el.querySelector('.sync-settings-panel');
    const settingsBtn = this._el.querySelector('.sync-log-settings');
    if (this._settingsVisible) {
      entriesEl.style.display = 'none';
      settingsEl.style.display = '';
      settingsBtn.title = 'Back to log';
      settingsBtn.classList.add('sync-log-settings--active');
      await this._loadSettingsIntoPanel();
    } else {
      entriesEl.style.display = '';
      settingsEl.style.display = 'none';
      settingsBtn.title = 'Sync settings';
      settingsBtn.classList.remove('sync-log-settings--active');
    }
  },

  async _loadSettingsIntoPanel() {
    const settings = await window.api.getSyncSettings();
    const panel = this._el.querySelector('.sync-settings-panel');
    const debounceInput = panel.querySelector('.sync-setting-commitDebounce');
    const pushInput = panel.querySelector('.sync-setting-pushInterval');
    debounceInput.value = settings.commitDebounceSeconds;
    debounceInput.closest('.sync-settings-row').querySelector('.sync-settings-value').textContent =
      this._formatSeconds(settings.commitDebounceSeconds);
    pushInput.value = settings.pushIntervalSeconds;
    pushInput.closest('.sync-settings-row').querySelector('.sync-settings-value').textContent =
      this._formatSeconds(settings.pushIntervalSeconds);
    panel.querySelector('.sync-setting-syncOnFocus').checked = settings.syncOnFocus;
    panel.querySelector('.sync-setting-pauseDuringClaude').checked = settings.pauseDuringClaude;
  },

  async _onSettingChanged() {
    const panel = this._el.querySelector('.sync-settings-panel');
    const settings = {
      commitDebounceSeconds: Number(panel.querySelector('.sync-setting-commitDebounce').value),
      pushIntervalSeconds:   Number(panel.querySelector('.sync-setting-pushInterval').value),
      syncOnFocus:           panel.querySelector('.sync-setting-syncOnFocus').checked,
      pauseDuringClaude:     panel.querySelector('.sync-setting-pauseDuringClaude').checked,
    };
    await window.api.setSyncSettings(settings);
  },

  async _onResetSettings() {
    const defaults = { commitDebounceSeconds: 30, pushIntervalSeconds: 300, syncOnFocus: true, pauseDuringClaude: true };
    await window.api.setSyncSettings(defaults);
    await this._loadSettingsIntoPanel();
  },

  _formatSeconds(s) {
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return rem === 0 ? `${m}m` : `${m}m ${rem}s`;
  },
};

// ─── Sync Recovery Modal (feature 75) ────────────────────────────────────────

const SyncRecoveryModal = {
  _el: null,
  _healthReport: null,
  _branches: [],
  _selectedBranch: null,
  _recloneConfirming: false,

  open(healthReport) {
    if (!this._el) {
      this._el = document.getElementById('sync-recovery-modal');
    }
    if (!this._el) return;
    this._healthReport = healthReport;
    this._recloneConfirming = false;
    this._el.classList.remove('hidden');
    this._render();
    // Load branches in background for detached HEAD issue
    if (healthReport.issues.some(i => i.type === 'detached-head')) {
      window.api.listBranches().then(branches => {
        this._branches = branches;
        this._selectedBranch = branches[0] || null;
        this._render();
      }).catch(() => {});
    }
  },

  close() {
    if (this._el) this._el.classList.add('hidden');
    this._healthReport = null;
    this._recloneConfirming = false;
  },

  _render() {
    const content = document.getElementById('sync-recovery-content');
    if (!content || !this._healthReport) return;

    const issueHtml = this._healthReport.issues.map(issue => this._renderIssue(issue)).join('');
    const recloneHtml = this._renderReclone();

    content.innerHTML = issueHtml + recloneHtml;
    this._bindActions();
  },

  _renderIssue(issue) {
    const titles = {
      'locked-index':       'Stale Lock File',
      'interrupted-rebase': 'Interrupted Rebase',
      'interrupted-merge':  'Interrupted Merge',
      'detached-head':      'Detached HEAD',
    };
    const buttonLabels = {
      'locked-index':       'Remove Lock File',
      'interrupted-rebase': 'Abort Rebase',
      'interrupted-merge':  'Abort Merge',
      'detached-head':      'Switch Branch',
    };

    let actionHtml;
    if (issue.type === 'detached-head') {
      const options = this._branches.map(b =>
        `<option value="${escapeHtml(b)}"${b === this._selectedBranch ? ' selected' : ''}>${escapeHtml(b)}</option>`
      ).join('');
      actionHtml = `
        <div class="sync-recovery-branch-row">
          <select class="sync-recovery-branch-select" id="sync-recovery-branch-select">
            ${options || '<option value="">Loading branches…</option>'}
          </select>
          <button class="sync-recovery-action" data-action="${issue.type}">Switch Branch</button>
        </div>`;
    } else {
      actionHtml = `<button class="sync-recovery-action" data-action="${issue.type}">${buttonLabels[issue.type] || 'Fix'}</button>`;
    }

    return `
      <div class="sync-recovery-issue" data-type="${issue.type}">
        <div class="sync-recovery-issue-header">
          <span class="sync-recovery-issue-title">${escapeHtml(titles[issue.type] || issue.type)}</span>
        </div>
        <p class="sync-recovery-issue-desc">${escapeHtml(issue.description)}</p>
        ${actionHtml}
        <div class="sync-recovery-inline-error hidden" id="sync-recovery-error-${issue.type}"></div>
      </div>`;
  },

  _renderReclone() {
    if (this._recloneConfirming) {
      return `
        <div class="sync-recovery-reclone">
          <p class="sync-recovery-issue-title">Confirm Re-clone</p>
          <p class="sync-recovery-issue-desc">Your local files will be backed up to a timestamped folder alongside your workspace before re-cloning. This cannot be undone.</p>
          <div class="sync-recovery-reclone-actions">
            <button class="btn-secondary" id="sync-recovery-reclone-cancel">Cancel</button>
            <button class="sync-recovery-action" id="sync-recovery-reclone-confirm">Confirm Re-clone</button>
          </div>
          <div class="sync-recovery-inline-error hidden" id="sync-recovery-error-reclone"></div>
        </div>`;
    }
    return `
      <div class="sync-recovery-reclone">
        <p class="sync-recovery-issue-title">Last Resort: Re-clone from Remote</p>
        <p class="sync-recovery-issue-desc">If the above options don't resolve the issue, you can re-clone the repository. Your local files will be backed up to a timestamped folder before re-cloning.</p>
        <button class="sync-recovery-action sync-recovery-action--danger" id="sync-recovery-reclone-btn">Re-clone from Remote</button>
      </div>`;
  },

  _bindActions() {
    const content = document.getElementById('sync-recovery-content');
    if (!content) return;

    // Branch select change
    const branchSelect = content.querySelector('#sync-recovery-branch-select');
    if (branchSelect) {
      branchSelect.addEventListener('change', (e) => {
        this._selectedBranch = e.target.value;
      });
    }

    // Issue recovery buttons
    content.querySelectorAll('.sync-recovery-action[data-action]').forEach(btn => {
      btn.addEventListener('click', () => this._executeRecovery(btn.dataset.action, btn));
    });

    // Re-clone button
    const recloneBtn = content.querySelector('#sync-recovery-reclone-btn');
    if (recloneBtn) {
      recloneBtn.addEventListener('click', () => {
        this._recloneConfirming = true;
        this._render();
      });
    }

    // Re-clone cancel
    const recloneCancel = content.querySelector('#sync-recovery-reclone-cancel');
    if (recloneCancel) {
      recloneCancel.addEventListener('click', () => {
        this._recloneConfirming = false;
        this._render();
      });
    }

    // Re-clone confirm
    const recloneConfirm = content.querySelector('#sync-recovery-reclone-confirm');
    if (recloneConfirm) {
      recloneConfirm.addEventListener('click', () => this._executeReclone(recloneConfirm));
    }

    // Dismiss button
    const dismissBtn = document.getElementById('sync-recovery-dismiss');
    if (dismissBtn) {
      dismissBtn.onclick = () => this.close();
    }
  },

  async _executeRecovery(issueType, btn) {
    btn.disabled = true;
    btn.textContent = 'Working…';
    const errorEl = document.getElementById(`sync-recovery-error-${issueType}`);

    let result;
    try {
      if (issueType === 'locked-index') {
        result = await window.api.recoverLockedIndex();
      } else if (issueType === 'interrupted-rebase') {
        result = await window.api.recoverInterruptedRebase();
      } else if (issueType === 'interrupted-merge') {
        result = await window.api.recoverInterruptedMerge();
      } else if (issueType === 'detached-head') {
        if (!this._selectedBranch) {
          if (errorEl) { errorEl.textContent = 'No branch selected.'; errorEl.classList.remove('hidden'); }
          btn.disabled = false;
          btn.textContent = 'Switch Branch';
          return;
        }
        result = await window.api.recoverDetachedHead(this._selectedBranch);
      }
    } catch (err) {
      if (errorEl) { errorEl.textContent = err.message || 'Unknown error'; errorEl.classList.remove('hidden'); }
      btn.disabled = false;
      btn.textContent = btn.dataset.originalLabel || 'Retry';
      return;
    }

    if (!result.ok) {
      if (errorEl) { errorEl.textContent = result.error || 'Recovery failed.'; errorEl.classList.remove('hidden'); }
      btn.disabled = false;
      btn.textContent = 'Retry';
      return;
    }

    if (result.healthReport && result.healthReport.healthy) {
      this.close();
      _showSyncToast('Sync recovered successfully.');
    } else {
      // Remaining issues
      this._healthReport = result.healthReport;
      this._render();
    }
  },

  async _executeReclone(btn) {
    btn.disabled = true;
    btn.textContent = 'Re-cloning…';
    const errorEl = document.getElementById('sync-recovery-error-reclone');

    let result;
    try {
      result = await window.api.recoverReclone();
    } catch (err) {
      if (errorEl) { errorEl.textContent = err.message || 'Unknown error'; errorEl.classList.remove('hidden'); }
      btn.disabled = false;
      btn.textContent = 'Confirm Re-clone';
      return;
    }

    if (!result.ok) {
      if (errorEl) { errorEl.textContent = result.error || 'Re-clone failed.'; errorEl.classList.remove('hidden'); }
      btn.disabled = false;
      btn.textContent = 'Confirm Re-clone';
      return;
    }

    if (result.healthReport && result.healthReport.healthy) {
      this.close();
      _showSyncToast('Re-clone complete. Backup saved to: ' + (result.backupPath || 'backup folder'));
    } else {
      this._healthReport = result.healthReport;
      this._recloneConfirming = false;
      this._render();
    }
  },
};

function showApp(wsPath, tree) {
  welcomeEl.classList.add("hidden");
  appEl.classList.remove("hidden");
  const wsName = wsPath.split("/").pop();
  workspaceNameEl.textContent = wsName;
  notesSectionTitleEl.textContent = wsName;
  currentWorkspacePath = wsPath;
  expandedPaths.clear();
  const restored = loadExpandedPaths(wsPath, tree);
  if (!restored) {
    expandAllFolders(tree);
  }
  if (searchInputEl) {
    searchInputEl.value = '';
    searchClearEl.classList.add('hidden');
  }
  isFiltering = false;
  savedExpandedPaths = null;
  currentTree = tree;
  refreshPublishedNotes().then(() => renderFilteredTree());
  renderFilteredTree();

  // Restore tab state for this workspace (or reset to a fresh default)
  if (!loadTabState(wsPath, tree)) {
    const freshId = crypto.randomUUID();
    TabState.restoreState({
      panels: [{ id: freshId, tabs: [], activeTabId: null, sizeRatio: 1 }],
      focusedPanelId: freshId,
      splitDirection: 'horizontal',
    });
  }

  // Restore active note toggle state for this workspace
  loadActiveNoteToggle(wsPath);
  _pushContextCurrentNote();

  // Restore or initialize conversation for this workspace
  initConversationForWorkspace(wsPath);

  // Refresh unified sync indicator for this workspace
  UnifiedSyncIndicator.refresh();
}

async function initConversationForWorkspace(wsPath) {
  // Reset in-memory state
  currentConversation = null;
  resetLastSentContext();
  aiMessages.querySelectorAll(".msg, .msg-footer").forEach(el => el.remove());
  aiEmptyState.classList.remove("hidden");
  setExpanded(false);

  window.api.newConversation();
  currentConversation = newConversationObj();
  updateChatTitle(null);
}

function renderTree(tree) {
  noteListEl.innerHTML = "";
  if (!tree || !tree.children) return;

  sortTree(tree.children, getSortMode());
  renderChildren(tree.children, noteListEl, 0);
  _updateNotesCount();
}

function _restoreNoteList() {
  const body = document.getElementById('notes-section-body');
  if (body && !body.contains(noteListEl)) {
    body.innerHTML = '';
    body.appendChild(noteListEl);
  }
}

function _renderSearchResultsInto(targetEl, results, query) {
  targetEl.innerHTML = '';
  const panel = TabState.getFocusedPanel();
  const activeTabId = panel?.activeTabId;
  const activeTab = panel?.tabs?.find(t => t.id === activeTabId);
  const activePath = activeTab?.filePath;

  for (const result of results) {
    const li = document.createElement('li');
    li.className = 'search-result-item';
    if (result.path === activePath) li.classList.add('active');

    const titleRow = document.createElement('div');
    titleRow.className = 'search-result-title-row';

    const iconSpan = document.createElement('span');
    iconSpan.className = 'tree-icon';
    const fileName = result.path.split('/').pop();
    iconSpan.innerHTML = getFileIcon({ name: fileName, type: 'file' }, false);
    titleRow.appendChild(iconSpan);

    const titleEl = document.createElement('span');
    titleEl.className = 'search-result-title';
    titleEl.textContent = result.title || fileName;
    titleRow.appendChild(titleEl);

    const snippetEl = document.createElement('div');
    snippetEl.className = 'search-result-snippet';
    const decoded = (result.snippet || '').replace(/<\/?mark>/gi, '');
    const escaped = decoded
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    let terms;
    if (lastContentParsed) {
      terms = [
        ...lastContentParsed.terms,
        ...lastContentParsed.phrases.flatMap(p => p.split(/\s+/).filter(Boolean)),
      ];
    } else {
      terms = (query || '').trim().split(/\s+/).filter(Boolean);
    }
    let highlighted = escaped;
    for (const term of terms) {
      const safeTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      highlighted = highlighted.replace(new RegExp(safeTerm, 'gi'), m => `<mark>${m}</mark>`);
    }
    snippetEl.innerHTML = highlighted;

    li.appendChild(titleRow);
    li.appendChild(snippetEl);
    li.addEventListener('click', () => selectNote(result.path, result.title, { searchQuery: query }));
    targetEl.appendChild(li);
  }
}

function _renderUnifiedSearchSections(query) {
  const body = document.getElementById('notes-section-body');
  if (!body) return;
  body.innerHTML = '';

  // ── Filename matches section ──
  let filteredTree = currentTree;
  const hasTagFilter = activeTagFilters.size > 0 && tagFilterPaths !== null;
  if (hasTagFilter) filteredTree = filterTreeByTagPaths(filteredTree, tagFilterPaths);
  if (query) filteredTree = filterTree(filteredTree, query);
  expandAllFolders(filteredTree);
  const filenameCount = filteredTree && filteredTree.children ? filteredTree.children.length : 0;

  const fnHeader = document.createElement('div');
  fnHeader.className = 'notes-section-header';
  const fnTitle = document.createElement('span');
  fnTitle.className = 'notes-section-title';
  fnTitle.textContent = 'Filename matches';
  const fnCount = document.createElement('span');
  fnCount.className = 'notes-section-count';
  fnCount.textContent = filenameCount;
  const fnToggle = document.createElement('span');
  fnToggle.className = 'section-chevron' + (filenameMatchCollapsed ? '' : ' expanded');
  fnToggle.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708"/></svg>';
  fnHeader.appendChild(fnTitle);
  fnHeader.appendChild(fnCount);
  fnHeader.appendChild(fnToggle);

  const fnBody = document.createElement('div');
  fnBody.className = 'search-section-body' + (filenameMatchCollapsed ? ' collapsed' : '');
  const fnList = document.createElement('ul');
  fnList.className = 'note-list-section';
  if (filteredTree && filteredTree.children) {
    renderChildren(filteredTree.children, fnList, 0);
  }
  fnBody.appendChild(fnList);

  fnHeader.addEventListener('click', () => {
    filenameMatchCollapsed = !filenameMatchCollapsed;
    fnBody.classList.toggle('collapsed', filenameMatchCollapsed);
    fnToggle.classList.toggle('expanded', !filenameMatchCollapsed);
  });

  body.appendChild(fnHeader);
  body.appendChild(fnBody);

  // ── Content matches section ──
  const contentCount = contentSearchResults ? contentSearchResults.length : 0;
  const cmHeader = document.createElement('div');
  cmHeader.className = 'notes-section-header';
  const cmTitle = document.createElement('span');
  cmTitle.className = 'notes-section-title';
  cmTitle.textContent = 'Content matches';
  const cmCount = document.createElement('span');
  cmCount.className = 'notes-section-count';
  if (contentSearchResults) {
    cmCount.textContent = contentCount;
  } else {
    cmCount.style.display = 'none';
  }
  const cmToggle = document.createElement('span');
  cmToggle.className = 'section-chevron' + (contentMatchCollapsed ? '' : ' expanded');
  cmToggle.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708"/></svg>';
  cmHeader.appendChild(cmTitle);
  cmHeader.appendChild(cmCount);
  cmHeader.appendChild(cmToggle);

  const cmBody = document.createElement('div');
  cmBody.className = 'search-section-body' + (contentMatchCollapsed ? ' collapsed' : '');

  if (contentSearchResults === null) {
    const status = document.createElement('div');
    status.className = 'search-section-status';
    status.textContent = 'Searching…';
    cmBody.appendChild(status);
  } else if (contentSearchResults.length === 0) {
    const status = document.createElement('div');
    status.className = 'search-section-status';
    status.textContent = 'No content matches';
    cmBody.appendChild(status);
  } else {
    const cmList = document.createElement('ul');
    cmList.className = 'note-list-section';
    _renderSearchResultsInto(cmList, contentSearchResults, query);
    cmBody.appendChild(cmList);
  }

  cmHeader.addEventListener('click', () => {
    contentMatchCollapsed = !contentMatchCollapsed;
    cmBody.classList.toggle('collapsed', contentMatchCollapsed);
    cmToggle.classList.toggle('expanded', !contentMatchCollapsed);
  });

  body.appendChild(cmHeader);
  body.appendChild(cmBody);
}

function renderFilteredTree() {
  if (!currentTree) return;
  const query = searchInputEl ? searchInputEl.value.trim() : '';
  const hasTagFilter = activeTagFilters.size > 0 && tagFilterPaths !== null;
  const hasQuery = !!query;

  if (hasQuery) {
    // Unified search mode: show both filename and content sections
    if (!savedExpandedPaths) {
      savedExpandedPaths = new Set(expandedPaths);
    }
    isFiltering = true;
    _renderUnifiedSearchSections(query);
  } else if (hasTagFilter) {
    // Tag filter only (no text query)
    if (!savedExpandedPaths) {
      savedExpandedPaths = new Set(expandedPaths);
    }
    isFiltering = true;
    _restoreNoteList();
    let tree = filterTreeByTagPaths(currentTree, tagFilterPaths);
    expandAllFolders(tree);
    renderTree(tree);

    if (tagFilterLogic === 'AND' && tagFilterPaths && tagFilterPaths.size === 0) {
      if (noteListEl && !noteListEl.querySelector('.tag-filter-empty-state')) {
        const msg = document.createElement('div');
        msg.className = 'tag-filter-empty-state';
        msg.textContent = 'No notes match all selected tags';
        noteListEl.appendChild(msg);
      }
    } else {
      document.querySelector('.tag-filter-empty-state')?.remove();
    }
  } else {
    // No filters: restore normal tree
    _restoreNoteList();
    if (savedExpandedPaths) {
      expandedPaths = new Set(savedExpandedPaths);
      savedExpandedPaths = null;
    }
    isFiltering = false;
    renderTree(currentTree);
    document.querySelector('.tag-filter-empty-state')?.remove();
  }
}

async function loadFileTagsCache() {
  if (!window.api || !window.api.tagsAllFileTags) return;
  const data = await window.api.tagsAllFileTags();
  fileTagsCache.clear();
  if (data && typeof data === 'object') {
    for (const [filePath, tags] of Object.entries(data)) {
      if (Array.isArray(tags) && tags.length > 0) {
        fileTagsCache.set(filePath, tags);
      }
    }
  }
}

/**
 * Builds a <span class="tree-pills"> container for the given tags array.
 * Shows up to 3 pills; excess tags appear as "+N" overflow pill with tooltip.
 */
function buildPillsContainer(tags) {
  const container = document.createElement('span');
  container.className = 'tree-pills';

  const visible = tags.slice(0, 3);
  for (const tag of visible) {
    const pill = document.createElement('span');
    pill.className = 'tag-pill';
    pill.textContent = tag.length > 8 ? tag.slice(0, 8) + '\u2026' : tag;
    pill.title = tag;
    container.appendChild(pill);
  }

  if (tags.length > 3) {
    const overflow = document.createElement('span');
    overflow.className = 'tag-pill tag-pill--overflow';
    overflow.textContent = `+${tags.length - 3}`;
    overflow.title = tags.slice(3).join(', ');
    container.appendChild(overflow);
  }

  return container;
}

/**
 * Incrementally updates the tag pills for a single file in the sidebar.
 */
function updatePillsForFile(filePath) {
  const li = document.querySelector(`li.tree-file[data-path="${CSS.escape(filePath)}"]`);
  if (!li) return;
  const row = li.querySelector('.tree-row');
  if (!row) return;

  const existing = row.querySelector('.tree-pills');
  if (existing) existing.remove();
}

function renderChildren(children, parentEl, depth) {
  for (const item of children) {
    const li = document.createElement("li");

    if (item.type === 'folder') {
      li.className = "tree-folder";
      li.dataset.path = item.path;

      const isExpanded = expandedPaths.has(item.path);

      const row = document.createElement("div");
      row.className = "tree-row";
      row.draggable = true;
      row.style.paddingLeft = `calc(var(--spacing-3) + ${depth} * var(--spacing-4))`;

      const toggle = document.createElement("span");
      toggle.className = "tree-toggle" + (isExpanded ? " expanded" : "");
      toggle.textContent = "\u25B6";
      row.appendChild(toggle);

      const iconSpan = document.createElement("span");
      iconSpan.className = "tree-icon";
      iconSpan.innerHTML = getFileIcon(item, isExpanded);
      row.appendChild(iconSpan);

      const label = document.createElement("span");
      label.className = "tree-label";
      label.textContent = item.name;
      row.appendChild(label);

      li.appendChild(row);

      const childUl = document.createElement("ul");
      childUl.className = "tree-children";
      if (!isExpanded) childUl.classList.add("hidden");

      if (item.children && item.children.length > 0) {
        renderChildren(item.children, childUl, depth + 1);
      }
      li.appendChild(childUl);

      row.addEventListener("click", () => {
        const nowExpanded = expandedPaths.has(item.path);
        if (nowExpanded) {
          expandedPaths.delete(item.path);
        } else {
          expandedPaths.add(item.path);
        }
        toggle.classList.toggle("expanded", !nowExpanded);
        childUl.classList.toggle("hidden", nowExpanded);
        iconSpan.innerHTML = !nowExpanded ? ICONS.folderOpen : ICONS.folder;
        saveExpandedPaths();
      });

      row.addEventListener("dragstart", (e) => {
        if (inlineEditActive || isFiltering) {
          e.preventDefault();
          return;
        }
        dragSourcePath = item.path;
        dragSourceType = 'folder';
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', item.path);
        requestAnimationFrame(() => li.classList.add('dragging'));
      });

      row.addEventListener("dragend", () => {
        li.classList.remove('dragging');
        cleanupDragState();
      });

    } else if (item.type === 'note') {
      // Note folder: leaf node, opens like a file, moves like a folder
      li.className = "tree-file";
      li.dataset.path = item.path;
      li.dataset.itemType = 'note';

      const row = document.createElement("div");
      row.className = "tree-row";
      row.draggable = true;
      if (item.path === selectedPath) row.classList.add("active");
      row.style.paddingLeft = `calc(var(--spacing-3) + ${depth} * var(--spacing-4))`;

      const iconSpan = document.createElement("span");
      iconSpan.className = "tree-icon";
      iconSpan.innerHTML = ICONS.html;
      row.appendChild(iconSpan);

      const label = document.createElement("span");
      label.className = "tree-label";
      label.textContent = item.title || item.name;
      row.appendChild(label);

      // Published indicator (link icon, click to copy URL)
      if (isPublished(item.path)) {
        row.appendChild(buildPublishIndicator(item.path));
      }

      // Star icon for favorites toggle
      const starSpan = document.createElement('span');
      starSpan.className = 'tree-star' + (isFavorited(item.path) ? ' favorited' : '');
      starSpan.innerHTML = isFavorited(item.path) ? ICONS.starFilled : ICONS.starOutline;
      starSpan.title = isFavorited(item.path) ? 'Remove from favorites' : 'Add to favorites';
      starSpan.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFavorite(item.path);
      });
      row.appendChild(starSpan);

      li.appendChild(row);

      row.classList.add("clickable");
      row.addEventListener("click", () => {
        const panel = TabState.getFocusedPanel();
        TabState.addTab(panel.id, { filePath: item.path, type: 'note', title: item.title || item.name });
      });

      row.addEventListener("dragstart", (e) => {
        if (inlineEditActive || isFiltering) {
          e.preventDefault();
          return;
        }
        dragSourcePath = item.path;
        dragSourceType = 'folder'; // note folders move like folders
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', item.path);
        requestAnimationFrame(() => li.classList.add('dragging'));
      });

      row.addEventListener("dragend", () => {
        li.classList.remove('dragging');
        cleanupDragState();
      });

    } else {
      li.className = "tree-file";
      li.dataset.path = item.path;

      const row = document.createElement("div");
      row.className = "tree-row";
      row.draggable = true;
      if (item.path === selectedPath) row.classList.add("active");
      row.style.paddingLeft = `calc(var(--spacing-3) + ${depth} * var(--spacing-4))`;

      const iconSpan = document.createElement("span");
      iconSpan.className = "tree-icon";
      iconSpan.innerHTML = getFileIcon(item);
      row.appendChild(iconSpan);

      const label = document.createElement("span");
      label.className = "tree-label";
      label.textContent = item.title || item.name;
      row.appendChild(label);

      if (_conflictPaths.has(item.path)) {
        row.classList.add('tree-row--conflict');
        const indicator = document.createElement('span');
        indicator.className = 'conflict-indicator';
        indicator.title = 'Sync conflict';
        indicator.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8.982 1.566a1.13 1.13 0 0 0-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767zM8 5c.535 0 .954.462.9.995l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 5.995A.905.905 0 0 1 8 5m.002 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2"/></svg>';
        row.appendChild(indicator);
      }

      // Feature 121: star icon for favorites toggle
      const starSpan = document.createElement('span');
      starSpan.className = 'tree-star' + (isFavorited(item.path) ? ' favorited' : '');
      starSpan.innerHTML = isFavorited(item.path) ? ICONS.starFilled : ICONS.starOutline;
      starSpan.title = isFavorited(item.path) ? 'Remove from favorites' : 'Add to favorites';
      starSpan.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFavorite(item.path);
      });
      row.appendChild(starSpan);

      li.appendChild(row);

      row.classList.add("clickable");
      row.addEventListener("click", () => selectNote(item.path, item.title || item.name));

      row.addEventListener("dragstart", (e) => {
        if (inlineEditActive || isFiltering) {
          e.preventDefault();
          return;
        }
        dragSourcePath = item.path;
        dragSourceType = 'file';
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', item.path);
        requestAnimationFrame(() => li.classList.add('dragging'));
      });

      row.addEventListener("dragend", () => {
        li.classList.remove('dragging');
        cleanupDragState();
      });
    }

    parentEl.appendChild(li);
  }
}

function getFileCategory(fileName) {
  const ext = fileName.lastIndexOf('.') !== -1
    ? fileName.slice(fileName.lastIndexOf('.')).toLowerCase()
    : '';
  if (ext === '.html' || ext === '.htm') return 'html';
  if (PDF_EXTENSIONS.has(ext)) return 'pdf';
  if (SPREADSHEET_EXTENSIONS.has(ext)) return 'spreadsheet';
  if (CSV_EXTENSIONS.has(ext)) return 'csv';
  if (TEXT_EXTENSIONS.has(ext)) return 'text';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  return 'unknown';
}

function getFileIcon(item, isExpanded) {
  if (item.type === 'folder') {
    return isExpanded ? ICONS.folderOpen : ICONS.folder;
  }
  const category = getFileCategory(item.name);
  if (category === 'html') return ICONS.html;
  if (category === 'pdf') return ICONS.pdf;
  if (category === 'spreadsheet' || category === 'csv') return ICONS.spreadsheet;
  if (category === 'image') return ICONS.image;
  if (category === 'text') {
    const ext = item.name.lastIndexOf('.') !== -1
      ? item.name.slice(item.name.lastIndexOf('.')).toLowerCase()
      : '';
    return ext === '.md' ? ICONS.markdown : ICONS.text;
  }
  return ICONS.generic;
}

// --- Tab bar rendering ---

function renderTabBar(panelId) {
  const panel = TabState.getPanel(panelId);
  const tabBarEl = document.querySelector(`.panel[data-panel-id="${panelId}"] .tab-bar`);
  if (!tabBarEl) return;

  tabBarEl.innerHTML = '';

  if (!panel) return;

  // ── Scrollable tab container ───────────────────────────────────────────────
  const scrollContainerEl = document.createElement('div');
  scrollContainerEl.className = 'tab-bar-scroll';

  // ── Drop indicator (repositioned during drag) ──────────────────────────────
  const dropIndicatorEl = document.createElement('div');
  dropIndicatorEl.className = 'tab-drop-indicator';

  for (const tab of panel.tabs) {
    const tabEl = document.createElement('div');
    tabEl.className = 'tab' + (tab.id === panel.activeTabId ? ' active' : '');
    tabEl.dataset.tabId = tab.id;
    tabEl.title = tab.title;

    const iconSpan = document.createElement('span');
    iconSpan.className = 'tab-icon';
    const _tabIconName = tab.filePath ? tab.filePath.split('/').pop() : tab.title;
    const _tabIconCategory = tab.type === 'note' ? 'html' : getFileCategory(_tabIconName);
    const _tabIconHtml = _tabIconCategory === 'html' ? ICONS.html
      : _tabIconCategory === 'pdf' ? ICONS.pdf
      : (_tabIconCategory === 'spreadsheet' || _tabIconCategory === 'csv') ? ICONS.spreadsheet
      : _tabIconCategory === 'image' ? ICONS.image
      : _tabIconCategory === 'text' ? (_tabIconName.endsWith('.md') ? ICONS.markdown : ICONS.text)
      : ICONS.generic;
    iconSpan.innerHTML = _tabIconHtml;

    const labelSpan = document.createElement('span');
    labelSpan.className = 'tab-label';
    labelSpan.textContent = tab.title;

    const closeSpan = document.createElement('span');
    closeSpan.className = 'tab-close';
    closeSpan.textContent = '×';
    closeSpan.addEventListener('click', (e) => {
      e.stopPropagation();
      TabState.removeTab(panelId, tab.id);
    });

    // Feature 121: star icon for favorites toggle
    const tabStarSpan = document.createElement('span');
    tabStarSpan.className = 'tab-star' + (isFavorited(tab.filePath) ? ' favorited' : '');
    tabStarSpan.innerHTML = isFavorited(tab.filePath) ? ICONS.starFilled : ICONS.starOutline;
    tabStarSpan.title = isFavorited(tab.filePath) ? 'Remove from favorites' : 'Add to favorites';
    tabStarSpan.addEventListener('click', (e) => {
      e.stopPropagation();
      if (tab.filePath) toggleFavorite(tab.filePath);
    });

    if (tab.isPinned) tabEl.classList.add('tab-pinned');
    tabEl.appendChild(iconSpan);
    tabEl.appendChild(labelSpan);
    tabEl.appendChild(tabStarSpan);
    tabEl.appendChild(closeSpan);
    tabEl.addEventListener('click', (e) => {
      if (e.target.closest('.tab-close')) return;
      TabState.setFocusedPanel(panelId);
      const panel = TabState.getPanel(panelId);
      if (panel && tab.id !== panel.activeTabId) {
        TabState.setActiveTab(panelId, tab.id);
      }
    });
    tabEl.addEventListener('auxclick', (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      TabState.removeTab(panelId, tab.id);
    });
    tabEl.addEventListener('contextmenu', (e) => {
      const state = TabState.getState();
      const panelCount = state.panels.length;
      const isMac = navigator.platform.includes('Mac');

      contextMenuTarget = { panelId, tabId: tab.id, source: 'tab' };

      const pinItem = tab.isPinned
        ? { label: 'Unpin Tab', action: 'tab-unpin' }
        : { label: 'Pin Tab',   action: 'tab-pin' };

      const items = [
        pinItem,
        { separator: true },
        { label: 'Close', action: 'tab-close', shortcut: isMac ? '⌘W' : 'Ctrl+W' },
        { label: 'Close Others',       action: 'tab-close-others' },
        { label: 'Close to the Right', action: 'tab-close-right' },
        { label: 'Close All',          action: 'tab-close-all' },
        { separator: true },
        { label: 'Copy File Path',     action: 'tab-copy-path' },
        { label: 'Reveal in Sidebar',  action: 'tab-reveal-sidebar' },
        { label: 'Duplicate',          action: 'tab-duplicate' },
      ];

      const conditionalItems = [];
      if (panelCount > 1) {
        conditionalItems.push({ label: 'Move to Other Panel',      action: 'tab-move-panel' });
        conditionalItems.push({ label: 'Duplicate to Other Panel', action: 'tab-duplicate-to-panel' });
      }
      if (panelCount < 3) {
        conditionalItems.push({ label: 'Split Right', action: 'tab-split-right' });
        conditionalItems.push({ label: 'Split Down',  action: 'tab-split-down' });
      }
      if (conditionalItems.length > 0) {
        items.push({ separator: true });
        items.push(...conditionalItems);
      }

      // Feature 121: favorites toggle
      const tabForFav = TabState.getTab(tab.id);
      if (tabForFav && tabForFav.filePath) {
        const tabFavLabel = isFavorited(tabForFav.filePath)
          ? 'Remove from Favorites'
          : 'Add to Favorites';
        items.push({ separator: true });
        items.push({ label: tabFavLabel, action: 'tab-toggle-favorite' });
      }

      // Export group
      const isMacExport = navigator.platform.includes('Mac');
      const exportShortcutHint = isMacExport ? '⌘⇧E' : 'Ctrl+Shift+E';
      const tabForExport = TabState.getActiveTab(panelId);
      const tabHasPath = !!(tabForExport && tabForExport.filePath);
      items.push({ separator: true });
      items.push({ label: 'Export as PDF',         action: 'tab-export-pdf',       disabled: !tabHasPath, shortcut: exportShortcutHint });
      items.push({ label: 'Export as Markdown',    action: 'tab-export-markdown',  disabled: !tabHasPath });
      items.push({ label: 'Export as Plain Text',  action: 'tab-export-plaintext', disabled: !tabHasPath });
      items.push({ label: 'Export as HTML (copy)', action: 'tab-export-html',      disabled: !tabHasPath });

      showContextMenu(e, items);
    });

    // ── Drag to reorder ────────────────────────────────────────────────────────
    tabEl.draggable = true;

    tabEl.addEventListener('dragstart', (e) => {
      e.stopPropagation(); // prevent bubbling to sidebar drag handlers

      tabDragSourceId = tab.id;
      tabDragPanelId = panelId;
      tabDragOriginalIndex = panel.tabs.findIndex(t => t.id === tab.id);
      tabDragIsPinned = tab.isPinned;

      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', tab.id);

      // Custom drag image: clean clone of the tab without close button
      const clone = tabEl.cloneNode(true);
      clone.querySelector('.tab-close')?.remove();
      clone.style.cssText = `
        position: fixed; top: -200px; left: -200px;
        opacity: 0.9; transform: scale(1.05);
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        pointer-events: none;
      `;
      document.body.appendChild(clone);
      e.dataTransfer.setDragImage(clone, e.offsetX, e.offsetY);
      requestAnimationFrame(() => clone.remove());

      tabEl.classList.add('tab-dragging');
      document.querySelectorAll('.panel .note-frame').forEach(f => { f.style.pointerEvents = 'none'; });
      createSplitDropOverlays();
    });

    tabEl.addEventListener('dragend', () => {
      cleanupTabDragState();
    });

    scrollContainerEl.appendChild(tabEl);
  }

  // ── Pinned separator ───────────────────────────────────────────────────────
  const pinnedTabCount = panel.tabs.filter(t => t.isPinned).length;
  if (pinnedTabCount > 0 && pinnedTabCount < panel.tabs.length) {
    const tabs = scrollContainerEl.querySelectorAll('.tab');
    const separatorEl = document.createElement('div');
    separatorEl.className = 'pinned-separator';
    const lastPinnedTab = tabs[pinnedTabCount - 1];
    if (lastPinnedTab && lastPinnedTab.nextSibling) {
      scrollContainerEl.insertBefore(separatorEl, lastPinnedTab.nextSibling);
    } else if (lastPinnedTab) {
      scrollContainerEl.appendChild(separatorEl);
    }
  }

  // ── Drag helpers ───────────────────────────────────────────────────────────
  function computeTabDropIndex(clientX) {
    const tabs = [...scrollContainerEl.querySelectorAll('.tab')];
    for (let i = 0; i < tabs.length; i++) {
      const rect = tabs[i].getBoundingClientRect();
      if (clientX < rect.left + rect.width / 2) return i;
    }
    return tabs.length;
  }

  function positionDropIndicator(dropIndex) {
    const tabs = [...scrollContainerEl.querySelectorAll('.tab')];
    if (tabs.length === 0) return;
    let left;
    if (dropIndex < tabs.length) {
      left = tabs[dropIndex].offsetLeft;
    } else {
      const last = tabs[tabs.length - 1];
      left = last.offsetLeft + last.offsetWidth;
    }
    dropIndicatorEl.style.left = left + 'px';
    dropIndicatorEl.style.display = 'block';
  }

  scrollContainerEl.addEventListener('dragover', (e) => {
    if (!tabDragSourceId) return; // not a tab drag

    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    // Add visual highlight when hovering over a different panel's tab bar
    if (panelId !== tabDragPanelId) {
      scrollContainerEl.classList.add('tab-bar-drop-target');
    }

    const rawDropIndex = computeTabDropIndex(e.clientX);
    const currentPanel = TabState.getPanel(panelId);
    const currentPinnedCount = currentPanel ? currentPanel.tabs.filter(t => t.isPinned).length : 0;

    let dropIndex;
    if (panelId !== tabDragPanelId) {
      dropIndex = tabDragIsPinned
        ? Math.min(rawDropIndex, currentPinnedCount)
        : Math.max(rawDropIndex, currentPinnedCount);
    } else {
      dropIndex = rawDropIndex;
    }
    positionDropIndicator(dropIndex);

    // Auto-scroll when cursor is near left or right edge
    const containerRect = scrollContainerEl.getBoundingClientRect();
    const SCROLL_ZONE = 30;
    const SCROLL_SPEED = 8;

    if (tabDragScrollRAF) {
      cancelAnimationFrame(tabDragScrollRAF);
      tabDragScrollRAF = null;
    }

    if (e.clientX < containerRect.left + SCROLL_ZONE) {
      const scroll = () => {
        scrollContainerEl.scrollLeft -= SCROLL_SPEED;
        tabDragScrollRAF = requestAnimationFrame(scroll);
      };
      tabDragScrollRAF = requestAnimationFrame(scroll);
    } else if (e.clientX > containerRect.right - SCROLL_ZONE) {
      const scroll = () => {
        scrollContainerEl.scrollLeft += SCROLL_SPEED;
        tabDragScrollRAF = requestAnimationFrame(scroll);
      };
      tabDragScrollRAF = requestAnimationFrame(scroll);
    }
  });

  scrollContainerEl.addEventListener('drop', (e) => {
    if (!tabDragSourceId) return;

    e.preventDefault();

    const rawDropIndex = computeTabDropIndex(e.clientX);
    const sourceId = tabDragSourceId;
    const sourcePanelId = tabDragPanelId;
    const originalIndex = tabDragOriginalIndex; // capture before cleanupTabDragState resets it
    const wasPinned = tabDragIsPinned;

    // Clean up before re-render (state mutations trigger renderTabBar synchronously)
    cleanupTabDragState();

    const targetPanel = TabState.getPanel(panelId);
    if (!targetPanel) return;
    const targetPinnedCount = targetPanel.tabs.filter(t => t.isPinned).length;

    if (panelId !== sourcePanelId) {
      // Cross-panel move: clamping handled in moveTab()
      TabState.moveTab(sourcePanelId, panelId, sourceId, rawDropIndex);
    } else {
      // Same-panel: check if drag crosses zone boundary
      const crossedIntoPinned = !wasPinned && rawDropIndex < targetPinnedCount;
      const crossedIntoUnpinned = wasPinned && rawDropIndex >= targetPinnedCount;

      if (crossedIntoPinned) {
        TabState.updateTab(sourceId, { isPinned: true });
      } else if (crossedIntoUnpinned) {
        TabState.updateTab(sourceId, { isPinned: false });
      } else {
        // Normal reorder within same zone
        const adjustedIndex = rawDropIndex > originalIndex ? rawDropIndex - 1 : rawDropIndex;
        if (adjustedIndex === originalIndex) return; // no-op
        TabState.reorderTab(sourcePanelId, sourceId, adjustedIndex);
      }
    }
  });

  scrollContainerEl.addEventListener('dragleave', (e) => {
    if (!tabDragSourceId) return; // not a tab drag

    // Ignore spurious dragleave events fired when moving over child elements
    if (scrollContainerEl.contains(e.relatedTarget)) return;

    scrollContainerEl.classList.remove('tab-bar-drop-target');
    dropIndicatorEl.style.display = 'none';

    // Cancel auto-scroll when leaving this panel's tab bar
    if (tabDragScrollRAF) {
      cancelAnimationFrame(tabDragScrollRAF);
      tabDragScrollRAF = null;
    }
  });

  // ── Wheel → horizontal scroll ──────────────────────────────────────────────
  scrollContainerEl.addEventListener('wheel', (e) => {
    if (e.deltaY !== 0) {
      e.preventDefault();
      scrollContainerEl.scrollLeft += e.deltaY;
    }
  }, { passive: false });

  scrollContainerEl.appendChild(dropIndicatorEl);

  // ── Scroll arrows ──────────────────────────────────────────────────────────
  const leftArrowEl = document.createElement('button');
  leftArrowEl.className = 'tab-scroll-arrow left';
  leftArrowEl.textContent = '‹';
  leftArrowEl.setAttribute('aria-label', 'Scroll tabs left');
  leftArrowEl.addEventListener('click', () => {
    scrollContainerEl.scrollBy({ left: -150, behavior: 'smooth' });
  });

  const rightArrowEl = document.createElement('button');
  rightArrowEl.className = 'tab-scroll-arrow right';
  rightArrowEl.textContent = '›';
  rightArrowEl.setAttribute('aria-label', 'Scroll tabs right');
  rightArrowEl.addEventListener('click', () => {
    scrollContainerEl.scrollBy({ left: 150, behavior: 'smooth' });
  });

  // ── Arrow visibility update ────────────────────────────────────────────────
  const updateArrows = () => {
    const { scrollLeft, clientWidth, scrollWidth } = scrollContainerEl;
    leftArrowEl.classList.toggle('visible', scrollLeft > 0);
    rightArrowEl.classList.toggle('visible', scrollLeft + clientWidth < scrollWidth - 1);
  };

  scrollContainerEl.addEventListener('scroll', updateArrows, { passive: true });

  // ── Close panel button ─────────────────────────────────────────────────────
  const state = TabState.getState();
  const closePanelBtn = document.createElement('button');
  closePanelBtn.className = 'split-btn close-panel-btn';
  closePanelBtn.title = 'Close Panel';
  closePanelBtn.innerHTML = '<svg viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><line x1="3.5" y1="3.5" x2="10.5" y2="10.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><line x1="10.5" y1="3.5" x2="3.5" y2="10.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';
  closePanelBtn.disabled = state.panels.length <= 1;
  closePanelBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    TabState.removePanel(panelId);
  });

  // ── Assemble tab bar ───────────────────────────────────────────────────────
  tabBarEl.appendChild(leftArrowEl);
  tabBarEl.appendChild(scrollContainerEl);
  tabBarEl.appendChild(rightArrowEl);
  tabBarEl.appendChild(closePanelBtn);

  // ── Auto-scroll active tab into view ──────────────────────────────────────
  const activeTabEl = scrollContainerEl.querySelector('.tab.active');
  if (activeTabEl) {
    activeTabEl.scrollIntoView({ inline: 'nearest', behavior: 'smooth' });
  }

  // ── Initial arrow state ────────────────────────────────────────────────────
  requestAnimationFrame(updateArrows);

  // ── ResizeObserver: update arrows when tab bar width changes ──────────────
  const ro = new ResizeObserver(updateArrows);
  ro.observe(scrollContainerEl);
}

// ─── Title-bar split action buttons ──────────────────────────────────────────
function renderTitleBarSplitActions() {
  const container = document.getElementById('title-bar-split-actions');
  if (!container) return;
  container.innerHTML = '';

  const state = TabState.getState();
  const canSplit = state.panels.length < 3;
  const focusedPanelId = state.focusedPanelId;

  const splitRightBtn = document.createElement('button');
  splitRightBtn.className = 'split-btn';
  splitRightBtn.title = 'Split Right';
  splitRightBtn.innerHTML = '<svg viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="1.5" y="1.5" width="11" height="11" rx="1.5" stroke="currentColor" stroke-width="1.2"/><line x1="7" y1="1.5" x2="7" y2="12.5" stroke="currentColor" stroke-width="1.2"/></svg>';
  splitRightBtn.disabled = !canSplit;
  splitRightBtn.addEventListener('click', () => {
    TabState.splitPanel(focusedPanelId, 'horizontal');
  });

  const splitDownBtn = document.createElement('button');
  splitDownBtn.className = 'split-btn';
  splitDownBtn.title = 'Split Down';
  splitDownBtn.innerHTML = '<svg viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="1.5" y="1.5" width="11" height="11" rx="1.5" stroke="currentColor" stroke-width="1.2"/><line x1="1.5" y1="7" x2="12.5" y2="7" stroke="currentColor" stroke-width="1.2"/></svg>';
  splitDownBtn.disabled = !canSplit;
  splitDownBtn.addEventListener('click', () => {
    TabState.splitPanel(focusedPanelId, 'vertical');
  });

  container.appendChild(splitRightBtn);
  container.appendChild(splitDownBtn);
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function updateSidebarHighlight() {
  const focusedPanel = TabState.getFocusedPanel();
  const tab = focusedPanel ? TabState.getActiveTab(focusedPanel.id) : null;
  if (!tab) {
    selectedPath = null;
    noteListEl.querySelectorAll(".tree-row").forEach((row) => {
      row.classList.remove("active");
    });
    // Feature 120
    updateFavoritesActiveHighlight();
    return;
  }
  selectedPath = tab.filePath;
  noteListEl.querySelectorAll(".tree-row").forEach((row) => {
    row.classList.toggle("active", row.closest("li")?.dataset.path === tab.filePath);
  });
  const activeRow = noteListEl.querySelector(".tree-row.active");
  if (activeRow) {
    activeRow.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  // Feature 120
  updateFavoritesActiveHighlight();
}

function selectNote(filePath, title, { searchQuery = '' } = {}) {
  const panel = TabState.getFocusedPanel();
  const fileName = filePath.split('/').pop();
  const fileType = getFileCategory(fileName);
  const tab = TabState.addTab(panel.id, { filePath, fileType, title: title || fileName });
  // addTab triggers onChange → renderTabBar + loadContentForTab
  // Store the search query on the tab so loadContentForTab can scroll to the first match.
  // This must be set AFTER addTab (which fires onChange synchronously), but loadContentForTab
  // is async — it suspends at its first await before the iframe load event, so the property
  // will be visible by the time scrolling is attempted.
  if (tab && searchQuery) tab.pendingSearchQuery = searchQuery;
}

// ─── Heading extraction ───────────────────────────────────────────────────────

async function extractHeadingsFromWebview(webviewEl) {
  try {
    const headings = await webviewEl.executeJavaScript(EXTRACT_HEADINGS_SCRIPT);
    return Array.isArray(headings) ? headings : [];
  } catch (_) {
    return [];
  }
}

function scrollToHeading(webviewEl, headingId) {
  if (!webviewEl || !headingId) return;
  const escaped = headingId.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  webviewEl.executeJavaScript(
    `document.getElementById('${escaped}')?.scrollIntoView({ behavior: 'smooth', block: 'start' })`
  ).catch(() => {});
}

function getOutlineTree(panelId) {
  const tab = TabState.getActiveTab(panelId);
  return tab ? (_outlineTrees.get(tab.id) || []) : [];
}

// ─── Outline active-section tracking ─────────────────────────────────────────

function updateOutlineHighlight(panelId) {
  const tab = TabState.getActiveTab(panelId);
  const tabId = tab ? tab.id : null;
  const activeId = tabId ? (_activeHeadingId.get(tabId) ?? null) : null;

  updateBreadcrumb(panelId);

  const state = TabState.getState();
  if (state.focusedPanelId !== panelId) return;

  document.querySelector('.outline-item--active')?.classList.remove('outline-item--active');
  if (activeId) {
    let activeItemEl = document.querySelector(`.outline-item[data-heading-id="${activeId}"]`);

    // If the active heading is filtered out, walk backwards through flat entries
    // to find the nearest visible ancestor heading
    if (!activeItemEl && _outlineMaxLevel < 6) {
      const flatEntries = tabId ? _outlineFlatEntries.get(tabId) : null;
      if (flatEntries) {
        const idx = flatEntries.findIndex(e => e.id === activeId);
        for (let i = idx - 1; i >= 0; i--) {
          if (flatEntries[i].level <= _outlineMaxLevel) {
            activeItemEl = document.querySelector(
              `.outline-item[data-heading-id="${flatEntries[i].id}"]`
            );
            if (activeItemEl) break;
          }
        }
      }
    }

    if (activeItemEl) {
      activeItemEl.classList.add('outline-item--active');
      activeItemEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
}

function buildBreadcrumbPath(panelId) {
  const tab = TabState.getActiveTab(panelId);
  const tabId = tab ? tab.id : null;
  const activeId = tabId ? _activeHeadingId.get(tabId) : null;
  if (!activeId) return [];

  const tree = tabId ? _outlineTrees.get(tabId) : null;
  if (!tree || tree.length === 0) return [];

  const path = [];
  function dfs(nodes) {
    for (const node of nodes) {
      path.push(node);
      if (node.id === activeId) return true;
      if (node.children.length > 0 && dfs(node.children)) return true;
      path.pop();
    }
    return false;
  }
  dfs(tree);
  return path;
}

function updateBreadcrumb(panelId) {
  const panelEl = document.querySelector(`.panel[data-panel-id="${panelId}"]`);
  if (!panelEl) return;
  const barEl = panelEl.querySelector('.breadcrumb-bar');
  if (!barEl) return;

  const path = buildBreadcrumbPath(panelId);

  barEl.textContent = '';

  if (path.length === 0) {
    barEl.classList.add('breadcrumb-empty');
    return;
  }
  barEl.classList.remove('breadcrumb-empty');

  for (let i = 0; i < path.length; i++) {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'breadcrumb-sep';
      sep.textContent = '›';
      barEl.appendChild(sep);
    }
    const seg = document.createElement('span');
    seg.className = 'breadcrumb-segment';
    seg.textContent = path[i].text;
    seg.title = path[i].text;
    const headingId = path[i].id;
    seg.addEventListener('click', () => {
      scrollToHeading(getWebviewForPanel(panelId), headingId);
    });
    barEl.appendChild(seg);
  }
}

// ─── Outline panel rendering ──────────────────────────────────────────────────

function filterOutlineTree(entries, maxLevel) {
  if (maxLevel >= 6) return entries;
  const result = [];
  for (const entry of entries) {
    if (entry.level <= maxLevel) {
      const filtered = Object.assign({}, entry);
      filtered.children = filterOutlineTree(entry.children || [], maxLevel);
      result.push(filtered);
    }
    // entries with level > maxLevel are skipped entirely (including their children)
  }
  return result;
}

function renderOutlinePanel() {
  const emptyEl = document.getElementById('outline-empty');
  const treeEl = document.getElementById('outline-tree');
  if (!emptyEl || !treeEl) return; // panel not in DOM yet (welcome screen)
  if (!_rightPanelVisible || _rightPanelActiveTab !== 'outline') return; // skip DOM work when panel is hidden

  const state = TabState.getState();
  const panelId = state.focusedPanelId;
  const panel = TabState.getPanel(panelId);

  // Case 1: no panel or no active tab → "No note selected"
  if (!panel || !panel.activeTabId) {
    emptyEl.textContent = 'No note selected';
    emptyEl.classList.remove('hidden');
    treeEl.classList.add('hidden');
    treeEl.innerHTML = '';
    return;
  }

  // Case 2: active tab exists → get its outline tree
  const tree = getOutlineTree(panelId);
  const filteredTree = filterOutlineTree(tree, _outlineMaxLevel);

  if (filteredTree.length === 0) {
    // Case 2a: no headings (including non-HTML files)
    emptyEl.textContent = 'No headings in this document';
    emptyEl.classList.remove('hidden');
    treeEl.classList.add('hidden');
    treeEl.innerHTML = '';
    return;
  }

  // Case 2b: has headings → render the tree
  emptyEl.classList.add('hidden');
  treeEl.classList.remove('hidden');
  treeEl.innerHTML = '';

  const tab = TabState.getActiveTab(panelId);
  const filePath = tab ? tab.filePath : null;

  // Load collapse state from localStorage if not already in memory
  if (filePath && !_outlineCollapsedIds.has(filePath)) {
    _outlineCollapsedIds.set(filePath, loadOutlineCollapseState(filePath));
  }
  const collapsedIds = filePath ? (_outlineCollapsedIds.get(filePath) || new Set()) : new Set();

  renderOutlineNodes(filteredTree, treeEl, collapsedIds, filePath, panelId);

  const activeTabId = tab ? tab.id : null;
  const activeId = activeTabId ? _activeHeadingId.get(activeTabId) : null;
  if (activeId) {
    const el = document.querySelector(`.outline-item[data-heading-id="${activeId}"]`);
    if (el) el.classList.add('outline-item--active');
  }
}

// ─── Storage Inspector helpers ────────────────────────────────────────────────

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
  return (bytes / 1073741824).toFixed(1) + ' GB';
}

// Storage panel visibility is now driven by _rightPanelActiveTab
function _setStoragePanelVisible(visible) {
  if (visible && !(_rightPanelVisible && _rightPanelActiveTab === 'storage')) {
    setRightPanel('storage');
  } else if (!visible && _rightPanelVisible && _rightPanelActiveTab === 'storage') {
    setRightPanel('storage'); // toggle off
  }
}

function _setStorageKvCollapsed(collapsed, persist = true) {
  _storageKvCollapsed = collapsed;
  const bodyEl = document.getElementById('storage-kv-body');
  const headerEl = document.getElementById('storage-kv-header');
  const toggleEl = document.getElementById('storage-kv-toggle');
  if (bodyEl) bodyEl.classList.toggle('collapsed', collapsed);
  if (headerEl) headerEl.setAttribute('aria-expanded', String(!collapsed));
  if (toggleEl) toggleEl.classList.toggle('expanded', !collapsed);
  if (persist && currentWorkspacePath) {
    window.api.setSidebarStateKey(currentWorkspacePath, 'storageKvCollapsed', collapsed);
  }
}

function _setStorageFilesCollapsed(collapsed, persist = true) {
  _storageFilesCollapsed = collapsed;
  const bodyEl = document.getElementById('storage-files-body');
  const headerEl = document.getElementById('storage-files-header');
  const toggleEl = document.getElementById('storage-files-toggle');
  if (bodyEl) bodyEl.classList.toggle('collapsed', collapsed);
  if (headerEl) headerEl.setAttribute('aria-expanded', String(!collapsed));
  if (toggleEl) toggleEl.classList.toggle('expanded', !collapsed);
  if (persist && currentWorkspacePath) {
    window.api.setSidebarStateKey(currentWorkspacePath, 'storageFilesCollapsed', collapsed);
  }
}

function _setStorageSqlCollapsed(collapsed, persist = true) {
  _storageSqlCollapsed = collapsed;
  const bodyEl = document.getElementById('storage-sql-body');
  const headerEl = document.getElementById('storage-sql-header');
  const toggleEl = document.getElementById('storage-sql-toggle');
  if (bodyEl) bodyEl.classList.toggle('collapsed', collapsed);
  if (headerEl) headerEl.setAttribute('aria-expanded', String(!collapsed));
  if (toggleEl) toggleEl.classList.toggle('expanded', !collapsed);
  if (persist && currentWorkspacePath) {
    window.api.setSidebarStateKey(currentWorkspacePath, 'storageSqlCollapsed', collapsed);
  }
}

async function _storageLoadState() {
  if (!currentWorkspacePath) return;
  const state = await window.api.getSidebarState(currentWorkspacePath);
  _setStorageKvCollapsed(state.storageKvCollapsed === true, false);
  _setStorageFilesCollapsed(state.storageFilesCollapsed === true, false);
  _setStorageSqlCollapsed(state.storageSqlCollapsed === true, false);
}

async function renderStorageSection() {
  if (!_rightPanelVisible || _rightPanelActiveTab !== 'storage') return;

  const emptyEl = document.getElementById('storage-empty');

  // Grab active tab
  const state = TabState.getState();
  const panelId = state.focusedPanelId;
  const panel = TabState.getPanel(panelId);
  const tab = panel ? TabState.getActiveTab(panelId) : null;

  if (!tab || !tab.filePath) {
    if (emptyEl) { emptyEl.textContent = 'No note selected'; emptyEl.classList.remove('hidden'); }
    _clearStorageSubSections();
    return;
  }

  const noteId = noteIdFromPath(tab.filePath);

  // Staleness guard
  const gen = ++_storageRenderGen;

  let kvEntries, files, tables;
  try {
    [kvEntries, files, tables] = await Promise.all([
      window.storageInspector.listKV(noteId),
      window.storageInspector.listFiles(noteId),
      window.storageInspector.listTables(noteId),
    ]);
  } catch {
    kvEntries = [];
    files = [];
    tables = [];
  }

  if (gen !== _storageRenderGen) return; // stale — newer render started

  if (emptyEl) emptyEl.classList.add('hidden');

  // Render sub-sections
  _renderStorageKv(kvEntries || [], noteId);
  _renderStorageFiles(files || []);
  _renderStorageSql(tables || [], noteId);

}

function _clearStorageSubSections() {
  _expandedKvKeys.clear();
  _expandedSqlTables.clear();
  _sqlBrowsing = null;
  _sqlQueryState = null;

  const kvInfoEl = document.getElementById('storage-kv-info');
  const kvEmptyEl = document.getElementById('storage-kv-empty');
  const kvTableEl = document.getElementById('storage-kv-table');
  if (kvInfoEl) kvInfoEl.textContent = '';
  if (kvEmptyEl) kvEmptyEl.classList.remove('hidden');
  if (kvTableEl) kvTableEl.classList.add('hidden');

  const filesInfoEl = document.getElementById('storage-files-info');
  const filesEmptyEl = document.getElementById('storage-files-empty');
  const filesTableEl = document.getElementById('storage-files-table');
  if (filesInfoEl) filesInfoEl.textContent = '';
  if (filesEmptyEl) filesEmptyEl.classList.remove('hidden');
  if (filesTableEl) filesTableEl.classList.add('hidden');

  const sqlInfoEl = document.getElementById('storage-sql-info');
  const sqlEmptyEl = document.getElementById('storage-sql-empty');
  const sqlTablesEl = document.getElementById('storage-sql-tables');
  const sqlBrowseEl = document.getElementById('storage-sql-browse');
  const sqlQueryEl = document.getElementById('storage-sql-query');
  if (sqlInfoEl) sqlInfoEl.textContent = '';
  if (sqlEmptyEl) sqlEmptyEl.classList.remove('hidden');
  if (sqlTablesEl) { sqlTablesEl.classList.add('hidden'); sqlTablesEl.innerHTML = ''; }
  if (sqlBrowseEl) sqlBrowseEl.classList.add('hidden');
  if (sqlQueryEl) {
    sqlQueryEl.classList.add('hidden');
    delete sqlQueryEl.dataset.wired;
    const input = document.getElementById('sql-query-input');
    if (input) input.value = '';
    const errorEl = document.getElementById('sql-query-error');
    if (errorEl) { errorEl.textContent = ''; errorEl.classList.add('hidden'); }
    const resultsWrap = document.getElementById('sql-query-results-wrap');
    if (resultsWrap) resultsWrap.classList.add('hidden');
  }
}

/**
 * Returns an HTML string with simple JSON syntax highlighting.
 * Accepts any JS value (object, array, string, number, boolean, null).
 */
function highlightJson(value) {
  let str;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === 'object' && parsed !== null) {
        str = JSON.stringify(parsed, null, 2);
      } else {
        str = value;
      }
    } catch {
      str = value;
    }
  } else if (value === null || value === undefined) {
    str = String(value);
  } else if (typeof value === 'object') {
    str = JSON.stringify(value, null, 2);
  } else {
    str = String(value);
  }
  // Escape HTML entities
  const escaped = str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  // Apply syntax highlighting via regex
  return escaped.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      if (/^"/.test(match)) {
        if (/:$/.test(match)) return `<span class="kv-json-key">${match}</span>`;
        return `<span class="kv-json-string">${match}</span>`;
      }
      if (/true|false/.test(match)) return `<span class="kv-json-bool">${match}</span>`;
      if (/null/.test(match))       return `<span class="kv-json-null">${match}</span>`;
      return `<span class="kv-json-number">${match}</span>`;
    }
  );
}

function _renderStorageKv(entries, noteId) {
  const infoEl = document.getElementById('storage-kv-info');
  const emptyEl = document.getElementById('storage-kv-empty');
  const tableEl = document.getElementById('storage-kv-table');
  const rowsEl = document.getElementById('storage-kv-rows');

  if (!entries.length) {
    if (infoEl) infoEl.textContent = '';
    if (emptyEl) emptyEl.classList.remove('hidden');
    if (tableEl) tableEl.classList.add('hidden');
    return;
  }

  if (infoEl) infoEl.textContent = `${entries.length} ${entries.length === 1 ? 'key' : 'keys'}`;
  if (emptyEl) emptyEl.classList.add('hidden');
  if (tableEl) tableEl.classList.remove('hidden');
  if (rowsEl) {
    rowsEl.innerHTML = '';
    for (const { key, value, type } of entries) {
      const tr = document.createElement('tr');
      tr.classList.add('kv-row');

      const tdKey = document.createElement('td');
      const arrow = document.createElement('span');
      arrow.className = 'kv-expand-arrow';
      arrow.textContent = '▶';
      tdKey.appendChild(arrow);
      tdKey.appendChild(document.createTextNode(key));
      tdKey.title = key;

      const tdVal = document.createElement('td');
      tdVal.textContent = value;
      tdVal.title = value;

      const tdType = document.createElement('td');
      tdType.textContent = type;

      tr.appendChild(tdKey);
      tr.appendChild(tdVal);
      tr.appendChild(tdType);

      tr.addEventListener('click', () => _onKvRowClick(tr, noteId, key));

      rowsEl.appendChild(tr);

      // Re-expand keys that were open before this render
      if (_expandedKvKeys.has(key)) {
        tr.classList.add('kv-expanded');
        _renderKvDetail(tr, noteId, key); // async, fire-and-forget
      }
    }
  }
}

function _onKvRowClick(tr, noteId, key) {
  if (_expandedKvKeys.has(key)) {
    // Collapse: remove detail row and update state
    _expandedKvKeys.delete(key);
    tr.classList.remove('kv-expanded');
    const detailRow = tr.nextElementSibling;
    if (detailRow && detailRow.classList.contains('kv-detail-row')) {
      detailRow.remove();
    }
  } else {
    // Expand: add state and render detail row
    _expandedKvKeys.add(key);
    tr.classList.add('kv-expanded');
    _renderKvDetail(tr, noteId, key);
  }
}

async function _renderKvDetail(tr, noteId, key) {
  const TRUNCATE_LIMIT = 10240; // 10 KB

  let rawValue;
  try {
    rawValue = await window.storageInspector.getKV(noteId, key);
  } catch {
    rawValue = null;
  }

  // Abort if the row was collapsed while we were fetching
  if (!_expandedKvKeys.has(key) || !tr.isConnected) return;

  // Serialise to display string
  let displayStr;
  if (rawValue === null || rawValue === undefined) {
    displayStr = String(rawValue);
  } else if (typeof rawValue === 'object') {
    displayStr = JSON.stringify(rawValue, null, 2);
  } else {
    displayStr = String(rawValue);
  }

  const isTruncated = displayStr.length > TRUNCATE_LIMIT;
  const visibleStr = isTruncated ? displayStr.slice(0, TRUNCATE_LIMIT) : displayStr;

  // Build detail row
  const detailRow = document.createElement('tr');
  detailRow.classList.add('kv-detail-row');

  const detailCell = document.createElement('td');
  detailCell.colSpan = 3;

  // Content block (pre with syntax-highlighted JSON)
  const pre = document.createElement('pre');
  pre.className = 'kv-detail-content';
  pre.innerHTML = highlightJson(visibleStr);
  detailCell.appendChild(pre);

  // Truncation banner (if needed)
  if (isTruncated) {
    const totalKb = Math.round(displayStr.length / 1024);
    const banner = document.createElement('div');
    banner.className = 'kv-truncation-banner';
    const link = document.createElement('a');
    link.textContent = 'Show full value';
    link.addEventListener('click', () => {
      pre.innerHTML = highlightJson(displayStr);
      banner.remove();
    });
    banner.append(`Value truncated (${totalKb} KB total) — `, link);
    detailCell.appendChild(banner);
  }

  // Toolbar with Copy and Delete buttons
  const toolbar = document.createElement('div');
  toolbar.className = 'kv-detail-toolbar';

  // Copy button
  const copyBtn = document.createElement('button');
  copyBtn.textContent = 'Copy';
  copyBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(displayStr).then(() => {
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
    });
  });

  // Delete button
  const deleteBtn = document.createElement('button');
  deleteBtn.textContent = 'Delete';
  deleteBtn.className = 'kv-detail-btn-delete';
  deleteBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm(`Delete key "${key}"? This cannot be undone.`)) return;
    try {
      await window.storageInspector.deleteKV(noteId, key);
    } catch (err) {
      console.error('Failed to delete KV entry:', err);
      return;
    }
    _expandedKvKeys.delete(key);
    renderStorageSection();
  });

  toolbar.appendChild(copyBtn);
  toolbar.appendChild(deleteBtn);
  detailCell.appendChild(toolbar);

  detailRow.appendChild(detailCell);

  // Insert after the data row (replacing any previous detail row)
  const existing = tr.nextElementSibling;
  if (existing && existing.classList.contains('kv-detail-row')) {
    existing.replaceWith(detailRow);
  } else {
    tr.after(detailRow);
  }
}

function _renderStorageFiles(files) {
  const infoEl = document.getElementById('storage-files-info');
  const emptyEl = document.getElementById('storage-files-empty');
  const tableEl = document.getElementById('storage-files-table');
  const rowsEl = document.getElementById('storage-files-rows');

  if (!files.length) {
    if (infoEl) infoEl.textContent = '';
    if (emptyEl) emptyEl.classList.remove('hidden');
    if (tableEl) tableEl.classList.add('hidden');
    return;
  }

  const totalSize = files.reduce((sum, f) => sum + (f.size || 0), 0);
  if (infoEl) infoEl.textContent = `${files.length} ${files.length === 1 ? 'file' : 'files'} (${formatBytes(totalSize)})`;
  if (emptyEl) emptyEl.classList.add('hidden');
  if (tableEl) tableEl.classList.remove('hidden');
  if (rowsEl) {
    rowsEl.innerHTML = '';
    for (const { name, size, modified } of files) {
      const tr = document.createElement('tr');
      const tdName = document.createElement('td');
      tdName.textContent = name;
      tdName.title = name;
      const tdSize = document.createElement('td');
      tdSize.textContent = formatBytes(size || 0);
      const tdMod = document.createElement('td');
      try {
        tdMod.textContent = new Date(modified).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      } catch {
        tdMod.textContent = modified || '';
      }
      tr.appendChild(tdName);
      tr.appendChild(tdSize);
      tr.appendChild(tdMod);
      rowsEl.appendChild(tr);
    }
  }
}

/**
 * Builds a CSV string from an array of column names and an array of row objects.
 */
function buildCsv(columns, rows) {
  const escape = v => {
    const s = v == null ? '' : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const header = columns.map(escape).join(',');
  const body = rows.map(r => columns.map(c => escape(r[c])).join(',')).join('\n');
  return header + '\n' + body;
}

/**
 * Triggers a browser download of the given CSV string with the given filename.
 */
function downloadCsv(csv, filename) {
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function _buildSqlSchemaDetail(columns) {
  const detailEl = document.createElement('div');
  detailEl.className = 'sql-schema-detail';

  if (!columns || !columns.length) {
    const empty = document.createElement('span');
    empty.className = 'sql-results-empty';
    empty.textContent = 'No columns';
    detailEl.appendChild(empty);
    return detailEl;
  }

  const table = document.createElement('table');
  table.className = 'sql-schema-table';
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  ['Column', 'Type'].forEach(h => {
    const th = document.createElement('th');
    th.textContent = h;
    hr.appendChild(th);
  });
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const { name, type } of columns) {
    const tr = document.createElement('tr');
    const tdName = document.createElement('td');
    tdName.textContent = name;
    const tdType = document.createElement('td');
    tdType.className = 'sql-col-type';
    tdType.textContent = type || '';
    tr.appendChild(tdName);
    tr.appendChild(tdType);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  detailEl.appendChild(table);
  return detailEl;
}

function _renderSqlResultsTable(containerEl, columns, rows) {
  containerEl.innerHTML = '';

  if (!columns.length) {
    const msg = document.createElement('div');
    msg.className = 'sql-results-empty';
    msg.textContent = 'No results';
    containerEl.appendChild(msg);
    return;
  }

  const wrap = document.createElement('div');
  wrap.className = 'sql-results-wrap';

  const table = document.createElement('table');
  table.className = 'sql-results-table';

  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  for (const col of columns) {
    const th = document.createElement('th');
    th.textContent = col;
    th.title = col;
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  if (rows.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = columns.length;
    td.className = 'sql-results-empty';
    td.textContent = 'No rows';
    tr.appendChild(td);
    tbody.appendChild(tr);
  } else {
    for (const row of rows) {
      const tr = document.createElement('tr');
      for (const col of columns) {
        const td = document.createElement('td');
        const val = row[col];
        td.textContent = val == null ? '' : String(val);
        td.title = val == null ? '' : String(val);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  containerEl.appendChild(wrap);
}

function _restoreSqlQueryState() {
  const input = document.getElementById('sql-query-input');
  if (input && _sqlQueryState && _sqlQueryState.sql) {
    input.value = _sqlQueryState.sql;
  }
  if (_sqlQueryState && _sqlQueryState.columns && _sqlQueryState.rows) {
    const resultsEl = document.getElementById('sql-query-results');
    const resultsWrap = document.getElementById('sql-query-results-wrap');
    const resultInfo = document.getElementById('sql-query-result-info');
    if (resultsEl) _renderSqlResultsTable(resultsEl, _sqlQueryState.columns, _sqlQueryState.rows);
    if (resultInfo) resultInfo.textContent = `${_sqlQueryState.rows.length} ${_sqlQueryState.rows.length === 1 ? 'row' : 'rows'}`;
    if (resultsWrap) resultsWrap.classList.remove('hidden');
  }
}

function _onSqlTableClick(itemEl, name, columns) {
  const tablesEl = document.getElementById('storage-sql-tables');
  if (!tablesEl) return;

  if (_expandedSqlTables.has(name)) {
    _expandedSqlTables.delete(name);
    itemEl.classList.remove('sql-expanded');
    const next = itemEl.nextElementSibling;
    if (next && next.classList.contains('sql-schema-detail')) {
      next.remove();
    }
  } else {
    _expandedSqlTables.add(name);
    itemEl.classList.add('sql-expanded');
    const detailEl = _buildSqlSchemaDetail(columns);
    itemEl.after(detailEl);
  }
}

async function _browseSqlTable(noteId, tableName, columns, totalRows, page) {
  const PAGE_SIZE = 50;
  const browseEl = document.getElementById('storage-sql-browse');
  if (!browseEl) return;

  _sqlBrowsing = { noteId, table: tableName, page, pageSize: PAGE_SIZE, totalRows, columns, rows: [] };

  browseEl.classList.remove('hidden');
  const titleEl = browseEl.querySelector('.sql-browse-title');
  if (titleEl) titleEl.textContent = tableName;

  const closeBtn = browseEl.querySelector('.sql-browse-close');
  if (closeBtn) {
    closeBtn.onclick = () => {
      browseEl.classList.add('hidden');
      _sqlBrowsing = null;
    };
  }
  const exportBtn = browseEl.querySelector('.sql-export-btn');
  if (exportBtn) {
    exportBtn.onclick = () => {
      if (_sqlBrowsing && _sqlBrowsing.columns && _sqlBrowsing.rows) {
        const cols = _sqlBrowsing.columns.map(c => c.name);
        downloadCsv(buildCsv(cols, _sqlBrowsing.rows), `${_sqlBrowsing.table}.csv`);
      }
    };
  }

  const prevBtn = browseEl.querySelector('.sql-page-prev');
  const nextBtn = browseEl.querySelector('.sql-page-next');
  if (prevBtn) prevBtn.onclick = () => _browseSqlTable(noteId, tableName, columns, totalRows, _sqlBrowsing.page - 1);
  if (nextBtn) nextBtn.onclick = () => _browseSqlTable(noteId, tableName, columns, totalRows, _sqlBrowsing.page + 1);

  const offset = page * PAGE_SIZE;
  const safeName = tableName.replace(/"/g, '""');
  const sql = `SELECT * FROM "${safeName}" LIMIT ${PAGE_SIZE} OFFSET ${offset}`;
  let rows;
  try {
    rows = await window.storageInspector.queryReadonly(noteId, sql);
  } catch (err) {
    rows = [];
  }
  _sqlBrowsing.rows = rows;
  _sqlBrowsing.page = page;

  const resultsEl = browseEl.querySelector('.sql-browse-results');
  if (resultsEl) _renderSqlResultsTable(resultsEl, columns.map(c => c.name), rows);

  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const pageInfo = browseEl.querySelector('.sql-page-info');
  if (pageInfo) {
    const start = offset + 1;
    const end = Math.min(offset + PAGE_SIZE, totalRows);
    pageInfo.textContent = totalRows > 0
      ? `${start}–${end} of ${totalRows} rows`
      : 'Page 1 of 1';
  }
  if (prevBtn) prevBtn.disabled = page <= 0;
  if (nextBtn) nextBtn.disabled = page >= totalPages - 1;
}

async function _runSqlQuery(noteId, sql) {
  const errorEl = document.getElementById('sql-query-error');
  const resultsWrap = document.getElementById('sql-query-results-wrap');
  const resultsEl = document.getElementById('sql-query-results');
  const resultInfo = document.getElementById('sql-query-result-info');

  if (errorEl) { errorEl.textContent = ''; errorEl.classList.add('hidden'); }
  if (resultsWrap) resultsWrap.classList.add('hidden');

  if (!sql) return;

  let rows;
  try {
    rows = await window.storageInspector.queryReadonly(noteId, sql);
  } catch (err) {
    if (errorEl) {
      errorEl.textContent = err && err.message ? err.message : String(err);
      errorEl.classList.remove('hidden');
    }
    _sqlQueryState = { sql, columns: null, rows: null, error: err };
    return;
  }

  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  _sqlQueryState = { sql, columns, rows, error: null };

  if (resultsEl) _renderSqlResultsTable(resultsEl, columns, rows);
  if (resultInfo) resultInfo.textContent = `${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`;
  if (resultsWrap) resultsWrap.classList.remove('hidden');
}

function _renderStorageSql(tables, noteId) {
  const infoEl = document.getElementById('storage-sql-info');
  const emptyEl = document.getElementById('storage-sql-empty');
  const tablesEl = document.getElementById('storage-sql-tables');
  const queryEl = document.getElementById('storage-sql-query');

  if (!tables.length) {
    if (infoEl) infoEl.textContent = '';
    if (emptyEl) emptyEl.classList.remove('hidden');
    if (tablesEl) tablesEl.classList.add('hidden');
    if (queryEl) queryEl.classList.add('hidden');
    return;
  }

  if (infoEl) infoEl.textContent = `${tables.length} ${tables.length === 1 ? 'table' : 'tables'}`;
  if (emptyEl) emptyEl.classList.add('hidden');

  if (tablesEl) {
    tablesEl.classList.remove('hidden');
    tablesEl.innerHTML = '';
    for (const { name, columns, rowCount } of tables) {
      const itemEl = document.createElement('div');
      itemEl.className = 'sql-table-item';
      if (_expandedSqlTables.has(name)) itemEl.classList.add('sql-expanded');

      const arrow = document.createElement('span');
      arrow.className = 'sql-table-expand-arrow';
      arrow.textContent = '▶';

      const nameEl = document.createElement('span');
      nameEl.className = 'sql-table-name';
      nameEl.textContent = name;
      nameEl.title = name;

      const countEl = document.createElement('span');
      countEl.className = 'sql-table-rowcount';
      countEl.textContent = `(${rowCount} ${rowCount === 1 ? 'row' : 'rows'})`;

      const browseBtn = document.createElement('button');
      browseBtn.className = 'sql-table-browse-btn';
      browseBtn.textContent = 'Browse';
      browseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        _browseSqlTable(noteId, name, columns, rowCount, 0);
      });

      itemEl.appendChild(arrow);
      itemEl.appendChild(nameEl);
      itemEl.appendChild(countEl);
      itemEl.appendChild(browseBtn);
      itemEl.addEventListener('click', () => _onSqlTableClick(itemEl, name, columns));
      tablesEl.appendChild(itemEl);

      if (_expandedSqlTables.has(name)) {
        const detailEl = _buildSqlSchemaDetail(columns);
        tablesEl.appendChild(detailEl);
      }
    }
  }

  if (queryEl) {
    queryEl.classList.remove('hidden');
    if (!queryEl.dataset.wired) {
      queryEl.dataset.wired = '1';
      const runBtn = document.getElementById('sql-query-run');
      const input = document.getElementById('sql-query-input');
      if (runBtn && input) {
        runBtn.addEventListener('click', () => _runSqlQuery(noteId, input.value.trim()));
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            _runSqlQuery(noteId, input.value.trim());
          }
        });
      }
      const exportBtn = document.getElementById('sql-query-export');
      if (exportBtn) {
        exportBtn.addEventListener('click', () => {
          if (_sqlQueryState && _sqlQueryState.columns && _sqlQueryState.rows) {
            downloadCsv(buildCsv(_sqlQueryState.columns, _sqlQueryState.rows), 'query-results.csv');
          }
        });
      }
    }
    _restoreSqlQueryState();
  }
}

// ─── Memory panel rendering ──────────────────────────────────────────────────

let _memoryEditing = false;

async function renderMemoryPanel() {
  if (!_rightPanelVisible || _rightPanelActiveTab !== 'memory') return;

  const emptyEl = document.getElementById('memory-empty');
  const contentEl = document.getElementById('memory-content');
  const textEl = document.getElementById('memory-text');
  const editWrap = document.getElementById('memory-edit-wrap');
  const editBtn = document.getElementById('memory-edit-btn');

  // Get active tab
  const state = TabState.getState();
  const panelId = state.focusedPanelId;
  const panel = TabState.getPanel(panelId);
  const tab = panel ? TabState.getActiveTab(panelId) : null;

  if (!tab || !tab.filePath) {
    if (emptyEl) { emptyEl.textContent = 'No note selected'; emptyEl.classList.remove('hidden'); }
    if (contentEl) contentEl.classList.add('hidden');
    if (editWrap) editWrap.classList.add('hidden');
    if (editBtn) editBtn.style.display = 'none';
    return;
  }

  const noteId = noteIdFromPath(tab.filePath);
  let memory = null;
  try {
    memory = await window.storageInspector.readMemory(noteId);
  } catch { /* ignore */ }

  if (_memoryEditing) return; // don't clobber edit in progress

  if (memory) {
    if (emptyEl) emptyEl.classList.add('hidden');
    if (contentEl) contentEl.classList.remove('hidden');
    if (textEl) textEl.innerHTML = window.renderMarkdown(memory);
    if (editBtn) editBtn.style.display = '';
  } else {
    if (emptyEl) { emptyEl.textContent = 'No memory for this note'; emptyEl.classList.remove('hidden'); }
    if (contentEl) contentEl.classList.add('hidden');
    if (editBtn) editBtn.style.display = '';
  }
  if (editWrap) editWrap.classList.add('hidden');
}

// Memory panel edit handlers
(function() {
  const editBtn = document.getElementById('memory-edit-btn');
  const saveBtn = document.getElementById('memory-save-btn');
  const cancelBtn = document.getElementById('memory-cancel-btn');
  const textarea = document.getElementById('memory-edit-textarea');
  const contentEl = document.getElementById('memory-content');
  const editWrap = document.getElementById('memory-edit-wrap');
  const emptyEl = document.getElementById('memory-empty');

  if (editBtn) editBtn.addEventListener('click', async () => {
    // Get current memory text to prefill
    const state = TabState.getState();
    const panelId = state.focusedPanelId;
    const panel = TabState.getPanel(panelId);
    const tab = panel ? TabState.getActiveTab(panelId) : null;
    if (!tab || !tab.filePath) return;
    const noteId = noteIdFromPath(tab.filePath);
    let memory = null;
    try { memory = await window.storageInspector.readMemory(noteId); } catch {}
    if (textarea) textarea.value = memory || '';
    _memoryEditing = true;
    if (contentEl) contentEl.classList.add('hidden');
    if (emptyEl) emptyEl.classList.add('hidden');
    if (editWrap) editWrap.classList.remove('hidden');
    editBtn.style.display = 'none';
    if (textarea) textarea.focus();
  });

  if (cancelBtn) cancelBtn.addEventListener('click', () => {
    _memoryEditing = false;
    if (editWrap) editWrap.classList.add('hidden');
    renderMemoryPanel();
  });

  if (saveBtn) saveBtn.addEventListener('click', async () => {
    const state = TabState.getState();
    const panelId = state.focusedPanelId;
    const panel = TabState.getPanel(panelId);
    const tab = panel ? TabState.getActiveTab(panelId) : null;
    if (!tab || !tab.filePath) return;
    const noteId = noteIdFromPath(tab.filePath);
    const text = textarea ? textarea.value : '';
    try {
      await window.storageInspector.writeMemory(noteId, text);
    } catch (err) {
      console.error('Failed to save memory:', err);
    }
    _memoryEditing = false;
    if (editWrap) editWrap.classList.add('hidden');
    renderMemoryPanel();
  });
})();

// ─── Scripts panel rendering (feature 110) ────────────────────────────────────

function _formatElapsed(ms) {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return min > 0 ? `${min}:${String(sec).padStart(2, '0')}` : `${sec}s`;
}

function _updateScriptsElapsed() {
  const now = Date.now();
  for (const entry of _scriptsRunningCache) {
    const el = document.getElementById(`scripts-run-elapsed-${entry.runId}`);
    if (el) el.textContent = _formatElapsed(now - entry.startedAt);
  }
}

function _startScriptsRunningTimer() {
  if (_scriptsRunningTimer) return;
  _scriptsRunningTimer = setInterval(_updateScriptsElapsed, 1000);
}

function _stopScriptsRunningTimer() {
  clearInterval(_scriptsRunningTimer);
  _scriptsRunningTimer = null;
}

async function renderScriptsRunning() {
  const sectionEl = document.getElementById('scripts-running-section');
  const listEl = document.getElementById('scripts-running-list');
  const badgeEl = document.getElementById('scripts-running-count-badge');
  if (!sectionEl || !listEl) return;

  let running;
  try {
    running = await window.storageInspector.listRunning();
  } catch {
    running = [];
  }

  _scriptsRunningCache = running;

  if (!running.length) {
    sectionEl.classList.add('hidden');
    listEl.innerHTML = '';
    if (badgeEl) badgeEl.textContent = '';
    _stopScriptsRunningTimer();
    return;
  }

  sectionEl.classList.remove('hidden');
  if (badgeEl) badgeEl.textContent = running.length;
  listEl.innerHTML = '';
  const now = Date.now();

  for (const entry of running) {
    const row = document.createElement('div');
    row.className = 'scripts-running-row';

    const nameEl = document.createElement('span');
    nameEl.className = 'scripts-running-name';
    nameEl.textContent = entry.scriptName;
    nameEl.title = `${entry.noteId} / ${entry.scriptName}`;

    const elapsedEl = document.createElement('span');
    elapsedEl.className = 'scripts-running-elapsed';
    elapsedEl.id = `scripts-run-elapsed-${entry.runId}`;
    elapsedEl.textContent = _formatElapsed(now - entry.startedAt);

    const stopBtn = document.createElement('button');
    stopBtn.className = 'scripts-stop-btn';
    stopBtn.textContent = 'Stop';
    stopBtn.title = 'Stop this script';
    stopBtn.addEventListener('click', async () => {
      try {
        await window.storageInspector.stopScript(entry.runId);
      } catch (err) {
        console.error('Failed to stop script:', err);
      }
    });

    row.appendChild(nameEl);
    row.appendChild(elapsedEl);
    row.appendChild(stopBtn);
    listEl.appendChild(row);
  }

  _startScriptsRunningTimer();
}

async function renderScriptsPanel() {
  if (!_rightPanelVisible || _rightPanelActiveTab !== 'scripts') return;

  renderScriptsEnv();
  renderScriptsRunning();

  const emptyEl = document.getElementById('scripts-empty');
  const listEl = document.getElementById('scripts-list');
  const badgeEl = document.getElementById('scripts-collection-count-badge');

  const state = TabState.getState();
  const panelId = state.focusedPanelId;
  const panel = TabState.getPanel(panelId);
  const tab = panel ? TabState.getActiveTab(panelId) : null;

  if (!tab || !tab.filePath) {
    if (emptyEl) { emptyEl.textContent = 'No note selected'; emptyEl.classList.remove('hidden'); }
    if (listEl) { listEl.classList.add('hidden'); listEl.innerHTML = ''; }
    if (badgeEl) badgeEl.textContent = '';
    return;
  }

  const noteId = noteIdFromPath(tab.filePath);
  const gen = ++_scriptsRenderGen;

  let scripts;
  try {
    scripts = await window.storageInspector.listScripts(noteId);
  } catch {
    scripts = [];
  }

  if (gen !== _scriptsRenderGen) return;

  if (!scripts || scripts.length === 0) {
    if (emptyEl) { emptyEl.textContent = 'No scripts found'; emptyEl.classList.remove('hidden'); }
    if (listEl) { listEl.classList.add('hidden'); listEl.innerHTML = ''; }
    if (badgeEl) badgeEl.textContent = '';
    return;
  }

  if (emptyEl) emptyEl.classList.add('hidden');
  if (badgeEl) badgeEl.textContent = scripts.length;
  if (!listEl) return;
  listEl.classList.remove('hidden');
  listEl.innerHTML = '';

  for (const script of scripts) {
    const row = document.createElement('div');
    row.className = 'scripts-row';

    const nameEl = document.createElement('span');
    nameEl.className = 'scripts-name';
    nameEl.textContent = script.name;
    nameEl.title = script.name;

    const sizeEl = document.createElement('span');
    sizeEl.className = 'scripts-size';
    sizeEl.textContent = formatBytes(script.size || 0);

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'scripts-toggle' + (script.approved ? ' approved' : '');
    toggleBtn.textContent = script.approved ? 'Approved' : 'Not approved';
    toggleBtn.title = script.approved ? 'Click to revoke approval' : 'Click to approve this script';
    toggleBtn.addEventListener('click', async () => {
      try {
        if (script.approved) {
          await window.storageInspector.revokeScript(noteId, script.name);
        } else {
          await window.storageInspector.approveScript(noteId, script.name);
        }
        renderScriptsPanel();
      } catch (err) {
        console.error('Script approval toggle failed:', err);
      }
    });

    row.appendChild(nameEl);
    row.appendChild(sizeEl);
    row.appendChild(toggleBtn);
    listEl.appendChild(row);
  }
}

// ─── Per-note script environment config ───────────────────────────────────────

async function renderScriptsEnv() {
  const container = document.getElementById('scripts-env-content');
  if (!container) return;

  const state = TabState.getState();
  const panelId = state.focusedPanelId;
  const panel = TabState.getPanel(panelId);
  const tab = panel ? TabState.getActiveTab(panelId) : null;

  if (!tab || !tab.filePath) {
    container.innerHTML = '<div class="scripts-env-empty">No note selected</div>';
    return;
  }

  const noteId = noteIdFromPath(tab.filePath);
  let envConfig, detected, systemDefault;
  try {
    const [env, detectResult] = await Promise.all([
      window.storageInspector.getScriptEnv(noteId),
      window.storageInspector.detectScriptEnv(noteId),
    ]);
    envConfig = env;
    detected = detectResult.detected || [];
    systemDefault = detectResult.systemDefault || { name: 'System default' };
  } catch {
    envConfig = null;
    detected = [];
    systemDefault = { name: 'System default' };
  }

  container.innerHTML = '';

  const row = document.createElement('div');
  row.className = 'scripts-env-row';

  const label = document.createElement('span');
  label.className = 'scripts-env-label';
  label.textContent = 'Python:';

  const value = document.createElement('span');
  value.className = 'scripts-env-value';
  if (envConfig && envConfig.pythonPath) {
    value.textContent = envConfig.pythonPath.replace(/.*\/\.venv\//, '.venv/');
    value.title = envConfig.pythonPath;
  } else {
    value.textContent = systemDefault.name;
    value.title = systemDefault.venv || systemDefault.name;
  }

  row.appendChild(label);
  row.appendChild(value);

  // Edit button
  const editBtn = document.createElement('button');
  editBtn.className = 'scripts-env-btn';
  editBtn.textContent = 'Edit';
  editBtn.title = 'Set a custom Python path or venv';
  editBtn.addEventListener('click', () => {
    const current = (envConfig && envConfig.pythonPath) || '';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'scripts-env-input';
    input.value = current;
    input.placeholder = 'e.g. /path/to/.venv/bin/python3';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'scripts-env-btn';
    saveBtn.textContent = 'Save';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'scripts-env-btn secondary';
    cancelBtn.textContent = 'Cancel';

    const inputRow = document.createElement('div');
    inputRow.className = 'scripts-env-input-row';
    inputRow.appendChild(input);
    inputRow.appendChild(saveBtn);
    inputRow.appendChild(cancelBtn);

    container.innerHTML = '';
    container.appendChild(inputRow);
    input.focus();

    saveBtn.addEventListener('click', async () => {
      const val = input.value.trim();
      try {
        if (val) {
          await window.storageInspector.setScriptEnv(noteId, { pythonPath: val, type: 'custom' });
        } else {
          await window.storageInspector.setScriptEnv(noteId, null);
        }
      } catch (err) {
        console.error('Failed to save script env:', err);
      }
      renderScriptsEnv();
    });

    cancelBtn.addEventListener('click', () => renderScriptsEnv());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveBtn.click();
      if (e.key === 'Escape') cancelBtn.click();
    });
  });
  row.appendChild(editBtn);

  // Reset button (only if custom env is set)
  if (envConfig && envConfig.pythonPath) {
    const resetBtn = document.createElement('button');
    resetBtn.className = 'scripts-env-btn secondary';
    resetBtn.textContent = 'Reset';
    resetBtn.title = 'Reset to system default';
    resetBtn.addEventListener('click', async () => {
      try {
        await window.storageInspector.setScriptEnv(noteId, null);
      } catch (err) {
        console.error('Failed to reset script env:', err);
      }
      renderScriptsEnv();
    });
    row.appendChild(resetBtn);
  }

  container.appendChild(row);

  // Show auto-detected venvs if no custom config is set
  if (!envConfig && detected.length > 0) {
    for (const d of detected) {
      const hint = document.createElement('div');
      hint.className = 'scripts-env-detected';
      const text = document.createElement('span');
      text.textContent = `Detected: ${d.label}`;
      const useBtn = document.createElement('button');
      useBtn.className = 'scripts-env-btn';
      useBtn.textContent = 'Use';
      useBtn.addEventListener('click', async () => {
        try {
          await window.storageInspector.setScriptEnv(noteId, { pythonPath: d.pythonPath, type: 'venv' });
        } catch (err) {
          console.error('Failed to set detected env:', err);
        }
        renderScriptsEnv();
      });
      hint.appendChild(text);
      hint.appendChild(useBtn);
      container.appendChild(hint);
    }
  }
}

// ─── Scripts section collapse toggles ─────────────────────────────────────────

function _toggleScriptsSection(headerEl, bodyEl, toggleEl) {
  const isCollapsed = bodyEl.classList.contains('collapsed');
  if (isCollapsed) {
    bodyEl.classList.remove('collapsed');
    headerEl.setAttribute('aria-expanded', 'true');
    toggleEl.classList.add('expanded');
  } else {
    bodyEl.classList.add('collapsed');
    headerEl.setAttribute('aria-expanded', 'false');
    toggleEl.classList.remove('expanded');
  }
}

['scripts-env', 'scripts-running', 'scripts-collection'].forEach(prefix => {
  const headerEl = document.getElementById(`${prefix}-header`);
  const bodyEl = document.getElementById(`${prefix}-body`);
  const toggleEl = document.getElementById(`${prefix}-toggle`);
  if (!headerEl || !bodyEl || !toggleEl) return;
  headerEl.addEventListener('click', () => _toggleScriptsSection(headerEl, bodyEl, toggleEl));
  headerEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      _toggleScriptsSection(headerEl, bodyEl, toggleEl);
    }
  });
});

// ─── Logs panel rendering ────────────────────────────────────────────────────

function _updateLogsToggleBtn() {
  const btn = document.getElementById('logs-toggle-btn');
  if (!btn) return;
  btn.textContent = _loggingEnabled ? 'Logging: On' : 'Logging: Off';
  btn.classList.toggle('logs-toggle-off', !_loggingEnabled);
}

(function() {
  const btn = document.getElementById('logs-toggle-btn');
  if (btn) btn.addEventListener('click', async () => {
    _loggingEnabled = !_loggingEnabled;
    await window.storageInspector.setLoggingEnabled(_loggingEnabled);
    _updateLogsToggleBtn();
  });
})();

async function renderLogsPanel() {
  if (!_rightPanelVisible || _rightPanelActiveTab !== 'logs') {
    _stopLogsRefresh();
    return;
  }

  // Sync toggle state from main process
  try { _loggingEnabled = await window.storageInspector.getLoggingEnabled(); } catch {}
  _updateLogsToggleBtn();

  const emptyEl = document.getElementById('logs-empty');
  const fileListEl = document.getElementById('logs-file-list');
  const selectorEl = document.getElementById('logs-file-selector');
  const contentEl = document.getElementById('logs-content');

  const state = TabState.getState();
  const panelId = state.focusedPanelId;
  const panel = TabState.getPanel(panelId);
  const tab = panel ? TabState.getActiveTab(panelId) : null;

  if (!tab || !tab.filePath) {
    if (emptyEl) { emptyEl.textContent = 'No note selected'; emptyEl.classList.remove('hidden'); }
    if (fileListEl) fileListEl.classList.add('hidden');
    _stopLogsRefresh();
    return;
  }

  const noteId = noteIdFromPath(tab.filePath);
  const gen = ++_logsRenderGen;

  let logFiles;
  try {
    logFiles = await window.storageInspector.listLogs(noteId);
  } catch { logFiles = []; }

  if (gen !== _logsRenderGen) return;

  if (!logFiles || logFiles.length === 0) {
    if (emptyEl) { emptyEl.textContent = 'No logs found'; emptyEl.classList.remove('hidden'); }
    if (fileListEl) fileListEl.classList.add('hidden');
    _startLogsRefresh();
    return;
  }

  if (emptyEl) emptyEl.classList.add('hidden');
  if (fileListEl) fileListEl.classList.remove('hidden');

  // Build file selector buttons
  if (selectorEl) {
    selectorEl.innerHTML = '';
    if (!_logsSelectedFile || !logFiles.find(f => f.name === _logsSelectedFile)) {
      const frontendLog = logFiles.find(f => f.name === 'frontend.log');
      _logsSelectedFile = frontendLog ? 'frontend.log' : logFiles[0].name;
    }
    for (const lf of logFiles) {
      const btn = document.createElement('button');
      btn.className = 'logs-file-btn' + (lf.name === _logsSelectedFile ? ' active' : '');
      btn.textContent = lf.name.replace(/\.log$/, '');
      btn.addEventListener('click', () => {
        _logsSelectedFile = lf.name;
        renderLogsPanel();
      });
      selectorEl.appendChild(btn);
    }
    const clearBtn = document.createElement('button');
    clearBtn.className = 'logs-clear-btn';
    clearBtn.textContent = 'Clear';
    clearBtn.addEventListener('click', async () => {
      if (_logsSelectedFile) {
        await window.storageInspector.clearLog(noteId, _logsSelectedFile);
        renderLogsPanel();
      }
    });
    selectorEl.appendChild(clearBtn);
  }

  // Load selected log content
  if (contentEl && _logsSelectedFile) {
    try {
      const content = await window.storageInspector.readLog(noteId, _logsSelectedFile);
      if (gen === _logsRenderGen) {
        contentEl.textContent = content || '(empty)';
        const wrap = document.getElementById('logs-content-wrap');
        if (wrap) wrap.scrollTop = wrap.scrollHeight;
      }
    } catch {
      contentEl.textContent = '(error reading log)';
    }
  }

  _startLogsRefresh();
}

function _startLogsRefresh() {
  if (_logsRefreshTimer) return;
  _logsRefreshTimer = setInterval(() => {
    if (_rightPanelVisible && _rightPanelActiveTab === 'logs') {
      renderLogsPanel();
    } else {
      _stopLogsRefresh();
    }
  }, 3000);
}

function _stopLogsRefresh() {
  if (_logsRefreshTimer) { clearInterval(_logsRefreshTimer); _logsRefreshTimer = null; }
}

// ─── Backlinks section rendering ──────────────────────────────────────────────

async function renderBacklinksSection() {
  const sectionEl = document.getElementById('backlinks-section');
  if (!sectionEl) return;
  if (!_rightPanelVisible || _rightPanelActiveTab !== 'outline') return; // skip work when panel is hidden

  const emptyEl = document.getElementById('backlinks-empty');
  const listEl = document.getElementById('backlinks-list');
  const countEl = document.getElementById('backlinks-count');

  const state = TabState.getState();
  const panelId = state.focusedPanelId;
  const panel = TabState.getPanel(panelId);
  const tab = panel ? TabState.getActiveTab(panelId) : null;

  if (!tab || !tab.filePath) {
    if (emptyEl) { emptyEl.textContent = 'No note selected'; emptyEl.classList.remove('hidden'); }
    if (listEl) listEl.classList.add('hidden');
    if (countEl) countEl.textContent = '';
    return;
  }

  const filePath = tab.filePath;

  // Capture generation before the async IPC call — guards against stale renders
  const gen = ++_backlinksRenderGen;

  let backlinks;
  if (_backlinksCache.has(filePath)) {
    backlinks = _backlinksCache.get(filePath);
  } else {
    try {
      backlinks = await window.api.getBacklinks(filePath);
    } catch {
      backlinks = [];
    }
    if (gen !== _backlinksRenderGen) return; // stale — newer render has started
    _backlinksCache.set(filePath, backlinks);
  }

  if (gen !== _backlinksRenderGen) return; // stale check after cache set

  if (!backlinks || backlinks.length === 0) {
    if (emptyEl) { emptyEl.textContent = 'No backlinks'; emptyEl.classList.remove('hidden'); }
    if (listEl) listEl.classList.add('hidden');
    if (countEl) countEl.textContent = '';
    return;
  }

  if (emptyEl) emptyEl.classList.add('hidden');
  if (countEl) countEl.textContent = `(${backlinks.length})`;
  if (listEl) {
    listEl.classList.remove('hidden');
    listEl.innerHTML = '';
    for (const relPath of backlinks) {
      const li = document.createElement('li');
      li.className = 'backlinks-item';
      // Display name: derive workspace-relative path, strip .html, show folder structure
      const rel = currentWorkspacePath && relPath.startsWith(currentWorkspacePath)
        ? relPath.slice(currentWorkspacePath.length + 1)
        : relPath.split('/').pop();
      const displayName = rel.replace(/\.html$/i, '').replace(/[/\\]/g, ' / ');
      li.textContent = displayName;
      li.title = relPath;
      li.addEventListener('click', () => selectNote(relPath));
      listEl.appendChild(li);
    }
  }
}

// ─── Graph View (feature 127) ─────────────────────────────────────────────────

async function openGraphView() {
  const modal = document.getElementById('graph-modal');
  if (!modal) return;
  modal.classList.remove('hidden');

  // Determine the active note path for highlighting
  const state = TabState.getState();
  const panel = TabState.getPanel(state.focusedPanelId);
  const tab = panel ? TabState.getActiveTab(state.focusedPanelId) : null;
  const activeNotePath = tab ? tab.filePath : null;

  let data;
  try {
    data = await window.api.getGraphData();
  } catch (err) {
    console.error('[graph-view] getGraphData failed:', err);
    data = { nodes: [], edges: [] };
  }

  // Guard: modal may have been closed while IPC was in flight
  if (modal.classList.contains('hidden')) return;

  renderGraph(data.nodes, data.edges, activeNotePath);
}

function renderGraph(nodes, edges, activeNotePath) {
  const canvas = document.getElementById('graph-canvas');
  if (!canvas) return;

  // Stop any previous simulation
  if (_graphSimulation) { _graphSimulation.stop(); _graphSimulation = null; }
  canvas.innerHTML = '';

  // Empty state
  if (!nodes || nodes.length === 0) {
    const msg = document.createElement('div');
    msg.id = 'graph-empty-msg';
    msg.textContent = 'No notes in workspace';
    canvas.appendChild(msg);
    return;
  }

  const W = canvas.clientWidth || 800;
  const H = canvas.clientHeight || 600;

  // Adaptive force parameters based on workspace size
  const n = nodes.length;
  const chargeStrength = n < 20 ? -350 : n < 100 ? -220 : -120;
  const linkDistance   = n < 20 ? 130  : n < 100 ? 85   : 55;
  const nodeRadius     = n < 100 ? 7 : 5;
  const activeRadius   = nodeRadius + 3;

  // Create SVG
  const svg = d3.select(canvas)
    .append('svg')
    .attr('width', W)
    .attr('height', H);

  const g = svg.append('g'); // transform target for zoom

  // Zoom behaviour
  const zoom = d3.zoom()
    .scaleExtent([0.05, 6])
    .on('zoom', (event) => g.attr('transform', event.transform));
  svg.call(zoom);

  // --- Edges ---
  const edgeGroup = g.append('g').attr('class', 'graph-edges');
  const edgeSel = edgeGroup.selectAll('line')
    .data(edges)
    .join('line');

  // --- Nodes ---
  const nodeGroup = g.append('g').attr('class', 'graph-nodes');
  const nodeSel = nodeGroup.selectAll('circle')
    .data(nodes)
    .join('circle')
    .attr('r', d => d.id === activeNotePath ? activeRadius : nodeRadius)
    .classed('graph-node-active', d => d.id === activeNotePath)
    .call(
      d3.drag()
        .on('start', (event, d) => {
          if (!event.active) _graphSimulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on('drag', (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on('end', (event, d) => {
          if (!event.active) _graphSimulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        })
    )
    .on('click', (event, d) => {
      event.stopPropagation();
      closeGraphView();
      selectNote(d.path, d.title);
    });

  // --- Labels ---
  const labelGroup = g.append('g').attr('class', 'graph-labels');
  const labelSel = labelGroup.selectAll('text')
    .data(nodes)
    .join('text')
    .attr('dy', nodeRadius + 13)
    .attr('text-anchor', 'middle')
    .classed('graph-label-active', d => d.id === activeNotePath)
    .text(d => d.title.length > 25 ? d.title.slice(0, 24) + '\u2026' : d.title);

  // --- Force simulation ---
  _graphSimulation = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(edges).id(d => d.id).distance(linkDistance))
    .force('charge', d3.forceManyBody().strength(chargeStrength))
    .force('center', d3.forceCenter(W / 2, H / 2))
    .force('collision', d3.forceCollide().radius(nodeRadius + 6))
    .on('tick', () => {
      edgeSel
        .attr('x1', d => d.source.x)
        .attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x)
        .attr('y2', d => d.target.y);
      nodeSel
        .attr('cx', d => d.x)
        .attr('cy', d => d.y);
      labelSel
        .attr('x', d => d.x)
        .attr('y', d => d.y);
    });
}

function closeGraphView() {
  const modal = document.getElementById('graph-modal');
  if (modal) modal.classList.add('hidden');
  if (_graphSimulation) { _graphSimulation.stop(); _graphSimulation = null; }
  const canvas = document.getElementById('graph-canvas');
  if (canvas) canvas.innerHTML = '';
}

function renderOutlineNodes(entries, parentUl, collapsedIds, filePath, panelId) {
  for (const entry of entries) {
    const li = document.createElement('li');

    const itemEl = document.createElement('div');
    itemEl.className = 'outline-item';
    itemEl.dataset.level = entry.level;
    itemEl.dataset.headingId = entry.id;
    itemEl.title = entry.text;

    const hasChildren = entry.children && entry.children.length > 0;

    // Build childUl first so toggle's closure can reference it
    let childUl = null;
    if (hasChildren) {
      childUl = document.createElement('ul');
      if (collapsedIds.has(entry.id)) {
        childUl.classList.add('hidden');
      }
      renderOutlineNodes(entry.children, childUl, collapsedIds, filePath, panelId);
    }

    if (hasChildren) {
      const toggle = document.createElement('span');
      toggle.className = 'outline-toggle';
      toggle.textContent = '\u25B6';
      if (!collapsedIds.has(entry.id)) toggle.classList.add('expanded');
      itemEl.appendChild(toggle);

      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const nowCollapsed = collapsedIds.has(entry.id);
        if (nowCollapsed) {
          collapsedIds.delete(entry.id);
        } else {
          collapsedIds.add(entry.id);
        }
        toggle.classList.toggle('expanded', nowCollapsed);
        childUl.classList.toggle('hidden', !nowCollapsed);
        if (filePath) saveOutlineCollapseState(filePath);
      });
    } else {
      const spacer = document.createElement('span');
      spacer.className = 'outline-toggle-spacer';
      itemEl.appendChild(spacer);
    }

    const textSpan = document.createElement('span');
    textSpan.className = 'outline-item-text';
    textSpan.textContent = entry.text;
    itemEl.appendChild(textSpan);

    itemEl.addEventListener('click', () => {
      scrollToHeading(getWebviewForPanel(panelId), entry.id);
    });
    li.appendChild(itemEl);

    if (childUl) li.appendChild(childUl);

    parentUl.appendChild(li);
  }
}

// ─── Conflict Resolution Panel (feature 73) ──────────────────────────────────

const _CONFLICT_WARNING_SVG = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8.982 1.566a1.13 1.13 0 0 0-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767zM8 5c.535 0 .954.462.9.995l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 5.995A.905.905 0 0 1 8 5m.002 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2"/></svg>';

function _renderConflictPanel(containerEl, filePath) {
  const entry = _conflictData.find(c => c.filePath === filePath);
  if (!entry) return;

  const { localContent, remoteContent } = entry;
  const idx = _conflictData.indexOf(entry);
  const total = _conflictData.length;
  const fileName = filePath.split('/').pop();

  const isText = (c) => c === null || typeof c === 'string';
  const localIsText = isText(localContent);
  const remoteIsText = isText(remoteContent);

  function sideHtml(content, isTextContent, label, btnClass, btnLabel) {
    const bodyHtml = content === null
      ? '<p class="conflict-absent">File does not exist on this side</p>'
      : (isTextContent
          ? `<pre>${escapeHtml(content)}</pre>`
          : '<p class="conflict-absent">Binary file \u2014 cannot display</p>');
    const keepBtn = (isTextContent && content !== null)
      ? `<button class="${btnClass} btn-primary">${btnLabel}</button>`
      : '';
    return `<div class="conflict-side">
      <div class="conflict-side-header"><span>${label}</span>${keepBtn}</div>
      <div class="conflict-side-content">${bodyHtml}</div>
    </div>`;
  }

  const canEdit = localIsText && remoteIsText;

  containerEl.innerHTML = `<div class="conflict-panel" data-file-path="${escapeHtml(filePath)}">
  <div class="conflict-header">
    <span class="conflict-file-name">${escapeHtml(fileName)}</span>
    <span class="conflict-status">${idx + 1} of ${total} conflict${total !== 1 ? 's' : ''}</span>
  </div>
  <div class="conflict-body">
    ${sideHtml(localContent, localIsText, 'Local Version', 'conflict-keep-local', 'Keep Local')}
    ${sideHtml(remoteContent, remoteIsText, 'Remote Version', 'conflict-keep-remote', 'Keep Remote')}
  </div>
  <div class="conflict-footer">
    ${canEdit ? '<button class="conflict-open-editor btn-secondary">Open in Editor</button>' : ''}
    <span class="conflict-nav">
      <button class="conflict-prev"${idx === 0 ? ' disabled' : ''}>\u2190 Previous</button>
      <button class="conflict-next"${idx === total - 1 ? ' disabled' : ''}>Next \u2192</button>
    </span>
  </div>
</div>`;

  const panel = containerEl.querySelector('.conflict-panel');

  const keepLocalBtn = panel.querySelector('.conflict-keep-local');
  if (keepLocalBtn) keepLocalBtn.addEventListener('click', () => _resolveConflictFromUI(filePath, localContent));

  const keepRemoteBtn = panel.querySelector('.conflict-keep-remote');
  if (keepRemoteBtn) keepRemoteBtn.addEventListener('click', () => _resolveConflictFromUI(filePath, remoteContent));

  const openEditorBtn = panel.querySelector('.conflict-open-editor');
  if (openEditorBtn) {
    openEditorBtn.addEventListener('click', () => {
      _showConflictEditor(containerEl, filePath, localContent !== null ? localContent : remoteContent);
    });
  }

  const prevBtn = panel.querySelector('.conflict-prev');
  if (prevBtn) prevBtn.addEventListener('click', () => {
    if (idx > 0) _selectConflictFile(_conflictData[idx - 1].filePath);
  });

  const nextBtn = panel.querySelector('.conflict-next');
  if (nextBtn) nextBtn.addEventListener('click', () => {
    if (idx < total - 1) _selectConflictFile(_conflictData[idx + 1].filePath);
  });
}

function _showConflictEditor(containerEl, filePath, initialContent) {
  const panel = containerEl.querySelector('.conflict-panel');
  if (!panel) return;

  const body = panel.querySelector('.conflict-body');
  if (body) {
    body.innerHTML = `<div class="conflict-editor-wrapper">
      <textarea class="conflict-editor">${escapeHtml(initialContent || '')}</textarea>
    </div>`;
  }

  const footer = panel.querySelector('.conflict-footer');
  if (footer) {
    footer.innerHTML =
      '<button class="conflict-save-resolution btn-primary">Save Resolution</button>' +
      '<button class="conflict-cancel-editor btn-secondary">Cancel</button>';
    footer.querySelector('.conflict-save-resolution').addEventListener('click', () => {
      const ta = containerEl.querySelector('.conflict-editor');
      _resolveConflictFromUI(filePath, ta ? ta.value : '');
    });
    footer.querySelector('.conflict-cancel-editor').addEventListener('click', () => {
      _renderConflictPanel(containerEl, filePath);
    });
  }
}

async function _resolveConflictFromUI(filePath, chosenContent) {
  const result = await window.api.resolveConflict(filePath, chosenContent);
  if (!result || !result.ok) return;

  _conflictData = _conflictData.filter(c => c.filePath !== filePath);
  _conflictPaths.delete(filePath);

  _updateSidebarConflictRow(filePath, false);

  if (_conflictData.length === 0) {
    ConflictBanner.hide();
    _showSyncToast('All conflicts resolved \u2014 changes synced.');
    _refreshAllConflictPanels();
  } else {
    ConflictBanner.updateCount(_conflictData.length);
    _selectConflictFile(_conflictData[0].filePath);
  }
}

function _selectConflictFile(filePath) {
  const fileName = filePath.split('/').pop();
  selectNote(filePath, fileName);
  requestAnimationFrame(() => {
    const li = document.querySelector(`.tree-file[data-path="${filePath}"]`);
    if (li) li.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
}

function _updateSidebarConflictRow(filePath, isConflict) {
  const li = document.querySelector(`.tree-file[data-path="${filePath}"]`);
  if (!li) return;
  const row = li.querySelector('.tree-row');
  if (!row) return;
  if (isConflict) {
    row.classList.add('tree-row--conflict');
    if (!row.querySelector('.conflict-indicator')) {
      const indicator = document.createElement('span');
      indicator.className = 'conflict-indicator';
      indicator.title = 'Sync conflict';
      indicator.innerHTML = _CONFLICT_WARNING_SVG;
      row.appendChild(indicator);
    }
  } else {
    row.classList.remove('tree-row--conflict');
    row.querySelector('.conflict-indicator')?.remove();
  }
}

function _refreshAllConflictPanels() {
  const allPanels = document.querySelectorAll('.panel[data-panel-id]');
  for (const panelEl of allPanels) {
    const container = panelEl.querySelector('.conflict-panel-container');
    if (container && !container.classList.contains('hidden')) {
      loadContentForTab(panelEl.dataset.panelId);
    }
  }
}

function _showSyncToast(message) {
  const toast = document.createElement('div');
  toast.className = 'sync-toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('sync-toast--visible'));
  setTimeout(() => {
    toast.classList.remove('sync-toast--visible');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function _showErrorToast(message) {
  const toast = document.createElement('div');
  toast.className = 'error-toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('error-toast--visible'));
  setTimeout(() => {
    toast.classList.remove('error-toast--visible');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// --- Panel-aware content loading ---

async function loadContentForTab(panelId) {
  const panelEl = document.querySelector(`.panel[data-panel-id="${panelId}"]`);
  if (!panelEl) return;
  const containerEl = panelEl.querySelector('.webview-container');
  const emptyStateEl = panelEl.querySelector('.empty-state');
  const conflictPanelContainerEl = panelEl.querySelector('.conflict-panel-container');

  updateSidebarHighlight();
  const tab = TabState.getActiveTab(panelId);

  // Hide all webviews in this panel
  if (containerEl) containerEl.querySelectorAll('webview').forEach(wv => wv.classList.add('hidden'));

  if (!tab) {
    if (emptyStateEl) emptyStateEl.classList.remove("hidden");
    renderOutlinePanel();
    renderBacklinksSection();
    updateBreadcrumb(panelId);
    return;
  }

  const tabId = tab.id;
  const filePath = tab.filePath;

  // ─── Conflict resolution view (feature 73) ───────────────────────────────
  if (_conflictPaths.has(filePath)) {
    if (emptyStateEl) emptyStateEl.classList.add('hidden');
    if (conflictPanelContainerEl) {
      conflictPanelContainerEl.classList.remove('hidden');
      _renderConflictPanel(conflictPanelContainerEl, filePath);
    }
    updateBreadcrumb(panelId);
    return;
  }
  // Hide conflict panel if visible but file is no longer in conflict
  if (conflictPanelContainerEl && !conflictPanelContainerEl.classList.contains('hidden')) {
    conflictPanelContainerEl.classList.add('hidden');
    conflictPanelContainerEl.innerHTML = '';
  }

  // Check if this tab already has a webview
  let webviewEl = getWebviewForTab(tabId);

  if (webviewEl) {
    // Tab already has a webview — just show it, no reload
    // Check if file was renamed (tab.filePath changed but tabId is same)
    const expectedSrc = _computeSrcForTab(tab);
    if (expectedSrc && webviewEl.src !== expectedSrc) {
      // File was renamed — need to re-navigate
      webviewEl.src = expectedSrc;
    }
    webviewEl.classList.remove('hidden');
    if (emptyStateEl) emptyStateEl.classList.add('hidden');
    // Refresh outline/breadcrumb from cached tab data
    renderOutlinePanel();
    renderBacklinksSection();
    updateBreadcrumb(panelId);
    return;
  }

  // ─── Create new webview for this tab ──────────────────────────────────────
  const src = _computeSrcForTab(tab);
  if (!src) return;

  webviewEl = createWebviewForTab(tabId, panelId);
  if (!webviewEl) return;

  // Wait for the webview guest to finish its initial about:blank load.
  const readyPromise = _webviewGuestReady.get(tabId);
  if (readyPromise) {
    await readyPromise;
    _webviewGuestReady.delete(tabId);
  }

  const gen = (_outlineGeneration.get(tabId) || 0) + 1;
  _outlineGeneration.set(tabId, gen);

  // Attach the one-shot dom-ready listener BEFORE setting src,
  // so it cannot be missed due to synchronous protocol handling.
  webviewEl.addEventListener('dom-ready', async () => {
    if (_outlineGeneration.get(tabId) !== gen) return;

    const headings = await extractHeadingsFromWebview(webviewEl);
    _outlineFlatEntries.set(tabId, headings);
    _outlineTrees.set(tabId, Outline.buildOutlineTree(headings));
    _activeHeadingId.set(tabId, null);
    renderOutlinePanel();
    renderBacklinksSection();
    updateBreadcrumb(panelId);

    if (_outlineGeneration.get(tabId) !== gen) return;

    webviewEl.executeJavaScript(SCROLL_TRACKER_SCRIPT).catch(() => {});
    webviewEl.executeJavaScript(SELECTION_LISTENER_SCRIPT).catch(() => {});
    webviewEl.executeJavaScript(LINK_CLICK_HANDLER_SCRIPT).catch(() => {});

    const currentTab = TabState.getActiveTab(panelId);
    if (currentTab && currentTab.pendingSearchQuery) {
      const q = currentTab.pendingSearchQuery;
      currentTab.pendingSearchQuery = null;
      applySearchHighlights(webviewEl, panelId, q);
    }
  }, { once: true });

  webviewEl.src = src;
  webviewEl.classList.remove('hidden');
  if (emptyStateEl) emptyStateEl.classList.add('hidden');
}

function _computeSrcForTab(tab) {
  const filePath = tab.filePath;
  const isNote = tab.type === 'note'
    || (!tab.type && currentTree && findNodeByPath(currentTree, filePath)?.type === 'note');
  const fileName = isNote ? 'index.html' : filePath.split('/').pop();
  const category = isNote ? 'html' : (tab.fileType || getFileCategory(fileName));
  const wsRelPath = (currentWorkspacePath && filePath.startsWith(currentWorkspacePath + '/'))
    ? filePath.slice(currentWorkspacePath.length + 1)
    : filePath.replace(/^\/+/, '');
  const effectivePath = isNote ? wsRelPath + '/index.html' : wsRelPath;
  const encodedPath = effectivePath.split('/').map(encodeURIComponent).join('/');

  if (category === 'html') return 'note://notes/' + encodedPath;
  if (category === 'text' || category === 'csv') return 'note://viewer/text/' + encodedPath;
  if (category === 'image') return 'note://viewer/image/' + encodedPath;
  if (category === 'pdf') return 'note://viewer/pdf/' + encodedPath;
  if (category === 'unknown') return 'note://viewer/trytext/' + encodedPath;
  return 'note://viewer/unsupported/' + encodeURIComponent(fileName);
}

async function initProviderDropdown() {
  const providers = await window.api.listProviders();
  aiProviderSelect.innerHTML = '';
  for (const p of providers) {
    const opt = document.createElement('option');
    opt.value = p.name;
    opt.textContent = p.label || p.name;
    aiProviderSelect.appendChild(opt);
  }
  const lastProvider = await window.api.getLastProvider();
  const fallbackProvider = aiProviderSelect.options[0]?.value || '';
  aiProviderSelect.value = aiProviderSelect.querySelector(`option[value="${lastProvider}"]`)
    ? lastProvider
    : fallbackProvider;
  await window.api.setActiveProvider(aiProviderSelect.value);
  await populateModelDropdown(aiProviderSelect.value);
  await populateEffortDropdown(aiProviderSelect.value);
  await populatePermissionDropdown(aiProviderSelect.value);
}

// Single shared subscription to github:stateChanged so each consumer (the
// publish popover, the settings Sharing tab, …) doesn't accumulate IPC
// listeners across open/close cycles. Defined here so all later consumers
// (SecuritySettings, PublishModal) see the binding.
const _githubStateBroadcaster = (() => {
  const listeners = new Set();
  let attached = false;
  return {
    add(cb) {
      if (!attached) {
        attached = true;
        window.api.onGithubStateChanged((state) => {
          listeners.forEach((fn) => { try { fn(state); } catch {} });
        });
      }
      listeners.add(cb);
    },
    remove(cb) { listeners.delete(cb); },
  };
})();

// ── App Settings Modal (gear icon in title bar) ──────────────────────────
//   Tab 1: Note Security
//   Tab 2: Sharing (gist-backed publishing)
const SecuritySettings = (() => {
  let _modal;
  const _keys = [
    { id: 'sec-allow-file-access',       key: 'allowFileAccess' },
    { id: 'sec-allow-external-network',   key: 'allowExternalNetwork' },
    { id: 'sec-allow-navigation',         key: 'allowNavigation' },
    { id: 'sec-allow-popups',             key: 'allowPopups' },
  ];

  function init() {
    _modal = document.getElementById('security-settings-modal');
    _modal.querySelector('.modal-backdrop').addEventListener('click', close);
    document.getElementById('security-settings-close').addEventListener('click', close);
    document.getElementById('security-settings-done').addEventListener('click', close);
    document.getElementById('security-settings-reset').addEventListener('click', resetDefaults);
    document.getElementById('settings-btn')?.addEventListener('click', open);

    // Save on every toggle change
    for (const { id } of _keys) {
      document.getElementById(id).addEventListener('change', save);
    }

    // Tab switching (Note Security / Sharing)
    _modal.querySelectorAll('.app-settings-tab').forEach((btn) => {
      btn.addEventListener('click', () => _switchTab(btn.dataset.appTab));
    });

    // Live-update the Sharing pane when GitHub state changes from anywhere
    // (popover, devtools, etc.)
    _githubStateBroadcaster.add((state) => {
      if (_modal.classList.contains('hidden')) return;
      const activePane = _modal.querySelector('.app-settings-pane:not(.hidden)');
      if (activePane && activePane.dataset.appPane === 'sharing') {
        _renderSharingPane(state);
      }
    });

    // Wire delegated clicks inside the sharing pane
    const sharingBody = document.getElementById('sharing-settings-body');
    sharingBody.addEventListener('click', _handleSharingClick);

    // Wire the repo-confirm modal (layered over Settings → Sharing)
    const confirmModal = document.getElementById('repo-confirm-modal');
    if (confirmModal) {
      confirmModal.addEventListener('click', _handleRepoConfirmClick);
      confirmModal.querySelector('.modal-backdrop')?.addEventListener('click', _pickDifferentName);
      confirmModal.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); _pickDifferentName(); }
      });
    }
  }

  function _switchTab(name) {
    _modal.querySelectorAll('.app-settings-tab').forEach((b) => {
      b.classList.toggle('app-settings-tab--active', b.dataset.appTab === name);
    });
    _modal.querySelectorAll('.app-settings-pane').forEach((p) => {
      p.classList.toggle('hidden', p.dataset.appPane !== name);
    });
    if (name === 'sharing') _renderSharingPane();
  }

  let _repoEditing = false;
  let _repoConfirmAvailable = null; // pending name string while user picks Create now / later / different
  let _repoWorking = false;
  let _repoSuccessFor = null; // repo name to display a "ready" check for, briefly after provisioning

  function _resetSharingState() {
    _repoEditing = false;
    _repoConfirmAvailable = null;
    _repoWorking = false;
    _repoSuccessFor = null;
  }

  async function _renderSharingPane(presetState) {
    const body = document.getElementById('sharing-settings-body');
    const state = presetState || await window.api.githubGetState();
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    if (!state || state.status === 'disconnected') {
      _resetSharingState();
      body.innerHTML = `
        <p class="sharing-tab-desc">
          Sharing publishes individual notes to your own GitHub account as gists, rendered through GitHub Pages.
          No toutkit servers in the path.
        </p>
        <div class="sharing-tab-actions">
          <button class="btn-primary" data-sharing-action="connect">Connect GitHub</button>
        </div>`;
      return;
    }

    if (state.status === 'connecting') {
      _resetSharingState();
      body.innerHTML = `
        <p class="sharing-tab-desc">Confirm this code in the GitHub page that just opened:</p>
        <p><span class="publish-device-code">${esc(state.userCode || '')}</span></p>
        <p class="sharing-tab-desc">Waiting for authorization…</p>
        <div class="sharing-tab-actions">
          <button class="btn-secondary" data-sharing-action="cancel-connect">Cancel</button>
        </div>`;
      return;
    }

    // connected
    const u = state.user || {};
    const statusHtml = `
      <div class="sharing-tab-status">
        <span class="sharing-tab-dot sharing-tab-dot--connected"></span>
        <span>Connected as <strong>@${esc(u.login || '')}</strong></span>
      </div>`;
    const disconnectHtml = `
      <div class="sharing-tab-actions">
        <button class="btn-secondary" data-sharing-action="disconnect">Disconnect GitHub</button>
      </div>`;

    if (_repoWorking) {
      body.innerHTML = `
        ${statusHtml}
        <div class="sharing-repo-block">
          <div class="publish-working">
            <div class="publish-spinner"></div>
            <span>Creating repo and enabling Pages…</span>
            <span class="publish-working-timer" id="repo-working-timer">0:00 / ~30s</span>
          </div>
        </div>
        ${disconnectHtml}`;
      return;
    }

    if (_repoSuccessFor) {
      body.innerHTML = `
        ${statusHtml}
        <div class="sharing-repo-block">
          <div class="publish-success">
            <span class="publish-checkmark" aria-hidden="true">&check;</span>
            <span>Repo <code>${esc(_repoSuccessFor)}</code> is ready.</span>
          </div>
        </div>
        ${disconnectHtml}`;
      return;
    }

    let repoValueHtml;
    if (_repoEditing) {
      const current = state.repoName || 'toutkit-shares';
      repoValueHtml = `
        <input type="text" id="sharing-repo-input" value="${esc(current)}" autocomplete="off" spellcheck="false" />
        <button class="sharing-tab-link-btn" data-sharing-action="save-repo">Save</button>
        <button class="sharing-tab-link-btn" data-sharing-action="cancel-repo">Cancel</button>`;
    } else if (state.repoName) {
      repoValueHtml = `<code>${esc(state.repoName)}</code> <button class="sharing-tab-link-btn" data-sharing-action="change-repo">Change…</button>`;
    } else {
      repoValueHtml = `<em>Not picked yet</em> <button class="sharing-tab-link-btn" data-sharing-action="change-repo">Pick…</button>`;
    }

    body.innerHTML = `
      ${statusHtml}
      <div class="sharing-tab-row">
        <span class="sharing-tab-row-label">Renderer repo</span>
        <span class="sharing-tab-row-value">${repoValueHtml}</span>
      </div>
      <p id="sharing-repo-validation" class="publish-validation hidden"></p>
      ${disconnectHtml}`;

    if (_repoEditing) {
      const input = document.getElementById('sharing-repo-input');
      input.focus();
      input.select();
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); _saveRepoEdit(); }
        else if (e.key === 'Escape') { e.preventDefault(); _repoEditing = false; _renderSharingPane(); }
      });
    }
  }

  async function _saveRepoEdit() {
    const input = document.getElementById('sharing-repo-input');
    const validation = document.getElementById('sharing-repo-validation');
    const setError = (msg) => {
      validation.textContent = msg;
      validation.classList.remove('hidden', 'publish-validation--info');
    };
    const setInfo = (msg) => {
      validation.textContent = msg;
      validation.classList.remove('hidden');
      validation.classList.add('publish-validation--info');
    };

    const next = (input?.value || '').trim();
    if (!/^[A-Za-z0-9_.-]{1,100}$/.test(next) || next === '.' || next === '..') {
      return setError('Use letters, numbers, dots, hyphens, underscores. Max 100 chars.');
    }
    if (input) input.disabled = true;
    setInfo('Checking…');
    const check = await window.api.githubCheckRepoName(next);
    if (input) input.disabled = false;
    if (!check || !check.ok) {
      setError((check && check.message) || 'Repo name not available.');
      input?.focus();
      return;
    }

    if (check.status === 'reusable') {
      // Existing toutkit-shares repo of theirs — save and proceed silently.
      const res = await window.api.githubSetRepoName(next);
      if (!res || !res.ok) {
        return setError((res && res.error) || 'Could not update repo name.');
      }
      _repoEditing = false;
      _renderSharingPane();
      _showSyncToast(`Repo set to "${next}" — reusing your existing renderer repo.`);
      return;
    }

    // status === 'available' — name is free. Open the confirmation modal
    // layered on top so the user can choose between create-now, defer, or rename.
    // Leave _repoEditing = true so the input remains visible underneath; if the
    // user dismisses the modal they land back in edit mode with their name typed.
    _repoConfirmAvailable = next;
    if (validation) {
      validation.textContent = '';
      validation.classList.add('hidden');
    }
    _showRepoConfirmModal(next);
  }

  async function _saveAvailableDeferred() {
    const name = _repoConfirmAvailable;
    if (!name) return;
    const res = await window.api.githubSetRepoName(name);
    _repoConfirmAvailable = null;
    if (!res || !res.ok) {
      _renderSharingPane();
      _showSyncToast(`Could not save repo name: ${(res && res.error) || 'unknown error'}`);
      return;
    }
    _renderSharingPane();
    _showSyncToast(`Repo set to "${name}" — will be created on your next publish.`);
  }

  async function _provisionRepoNow() {
    const name = _repoConfirmAvailable;
    if (!name) return;
    const setRes = await window.api.githubSetRepoName(name);
    if (!setRes || !setRes.ok) {
      _repoConfirmAvailable = null;
      _renderSharingPane();
      _showSyncToast(`Could not save repo name: ${(setRes && setRes.error) || 'unknown error'}`);
      return;
    }
    _repoConfirmAvailable = null;
    _repoWorking = true;
    _renderSharingPane();

    const startedAt = Date.now();
    const timerInterval = setInterval(() => {
      const el = document.getElementById('repo-working-timer');
      if (!el) return;
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      const m = Math.floor(elapsed / 60);
      const s = elapsed % 60;
      el.textContent = `${m}:${String(s).padStart(2, '0')} / ~30s`;
    }, 1000);

    const result = await window.api.githubProvisionRepo();
    clearInterval(timerInterval);
    _repoWorking = false;
    if (result && result.ok) {
      _repoSuccessFor = name;
      _renderSharingPane();
      setTimeout(() => {
        if (_repoSuccessFor === name) {
          _repoSuccessFor = null;
          _renderSharingPane();
        }
      }, 2500);
    } else {
      _renderSharingPane();
      _showSyncToast(`Could not create repo: ${(result && result.error) || 'unknown error'}`);
    }
  }

  async function _handleSharingClick(e) {
    const btn = e.target.closest('[data-sharing-action]');
    if (!btn) return;
    const action = btn.dataset.sharingAction;
    if (action === 'connect') {
      try { await window.api.githubConnect(); } catch {}
    } else if (action === 'cancel-connect') {
      try { await window.api.githubCancelConnect(); } catch {}
      _renderSharingPane();
    } else if (action === 'disconnect') {
      const ok = confirm(
        'Disconnect GitHub? Existing share links will keep working. Re-connecting will let you share new notes.'
      );
      if (!ok) return;
      try { await window.api.githubDisconnect(); } catch {}
      _renderSharingPane();
    } else if (action === 'change-repo') {
      _repoConfirmAvailable = null;
      _repoEditing = true;
      _renderSharingPane();
    } else if (action === 'save-repo') {
      _saveRepoEdit();
    } else if (action === 'cancel-repo') {
      _repoEditing = false;
      _renderSharingPane();
    }
  }

  function _showRepoConfirmModal(name) {
    const modal = document.getElementById('repo-confirm-modal');
    if (!modal) return;
    document.getElementById('repo-confirm-name').textContent = name;
    const defaultRadio = modal.querySelector('input[name="repo-confirm-mode"][value="provision-now"]');
    if (defaultRadio) defaultRadio.checked = true;
    modal.classList.remove('hidden');
    modal.querySelector('[data-repo-confirm-action="confirm"]')?.focus();
  }

  function _hideRepoConfirmModal() {
    const modal = document.getElementById('repo-confirm-modal');
    if (modal) modal.classList.add('hidden');
  }

  async function _pickDifferentName() {
    const lastTyped = _repoConfirmAvailable;
    _hideRepoConfirmModal();
    _repoConfirmAvailable = null;
    _repoEditing = true;
    await _renderSharingPane();
    const input = document.getElementById('sharing-repo-input');
    if (input && lastTyped) {
      input.value = lastTyped;
      input.focus();
      input.select();
    }
  }

  function _handleRepoConfirmClick(e) {
    const btn = e.target.closest('[data-repo-confirm-action]');
    if (!btn) return;
    const action = btn.dataset.repoConfirmAction;
    if (action === 'confirm') {
      const modal = document.getElementById('repo-confirm-modal');
      const choice = modal.querySelector('input[name="repo-confirm-mode"]:checked')?.value;
      _hideRepoConfirmModal();
      if (choice === 'save-only') _saveAvailableDeferred();
      else _provisionRepoNow();
    } else if (action === 'pick-different') {
      _pickDifferentName();
    }
  }

  async function open() {
    const settings = await window.api.getSecuritySettings();
    for (const { id, key } of _keys) {
      document.getElementById(id).checked = settings[key];
    }
    _modal.classList.remove('hidden');
  }

  function close() {
    _modal.classList.add('hidden');
    _hideRepoConfirmModal();
    _resetSharingState();
  }

  async function save() {
    const settings = {};
    for (const { id, key } of _keys) {
      settings[key] = document.getElementById(id).checked;
    }
    await window.api.setSecuritySettings(settings);
    _cachedSecuritySettings = { ...settings };
  }

  async function resetDefaults() {
    for (const { id } of _keys) {
      document.getElementById(id).checked = false;
    }
    // External network defaults to true
    document.getElementById('sec-allow-external-network').checked = true;
    await save();
  }

  return { init, open, close };
})();

// ── Endpoints Settings Modal (feature 130) ────────────────────────────────
const EndpointsSettings = (() => {
  // ── State ────────────────────────────────────────────────────────────────
  let _editingEndpoint = null;  // endpoint object being edited; null = new custom
  let _editingIsNew    = false; // true = brand-new custom (not yet saved)

  // ── DOM refs (lazily resolved on first open) ──────────────────────────────
  let _modal, _listView, _editView, _listContainer, _presetsContainer, _quickAdd;
  function _refs() {
    if (_modal) return;
    _modal            = document.getElementById('endpoints-modal');
    _listView         = document.getElementById('endpoints-list-view');
    _editView         = document.getElementById('endpoints-edit-view');
    _listContainer    = document.getElementById('endpoints-list');
    _presetsContainer = document.getElementById('endpoints-presets');
    _quickAdd         = _listView.querySelector('.endpoints-quick-add');
  }

  // ── HTML escaping helper ─────────────────────────────────────────────────
  function _esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Modal open / close ───────────────────────────────────────────────────
  async function open() {
    _refs();
    _modal.classList.remove('hidden');
    // Load unsetApiKeys preferences
    const keys = await window.api.getUnsetApiKeys();
    document.getElementById('chk-unset-anthropic').checked = keys.anthropic;
    document.getElementById('chk-unset-openai').checked = keys.openai;
    document.getElementById('chk-unset-gemini').checked = keys.gemini;
    await _showListView();
    // Render OpenClaw remotes inline list (first section)
    await OpenClawRemotesSettings.renderInlineList();
  }

  function close() {
    _refs();
    _modal.classList.add('hidden');
    _editingEndpoint = null;
    _editingIsNew    = false;
    // Clean up OpenClaw edit state if it was open
    if (typeof OpenClawRemotesSettings !== 'undefined') OpenClawRemotesSettings.close();
  }

  // ── List view ────────────────────────────────────────────────────────────
  async function _showListView() {
    _editView.classList.add('hidden');
    // Also hide OpenClaw edit view if visible
    document.getElementById('oc-remotes-edit-view')?.classList.add('hidden');
    _listView.classList.remove('hidden');
    await _renderList();
  }

  async function _renderList() {
    const [endpoints, availablePresets] = await Promise.all([
      window.api.getOpenaiCompatEndpoints(),
      window.api.getOpenaiCompatAvailablePresets(),
    ]);

    // Endpoint rows
    _listContainer.innerHTML = '';
    if (endpoints.length === 0) {
      _listContainer.innerHTML =
        '<div class="endpoints-empty-state">No endpoints configured. Add one below.</div>';
    } else {
      for (const ep of endpoints) {
        _listContainer.appendChild(_buildRow(ep));
      }
    }

    // Quick-add preset buttons
    _presetsContainer.innerHTML = '';
    if (availablePresets.length > 0) {
      _quickAdd.classList.remove('hidden');
      for (const preset of availablePresets) {
        const btn = document.createElement('button');
        btn.className = 'preset-card';
        btn.textContent = `+ ${preset.label}`;
        btn.addEventListener('click', () => _quickAddPreset(preset));
        _presetsContainer.appendChild(btn);
      }
    } else {
      _quickAdd.classList.add('hidden');
    }
  }

  function _buildRow(ep) {
    const isPreset = !!ep.presetId;
    const row = document.createElement('div');
    row.className = 'endpoint-row';
    row.dataset.id = ep.id;
    row.innerHTML = `
      <div class="endpoint-row-info">
        <div class="endpoint-row-label">${_esc(ep.label)}</div>
        <div class="endpoint-row-url">${_esc(ep.baseUrl)}</div>
      </div>
      <span class="endpoint-badge${isPreset ? ' badge-preset' : ''}">${isPreset ? 'Preset' : 'Custom'}</span>
      <div class="endpoint-row-actions">
        <button class="btn-edit">Edit</button>
        <button class="btn-test-row">Test</button>
        <button class="btn-remove btn-danger">Remove</button>
      </div>`;
    row.querySelector('.btn-edit').addEventListener('click', () => _showEditForm(ep, false));
    row.querySelector('.btn-test-row').addEventListener('click', e => _testRow(ep, e.currentTarget));
    row.querySelector('.btn-remove').addEventListener('click', e => _confirmRemove(ep, row, e.currentTarget));
    return row;
  }

  // ── Quick-add preset ─────────────────────────────────────────────────────
  async function _quickAddPreset(preset) {
    const newEp = {
      id:           crypto.randomUUID(),
      presetId:     preset.id,
      label:        preset.label,
      baseUrl:      preset.baseUrl    || '',
      apiKey:       preset.apiKey     || '',
      modelId:      preset.defaultModel || '',
      userModified: false,
      requiresKey:  preset.requiresKey || false,
      models:       preset.models     || [],
    };
    const saved = await window.api.getOpenaiCompatEndpoints();
    await window.api.setOpenaiCompatEndpoints([...saved, newEp]);
    // Open edit form (already saved; user may need to add API key)
    await _showEditForm(newEp, false);
  }

  // ── Edit form ────────────────────────────────────────────────────────────
  function _showEditForm(ep, isNew) {
    _editingEndpoint = ep ? { ...ep } : null;
    _editingIsNew    = isNew;
    _listView.classList.add('hidden');
    _populateForm(ep);
    _editView.classList.remove('hidden');
  }

  function _populateForm(ep) {
    const e = ep || { label: '', baseUrl: '', apiKey: '', modelId: '', presetId: null, models: [] };

    document.getElementById('ep-label').value = e.label;
    document.getElementById('ep-url').value   = e.baseUrl;

    // API key: never put real value in the field — use placeholder mask
    const epKey = document.getElementById('ep-key');
    epKey.value       = '';
    epKey.type        = 'password';
    epKey.placeholder = e.apiKey ? '••••••••' : 'Optional';

    // Model dropdown
    _populateModelSelect(e.models || [], e.modelId || '');

    // "Reset to defaults" link — only for preset-based endpoints
    document.getElementById('ep-reset-row').classList.toggle('hidden', !e.presetId);

    // Clear any previous errors / test result
    _clearFormState();
  }

  function _clearFormState() {
    const errEl = document.getElementById('ep-form-error');
    errEl.textContent = '';
    errEl.classList.add('hidden');

    const fetchErr = document.getElementById('ep-fetch-error');
    fetchErr.textContent = '';
    fetchErr.classList.add('hidden');

    const testResult = document.getElementById('ep-test-result');
    testResult.textContent = '';
    testResult.className = 'hidden';
  }

  function _populateModelSelect(models, currentModelId) {
    const sel  = document.getElementById('ep-model');
    const txt  = document.getElementById('ep-model-text');
    sel.classList.remove('hidden');
    txt.classList.add('hidden');
    txt.value = '';

    sel.innerHTML = '<option value="">— select model —</option>';
    if (models && models.length > 0) {
      for (const m of models) {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = m;
        if (m === currentModelId) opt.selected = true;
        sel.appendChild(opt);
      }
    } else if (currentModelId) {
      const opt = document.createElement('option');
      opt.value = currentModelId;
      opt.textContent = currentModelId;
      opt.selected = true;
      sel.appendChild(opt);
    }
  }

  // ── Fetch models ─────────────────────────────────────────────────────────
  async function _fetchModels() {
    const baseUrl = document.getElementById('ep-url').value.trim();
    const apiKey  = document.getElementById('ep-key').value.trim() || (_editingEndpoint?.apiKey || '');

    const fetchErr = document.getElementById('ep-fetch-error');
    fetchErr.classList.add('hidden');

    if (!baseUrl) {
      fetchErr.textContent = 'Enter a Base URL first.';
      fetchErr.classList.remove('hidden');
      return;
    }

    const btn = document.getElementById('ep-fetch-models');
    btn.disabled    = true;
    btn.textContent = 'Fetching…';

    try {
      const result   = await window.api.fetchOpenaiCompatModels(baseUrl, apiKey);
      const modelIds = Array.isArray(result)
        ? result.map(m => (typeof m === 'string' ? m : (m.id || m.name || String(m)))).filter(Boolean)
        : [];
      const currentId = document.getElementById('ep-model').value || (_editingEndpoint?.modelId || '');
      _populateModelSelect(modelIds, currentId);
    } catch (err) {
      // Fall back to text input
      const sel = document.getElementById('ep-model');
      const txt = document.getElementById('ep-model-text');
      sel.classList.add('hidden');
      txt.classList.remove('hidden');
      txt.value = _editingEndpoint?.modelId || '';
      fetchErr.textContent = `Fetch failed: ${err.message || err}`;
      fetchErr.classList.remove('hidden');
    } finally {
      btn.disabled    = false;
      btn.textContent = 'Fetch Models';
    }
  }

  // ── Test connection (in edit form) ────────────────────────────────────────
  async function _testConnection() {
    const baseUrl = document.getElementById('ep-url').value.trim();
    const apiKey  = document.getElementById('ep-key').value.trim() || (_editingEndpoint?.apiKey || '');
    const resultEl = document.getElementById('ep-test-result');

    if (!baseUrl) {
      resultEl.textContent = 'Enter a Base URL first.';
      resultEl.className   = 'ep-test-result error';
      return;
    }

    const btn = document.getElementById('ep-test');
    btn.disabled    = true;
    btn.textContent = 'Testing…';
    resultEl.classList.add('hidden');

    const t0 = performance.now();
    try {
      const models = await window.api.fetchOpenaiCompatModels(baseUrl, apiKey);
      const ms     = Math.round(performance.now() - t0);
      const count  = Array.isArray(models) ? models.length : 0;
      resultEl.textContent = `Connected — ${count} model${count !== 1 ? 's' : ''} available (${ms}ms)`;
      resultEl.className   = 'ep-test-result success';
    } catch (err) {
      resultEl.textContent = `Error: ${err.message || err}`;
      resultEl.className   = 'ep-test-result error';
    } finally {
      resultEl.classList.remove('hidden');
      btn.disabled    = false;
      btn.textContent = 'Test Connection';
    }
  }

  // ── Test from list row (no edit form) ────────────────────────────────────
  async function _testRow(ep, btn) {
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = '…';
    try {
      const t0     = performance.now();
      const models = await window.api.fetchOpenaiCompatModels(ep.baseUrl, ep.apiKey || '');
      const ms     = Math.round(performance.now() - t0);
      const count  = Array.isArray(models) ? models.length : 0;
      btn.textContent  = `✓ ${count}m`;
      btn.classList.remove('test-result-error');
      btn.classList.add('test-result-success');
    } catch {
      btn.textContent  = '✗ err';
      btn.classList.remove('test-result-success');
      btn.classList.add('test-result-error');
    } finally {
      setTimeout(() => {
        btn.textContent = orig;
        btn.classList.remove('test-result-success', 'test-result-error');
        btn.disabled    = false;
      }, 3000);
    }
  }

  // ── Save ─────────────────────────────────────────────────────────────────
  async function _save() {
    const label   = document.getElementById('ep-label').value.trim();
    const baseUrl = document.getElementById('ep-url').value.trim();
    const apiKeyField = document.getElementById('ep-key');
    const sel     = document.getElementById('ep-model');
    const txt     = document.getElementById('ep-model-text');
    const errEl   = document.getElementById('ep-form-error');

    errEl.classList.add('hidden');

    if (!label) {
      errEl.textContent = 'Label is required.';
      errEl.classList.remove('hidden');
      return;
    }
    if (!baseUrl) {
      errEl.textContent = 'Base URL is required.';
      errEl.classList.remove('hidden');
      return;
    }

    const modelId = sel.classList.contains('hidden') ? txt.value.trim() : sel.value;
    const newApiKey = apiKeyField.value.trim();

    const saved = await window.api.getOpenaiCompatEndpoints();
    let updated;

    if (_editingIsNew) {
      // Brand-new custom endpoint — append
      updated = [...saved, {
        id:           crypto.randomUUID(),
        presetId:     null,
        label,
        baseUrl,
        apiKey:       newApiKey,
        modelId,
        userModified: false,
        requiresKey:  false,
        models:       [],
      }];
    } else {
      // Update existing endpoint
      updated = saved.map(e => {
        if (e.id !== _editingEndpoint.id) return e;
        return {
          ...e,
          label,
          baseUrl,
          apiKey:  newApiKey !== '' ? newApiKey : e.apiKey,  // keep existing key if field left blank
          modelId,
        };
      });
    }

    await window.api.setOpenaiCompatEndpoints(updated);
    await _showListView();
  }

  // ── Remove (custom endpoint) ─────────────────────────────────────────────
  function _confirmRemove(ep, row, btn) {
    // Inline "Are you sure?" — replace Remove button with Sure? + No
    btn.textContent = 'Sure?';
    btn.classList.add('btn-confirm');
    btn.classList.remove('btn-danger');

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'No';
    row.querySelector('.endpoint-row-actions').appendChild(cancelBtn);

    btn.onclick = async () => {
      const saved = await window.api.getOpenaiCompatEndpoints();
      await window.api.setOpenaiCompatEndpoints(saved.filter(e => e.id !== ep.id));
      await _renderList();
    };
    cancelBtn.onclick = () => _renderList();
  }

  // ── Reset to preset defaults ─────────────────────────────────────────────
  async function _resetToDefaults() {
    if (!_editingEndpoint?.id) return;
    const reset = await window.api.resetOpenaiCompatEndpoint(_editingEndpoint.id);
    if (reset) {
      _editingEndpoint = reset;
      _populateForm(reset);
    }
  }

  // ── One-time initialization ───────────────────────────────────────────────
  function init() {
    _refs();

    // Gear button → open modal
    document.getElementById('ai-endpoints-settings').addEventListener('click', open);

    // Close via backdrop or × button
    _modal.querySelector('.modal-backdrop').addEventListener('click', close);
    _modal.querySelector('.endpoints-close').addEventListener('click', close);

    // Close via Escape
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !_modal.classList.contains('hidden')) close();
    });

    // Back button in edit view
    _editView.querySelector('.endpoints-back').addEventListener('click', _showListView);

    // Add custom
    document.getElementById('endpoints-add-custom').addEventListener('click', () =>
      _showEditForm(null, true)
    );

    // Fetch models button
    document.getElementById('ep-fetch-models').addEventListener('click', _fetchModels);

    // Test connection button
    document.getElementById('ep-test').addEventListener('click', _testConnection);

    // API key eye toggle
    _editView.querySelector('.ep-key-toggle').addEventListener('click', () => {
      const f = document.getElementById('ep-key');
      f.type = f.type === 'password' ? 'text' : 'password';
    });

    // Save / Cancel
    document.getElementById('ep-save').addEventListener('click', _save);
    document.getElementById('ep-cancel').addEventListener('click', _showListView);

    // Reset to preset defaults
    document.getElementById('ep-reset').addEventListener('click', _resetToDefaults);

    // Unset API keys toggles (feature 145)
    for (const key of ['anthropic', 'openai', 'gemini']) {
      document.getElementById(`chk-unset-${key}`).addEventListener('change', async () => {
        const keys = await window.api.getUnsetApiKeys();
        keys[key] = document.getElementById(`chk-unset-${key}`).checked;
        window.api.setUnsetApiKeys(keys);
      });
    }
  }

  return { init, open, close };
})();

// ── OpenClaw Remotes Settings Modal (feature 151) ─────────────────────────
const OpenClawRemotesSettings = (() => {
  // ── State ────────────────────────────────────────────────────────────────
  let _editingEndpoint = null;  // endpoint object being edited; null = new
  let _editingIsNew    = false; // true = brand-new (not yet saved)

  // ── DOM refs (lazily resolved on first use) ──────────────────────────────
  let _listView, _editView, _inlineListContainer;
  function _refs() {
    if (_listView) return;
    _listView            = document.getElementById('endpoints-list-view');
    _editView            = document.getElementById('oc-remotes-edit-view');
    _inlineListContainer = document.getElementById('oc-remotes-list-inline');
  }

  // ── HTML escaping helper ─────────────────────────────────────────────────
  function _esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── View switching (mirrors EndpointsSettings pattern) ──────────────────
  function _showEditView() {
    _refs();
    // Hide list view and EndpointsSettings' edit view
    _listView.classList.add('hidden');
    document.getElementById('endpoints-edit-view')?.classList.add('hidden');
    _editView.classList.remove('hidden');
  }

  function _returnToList() {
    _refs();
    _editView.classList.add('hidden');
    _listView.classList.remove('hidden');
    _editingEndpoint = null;
    _editingIsNew    = false;
  }

  async function open() {
    _refs();
    await _renderInlineList();
  }

  function close() {
    _refs();
    _editView.classList.add('hidden');
    _editingEndpoint = null;
    _editingIsNew    = false;
  }

  // ── Inline list (rendered inside EndpointsSettings modal) ──────────────
  async function _renderInlineList() {
    _refs();
    const endpoints = await window.api.getOpenclawRemoteEndpoints();
    _inlineListContainer.innerHTML = '';
    if (endpoints.length === 0) {
      _inlineListContainer.innerHTML = '<div class="oc-remotes-empty">No OpenClaw remotes configured.</div>';
    } else {
      for (const ep of endpoints) {
        _inlineListContainer.appendChild(_buildRow(ep));
      }
    }
  }

  // ── Back to list from edit ──────────────────────────────────────────────
  async function _showListView() {
    _returnToList();
    await _renderInlineList();
  }

  async function _renderList() {
    const endpoints = await window.api.getOpenclawRemoteEndpoints();
    _listContainer.innerHTML = '';
    if (endpoints.length === 0) {
      _listContainer.innerHTML = '<div class="oc-remotes-empty">No OpenClaw remotes configured. Add one below.</div>';
    } else {
      for (const ep of endpoints) {
        _listContainer.appendChild(_buildRow(ep));
      }
    }
  }

  function _buildRow(ep) {
    const row = document.createElement('div');
    row.className = 'oc-remote-row';
    row.dataset.id = ep.id;
    row.innerHTML = `
      <span class="oc-status-dot" title="Untested"></span>
      <div class="oc-remote-row-info">
        <div class="oc-remote-row-label">${_esc(ep.label)}</div>
        <div class="oc-remote-row-url">${_esc(ep.url)}</div>
      </div>
      <div class="oc-remote-row-actions">
        <button class="btn-edit">Edit</button>
        <button class="btn-test-row">Test</button>
        <button class="btn-remove btn-danger">Remove</button>
      </div>`;
    row.querySelector('.btn-edit').addEventListener('click', () => _showEditForm(ep, false));
    row.querySelector('.btn-test-row').addEventListener('click', e => _testRow(ep, e.currentTarget, row));
    row.querySelector('.btn-remove').addEventListener('click', e => _confirmRemove(ep, row, e.currentTarget));
    return row;
  }

  // ── Edit form ────────────────────────────────────────────────────────────
  function _showEditForm(ep, isNew) {
    _editingEndpoint = ep ? { ...ep } : null;
    _editingIsNew    = isNew;
    _populateForm(ep);
    _showEditView();
  }

  function _populateForm(ep) {
    const e = ep || { label: '', url: '', token: '' };
    document.getElementById('oc-label').value = e.label;
    document.getElementById('oc-url').value   = e.url;

    const tokenInput = document.getElementById('oc-token');
    tokenInput.value = '';         // never pre-fill token for security
    tokenInput.type  = 'password';
    // Show hint if editing an existing endpoint (token is stored encrypted)
    tokenInput.placeholder = ep
      ? 'Token saved \u2014 leave blank to keep, or paste new'
      : 'Leave blank if not required';

    // Reset test result
    const testResult = document.getElementById('oc-test-result');
    testResult.classList.add('hidden');
    testResult.className = 'hidden';

    // Reset form error
    document.getElementById('oc-form-error').classList.add('hidden');
  }

  // ── Test Connection (from edit form) ─────────────────────────────────────
  async function _testConnection() {
    const btn      = document.getElementById('oc-test');
    const resultEl = document.getElementById('oc-test-result');
    const label    = document.getElementById('oc-label').value.trim();
    const url      = document.getElementById('oc-url').value.trim();
    const token    = document.getElementById('oc-token').value.trim();

    btn.disabled    = true;
    btn.textContent = '…';
    resultEl.classList.add('hidden');

    const endpoint = {
      id:       _editingEndpoint?.id,
      label,
      url,
      token:    token || undefined,
    };

    try {
      const r = await window.api.testOpenclawRemoteEndpoint(endpoint);
      if (r.ok) {
        const count = Array.isArray(r.models) ? r.models.length : 0;
        resultEl.textContent = `Connected — ${count} model${count !== 1 ? 's' : ''} available (${r.latencyMs}ms)`;
        resultEl.className   = 'ep-test-result';
      } else {
        resultEl.textContent = r.error || 'Connection failed.';
        resultEl.className   = 'ep-test-result error';
      }
    } catch (err) {
      resultEl.textContent = err.message;
      resultEl.className   = 'ep-test-result error';
    } finally {
      resultEl.classList.remove('hidden');
      btn.disabled    = false;
      btn.textContent = 'Test Connection';
    }
  }

  // ── Test from list row ────────────────────────────────────────────────────
  async function _testRow(ep, btn, row) {
    const dot  = row.querySelector('.oc-status-dot');
    const orig = btn.textContent;
    btn.disabled    = true;
    btn.textContent = '…';
    try {
      const r = await window.api.testOpenclawRemoteEndpoint(ep);
      if (r.ok) {
        const count = Array.isArray(r.models) ? r.models.length : 0;
        btn.textContent = `✓ ${count}m`;
        btn.classList.remove('test-result-error');
        btn.classList.add('test-result-success');
        dot.className   = 'oc-status-dot ok';
        dot.title       = `Connected — ${count} model${count !== 1 ? 's' : ''}`;
      } else {
        btn.textContent = '✗ err';
        btn.classList.remove('test-result-success');
        btn.classList.add('test-result-error');
        dot.className   = 'oc-status-dot error';
        dot.title       = r.error || 'Connection failed';
      }
    } catch {
      btn.textContent = '✗ err';
      btn.classList.remove('test-result-success');
      btn.classList.add('test-result-error');
      dot.className   = 'oc-status-dot error';
    } finally {
      setTimeout(() => {
        btn.textContent = orig;
        btn.classList.remove('test-result-success', 'test-result-error');
        btn.disabled    = false;
      }, 3000);
    }
  }

  // ── Save ─────────────────────────────────────────────────────────────────
  async function _save() {
    const label    = document.getElementById('oc-label').value.trim();
    const url      = document.getElementById('oc-url').value.trim();
    const tokenVal = document.getElementById('oc-token').value.trim();
    const errEl    = document.getElementById('oc-form-error');

    errEl.classList.add('hidden');

    if (!label) {
      errEl.textContent = 'Label is required.';
      errEl.classList.remove('hidden');
      return;
    }
    if (!url) {
      errEl.textContent = 'WebSocket URL is required.';
      errEl.classList.remove('hidden');
      return;
    }
    if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
      errEl.textContent = 'URL must start with ws:// or wss://.';
      errEl.classList.remove('hidden');
      return;
    }

    if (_editingIsNew) {
      const endpoint = {
        label,
        url,
        token: tokenVal || undefined,
      };
      const saved = await window.api.addOpenclawRemoteEndpoint(endpoint);
      _editingEndpoint = saved;
      _editingIsNew    = false;
      await _showListView();
    } else {
      // Update existing: use bulk set (fetch + replace + save)
      const all = await window.api.getOpenclawRemoteEndpoints();
      const updated = all.map(e => {
        if (e.id !== _editingEndpoint.id) return e;
        const u = { ...e, label, url };
        // Only send token if user entered a new one (blank = keep existing encrypted token)
        if (tokenVal !== '') {
          u.token = tokenVal;
        }
        return u;
      });
      await window.api.setOpenclawRemoteEndpoints(updated);
      await _showListView();
    }
  }

  // ── Remove ────────────────────────────────────────────────────────────────
  function _confirmRemove(ep, row, btn) {
    btn.textContent = 'Sure?';
    btn.classList.add('btn-confirm');
    btn.classList.remove('btn-danger');

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'No';
    row.querySelector('.oc-remote-row-actions').appendChild(cancelBtn);

    btn.onclick = async () => {
      await window.api.removeOpenclawRemoteEndpoint(ep.id);
      await _renderList();
    };
    cancelBtn.onclick = () => _renderList();
  }

  // ── One-time initialization ───────────────────────────────────────────────
  function init() {
    _refs();

    // Back to list
    document.getElementById('oc-back-to-list').addEventListener('click', _showListView);

    // Add remote button
    document.getElementById('oc-add-remote-inline').addEventListener('click', () =>
      _showEditForm(null, true)
    );

    // Help icon toggles
    _editView.querySelectorAll('.oc-help-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const panelId = btn.getAttribute('data-help');
        const panel = document.getElementById(panelId);
        if (!panel) return;
        const isOpen = !panel.classList.contains('hidden');
        // Close all help panels first
        _editView.querySelectorAll('.oc-help-panel').forEach(p => p.classList.add('hidden'));
        _editView.querySelectorAll('.oc-help-btn').forEach(b => b.classList.remove('active'));
        if (!isOpen) {
          panel.classList.remove('hidden');
          btn.classList.add('active');
        }
      });
    });

    // Token eye toggle
    _editView.querySelector('.oc-token-toggle').addEventListener('click', () => {
      const f = document.getElementById('oc-token');
      f.type = f.type === 'password' ? 'text' : 'password';
    });

    // Test connection
    document.getElementById('oc-test').addEventListener('click', _testConnection);

    // Save / Cancel
    document.getElementById('oc-save').addEventListener('click', _save);
    document.getElementById('oc-cancel').addEventListener('click', _showListView);

  }

  return { init, open, close, renderInlineList: () => { _refs(); return _renderInlineList(); } };
})();

async function populateModelDropdown(providerName, targetModelId = null) {
  const providers = await window.api.listProviders();
  const provider = providers.find(p => p.name === providerName);

  let models = provider?.models || [];

  if (provider?.type === 'http' && provider?.endpointConfig?.baseUrl) {
    const { baseUrl, apiKey } = provider.endpointConfig;
    const fetched = await window.api.fetchOpenaiCompatModels(baseUrl, apiKey);
    if (fetched && fetched.length > 0) {
      models = fetched;
    } else if (provider.endpointConfig.modelId) {
      models = [{ id: provider.endpointConfig.modelId, label: provider.endpointConfig.modelId }];
    }
  }

  if (models.length === 0) {
    aiModelSelect.style.display = 'none';
    await window.api.setActiveModel(null);
    return;
  }
  aiModelSelect.style.display = '';

  aiModelSelect.innerHTML = '';
  for (const m of models) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label;
    aiModelSelect.appendChild(opt);
  }

  // If a target model was specified (e.g. from a conversation), use it
  if (targetModelId && aiModelSelect.querySelector(`option[value="${targetModelId}"]`)) {
    aiModelSelect.value = targetModelId;
  } else {
    // Restore last-used model, or fall back to repo default
    const lastModel = await window.api.getLastModel();
    const savedModelId = lastModel[providerName];
    if (savedModelId && aiModelSelect.querySelector(`option[value="${savedModelId}"]`)) {
      aiModelSelect.value = savedModelId;
    } else if (provider.defaultModel && aiModelSelect.querySelector(`option[value="${provider.defaultModel}"]`)) {
      aiModelSelect.value = provider.defaultModel;
    }
    // else: first option stays selected
  }

  // Notify main process. First option = CLI default → pass null so no --model flag.
  const isDefault = aiModelSelect.selectedIndex === 0;
  await window.api.setActiveModel(isDefault ? null : aiModelSelect.value);
}

const EFFORT_OPTIONS_FALLBACK = [
  { id: 'default', label: 'Default' },
  { id: 'low',     label: 'Low' },
  { id: 'medium',  label: 'Medium' },
  { id: 'high',    label: 'High' },
  { id: 'max',     label: 'Max' },
];

async function populateEffortDropdown(providerName, targetEffortId = null) {
  const providers = await window.api.listProviders();
  const provider = providers.find(p => p.name === providerName);

  if (!provider?.supportsEffort) {
    aiEffortSelect.style.display = 'none';
    await window.api.setActiveEffort(null);
    return;
  }

  // Use remote effort options if available, otherwise fall back to defaults
  const effortLevels = provider.effortOptions
    ? [{ id: 'default', label: 'Default' }, ...provider.effortOptions.map(e => ({ id: e, label: e.charAt(0).toUpperCase() + e.slice(1) }))]
    : EFFORT_OPTIONS_FALLBACK;

  aiEffortSelect.style.display = '';
  aiEffortSelect.innerHTML = '';
  for (const e of effortLevels) {
    const opt = document.createElement('option');
    opt.value = e.id;
    opt.textContent = e.label;
    aiEffortSelect.appendChild(opt);
  }

  // If a target effort was specified (e.g. from a conversation), use it
  if (targetEffortId && aiEffortSelect.querySelector(`option[value="${targetEffortId}"]`)) {
    aiEffortSelect.value = targetEffortId;
  } else {
    // Restore last-used effort, or fall back to repo default
    const lastEffort = await window.api.getLastEffort();
    const savedEffortId = lastEffort[providerName];
    if (savedEffortId && aiEffortSelect.querySelector(`option[value="${savedEffortId}"]`)) {
      aiEffortSelect.value = savedEffortId;
    } else if (provider.defaultEffort && aiEffortSelect.querySelector(`option[value="${provider.defaultEffort}"]`)) {
      aiEffortSelect.value = provider.defaultEffort;
    }
  }

  const isDefaultEffort = aiEffortSelect.value === 'default';
  await window.api.setActiveEffort(isDefaultEffort ? null : aiEffortSelect.value);
}

async function populatePermissionDropdown(providerName, targetPermissionMode = null) {
  const providers = await window.api.listProviders();
  const provider = providers.find(p => p.name === providerName);

  const modes = provider?.permissionModes || [];
  if (modes.length === 0) {
    aiPermissionSelect.style.display = 'none';
    await window.api.setActivePermissionMode(null);
    return;
  }
  aiPermissionSelect.style.display = '';

  aiPermissionSelect.innerHTML = '';
  for (const mode of modes) {
    const opt = document.createElement('option');
    const id = typeof mode === 'string' ? mode : mode.id;
    const label = typeof mode === 'string' ? mode : (mode.label || mode.id);
    const desc = typeof mode === 'string' ? '' : (mode.description || '');
    opt.value = id;
    opt.textContent = desc ? `${label} — ${desc}` : label;
    aiPermissionSelect.appendChild(opt);
  }

  // If a target permission was specified (e.g. from a conversation), use it
  if (targetPermissionMode && aiPermissionSelect.querySelector(`option[value="${targetPermissionMode}"]`)) {
    aiPermissionSelect.value = targetPermissionMode;
  } else {
    // Restore last-used permission mode for this provider
    const lastPermission = await window.api.getLastPermissionMode();
    const savedMode = lastPermission[providerName];
    if (savedMode && aiPermissionSelect.querySelector(`option[value="${savedMode}"]`)) {
      aiPermissionSelect.value = savedMode;
    } else {
      // No saved permission — leave the dropdown on its first option (provider default).
    }
  }

  await window.api.setActivePermissionMode(aiPermissionSelect.value);
}

// Listen for workspace auto-load from main process
window.api.onWorkspaceLoaded(async (data) => {
  // Load security settings for this workspace (used by webview creation)
  try { _cachedSecuritySettings = await window.api.getSecuritySettings(); } catch { _cachedSecuritySettings = null; }
  showApp(data.path, data.tree);

  // Restore sidebar collapse/expand state now that currentWorkspacePath is set
  _notesLoadState();
  _tagsLoadState();
  refreshTagsList();
  _storageLoadState();
  if (_rightPanelVisible && _rightPanelActiveTab === 'storage') renderStorageSection();
  if (_rightPanelVisible && _rightPanelActiveTab === 'memory') renderMemoryPanel();
  if (_rightPanelVisible && _rightPanelActiveTab === 'scripts') renderScriptsPanel();
  if (_rightPanelVisible && _rightPanelActiveTab === 'logs') renderLogsPanel();

  if (window.SyncState) window.SyncState._lastGitStatus = data.gitStatus || null;
  if (data.healthReport && !data.healthReport.healthy) {
    SyncRecoveryModal.open(data.healthReport);
  }
  initProviderDropdown();
});

// Feature 110: update scripts running section when a script starts or finishes
window.api.onScriptsRunChanged(() => {
  if (_rightPanelVisible && _rightPanelActiveTab === 'scripts') {
    renderScriptsRunning();
  }
});

// Missing module detection — toast + sidebar banner
let _lastMissingModule = null;

window.api.onScriptsMissingModule((data) => {
  _lastMissingModule = data;
  _showErrorToast(`Missing module "${data.module}" — run: ${data.install}`);
  _renderMissingModuleBanner();
});

function _renderMissingModuleBanner() {
  const existing = document.getElementById('scripts-missing-module-banner');
  if (existing) existing.remove();
  if (!_lastMissingModule) return;

  const container = document.getElementById('scripts-env-body');
  if (!container) return;

  const data = _lastMissingModule;
  const banner = document.createElement('div');
  banner.id = 'scripts-missing-module-banner';
  banner.className = 'scripts-missing-banner';

  const msg = document.createElement('span');
  msg.className = 'scripts-missing-msg';
  msg.textContent = `"${data.scriptName}" failed: missing module "${data.module}"`;

  const cmd = document.createElement('code');
  cmd.className = 'scripts-missing-cmd';
  cmd.textContent = data.install;
  cmd.title = 'Click to copy';
  cmd.addEventListener('click', () => {
    navigator.clipboard.writeText(data.install);
    cmd.textContent = 'Copied!';
    setTimeout(() => { cmd.textContent = data.install; }, 1500);
  });

  const dismiss = document.createElement('button');
  dismiss.className = 'scripts-missing-dismiss';
  dismiss.textContent = '\u00d7';
  dismiss.title = 'Dismiss';
  dismiss.addEventListener('click', () => {
    _lastMissingModule = null;
    banner.remove();
  });

  banner.appendChild(dismiss);
  banner.appendChild(msg);
  banner.appendChild(cmd);
  container.appendChild(banner);
}

// Feature 111: show toast when _templates/ folder cannot be created
window.api.onTemplatesError((msg) => _showSyncToast(msg));

// Re-populate model dropdown when remote model lists arrive (fixes race on startup)
window.api.onModelsRefreshed(() => {
  const aiProviderSelect = document.getElementById('ai-provider-select');
  if (aiProviderSelect) populateModelDropdown(aiProviderSelect.value);
});

// Re-populate provider dropdown when HTTP endpoints are added/changed/removed (feature 128)
window.api.onProvidersUpdated(() => {
  initProviderDropdown();
});

// Feature 115: restore complete toast
window.api.onTemplatesRestoreComplete((data) => {
  const { restored } = data;
  if (restored.length === 0) {
    _showSyncToast('All default templates are already present.');
  } else {
    const names = restored.map(id => `${id}.html`).join(', ');
    _showSyncToast(`Restored ${restored.length} template${restored.length > 1 ? 's' : ''}: ${names}`);
  }
});

// Feature 117: show/hide "Use template" button based on template availability
window.api.onWorkspaceLoaded(() => {
  updateUseTemplateVisibility();
});
window.api.onTemplatesUpdated(() => {
  updateUseTemplateVisibility();
});

// ─── Search index progress indicator (feature 80) ────────────────────────────

(function () {
  const progressEl = document.getElementById('index-progress');
  const progressText = document.getElementById('index-progress-text');

  window.api.onSearchIndexProgress(({ current, total }) => {
    progressEl.classList.remove('hidden');
    progressText.textContent = `Indexing notes… ${current}/${total}`;
  });

  window.api.onSearchIndexComplete(() => {
    progressEl.classList.add('hidden');
    // Auto-retry content search if there's a pending query (was blocked by "not ready")
    if (searchInputEl && searchInputEl.value.trim()) {
      performContentSearch(searchInputEl.value.trim());
    }
  });

  window.api.onSearchIndexError(() => {
    progressEl.classList.add('hidden');
  });
})();

SyncSettingsModal.init();
UnifiedSyncIndicator.init();
AwsSyncSettingsModal.init();
ServerSyncPopover.init();
AwsSyncUnlinkModal.init();
AwsSyncConsentModal.init();

// --- Tab bar: re-render and content-load on TabState changes ---

TabState.onChange((snapshot, event) => {
  if (event.type === 'state-restored') {
    // Destroy all existing per-tab webviews before rebuilding
    for (const tabId of [..._tabWebviews.keys()]) cleanupTabWebview(tabId);
    rebuildAllPanelsDOM();
  } else if (event.type === 'panel-added') {
    addPanelToDOM(event.panelId, event.insertBeforePanelId || null);
    updateViewerDirection(snapshot.splitDirection);
    renderTabBar(event.panelId);
    loadContentForTab(event.panelId);
    for (const panel of snapshot.panels) {
      if (panel.id !== event.panelId) renderTabBar(panel.id);
    }
    updatePanelFocusIndicator(snapshot);
  } else if (event.type === 'panel-removed') {
    // Destroy any webviews still in the removed panel before removing DOM
    const removedPanelEl = document.querySelector(`.panel[data-panel-id="${event.panelId}"]`);
    if (removedPanelEl) {
      removedPanelEl.querySelectorAll('webview[data-tab-id]').forEach(wv => {
        const tid = wv.dataset.tabId;
        if (tid) cleanupTabWebview(tid);
      });
    }
    removePanelFromDOM(event.panelId);

    // Normalize flex on remaining panels to fill available space
    for (const panel of snapshot.panels) {
      const el = document.querySelector(`.panel[data-panel-id="${panel.id}"]`);
      if (el) el.style.flex = panel.sizeRatio;
    }

    // Update viewer direction (resets to horizontal when back to single panel)
    updateViewerDirection(snapshot.splitDirection);

    // Force remaining webviews to recalculate their internal content size.
    // Electron's <webview> can get stuck at its old dimensions after container resize.
    for (const panel of snapshot.panels) {
      const wv = getWebviewForPanel(panel.id);
      if (wv && !wv.classList.contains('hidden')) {
        const w = wv.style.width;
        wv.style.width = '99%';
        requestAnimationFrame(() => { wv.style.width = w || ''; });
      }
    }

    for (const panel of snapshot.panels) {
      renderTabBar(panel.id);
    }
    updatePanelFocusIndicator(snapshot);
  } else if (event.type === 'panel-focused') {
    updatePanelFocusIndicator(snapshot);
    updateSidebarHighlight();
  } else if (event.type === 'layout-changed') {
    updateViewerDirection(snapshot.splitDirection);
  } else if (event.type === 'panel-resized') {
    // DOM already updated by drag; this event only persists data. No DOM action needed.
  } else if (event.type === 'tab-moved') {
    // Reparent webview DOM element to target panel
    const movedWv = getWebviewForTab(event.tabId);
    if (movedWv) {
      const targetPanelEl = document.querySelector(`.panel[data-panel-id="${event.targetPanelId}"]`);
      const targetContainer = targetPanelEl?.querySelector('.webview-container');
      if (targetContainer) targetContainer.appendChild(movedWv);
    }
    // Auto-collapse source panel if it is now empty
    const sourcePanel = snapshot.panels.find(p => p.id === event.sourcePanelId);
    if (sourcePanel && sourcePanel.tabs.length === 0 && snapshot.panels.length > 1) {
      loadContentForTab(event.targetPanelId);
      TabState.removePanel(event.sourcePanelId);
      return;
    }
    renderTabBar(event.sourcePanelId);
    loadContentForTab(event.sourcePanelId);
    renderTabBar(event.targetPanelId);
    loadContentForTab(event.targetPanelId);
  } else if (event.type === 'tab-removed') {
    // Clean up webview for the removed tab
    cleanupTabWebview(event.tabId);
    // Auto-collapse: if last tab in a non-last panel is closed, remove the panel
    const panelData = snapshot.panels.find(p => p.id === event.panelId);
    if (panelData && panelData.tabs.length === 0 && snapshot.panels.length > 1) {
      TabState.removePanel(event.panelId);
      return;
    }
    renderTabBar(event.panelId);
    loadContentForTab(event.panelId);
  } else if (event.panelId) {
    renderTabBar(event.panelId);
    loadContentForTab(event.panelId);
  } else {
    // panelId is null for 'tabs-removed-by-path' — clean up webviews and re-render all panels
    if (event.removedTabIds) {
      for (const tid of event.removedTabIds) cleanupTabWebview(tid);
    }
    for (const panel of snapshot.panels) {
      renderTabBar(panel.id);
      loadContentForTab(panel.id);
    }
  }

  renderOutlinePanel();
  renderBacklinksSection();
  renderStorageSection();
  renderMemoryPanel();
  renderScriptsPanel();
  renderTitleBarSplitActions();
  debouncedSaveTabState();
});

// Clear currentSelection when user clicks outside note iframes
document.addEventListener('mousedown', (e) => {
  if (currentSelection && !e.target.closest('.note-frame') && !e.target.closest('#selection-toolbar')) {
    currentSelection = null;
    _notifySelectionChange(null);
  }
});

// Clear currentSelection on any tab change
TabState.onChange(() => {
  if (currentSelection) {
    currentSelection = null;
    _notifySelectionChange(null);
  }
});

// Push current-note context to .context/ folder on tab/panel changes
TabState.onChange((_snapshot, event) => {
  if (event.type === 'tab-activated' || event.type === 'panel-focused' || event.type === 'tab-added' || event.type === 'tab-removed') {
    _pushContextCurrentNote();
  }
});

// --- Selection Toolbar ---
const _selectionToolbar = document.createElement('div');
_selectionToolbar.id = 'selection-toolbar';
_selectionToolbar.className = 'glass hidden';
_selectionToolbar.innerHTML = `<button id="sel-toolbar-quote" type="button" title="Quote">${ICONS.quote} Quote</button>`;
document.body.appendChild(_selectionToolbar);

function hideSelectionToolbar() {
  _selectionToolbar.classList.add('hidden');
}

function showSelectionToolbar(sel) {
  if (!sel || !sel.rangeRect) { hideSelectionToolbar(); return; }

  const webviewEl = getWebviewForPanel(sel.panelId);
  if (!webviewEl) { hideSelectionToolbar(); return; }

  const rangeRect = sel.rangeRect;
  // Zero-dimension rect means selection is out of view
  if (rangeRect.width === 0 && rangeRect.height === 0) { hideSelectionToolbar(); return; }

  const webviewRect = webviewEl.getBoundingClientRect();

  const selTop     = webviewRect.top  + rangeRect.top;
  const selBottom  = webviewRect.top  + rangeRect.bottom;
  const selCenterX = webviewRect.left + rangeRect.left + rangeRect.width / 2;

  // Temporarily unhide off-screen to measure rendered size
  _selectionToolbar.style.top  = '-9999px';
  _selectionToolbar.style.left = '-9999px';
  _selectionToolbar.classList.remove('hidden');

  const toolbarH = _selectionToolbar.offsetHeight;
  const toolbarW = _selectionToolbar.offsetWidth;
  const gap = 6;

  let top;
  if (selTop - toolbarH - gap >= 0) {
    top = selTop - toolbarH - gap;
  } else {
    top = selBottom + gap;
  }

  let left = selCenterX - toolbarW / 2;
  left = Math.max(4, Math.min(left, window.innerWidth - toolbarW - 4));

  _selectionToolbar.style.top  = `${top}px`;
  _selectionToolbar.style.left = `${left}px`;
}

function repositionSelectionToolbar() {
  if (!currentSelection) { hideSelectionToolbar(); return; }
  showSelectionToolbar(currentSelection);
}

setOnSelectionChange((sel) => {
  if (sel && sel.text.length >= 3) {
    showSelectionToolbar(sel);
  } else {
    hideSelectionToolbar();
  }
});

document.getElementById('sel-toolbar-quote').addEventListener('click', () => {
  if (!currentSelection) return;
  addContextItem({
    type: 'selection',
    content: currentSelection.text,
    path: currentSelection.path,
    noteTitle: currentSelection.noteTitle,
  });
  const webviewEl = getWebviewForPanel(currentSelection.panelId);
  if (webviewEl) {
    webviewEl.executeJavaScript('window.getSelection().removeAllRanges()').catch(() => {});
  }
  currentSelection = null;
  _notifySelectionChange(null);
  aiInput.focus();
});

// Initial render for the panel(s) that exist on startup
for (const panel of TabState.getState().panels) {
  renderTabBar(panel.id);
  loadContentForTab(panel.id);
}
renderOutlinePanel();
renderBacklinksSection();

window.addEventListener('beforeunload', () => {
  saveTabState();
});

// Auto-select newest note after file system update
window.api.onNotesUpdated((tree) => {
  if (inlineEditActive) {
    currentTree = tree;
    return;
  }

  // Re-scan published kv state in case notes were renamed/moved (paths in our
  // map are absolute, so renames invalidate them). Cheap: small JSON files.
  refreshPublishedNotes().then(() => renderFilteredTree());

  // Build old/new file-node maps keyed by path
  const oldFileNodes = currentTree
    ? new Map(flattenFiles(currentTree).map(f => [f.path, f]))
    : new Map();

  if (activeTagFilters.size > 0) {
    _clearTagFilter();
  }

  currentTree = tree;
  const newFileNodes = new Map(flattenFiles(tree).map(f => [f.path, f]));

  // ── Rename detection ──────────────────────────────────────────────────────
  const removedPaths = new Set([...oldFileNodes.keys()].filter(p => !newFileNodes.has(p)));
  const addedNodes = new Map([...newFileNodes.entries()].filter(([p]) => !oldFileNodes.has(p)));

  for (const oldPath of [...removedPaths]) {
    const oldName = oldPath.split('/').pop();
    const oldExt = oldName.includes('.') ? oldName.slice(oldName.lastIndexOf('.')) : '';
    const oldDir = oldPath.slice(0, oldPath.lastIndexOf('/'));

    let matchNewPath = null;
    let matchTitle = null;

    // Priority 1: same parent directory + same extension (simple rename)
    for (const [newPath, newNode] of addedNodes) {
      const newName = newPath.split('/').pop();
      const newExt = newName.includes('.') ? newName.slice(newName.lastIndexOf('.')) : '';
      const newDir = newPath.slice(0, newPath.lastIndexOf('/'));
      if (newDir === oldDir && newExt === oldExt) {
        matchNewPath = newPath;
        matchTitle = newNode.title || newName;
        break;
      }
    }

    // Priority 2: same filename in different directory (file or folder move)
    if (!matchNewPath) {
      for (const [newPath, newNode] of addedNodes) {
        const newName = newPath.split('/').pop();
        if (newName === oldName) {
          matchNewPath = newPath;
          matchTitle = newNode.title || newName;
          break;
        }
      }
    }

    if (matchNewPath) {
      TabState.renameTabsByPath(oldPath, matchNewPath, matchTitle);
      // Feature 123: update favorites if the renamed file was a favorite
      if (currentWorkspacePath) {
        const relOld = oldPath.startsWith(currentWorkspacePath + '/') ? oldPath.slice(currentWorkspacePath.length + 1) : null;
        const relNew = matchNewPath.startsWith(currentWorkspacePath + '/') ? matchNewPath.slice(currentWorkspacePath.length + 1) : null;
        if (relOld && relNew && currentFavorites.includes(relOld)) {
          currentFavorites = currentFavorites.map(p => p === relOld ? relNew : p);
          window.api.favoritesRename(relOld, relNew).catch(() => {});
        }
      }
      removedPaths.delete(oldPath);
      addedNodes.delete(matchNewPath);
    }
  }

  // ── Stale tab pruning (truly deleted files, all panels) ───────────────────
  const validPaths = new Set(newFileNodes.keys());
  const stalePaths = new Set();
  for (const panel of TabState.getState().panels) {
    for (const tab of panel.tabs) {
      if (!validPaths.has(tab.filePath)) {
        stalePaths.add(tab.filePath);
      }
    }
  }
  for (const stale of stalePaths) {
    TabState.removeTabsByPath(stale);
  }

  // Feature 123: remove stale favorites (files deleted externally)
  // validPaths contains absolute paths; currentFavorites stores relative paths
  if (currentWorkspacePath) {
    const staleFavorites = currentFavorites.filter(relPath => !validPaths.has(currentWorkspacePath + '/' + relPath));
    if (staleFavorites.length > 0) {
      currentFavorites = currentFavorites.filter(relPath => validPaths.has(currentWorkspacePath + '/' + relPath));
      for (const relPath of staleFavorites) {
        window.api.favoritesRemove(relPath).catch(() => {});
      }
      renderFavoritesSection();
      refreshAllStarIcons();
    }
  }

  // ── New file handling ─────────────────────────────────────────────────────
  const newFiles = [...newFileNodes.values()];
  const addedFileList = [...addedNodes.values()];

  if (addedFileList.length > 0) {
    const newlyAdded = addedFileList[0];
    if (savedExpandedPaths) {
      savedExpandedPaths.add(tree.path);
      expandAncestorsInSet(newlyAdded.path, tree, savedExpandedPaths);
    }
    expandAncestors(newlyAdded.path, tree);
    renderFilteredTree();
    selectNote(newlyAdded.path, newlyAdded.title || newlyAdded.name);
  } else {
    renderFilteredTree();
    const focusedPanel = TabState.getFocusedPanel();
    const focusedActiveTab = focusedPanel ? TabState.getActiveTab(focusedPanel.id) : null;
    if (focusedActiveTab) {
      loadContentForTab(focusedPanel.id);
    }
  }

  // ── Prune stale folder paths (existing logic, unchanged) ──────────────────
  const validFolderPaths = collectFolderPaths(tree);
  for (const p of expandedPaths) {
    if (!validFolderPaths.has(p)) expandedPaths.delete(p);
  }
  if (savedExpandedPaths) {
    for (const p of savedExpandedPaths) {
      if (!validFolderPaths.has(p)) savedExpandedPaths.delete(p);
    }
  }
  saveExpandedPaths();
});

// Live-reload webviews whose underlying file changed on disk
window.api.onNoteContentChanged((absPath) => {
  if (inlineEditActive) return;
  for (const panel of TabState.getState().panels) {
    for (const tab of panel.tabs) {
      if (tab.filePath !== absPath && !(tab.type === 'note' && absPath === tab.filePath + '/index.html')) continue;
      const wv = getWebviewForTab(tab.id);
      if (!wv) continue;

      const gen = (_outlineGeneration.get(tab.id) || 0) + 1;
      _outlineGeneration.set(tab.id, gen);

      wv.addEventListener('dom-ready', async () => {
        if (_outlineGeneration.get(tab.id) !== gen) return;

        const headings = await extractHeadingsFromWebview(wv);
        _outlineFlatEntries.set(tab.id, headings);
        _outlineTrees.set(tab.id, Outline.buildOutlineTree(headings));
        _activeHeadingId.set(tab.id, null);
        renderOutlinePanel();
        renderBacklinksSection();
        const panelId = panel.id;
        updateBreadcrumb(panelId);

        if (_outlineGeneration.get(tab.id) !== gen) return;

        wv.executeJavaScript(SCROLL_TRACKER_SCRIPT).catch(() => {});
        wv.executeJavaScript(SELECTION_LISTENER_SCRIPT).catch(() => {});
        wv.executeJavaScript(LINK_CLICK_HANDLER_SCRIPT).catch(() => {});
      }, { once: true });

      wv.reload();
    }
  }
});

// --- Chat UI helpers ---

function renderMsgAttachments(msgAttachments) {
  const container = document.createElement("div");
  container.className = "msg-attachments";
  for (const att of msgAttachments) {
    const thumb = document.createElement("div");
    thumb.className = "msg-attachment-thumb";
    if (att.isImage) {
      const img = document.createElement("img");
      // Load image preview asynchronously from file path
      img.alt = att.filename;
      img.title = att.filename;
      window.api.readFilePreview(att.filePath).then((preview) => {
        if (preview) {
          img.src = `data:${preview.mimeType};base64,${preview.data}`;
        } else {
          // File no longer available — show fallback
          thumb.classList.add("msg-attachment-thumb--file");
          img.remove();
          const iconWrapper = document.createElement("div");
          iconWrapper.innerHTML = getFileIcon({ name: att.filename, type: "file" }, false);
          thumb.appendChild(iconWrapper.firstElementChild);
          const label = document.createElement("span");
          label.textContent = att.filename;
          thumb.appendChild(label);
        }
      });
      thumb.appendChild(img);
    } else {
      thumb.classList.add("msg-attachment-thumb--file");
      const iconWrapper = document.createElement("div");
      iconWrapper.innerHTML = getFileIcon({ name: att.filename, type: "file" }, false);
      thumb.appendChild(iconWrapper.firstElementChild);
      const label = document.createElement("span");
      label.textContent = att.filename;
      thumb.appendChild(label);
    }
    container.appendChild(thumb);
  }
  return container;
}

// --- Tool call display helpers ---

const TOOL_ICONS = {
  Bash:           '<svg fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 9a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 0 1h-3A.5.5 0 0 1 6 9M2 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2zm5.854 3.854-1.647 1.646 1.647 1.646a.5.5 0 0 1-.708.708l-2-2a.5.5 0 0 1 0-.708l2-2a.5.5 0 1 1 .708.708"/></svg>',
  Read:           '<svg fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M16 8s-3-5.5-8-5.5S0 8 0 8s3 5.5 8 5.5S16 8 16 8M1.173 8a13 13 0 0 1 1.66-2.043C4.12 4.668 5.88 3.5 8 3.5s3.879 1.168 5.168 2.457A13 13 0 0 1 14.828 8q-.086.13-.195.288c-.335.48-.83 1.12-1.465 1.755C11.879 11.332 10.119 12.5 8 12.5s-3.879-1.168-5.168-2.457A13 13 0 0 1 1.172 8z"/><path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5M4.5 8a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0"/></svg>',
  Edit:           '<svg fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M12.854.146a.5.5 0 0 0-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 0 0 0-.708zm.646 6.061L9.793 2.5 3.293 9H3.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.207zm-7.468 7.468A.5.5 0 0 1 6 13.5V13h-.5a.5.5 0 0 1-.5-.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.5-.5V10h-.5a.499.499 0 0 1-.175-.032l-.179.178a.5.5 0 0 0-.11.168l-2 5a.5.5 0 0 0 .65.65l5-2a.5.5 0 0 0 .168-.11z"/></svg>',
  Write:          '<svg fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M9.293 0H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.707A1 1 0 0 0 13.707 4L10 .293A1 1 0 0 0 9.293 0M9.5 3.5v-2l3 3h-2a1 1 0 0 1-1-1"/></svg>',
  Glob:           '<svg fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001q.044.06.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1 1 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0"/></svg>',
  Grep:           '<svg fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001q.044.06.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1 1 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0"/></svg>',
  Agent:          '<svg fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 .5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 0 1H9v1.07a7.001 7.001 0 0 1 3.274 12.474l.601.602a.5.5 0 0 1-.707.708l-.746-.746A6.97 6.97 0 0 1 8 16a6.97 6.97 0 0 1-3.422-.892l-.746.746a.5.5 0 0 1-.707-.708l.602-.602A7.001 7.001 0 0 1 7 2.07V1h-.5A.5.5 0 0 1 6 .5M8 3a6 6 0 1 0 0 12A6 6 0 0 0 8 3m0 2a.5.5 0 0 1 .5.5V8h1.5a.5.5 0 0 1 0 1H7.5V5.5A.5.5 0 0 1 8 5"/></svg>',
  WebSearch:      '<svg fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8m7.5-6.923c-.67.204-1.335.82-1.887 1.855A8 8 0 0 0 5.145 4H7.5zM4.09 4a9.3 9.3 0 0 1 .64-1.539 7 7 0 0 1 .597-.933A7 7 0 0 0 2.255 4zm-.582 3.5c.03-.877.138-1.718.312-2.5H1.674a7 7 0 0 0-.656 2.5zM4.847 5a12.5 12.5 0 0 0-.338 2.5H7.5V5zM8.5 5v2.5h2.99a12.5 12.5 0 0 0-.337-2.5zM4.51 8.5a12.5 12.5 0 0 0 .337 2.5H7.5V8.5zm3.99 0V11h2.653c.187-.765.306-1.608.338-2.5zM5.145 12q.208.58.468 1.068c.552 1.035 1.218 1.65 1.887 1.855V12zm.182 2.472a7 7 0 0 1-.597-.933A9.3 9.3 0 0 1 4.09 12H2.255a7 7 0 0 0 3.072 2.472M3.82 11a13.7 13.7 0 0 1-.312-2.5h-2.49a7 7 0 0 0 .656 2.5zM8.5 12v2.923c.67-.204 1.335-.82 1.887-1.855q.26-.487.468-1.068zm3.68-1h2.146c.365-.767.594-1.61.656-2.5h-2.49a13.7 13.7 0 0 1-.312 2.5m2.802-3.5a7 7 0 0 0-.656-2.5H12.18c.174.782.282 1.623.312 2.5zM11.27 2.461c.247.464.462.98.64 1.539h1.835a7 7 0 0 0-3.072-2.472c.218.284.418.598.597.933M10.855 4a8 8 0 0 0-.468-1.068C9.835 1.897 9.17 1.282 8.5 1.077V4z"/></svg>',
  WebFetch:       '<svg fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.715 6.542 3.343 7.914a3 3 0 1 0 4.243 4.243l1.828-1.829A3 3 0 0 0 8.586 5.5L8 6.086a1 1 0 0 0-.154.199 2 2 0 0 1 .861 3.337L6.88 11.45a2 2 0 1 1-2.83-2.83l.793-.792a4 4 0 0 1-.128-1.287z"/><path d="M6.586 4.672A3 3 0 0 0 7.414 9.5l.775-.776a2 2 0 0 1-.896-3.346L9.12 3.55a2 2 0 1 1 2.83 2.83l-.793.792c.112.42.155.855.128 1.287l1.372-1.372a3 3 0 1 0-4.243-4.243z"/></svg>',
  _default:       '<svg fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M1 0 0 1l2.2 3.081a1 1 0 0 0 .815.419h.07a1 1 0 0 1 .708.293l2.675 2.675-2.617 2.654A3.003 3.003 0 0 0 0 13a3 3 0 1 0 5.878-.851l2.654-2.617.968.968-.305.914a1 1 0 0 0 .242 1.023l3.27 3.27a.997.997 0 0 0 1.414 0l1.586-1.586a.997.997 0 0 0 0-1.414l-3.27-3.27a1 1 0 0 0-1.023-.242L10.5 9.5l-.96-.96 2.68-2.643A3.005 3.005 0 0 0 16 3q0-.405-.102-.777l-2.14 2.141L12 4l-.364-1.757L13.777.102a3 3 0 0 0-3.675 3.68L7.462 6.46 4.793 3.793a1 1 0 0 1-.293-.707v-.071a1 1 0 0 0-.419-.814zm9.646 10.646a.5.5 0 1 1 .708.708.5.5 0 0 1-.708-.708M3 11l.471.242.529.026.287.445.445.287.026.529L5 13l-.242.471-.026.529-.445.287-.287.445-.529.026L3 15l-.471-.242L2 14.732l-.287-.445L1.268 14l-.026-.529L1 13l.242-.471.026-.529.445-.287.287-.445.529-.026z"/></svg>',
};

/**
 * Extract primary display text for a tool_use event.
 * Returns { label, detail } where label is the tool name and detail is the key info.
 */
function toolUsePrimaryDisplay(name, input) {
  switch (name) {
    case 'Bash':
      return { label: input.description || 'Run command', detail: input.command || null };
    case 'Read':
      return { label: 'Read', detail: shortPath(input.file_path) + lineRange(input.offset, input.limit) };
    case 'Edit':
      return { label: 'Edit', detail: shortPath(input.file_path) };
    case 'Write':
      return { label: 'Write', detail: shortPath(input.file_path) };
    case 'Glob':
      return { label: 'Glob', detail: input.pattern };
    case 'Grep':
      return { label: 'Grep', detail: input.pattern + (input.path ? ' in ' + shortPath(input.path) : '') };
    case 'Agent':
      return { label: input.subagent_type ? `Agent (${input.subagent_type})` : 'Agent', detail: input.description || null };
    case 'WebSearch':
      return { label: 'Search', detail: input.query };
    case 'WebFetch':
      return { label: 'Fetch', detail: shortUrl(input.url) };
    case 'ToolSearch':
      return { label: 'ToolSearch', detail: input.query };
    case 'EnterPlanMode':
      return { label: 'Plan mode', detail: 'entering' };
    case 'ExitPlanMode':
      return { label: 'Plan mode', detail: 'exiting' };
    case 'AskUserQuestion':
      return { label: 'Question', detail: input.questions?.[0]?.question || null };
    case 'TodoWrite':
      return { label: 'Tasks', detail: (input.todos?.length || 0) + ' items' };
    case 'TaskCreate':
      return { label: 'Task', detail: input.subject };
    case 'TaskUpdate':
      return { label: 'Task update', detail: input.status || 'dependencies' };
    case 'TaskOutput':
      return { label: 'Task output', detail: input.task_id };
    default:
      return { label: name, detail: null };
  }
}

function shortPath(p) {
  if (!p) return '';
  const parts = p.split('/');
  if (parts.length <= 2) return p;
  return parts.slice(-2).join('/');
}

function shortUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    const path = u.pathname.length > 30 ? u.pathname.slice(0, 27) + '...' : u.pathname;
    return u.hostname + path;
  } catch { return url.slice(0, 50); }
}

function lineRange(offset, limit) {
  if (!offset && !limit) return '';
  if (offset && limit) return `:${offset}-${offset + limit}`;
  if (offset) return `:${offset}+`;
  return '';
}

function addToolUseBubble(name, input) {
  const { label, detail } = toolUsePrimaryDisplay(name, input);
  const icon = TOOL_ICONS[name] || TOOL_ICONS._default;

  const div = document.createElement("div");
  div.className = "msg msg-tool msg-tool-use";

  const row = document.createElement("div");
  row.className = "tool-use-row";

  const iconEl = document.createElement("span");
  iconEl.className = "tool-use-icon";
  iconEl.innerHTML = icon;
  row.appendChild(iconEl);

  const labelEl = document.createElement("span");
  labelEl.className = "tool-use-label";
  labelEl.textContent = label;
  row.appendChild(labelEl);

  if (detail) {
    const detailEl = document.createElement("span");
    detailEl.className = "tool-use-detail";
    detailEl.textContent = detail;
    row.appendChild(detailEl);
  }

  div.appendChild(row);
  aiMessages.insertBefore(div, aiScrollSentinel);
  aiEmptyState.classList.add("hidden");
  scrollMessages();
  return div;
}

function addToolResultBubble(output) {
  const div = document.createElement("div");
  div.className = "msg msg-tool msg-tool-result";

  const content = document.createElement("div");
  content.className = "msg-content";

  // Truncate long output
  const maxLen = 300;
  if (output.length > maxLen) {
    content.textContent = output.slice(0, maxLen) + '...';
  } else {
    content.textContent = output;
  }

  div.appendChild(content);
  aiMessages.insertBefore(div, aiScrollSentinel);
  aiEmptyState.classList.add("hidden");
  scrollMessages();
  return div;
}

function addMessageBubble(role, text, msgAttachments) {
  const div = document.createElement("div");
  div.className = `msg msg-${role}`;

  if (role === "user" && currentConversation) {
    div.dataset.msgIndex = currentConversation.messages.length;
  }

  // Sender label — user and assistant only; tool/error are system messages
  if (role === "user" || role === "assistant") {
    const sender = document.createElement("div");
    sender.className = "msg-sender";
    sender.textContent = role === "user" ? "You" : "Assistant";
    div.appendChild(sender);
  }

  // Attachment previews for user messages
  if (role === "user" && msgAttachments && msgAttachments.length > 0) {
    div.appendChild(renderMsgAttachments(msgAttachments));
  }

  // Content wrapper — isolates text/HTML from metadata siblings
  const content = document.createElement("div");
  content.className = "msg-content";
  if (role === "assistant") {
    div.classList.add("msg-markdown");
    content.innerHTML = window.renderMarkdown(text);
  } else {
    content.textContent = text;
  }
  div.appendChild(content);

  if (role === "assistant") {
    window.addCodeBlockCopyButtons(div);
  }

  aiMessages.insertBefore(div, aiScrollSentinel);

  // Footer row (outside bubble): timestamp + action buttons
  const footer = document.createElement("div");
  footer.className = `msg-footer msg-footer-${role}`;
  const time = document.createElement("span");
  time.className = "msg-time";
  time.textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (role === "assistant") {
    footer.appendChild(time);
    attachMsgActions(footer, role, text, div);
  } else if (role === "user") {
    attachMsgActions(footer, role, text, div);
    footer.appendChild(time);
  } else {
    footer.appendChild(time);
  }
  aiMessages.insertBefore(footer, aiScrollSentinel);
  div._footer = footer;
  aiEmptyState.classList.add("hidden");
  scrollMessages();
  return div;
}

function renderHistoricMessage(msg, msgIndex) {
  const { role, content, timestamp, attachments: msgAttachments, toolName, toolInput } = msg;

  // Tool use: render with styled tool bubble
  if (role === "tool" && toolName) {
    addToolUseBubble(toolName, toolInput || {});
    return;
  }

  // Tool result: render with styled result bubble
  if (role === "tool_result" && content) {
    addToolResultBubble(content);
    return;
  }

  const div = document.createElement("div");
  div.className = `msg msg-${role}`;

  if (role === "user" && msgIndex !== undefined) {
    div.dataset.msgIndex = msgIndex;
  }

  if (role === "user" || role === "assistant") {
    const sender = document.createElement("div");
    sender.className = "msg-sender";
    sender.textContent = role === "user" ? "You" : "Assistant";
    div.appendChild(sender);
  }

  // Attachment previews for user messages
  if (role === "user" && msgAttachments && msgAttachments.length > 0) {
    div.appendChild(renderMsgAttachments(msgAttachments));
  }

  const contentDiv = document.createElement("div");
  contentDiv.className = "msg-content";
  if (role === "assistant") {
    div.classList.add("msg-markdown");
    contentDiv.innerHTML = window.renderMarkdown(content);
    window.addCodeBlockCopyButtons(div);
  } else {
    contentDiv.textContent = content;
  }
  div.appendChild(contentDiv);

  aiMessages.insertBefore(div, aiScrollSentinel);

  // Footer row (outside bubble): timestamp + action buttons
  if (timestamp || role === "user" || role === "assistant") {
    const footer = document.createElement("div");
    footer.className = `msg-footer msg-footer-${role}`;

    const time = timestamp ? document.createElement("span") : null;
    if (time) {
      time.className = "msg-time";
      time.textContent = new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    }

    if (role === "assistant") {
      if (time) footer.appendChild(time);
      attachMsgActions(footer, role, content, div);
    } else if (role === "user") {
      attachMsgActions(footer, role, content, div);
      if (time) footer.appendChild(time);
    } else if (time) {
      footer.appendChild(time);
    }

    aiMessages.insertBefore(footer, aiScrollSentinel);
    div._footer = footer;
  }
  aiEmptyState.classList.add("hidden");
}

function attachMsgActions(container, role, msgText, msgDiv) {
  const bar = document.createElement("div");
  bar.className = "msg-actions";

  if (role === "user") {
    // Edit button
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "msg-action-btn";
    editBtn.title = "Edit message";
    editBtn.setAttribute("aria-label", "Edit message");
    editBtn.innerHTML = ICONS.edit;
    editBtn.addEventListener("click", () => {
      const msgIndex = parseInt(msgDiv.dataset.msgIndex, 10);
      startMessageEdit(msgDiv, msgIndex);
    });
    bar.appendChild(editBtn);
  }

  // Copy button (both roles)
  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "msg-action-btn";
  copyBtn.title = "Copy message";
  copyBtn.setAttribute("aria-label", "Copy message");
  copyBtn.innerHTML = ICONS.copy;
  copyBtn.addEventListener("click", () => {
    if (copyBtn.classList.contains("copied")) return;
    navigator.clipboard.writeText(msgText).then(() => {
      copyBtn.innerHTML = ICONS.check;
      copyBtn.classList.add("copied");
      setTimeout(() => {
        copyBtn.innerHTML = ICONS.copy;
        copyBtn.classList.remove("copied");
      }, 1500);
    }).catch((err) => {
      console.error("Copy failed:", err);
    });
  });
  bar.appendChild(copyBtn);

  if (role === "assistant") {
    // Regenerate button
    const regenBtn = document.createElement("button");
    regenBtn.type = "button";
    regenBtn.className = "msg-action-btn";
    regenBtn.title = "Regenerate response";
    regenBtn.setAttribute("aria-label", "Regenerate response");
    regenBtn.innerHTML = ICONS.regenerate;
    regenBtn.addEventListener("click", () => {
      regenerateMessage(msgDiv);
    });
    bar.appendChild(regenBtn);
  }

  container.appendChild(bar);
}

async function regenerateMessage(msgDiv) {
  if (isBusy || !currentConversation) return;

  // Find this assistant message's index
  const allMsgEls = Array.from(aiMessages.querySelectorAll(".msg:not(.msg-tool)"));
  const domIndex = allMsgEls.indexOf(msgDiv);
  // Map to model index: count user/assistant msgs up to this DOM position
  let modelIndex = -1;
  let counted = 0;
  for (let i = 0; i < currentConversation.messages.length; i++) {
    const m = currentConversation.messages[i];
    if (m.role === "user" || m.role === "assistant") {
      if (counted === domIndex) { modelIndex = i; break; }
      counted++;
    }
  }
  if (modelIndex < 0) return;

  // Find the preceding user message
  let userMsgIndex = -1;
  for (let i = modelIndex - 1; i >= 0; i--) {
    if (currentConversation.messages[i].role === "user") {
      userMsgIndex = i;
      break;
    }
  }
  if (userMsgIndex < 0) return;

  const userMsg = currentConversation.messages[userMsgIndex];
  const msgAttachments = userMsg.attachments;

  // Remove tool messages, assistant message, and everything after from model
  currentConversation.messages.splice(userMsgIndex + 1);

  // Remove from DOM: walk backwards to remove preceding tool bubbles
  let prev = msgDiv.previousElementSibling;
  while (prev && prev.classList.contains("msg-tool")) {
    const toRemove = prev;
    prev = prev.previousElementSibling;
    toRemove.remove();
  }
  // Remove assistant message and everything after it
  let next = msgDiv;
  while (next) {
    const toRemove = next;
    next = next.nextElementSibling;
    if (toRemove !== aiScrollSentinel) toRemove.remove();
  }

  // Reset backend session
  currentConversation.sessionId = null;
  resetLastSentContext();
  await window.api.newConversation();

  // Build context prompt (same logic as executeMessageEdit)
  let userPrompt = userMsg.content;
  if (msgAttachments && msgAttachments.length > 0) {
    const fileList = msgAttachments.map((a) => `- ${a.filePath}`).join("\n");
    const header = `[User has attached ${msgAttachments.length} file(s). Read them to see their content:]\n${fileList}`;
    userPrompt = userPrompt ? `${header}\n\n${userPrompt}` : header;
  }

  let prompt;
  if (userMsgIndex === 0) {
    prompt = userPrompt;
  } else {
    const prior = currentConversation.messages.slice(0, userMsgIndex);
    const contextLines = prior.map((m) => {
      const label = m.role === "user" ? "User" : "Assistant";
      return `${label}: ${m.content}`;
    }).join("\n");
    prompt = `[Previous conversation]\n${contextLines}\n\n[Current message]\n${userPrompt}`;
  }

  // Send to Claude
  showThinkingIndicator();
  isBusy = true;
  aiSend.disabled = true;
  aiProviderSelect.disabled = true;
  aiModelSelect.disabled = true;
  aiEffortSelect.disabled = true;
  aiPermissionSelect.disabled = true;
  aiCancel.classList.remove("hidden");
  const historyMessages = currentConversation?.messages?.map(m => ({ role: m.role, content: m.content })) || null;
  window.api.sendToClaude(prompt, historyMessages);
}

function cancelMessageEdit(msgDiv) {
  const editor = msgDiv.querySelector(".msg-edit-inline");
  if (editor) editor.remove();
  const contentEl = msgDiv.querySelector(".msg-content");
  if (contentEl) contentEl.style.display = "";
  if (msgDiv._footer) msgDiv._footer.style.display = "";
}

function startMessageEdit(msgDiv, msgIndex) {
  if (isBusy) return;

  // Cancel any existing open editor first (only one at a time)
  const existingEditor = aiMessages.querySelector(".msg-edit-inline");
  if (existingEditor) {
    cancelMessageEdit(existingEditor.closest(".msg"));
  }

  const originalText = currentConversation.messages[msgIndex].content;

  // Hide original content and footer
  const contentEl = msgDiv.querySelector(".msg-content");
  contentEl.style.display = "none";
  if (msgDiv._footer) msgDiv._footer.style.display = "none";

  // Build inline editor
  const editor = document.createElement("div");
  editor.className = "msg-edit-inline";

  const textarea = document.createElement("textarea");
  textarea.className = "msg-edit-textarea";
  textarea.value = originalText;

  const actions = document.createElement("div");
  actions.className = "msg-edit-actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "msg-edit-cancel";
  cancelBtn.textContent = "Cancel";

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "msg-edit-save";
  saveBtn.textContent = "Save & Send";

  actions.appendChild(cancelBtn);
  actions.appendChild(saveBtn);
  editor.appendChild(textarea);
  editor.appendChild(actions);

  // Insert editor after .msg-content (before timestamp)
  msgDiv.insertBefore(editor, contentEl.nextSibling);

  // Auto-size textarea to content
  textarea.style.height = "auto";
  textarea.style.height = textarea.scrollHeight + "px";

  // Focus with cursor at end
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);

  // Handlers
  cancelBtn.addEventListener("click", () => cancelMessageEdit(msgDiv));

  saveBtn.addEventListener("click", () => {
    const newText = textarea.value.trim();
    if (!newText) return;
    executeMessageEdit(msgDiv, msgIndex, newText);
  });

  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      cancelMessageEdit(msgDiv);
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const newText = textarea.value.trim();
      if (!newText) return;
      executeMessageEdit(msgDiv, msgIndex, newText);
    }
  });
}

async function executeMessageEdit(msgDiv, msgIndex, newText) {
  // 1. Update in-memory model (preserve attachments)
  const msgAttachments = currentConversation.messages[msgIndex].attachments;
  currentConversation.messages[msgIndex].content = newText;
  currentConversation.messages.splice(msgIndex + 1); // remove all after edited message

  // 2. Remove all DOM message elements after the edited message (keep sentinel)
  let next = msgDiv.nextElementSibling;
  while (next) {
    const toRemove = next;
    next = next.nextElementSibling;
    if (toRemove !== aiScrollSentinel) toRemove.remove();
  }

  // Restore message display (remove editor, show updated content)
  cancelMessageEdit(msgDiv);
  const contentEl = msgDiv.querySelector(".msg-content");
  contentEl.textContent = newText;

  // 3. Reset backend session
  currentConversation.sessionId = null;
  resetLastSentContext();
  await window.api.newConversation();

  // 4. Build context prompt
  // Prepend attachment paths for the edited message if it had attachments
  let editedMsgPrompt = newText;
  if (msgAttachments && msgAttachments.length > 0) {
    const fileList = msgAttachments.map((a) => `- ${a.filePath}`).join("\n");
    const header = `[User has attached ${msgAttachments.length} file(s). Read them to see their content:]\n${fileList}`;
    editedMsgPrompt = newText ? `${header}\n\n${newText}` : header;
  }

  let prompt;
  if (msgIndex === 0) {
    prompt = editedMsgPrompt;
  } else {
    const prior = currentConversation.messages.slice(0, msgIndex);
    const contextLines = prior.map((m) => {
      const label = m.role === "user" ? "User" : "Assistant";
      return `${label}: ${m.content}`;
    }).join("\n");
    prompt = `[Previous conversation]\n${contextLines}\n\n[Current message]\n${editedMsgPrompt}`;
  }

  // 5. Send to Claude (same flow as form submit)
  showThinkingIndicator();
  isBusy = true;
  aiSend.disabled = true;
  aiProviderSelect.disabled = true;
  aiModelSelect.disabled = true;
  aiEffortSelect.disabled = true;
  aiPermissionSelect.disabled = true;
  aiCancel.classList.remove("hidden");
  const historyMessages = currentConversation?.messages?.map(m => ({ role: m.role, content: m.content })) || null;
  window.api.sendToClaude(prompt, historyMessages);
}

function showThinkingIndicator() {
  const div = document.createElement("div");
  div.className = "msg msg-assistant msg-thinking glass";
  for (let i = 0; i < 3; i++) {
    const span = document.createElement("span");
    span.className = "dot";
    div.appendChild(span);
  }
  aiMessages.insertBefore(div, aiScrollSentinel);
  aiEmptyState.classList.add("hidden");
  scrollMessages();
  thinkingIndicator = div;
}

function removeThinkingIndicator() {
  if (thinkingIndicator) {
    thinkingIndicator.remove();
    thinkingIndicator = null;
  }
}

function scrollMessages() {
  if (isAtBottom) {
    aiMessages.scrollTop = aiMessages.scrollHeight;
  }
}

// --- Expand / Collapse (4 states: hidden, collapsed, half, full) ---

let aiExpandState = 'hidden';

const _expandIcons = {
  collapsed: '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9L7 5L11 9"/></svg>',
  half:      '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11L7 7L11 11"/><path d="M3 7L7 3L11 7"/></svg>',
  full:      '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5L7 9L11 5"/></svg>',
};

function setExpanded(expanded) {
  if (typeof expanded === 'string') {
    _setAiExpandState(expanded);
  } else {
    _setAiExpandState(expanded ? 'half' : 'hidden');
  }
}

const _collapseIcon = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5L7 9L11 5"/></svg>';
const _closeIcon = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3L11 11M11 3L3 11"/></svg>';

function _setAiExpandState(state) {
  aiExpandState = state;
  const isHidden = state === 'hidden';
  const isCollapsed = state === 'collapsed';
  const isVisible = !isHidden && !isCollapsed;
  aiPanel.classList.toggle("hidden", isHidden);
  aiPanel.classList.toggle("expanded", isVisible);
  aiPanel.classList.toggle("fully-expanded", state === 'full');
  if (isVisible) {
    const hasMessages = aiMessages.querySelectorAll(".msg").length > 0;
    aiEmptyState.classList.toggle("hidden", hasMessages);
  }
  aiExpandToggle.innerHTML = _expandIcons[state] || _expandIcons['collapsed'];
  aiExpandToggle.title = state === 'full' ? 'Collapse chat' : state === 'half' ? 'Fully expand chat' : 'Expand chat';
  aiExpandToggle.classList.toggle("hidden", state === 'full');
  // In collapsed: show X to close/hide; in half/full: show down-chevron to collapse
  aiCollapseBtn.classList.toggle("hidden", isHidden);
  aiCollapseBtn.innerHTML = isCollapsed ? _closeIcon : _collapseIcon;
  aiCollapseBtn.title = isCollapsed ? 'Close chat' : 'Collapse chat';
  // Sync bottom bar chat button active state
  const chatBtn = document.getElementById('bottom-chat-btn');
  if (chatBtn) chatBtn.classList.toggle('active', !isHidden);
  syncBottomBarDisclaimer();
  requestAnimationFrame(updateHistoryPanelHeight);
}

aiCollapseBtn.addEventListener("click", () => {
  closeHistoryPanel();
  if (aiExpandState === 'collapsed') {
    setExpanded('hidden');
  } else {
    setExpanded('collapsed');
  }
});

aiExpandToggle.addEventListener("click", () => {
  if (aiExpandState === 'collapsed') {
    setExpanded('half');
  } else if (aiExpandState === 'half') {
    setExpanded('full');
  } else {
    closeHistoryPanel();
    setExpanded('collapsed');
  }
});

function syncBottomBarDisclaimer() {
  const bar = document.getElementById('bottom-bar');
  if (!bar) return;
  const anyActive = bar.querySelector('button.active') !== null;
  bar.classList.toggle('panel-active', anyActive);
}

// --- Bottom bar toggle buttons ---

(function() {
  const chatBtn = document.getElementById('bottom-chat-btn');
  const termBtn = document.getElementById('bottom-terminal-btn');

  if (chatBtn) chatBtn.addEventListener('click', () => {
    if (aiExpandState !== 'hidden') {
      // Chat is visible — hide it
      closeHistoryPanel();
      setExpanded('hidden');
    } else {
      // Open chat, close terminal
      window.api.isTerminalVisible().then(visible => {
        if (visible) window.api.toggleTerminal();
      });
      setExpanded('half');
    }
  });

  if (termBtn) termBtn.addEventListener('click', () => {
    window.api.toggleTerminal();
  });
})();

// --- History panel ---

function updateHistoryPanelHeight() {
  const inputRow = document.getElementById("ai-input-row");
  const header = document.getElementById("ai-header");
  if (!inputRow || !header || aiHistoryPanel.classList.contains("hidden")) return;
  const headerRect = header.getBoundingClientRect();
  const inputRect = inputRow.getBoundingClientRect();
  const available = inputRect.top - headerRect.bottom;
  aiHistoryPanel.style.maxHeight = Math.max(available, 0) + "px";
}

window.addEventListener("resize", updateHistoryPanelHeight);

function closeHistoryPanel() {
  aiHistoryPanel.classList.add("hidden");
  aiHistory.classList.remove("active");
}

aiHistory.addEventListener("click", async () => {
  const isOpen = !aiHistoryPanel.classList.contains("hidden");
  if (isOpen) {
    closeHistoryPanel();
  } else {
    // Auto-expand to half state if collapsed
    if (aiExpandState === 'collapsed') {
      _setAiExpandState('half');
    }
    historyItems = await window.api.listConversations();
    renderHistoryList(historyItems);
    aiHistoryPanel.classList.remove("hidden");
    aiHistory.classList.add("active");
    updateHistoryPanelHeight();
    aiHistorySearch.value = "";
    aiHistorySearch.focus();
  }
});

aiHistorySearch.addEventListener("input", () => {
  const q = aiHistorySearch.value.trim().toLowerCase();
  if (!q) {
    renderHistoryList(historyItems);
  } else {
    const filtered = historyItems.filter(item =>
      item.title?.toLowerCase().includes(q) ||
      item.firstMessage?.toLowerCase().includes(q)
    );
    renderHistoryList(filtered);
  }
});

function formatHistoryDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function renderHistoryList(items) {
  aiHistoryList.innerHTML = '';
  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'history-empty';
    empty.textContent = 'No conversations yet.';
    aiHistoryList.appendChild(empty);
    return;
  }
  for (const item of items) {
    const div = document.createElement('div');
    div.className = 'history-item';
    div.dataset.id = item.id;
    if (currentConversation?.id === item.id) {
      div.classList.add('history-item--active');
    }

    const title = document.createElement('div');
    title.className = 'history-item-title';
    title.textContent = item.title || 'Untitled';
    div.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'history-item-meta';
    const msgWord = item.messageCount === 1 ? 'message' : 'messages';
    meta.textContent = `${formatHistoryDate(item.updatedAt)} · ${item.messageCount} ${msgWord}`;
    div.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'history-item-actions';

    const renameBtn = document.createElement('button');
    renameBtn.className = 'history-rename';
    renameBtn.title = 'Rename';
    renameBtn.textContent = '✎';
    renameBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      startHistoryRename(div, item);
    });
    actions.appendChild(renameBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'history-delete';
    deleteBtn.title = 'Delete';
    deleteBtn.textContent = '✕';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteHistoryConversation(div, item.id);
    });
    actions.appendChild(deleteBtn);

    div.appendChild(actions);
    div.addEventListener('click', () => loadHistoryConversation(item.id));
    aiHistoryList.appendChild(div);
  }
}

async function loadHistoryConversation(id) {
  await saveCurrentConversationIfNeeded();

  const conv = await window.api.loadConversation(id);
  if (!conv) return;

  aiMessages.querySelectorAll(".msg, .msg-footer").forEach(el => el.remove());
  aiEmptyState.classList.add("hidden");

  for (let i = 0; i < conv.messages.length; i++) {
    renderHistoricMessage(conv.messages[i], i);
  }
  scrollMessages();

  currentConversation = conv;
  updateChatTitle(conv.title);
  const providerToLoad = conv.provider || aiProviderSelect.options[0]?.value || '';
  aiProviderSelect.value = aiProviderSelect.querySelector(`option[value="${providerToLoad}"]`)
    ? providerToLoad
    : (aiProviderSelect.options[0]?.value || '');
  await window.api.setActiveProvider(aiProviderSelect.value);

  // Restore model, effort, and permission from conversation settings
  await populateModelDropdown(aiProviderSelect.value, conv.model);
  await populateEffortDropdown(aiProviderSelect.value, conv.effort);
  await populatePermissionDropdown(aiProviderSelect.value, conv.permissionMode);

  const userMsgCount = conv.messages.filter(m => m.role === 'user').length;
  await window.api.resumeConversation(conv.sessionId, userMsgCount);

  closeHistoryPanel();
  setExpanded(true);

}

function startHistoryRename(div, item) {
  const titleEl = div.querySelector('.history-item-title');
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'history-rename-input';
  input.value = item.title || '';
  titleEl.replaceWith(input);
  input.select();

  let committed = false;
  async function commit() {
    if (committed) return;
    committed = true;
    const newTitle = input.value.trim() || item.title || 'Untitled';
    await window.api.updateConversationTitle(item.id, newTitle);

    const cached = historyItems.find(i => i.id === item.id);
    if (cached) cached.title = newTitle;

    if (currentConversation?.id === item.id) {
      currentConversation.title = newTitle;
      updateChatTitle(newTitle);
    }

    const newTitleEl = document.createElement('div');
    newTitleEl.className = 'history-item-title';
    newTitleEl.textContent = newTitle;
    input.replaceWith(newTitleEl);
    item.title = newTitle;
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') {
      committed = true;
      const restoredTitle = document.createElement('div');
      restoredTitle.className = 'history-item-title';
      restoredTitle.textContent = item.title || 'Untitled';
      input.replaceWith(restoredTitle);
    }
  });
  input.addEventListener('blur', commit);
}

async function deleteHistoryConversation(div, id) {
  if (!confirm('Delete this conversation? This cannot be undone.')) return;

  await window.api.deleteConversation(id);

  const idx = historyItems.findIndex(i => i.id === id);
  if (idx !== -1) historyItems.splice(idx, 1);
  div.remove();

  if (currentConversation?.id === id) {
    aiMessages.querySelectorAll(".msg, .msg-footer").forEach(el => el.remove());
    aiEmptyState.classList.remove("hidden");
    setExpanded(false);
    window.api.newConversation();
    resetLastSentContext();
    currentConversation = newConversationObj();
    updateChatTitle(null);
  }
}

// --- New conversation ---

aiNew.addEventListener("click", async () => {
  if (currentConversation && currentConversation.messages.length > 0) {
    await window.api.saveConversation(currentConversation);
  }
  window.api.newConversation();
  resetLastSentContext();
  aiMessages.querySelectorAll(".msg, .msg-footer").forEach(el => el.remove());
  aiEmptyState.classList.remove("hidden");
  currentConversation = newConversationObj();
  updateChatTitle(null);
  clearContextItems();
  closeHistoryPanel();
});

SecuritySettings.init();
EndpointsSettings.init();
OpenClawRemotesSettings.init();

aiProviderSelect.addEventListener('change', async () => {
  const newProvider = aiProviderSelect.value;

  // Save current conversation if non-empty
  if (currentConversation && currentConversation.messages.length > 0) {
    await window.api.saveConversation(currentConversation);
  }

  // Reset conversation state in main process
  await window.api.newConversation();

  // Switch provider in main process
  await window.api.setActiveProvider(newProvider);

  // Persist as last-used provider
  await window.api.setLastProvider(newProvider);

  // Update model dropdown for new provider
  await populateModelDropdown(newProvider);
  await populateEffortDropdown(newProvider);
  await populatePermissionDropdown(newProvider);

  // Reset conversation in renderer (same as clicking New)
  resetLastSentContext();
  aiMessages.querySelectorAll('.msg, .msg-footer').forEach(el => el.remove());
  aiEmptyState.classList.remove('hidden');
  currentConversation = newConversationObj();
  updateChatTitle(null);
  clearContextItems();
  closeHistoryPanel();
});

aiModelSelect.addEventListener('change', async () => {
  const providerName = aiProviderSelect.value;
  const modelId = aiModelSelect.value;
  await window.api.setLastModel(providerName, modelId);
  const isDefault = aiModelSelect.selectedIndex === 0;
  await window.api.setActiveModel(isDefault ? null : modelId);
});

aiEffortSelect.addEventListener('change', async () => {
  const providerName = aiProviderSelect.value;
  const effortId = aiEffortSelect.value;
  await window.api.setLastEffort(providerName, effortId);
  const isDefault = effortId === 'default';
  await window.api.setActiveEffort(isDefault ? null : effortId);
});

aiPermissionSelect.addEventListener('change', async () => {
  const providerName = aiProviderSelect.value;
  const mode = aiPermissionSelect.value;
  await window.api.setLastPermissionMode(providerName, mode);
  await window.api.setActivePermissionMode(mode);
});

aiAttach.addEventListener("click", async () => {
  const files = await window.api.browseFiles();
  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) {
      addMessageBubble("error", `File "${file.filename}" exceeds the 10 MB size limit.`);
      continue;
    }
    const isImage = file.mimeType.startsWith("image/");
    let objectUrl = null;
    if (isImage) {
      const preview = await window.api.readFilePreview(file.filePath);
      if (preview) {
        objectUrl = `data:${preview.mimeType};base64,${preview.data}`;
      }
    }
    attachments.push({
      filePath: file.filePath,
      filename: file.filename,
      mimeType: file.mimeType,
      objectUrl,
      isImage,
    });
  }
  renderAttachments();
  aiInput.focus();
});

aiActiveNoteToggle.addEventListener('click', () => {
  activeNoteToggleOn = !activeNoteToggleOn;
  updateActiveNoteToggleUI();
  saveActiveNoteToggle();
  if (!activeNoteToggleOn) {
    const hadItems = contextItems.some(ci => ci.type === 'active-note');
    contextItems = contextItems.filter(ci => ci.type !== 'active-note');
    if (hadItems) onContextItemsChanged();
  }
  _pushContextCurrentNote();
});

// Feature 117: Use template button — copy template directly into workspace
aiUseTemplate.addEventListener("click", async () => {
  if (!currentWorkspacePath) {
    _showSyncToast("No workspace open.");
    return;
  }

  // 1. Fetch current templates
  let templates;
  try {
    templates = await window.api.templatesList();
  } catch {
    _showSyncToast("Could not load templates.");
    return;
  }

  // 2. Filter out blank template
  const nonBlank = templates.filter(t => t.id !== 'blank');
  if (nonBlank.length === 0) {
    _showSyncToast("No templates available.");
    return;
  }

  // 3. Open picker (without Blank option)
  const selected = await TemplatePicker.open(nonBlank, { excludeBlank: true });
  if (selected === null) return; // user cancelled

  // 4. Generate note name: "{name} - Template - {date}"
  const dateStr = new Date().toISOString().slice(0, 10);
  const baseName = `${selected.name} - Template - ${dateStr}`;
  let noteName = baseName;
  let destPath = currentWorkspacePath + "/" + noteName;

  // 5. Handle name collisions by appending a counter
  let counter = 2;
  while (await window.api.pathExists(destPath)) {
    noteName = `${baseName} ${counter}`;
    destPath = currentWorkspacePath + "/" + noteName;
    counter++;
  }

  // 6. Copy template folder to workspace
  try {
    const result = await window.api.createNoteFromTemplate(destPath, selected.path);
    if (!result || !result.success) throw new Error(result?.error || "copy failed");
  } catch (err) {
    _showSyncToast("Failed to create note from template.");
    console.error("Template copy failed:", err.message);
    return;
  }

  // 7. Refresh sidebar tree and open the new note
  currentTree = await window.api.listNotes();
  renderFilteredTree();
  selectNote(destPath + "/index.html", noteName);
});

// --- Claude AI ---

function renderAttachments() {
  aiAttachments.innerHTML = "";
  if (attachments.length === 0) {
    aiAttachments.classList.add("hidden");
    return;
  }
  aiAttachments.classList.remove("hidden");
  attachments.forEach((att, i) => {
    const thumb = document.createElement("div");
    thumb.className = "attachment-thumb";

    if (att.objectUrl) {
      const img = document.createElement("img");
      img.src = att.objectUrl;
      img.alt = att.filename;
      thumb.appendChild(img);
    } else {
      thumb.classList.add("attachment-thumb--file");
      const iconSvg = getFileIcon({ name: att.filename, type: "file" }, false);
      const iconWrapper = document.createElement("div");
      iconWrapper.innerHTML = iconSvg;
      thumb.appendChild(iconWrapper.firstElementChild);
      const label = document.createElement("span");
      label.textContent = att.filename;
      thumb.appendChild(label);
    }

    const btn = document.createElement("button");
    btn.className = "attachment-remove";
    btn.type = "button";
    btn.textContent = "×";
    btn.addEventListener("click", () => removeAttachment(i));
    thumb.appendChild(btn);

    aiAttachments.appendChild(thumb);
  });
}

function removeAttachment(index) {
  const att = attachments[index];
  if (att?.objectUrl) URL.revokeObjectURL(att.objectUrl);
  attachments.splice(index, 1);
  renderAttachments();
}

function renderContextBar() {
  aiContextBar.innerHTML = '';
  if (contextItems.length === 0) {
    aiContextBar.classList.add('hidden');
    return;
  }
  aiContextBar.classList.remove('hidden');

  const iconMap = {
    selection: ICONS.quote,
    'note-ref': ICONS.fileEarmark,
    'active-note': ICONS.eye,
  };

  contextItems.forEach((item, i) => {
    let labelText;
    if (item.type === 'selection') {
      const raw = (item.content || '').trim();
      labelText = raw.length > 30 ? raw.slice(0, 30) + '\u2026' : raw;
    } else {
      const raw = (item.noteTitle || item.path || '').trim();
      labelText = raw.length > 30 ? raw.slice(0, 30) + '\u2026' : raw;
    }

    const pill = document.createElement('div');
    pill.className = 'context-pill';
    pill.dataset.index = i;

    const iconSpan = document.createElement('span');
    iconSpan.className = 'context-pill-icon';
    iconSpan.innerHTML = iconMap[item.type] || ICONS.generic;

    const labelSpan = document.createElement('span');
    labelSpan.className = 'context-pill-label';
    labelSpan.textContent = labelText;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'context-pill-remove';
    removeBtn.type = 'button';
    removeBtn.textContent = '\u00d7';
    removeBtn.addEventListener('click', () => removeContextItem(i));

    pill.appendChild(iconSpan);
    pill.appendChild(labelSpan);
    pill.appendChild(removeBtn);
    aiContextBar.appendChild(pill);
  });
}

function clearAttachments() {
  for (const att of attachments) {
    if (att.objectUrl) URL.revokeObjectURL(att.objectUrl);
  }
  attachments = [];
  renderAttachments();
}

aiInput.addEventListener("keydown", (e) => {
  if (!atDropdown.classList.contains('hidden')) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const limit = Math.min(dropdownFiltered.length, 8);
      if (limit > 0) {
        dropdownSelectedIndex = (dropdownSelectedIndex + 1) % limit;
        renderDropdown();
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const limit = Math.min(dropdownFiltered.length, 8);
      if (limit > 0) {
        dropdownSelectedIndex = (dropdownSelectedIndex - 1 + limit) % limit;
        renderDropdown();
      }
      return;
    }
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      selectDropdownItem(dropdownSelectedIndex);
      return;
    }
  }
  if (e.key === "Escape" && atTrigger !== null) {
    e.preventDefault();
    atTrigger = null;
    _notifyAtTriggerChange();
    return;
  }
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    aiForm.requestSubmit();
  }
});

function autoResizeInput() {
  aiInput.style.height = "auto";
  const maxH = 150;
  const newH = Math.min(aiInput.scrollHeight, maxH);
  aiInput.style.height = newH + "px";
  aiInput.style.overflowY = aiInput.scrollHeight > maxH ? "auto" : "hidden";
}

async function updateUseTemplateVisibility() {
  try {
    const templates = await window.api.templatesList();
    const hasNonBlank = templates.some(t => t.id !== 'blank');
    aiUseTemplate.classList.toggle('hidden', !hasNonBlank);
  } catch {
    aiUseTemplate.classList.add('hidden');
  }
}

aiInput.addEventListener("input", autoResizeInput);
aiInput.addEventListener("input", updateAtTrigger);
aiInput.addEventListener("keyup", (e) => {
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) {
    updateAtTrigger();
  }
});
aiInput.addEventListener("click", updateAtTrigger);

setOnAtTriggerChange(async (trigger) => {
  if (trigger && trigger.active) {
    if (atDropdown.classList.contains('hidden')) {
      await showDropdown(trigger); // first activation: fetch notes
    } else {
      updateDropdown(trigger.query); // query changed: re-filter cached list
    }
  } else {
    hideDropdown(); // trigger cancelled
  }
});

setOnNoteSelected(({ note, atIndex, query }) => {
  // 1. Add context item (addContextItem handles dedup internally)
  addContextItem({
    type: 'note-ref',
    path: note.path,
    noteTitle: note.title || note.name,
  });

  // 2. Remove the @query text from the textarea
  const removeStart = atIndex;
  const removeEnd = atIndex + 1 + query.length;
  aiInput.value = aiInput.value.slice(0, removeStart) + aiInput.value.slice(removeEnd);

  // 3. Restore cursor to where the '@' was
  aiInput.selectionStart = removeStart;
  aiInput.selectionEnd = removeStart;

  // 4. Ensure textarea focus (needed after click-based selection)
  aiInput.focus();

  // 5. Dispatch 'input' to trigger auto-resize and updateAtTrigger() safety net
  aiInput.dispatchEvent(new Event('input', { bubbles: true }));
});

atDropdown.addEventListener('click', (e) => {
  const item = e.target.closest('.at-dropdown-item');
  if (!item) return;
  const index = parseInt(item.dataset.index, 10);
  selectDropdownItem(index);
});

atDropdown.addEventListener('mousemove', (e) => {
  const item = e.target.closest('.at-dropdown-item');
  if (!item) return;
  const index = parseInt(item.dataset.index, 10);
  if (index !== dropdownSelectedIndex) {
    dropdownSelectedIndex = index;
    atDropdown.querySelectorAll('.at-dropdown-item').forEach((el, i) => {
      el.classList.toggle('active', i === dropdownSelectedIndex);
    });
  }
});

document.addEventListener('mousedown', (e) => {
  if (atDropdown.classList.contains('hidden')) return;
  if (atDropdown.contains(e.target)) return;
  if (e.target === aiInput) return;
  atTrigger = null;
  _notifyAtTriggerChange();
});

aiInput.addEventListener("paste", (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;

  const SUPPORTED = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
  const imageItems = Array.from(items).filter((item) => SUPPORTED.has(item.type));

  if (imageItems.length === 0) return;

  e.preventDefault();

  for (const item of imageItems) {
    const blob = item.getAsFile();
    if (!blob) continue;

    const ext = item.type.split("/")[1].replace("jpeg", "jpg");
    const filename = `paste-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
    const objectUrl = URL.createObjectURL(blob);

    attachments.push({ blob, filename, mimeType: item.type, objectUrl });
  }

  renderAttachments();
  aiInput.focus();
});

// --- Drag & drop file attachment ---

aiForm.addEventListener("dragenter", (e) => {
  if (!e.dataTransfer.types.includes("Files")) return;
  e.preventDefault();
  dragFileCounter++;
  if (dragFileCounter === 1) {
    aiForm.classList.add("drag-over");
    aiDropOverlay.classList.remove("hidden");
  }
});

aiForm.addEventListener("dragover", (e) => {
  if (!e.dataTransfer.types.includes("Files")) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
});

aiForm.addEventListener("dragleave", () => {
  dragFileCounter--;
  if (dragFileCounter <= 0) {
    dragFileCounter = 0;
    aiForm.classList.remove("drag-over");
    aiDropOverlay.classList.add("hidden");
  }
});

aiForm.addEventListener("drop", async (e) => {
  e.preventDefault();
  dragFileCounter = 0;
  aiForm.classList.remove("drag-over");
  aiDropOverlay.classList.add("hidden");

  const files = Array.from(e.dataTransfer.files);
  for (const file of files) {
    if (!file.path) continue;
    if (file.size > MAX_FILE_SIZE) {
      addMessageBubble("error", `File "${file.name}" exceeds the 10 MB size limit.`);
      continue;
    }
    const mimeType = file.type || "application/octet-stream";
    const isImage = mimeType.startsWith("image/");
    let objectUrl = null;
    if (isImage) {
      const preview = await window.api.readFilePreview(file.path);
      if (preview) {
        objectUrl = `data:${preview.mimeType};base64,${preview.data}`;
      }
    }
    attachments.push({
      filePath: file.path,
      filename: file.name,
      mimeType,
      objectUrl,
      isImage,
    });
  }
  renderAttachments();
  aiInput.focus();
});

aiForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = aiInput.value.trim();
  const hasAttachments = attachments.length > 0;
  if ((!text && !hasAttachments) || isBusy) return;

  // Save/collect attachment paths + metadata
  const savedAttachments = []; // { filePath, filename, mimeType, isImage }
  for (const att of attachments) {
    if (att.filePath) {
      // File-picker attachment: reference original path directly
      savedAttachments.push({
        filePath: att.filePath,
        filename: att.filename,
        mimeType: att.mimeType,
        isImage: att.isImage || att.mimeType?.startsWith("image/") || false,
      });
    } else {
      // Paste attachment: save blob to temp dir
      const arrayBuffer = await att.blob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);
      const result = await window.api.saveTempImage(att.filename, base64);
      if (result?.success) {
        savedAttachments.push({
          filePath: result.tempPath,
          filename: att.filename,
          mimeType: att.mimeType,
          isImage: att.mimeType?.startsWith("image/") || false,
        });
      }
    }
  }

  const savedPaths = savedAttachments.map((a) => a.filePath);

  // Auto-include active note if toggle is on
  let perNoteContext = null;
  if (activeNoteToggleOn) {
    contextItems = contextItems.filter(ci => ci.type !== 'active-note');
    const focusedPanel = TabState.getFocusedPanel();
    const activeTab = focusedPanel ? TabState.getActiveTab(focusedPanel.id) : null;
    if (activeTab && activeTab.filePath) {
      addContextItem({ type: 'active-note', path: activeTab.filePath, noteTitle: activeTab.title || activeTab.filePath });
      // Fetch per-note context (KV schema + memory.md)
      const noteId = noteIdFromPath(activeTab.filePath);
      const [kvSchema, memory] = await Promise.all([
        window.storageInspector.kvSchema(noteId),
        window.storageInspector.readMemory(noteId),
      ]);
      if (kvSchema || memory) {
        perNoteContext = { noteTitle: activeTab.title || noteId, kvSchema, memory };
      }
    } else {
      onContextItemsChanged();
    }
  }

  // Resolve current note location (always sent, deduplicated like other context parts)
  let locationNoteId = null;
  {
    const fp = TabState.getFocusedPanel();
    const at = fp ? TabState.getActiveTab(fp.id) : null;
    if (at && at.filePath) {
      locationNoteId = noteIdFromPath(at.filePath);
    }
  }

  // Build context block from context items (selections and note refs)
  const contextBlock = buildContextBlock(getContextItems(), perNoteContext, locationNoteId);

  // Build attachment block
  let attachmentBlock = '';
  if (savedPaths.length > 0) {
    const fileList = savedPaths.map((p) => `- ${p}`).join('\n');
    attachmentBlock = `[User has attached ${savedPaths.length} file(s). Read them to see their content:]\n${fileList}`;
  }

  // Assemble final prompt: context → attachments → user text
  const parts = [contextBlock, attachmentBlock, text].filter(Boolean);
  let prompt = parts.join('\n\n');

  // Show user bubble with original text (not the augmented prompt with file paths)
  const displayText = text || `[${savedPaths.length} file(s) attached]`;
  addMessageBubble("user", displayText, savedAttachments);

  // Track user message in current conversation
  if (currentConversation) {
    const now = new Date().toISOString();
    if (!currentConversation.title && displayText) {
      currentConversation.title = displayText.length > 60
        ? displayText.slice(0, 60) + '…'
        : displayText;
      updateChatTitle(currentConversation.title, displayText);
    }
    currentConversation.messages.push({
      role: 'user',
      content: displayText,
      timestamp: now,
      attachments: savedAttachments.length > 0 ? savedAttachments : undefined,
    });
    currentConversation.updatedAt = now;
  }

  showThinkingIndicator();

  isBusy = true;
  aiSend.disabled = true;
  aiProviderSelect.disabled = true;
  aiModelSelect.disabled = true;
  aiEffortSelect.disabled = true;
  aiPermissionSelect.disabled = true;
  aiCancel.classList.remove("hidden");
  setExpanded(true);

  clearAttachments();
  clearTransientContextItems();
  const historyMessages = currentConversation?.messages?.map(m => ({ role: m.role, content: m.content })) || null;
  window.api.sendToClaude(prompt, historyMessages);
  aiInput.value = "";
  aiInput.style.height = "auto";
  aiInput.style.overflowY = "hidden";
});

aiCancel.addEventListener("click", () => {
  window.api.cancelClaude();
  finishStreaming(true);
});

window.api.onClaudeEvent((event) => {
  if (event.type === "text_done" && event.text) {
    removeThinkingIndicator();
    // Non-streaming full text block (only fires when no streaming bubble is active)
    if (!streamingBubble) {
      addMessageBubble("assistant", event.text);
      pendingAssistantText += event.text;
    }
    // Finalize the streaming bubble if active
    if (streamingBubble) {
      streamingContent.innerHTML = window.renderMarkdown(streamingText);
      streamingBubble.classList.remove("streaming");
      window.addCodeBlockCopyButtons(streamingBubble);
      // Add footer after bubble
      const sFooter = document.createElement("div");
      sFooter.className = "msg-footer msg-footer-assistant";
      const sTime = document.createElement("span");
      sTime.className = "msg-time";
      sTime.textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      sFooter.appendChild(sTime);
      attachMsgActions(sFooter, "assistant", streamingText, streamingBubble);
      streamingBubble.after(sFooter);
      streamingBubble._footer = sFooter;
      pendingAssistantText += streamingText;
      streamingBubble = null;
      streamingContent = null;
      streamingText = "";
    }
    // Re-show indicator: more content blocks may follow (finishStreaming removes it when done)
    showThinkingIndicator();
  } else if (event.type === "text_delta" && event.text) {
    removeThinkingIndicator();
    // Streaming delta: accumulate into a single bubble
    if (!streamingBubble) {
      const div = document.createElement("div");
      div.className = "msg msg-assistant msg-markdown streaming glass";

      const sender = document.createElement("div");
      sender.className = "msg-sender";
      sender.textContent = "Assistant";
      div.appendChild(sender);

      const content = document.createElement("div");
      content.className = "msg-content";
      div.appendChild(content);

      aiMessages.insertBefore(div, aiScrollSentinel);
      aiEmptyState.classList.add("hidden");
      streamingBubble = div;
      streamingContent = content;
      streamingText = "";
    }
    streamingText += event.text;
    streamingContent.innerHTML = window.renderMarkdown(streamingText);
    scrollMessages();
  } else if (event.type === "tool_use") {
    removeThinkingIndicator();
    addToolUseBubble(event.name, event.input);
    if (currentConversation) {
      currentConversation.messages.push({
        role: 'tool', content: null, toolName: event.name, toolInput: event.input,
        timestamp: new Date().toISOString(),
      });
    }
    // Re-show thinking indicator while waiting for tool result
    showThinkingIndicator();
  } else if (event.type === "tool_result") {
    if (event.output) {
      addToolResultBubble(event.output);
      if (currentConversation) {
        currentConversation.messages.push({
          role: 'tool_result', content: event.output,
          timestamp: new Date().toISOString(),
        });
      }
    }
    // Re-show thinking indicator: more output likely follows after a tool result
    showThinkingIndicator();
  }
});

let lastStderr = "";
window.api.onClaudeError((chunk) => {
  console.log("claude stderr:", chunk);
  lastStderr = chunk.trim();
});

window.api.onClaudeDone((code) => {
  if (code !== 0) {
    const detail = lastStderr ? `: ${lastStderr.slice(0, 200)}` : "";
    addMessageBubble("error", `Assistant exited with code ${code}${detail}`);
  }
  lastStderr = "";
  finishStreaming(false);
  window.api.cleanupTempImages();
});

window.api.onClaudeSessionId((sessionId) => {
  if (currentConversation) {
    currentConversation.sessionId = sessionId;
  }
});

function finishStreaming(cancelled) {
  removeThinkingIndicator();
  let capturedAssistantText = "";
  if (streamingBubble) {
    // Final render pass
    capturedAssistantText = streamingText;
    streamingContent.innerHTML = window.renderMarkdown(streamingText);
    streamingBubble.classList.remove("streaming");
    window.addCodeBlockCopyButtons(streamingBubble);
    // Add footer after bubble
    const fFooter = document.createElement("div");
    fFooter.className = "msg-footer msg-footer-assistant";
    const fTime = document.createElement("span");
    fTime.className = "msg-time";
    fTime.textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    fFooter.appendChild(fTime);
    attachMsgActions(fFooter, "assistant", streamingText, streamingBubble);
    streamingBubble.after(fFooter);
    streamingBubble._footer = fFooter;
    streamingBubble = null;
    streamingContent = null;
    streamingText = "";
  } else {
    capturedAssistantText = pendingAssistantText;
  }
  pendingAssistantText = "";

  // Auto-save: push assistant message and persist conversation
  if (capturedAssistantText && !cancelled && currentConversation) {
    const now = new Date().toISOString();
    currentConversation.messages.push({ role: 'assistant', content: capturedAssistantText, timestamp: now });
    currentConversation.updatedAt = now;
    window.api.saveConversation(currentConversation);
  }

  isBusy = false;
  aiSend.disabled = false;
  aiProviderSelect.disabled = false;
  aiModelSelect.disabled = false;
  aiEffortSelect.disabled = false;
  aiPermissionSelect.disabled = false;
  aiCancel.classList.add("hidden");
  if (cancelled) {
    addMessageBubble("tool", "(cancelled)");
  }
}

// --- Init modal helpers ---

const initModal = $("#init-modal");
const chkClaude = $("#chk-claude");
const chkGit = $("#chk-git");
const modalTitle = $("#modal-title");
const modalDesc = $("#modal-desc");
const modalConfirm = $("#modal-confirm");
const modalCancel = $("#modal-cancel");
const projectFields = $("#project-fields");
const projectDirInput = $("#project-dir");
const projectNameInput = $("#project-name");
const projectPathPreview = $("#project-path-preview");
const btnBrowse = $("#btn-browse");

let modalResolve = null;
let isCreateMode = false;

function updatePathPreview() {
  const dir = projectDirInput.value;
  const name = projectNameInput.value.trim();
  if (dir && name) {
    const invalid = /[/\\:*?"<>|]/.test(name);
    projectNameInput.classList.toggle("invalid", invalid);
    if (invalid) {
      projectPathPreview.textContent = "Invalid folder name";
      projectPathPreview.classList.add("error");
    } else {
      projectPathPreview.textContent = dir + "/" + name;
      projectPathPreview.classList.remove("error");
    }
    modalConfirm.disabled = invalid;
  } else {
    projectPathPreview.textContent = "";
    projectPathPreview.classList.remove("error");
    modalConfirm.disabled = isCreateMode && (!dir || !name);
  }
}

function showInitModal({ title, description, claudeChecked, gitChecked, claudeDisabled, gitDisabled, showProjectFields }) {
  modalTitle.textContent = title;
  modalDesc.textContent = description;
  chkClaude.checked = claudeChecked;
  chkGit.checked = gitChecked;
  chkClaude.disabled = !!claudeDisabled;
  chkGit.disabled = !!gitDisabled;
  isCreateMode = !!showProjectFields;

  if (isCreateMode) {
    projectFields.classList.remove("hidden");
    projectNameInput.value = "";
    projectPathPreview.textContent = "";
    projectPathPreview.classList.remove("error");
    projectNameInput.classList.remove("invalid");
    modalConfirm.disabled = true;
  } else {
    projectFields.classList.add("hidden");
    modalConfirm.disabled = false;
  }

  initModal.classList.remove("hidden");
  if (isCreateMode) projectNameInput.focus();
  return new Promise((resolve) => { modalResolve = resolve; });
}

function hideInitModal() {
  initModal.classList.add("hidden");
  modalResolve = null;
}

modalConfirm.addEventListener("click", () => {
  if (!modalResolve) return;
  if (isCreateMode) {
    modalResolve({
      dirPath: projectDirInput.value,
      projectName: projectNameInput.value.trim(),
      initClaude: chkClaude.checked,
      initGit: chkGit.checked,
    });
  } else {
    modalResolve({ initClaude: chkClaude.checked, initGit: chkGit.checked });
  }
  hideInitModal();
});

modalCancel.addEventListener("click", () => {
  if (modalResolve) modalResolve(null);
  hideInitModal();
});

btnBrowse.addEventListener("click", async () => {
  const dir = await window.api.browseDirectory();
  if (dir) {
    projectDirInput.value = dir;
    updatePathPreview();
  }
});

projectNameInput.addEventListener("input", updatePathPreview);

// --- Welcome screen actions ---

// "Create New Project"
$("#btn-create").addEventListener("click", async () => {
  const defaultDir = await window.api.getDefaultProjectDir();
  projectDirInput.value = defaultDir || "";

  const opts = await showInitModal({
    title: "Create New Project",
    description: "Choose where to create your project and give it a name.",
    claudeChecked: true,
    gitChecked: true,
    showProjectFields: true,
  });
  if (!opts) return; // user cancelled
  await saveCurrentConversationIfNeeded();
  await window.api.createProject(opts);
});

// "Open Existing Folder"
$("#btn-open").addEventListener("click", async () => {
  const info = await window.api.openProject();
  if (!info) return; // user cancelled folder picker

  if (info.hasClaude && info.hasGit) {
    // Already fully initialized — open directly
    await saveCurrentConversationIfNeeded();
    await window.api.confirmOpen({ dirPath: info.path, initClaude: false, initGit: false });
  } else {
    // Show modal for missing initializations
    const opts = await showInitModal({
      title: "Initialize Project?",
      description: "This folder is missing some setup. We suggest initializing, but it's optional.",
      claudeChecked: true,
      gitChecked: true,
      claudeDisabled: info.hasClaude,
      gitDisabled: info.hasGit,
    });
    if (!opts) return; // user cancelled
    await saveCurrentConversationIfNeeded();
    await window.api.confirmOpen({ dirPath: info.path, ...opts });
  }
});

// --- Sidebar "More" dropdown ---

sidebarMoreBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  const open = !sidebarMoreMenu.classList.contains("hidden");
  sidebarMoreMenu.classList.toggle("hidden", open);
  if (!open) _updateSortChecks();
});

// Close dropdown on outside click
document.addEventListener("click", (e) => {
  if (!sidebarMoreMenu.classList.contains("hidden") && !sidebarMoreMenu.contains(e.target)) {
    sidebarMoreMenu.classList.add("hidden");
  }
});

// Sort sub-menu items
document.querySelectorAll('.sidebar-sub-menu [data-sort]').forEach(el => {
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    _currentSortMode = el.dataset.sort;
    localStorage.setItem('sortMode', _currentSortMode);
    _updateSortChecks();
    sidebarMoreMenu.classList.add("hidden");
    if (currentTree) renderFilteredTree();
  });
});

// Collapse all
$("#menu-collapse-all").addEventListener("click", () => {
  sidebarMoreMenu.classList.add("hidden");
  if (!currentTree) return;
  expandedPaths.clear();
  if (savedExpandedPaths) savedExpandedPaths.clear();
  saveExpandedPaths();
  renderFilteredTree();
});

// Expand all
$("#menu-expand-all").addEventListener("click", () => {
  sidebarMoreMenu.classList.add("hidden");
  if (!currentTree) return;
  expandAllFolders(currentTree);
  if (savedExpandedPaths) {
    expandAllFolders(currentTree);
    savedExpandedPaths = new Set(expandedPaths);
  }
  saveExpandedPaths();
  renderFilteredTree();
});

// Change workspace
$("#menu-change-workspace").addEventListener("click", async () => {
  sidebarMoreMenu.classList.add("hidden");
  await saveCurrentConversationIfNeeded();
  window.api.changeWorkspace();
});

async function performContentSearch(query) {
  if (!query) {
    contentSearchResults = null;
    clearAllPanelHighlights();
    renderFilteredTree();
    return;
  }
  const sentQuery = query;
  contentSearchResults = null; // signal "searching"
  try {
    const response = await window.api.searchQuery(query);
    // Guard: query may have changed while awaiting
    if (searchInputEl && searchInputEl.value.trim() !== sentQuery) return;
    if (response && response.ready === false) {
      contentSearchResults = [];
    } else if (response && response.error) {
      contentSearchResults = [];
    } else {
      const results = Array.isArray(response) ? response : (response.results || []);
      lastContentParsed = Array.isArray(response) ? null : (response.parsed || null);
      contentSearchResults = results;
    }
    renderFilteredTree();
  } catch {
    contentSearchResults = [];
    renderFilteredTree();
  }
}

// --- Search / filter ---

function updateSearchClear() {
  if (!searchClearEl) return;
  const hasText = searchInputEl && searchInputEl.value.length > 0;
  searchClearEl.classList.toggle('hidden', !hasText);
}

if (searchInputEl) {
  searchInputEl.addEventListener('input', () => {
    updateSearchClear();
    // Immediately render filename matches
    contentSearchResults = null; // reset content results
    renderFilteredTree();
    // Debounce content search
    clearTimeout(searchDebounceTimer);
    const query = searchInputEl.value.trim();
    if (query) {
      // Auto-collapse favorites when search is active
      if (!favoritesSectionBodyEl.classList.contains('collapsed')) {
        _setFavoritesCollapsed(true, false);
        favAutoCollapsedBySearch = true;
      }
      searchDebounceTimer = setTimeout(() => performContentSearch(query), 250);
    } else {
      // Restore favorites if we auto-collapsed it
      if (favAutoCollapsedBySearch) {
        _setFavoritesCollapsed(false, false);
        favAutoCollapsedBySearch = false;
      }
      clearAllPanelHighlights();
    }
  });
}

if (searchClearEl) {
  searchClearEl.addEventListener('click', () => {
    searchInputEl.value = '';
    updateSearchClear();
    clearTimeout(searchDebounceTimer);
    contentSearchResults = null;
    clearAllPanelHighlights();
    // Restore favorites if we auto-collapsed it
    if (favAutoCollapsedBySearch) {
      _setFavoritesCollapsed(false, false);
      favAutoCollapsedBySearch = false;
    }
    renderFilteredTree();
    searchInputEl.focus();
  });
}

// Cmd/Ctrl+F or Cmd/Ctrl+Shift+F → focus search input
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F')) {
    if (!searchInputEl) return;
    e.preventDefault();
    searchInputEl.focus();
    searchInputEl.select();
  }
});

// Tab keyboard shortcuts
document.addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (e.isComposing) return;

  // Escape — close graph modal if open
  if (e.key === 'Escape' && !document.getElementById('graph-modal')?.classList.contains('hidden')) {
    closeGraphView();
    return;
  }

  // Cmd/Ctrl+Shift+O — toggle outline panel
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key === 'O') {
    e.preventDefault();
    setRightPanel('outline');
    return;
  }

  // Cmd/Ctrl+Shift+E — export active note (opens format picker)
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key === 'E') {
    e.preventDefault();
    showExportFormatPicker();
    return;
  }

  // Cmd/Ctrl+W — close active tab (or close window)
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key === 'w') {
    const panel = TabState.getFocusedPanel();
    if (panel && panel.activeTabId) {
      TabState.removeTab(panel.id, panel.activeTabId);
    } else {
      window.api.closeWindow();
    }
    e.preventDefault();
    return;
  }

  // Ctrl+Tab / Ctrl+Shift+Tab — next / previous tab
  if (e.ctrlKey && !e.metaKey && e.key === 'Tab') {
    const panel = TabState.getFocusedPanel();
    if (!panel || panel.tabs.length < 2) { e.preventDefault(); return; }
    const tabs = panel.tabs;
    const idx = tabs.findIndex(t => t.id === panel.activeTabId);
    const targetIdx = e.shiftKey
      ? (idx - 1 + tabs.length) % tabs.length
      : (idx + 1) % tabs.length;
    TabState.setActiveTab(panel.id, tabs[targetIdx].id);
    e.preventDefault();
    return;
  }

  // Cmd/Ctrl+1–9 — jump to Nth tab
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey
      && e.key >= '1' && e.key <= '9') {
    const panel = TabState.getFocusedPanel();
    if (!panel || panel.tabs.length === 0) { e.preventDefault(); return; }
    const n = parseInt(e.key, 10);
    const idx = n === 9 ? panel.tabs.length - 1 : n - 1;
    if (idx < panel.tabs.length) {
      TabState.setActiveTab(panel.id, panel.tabs[idx].id);
    }
    e.preventDefault();
    return;
  }

  // Cmd/Ctrl+\ — split focused panel right
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key === '\\') {
    const panel = TabState.getFocusedPanel();
    if (panel) TabState.splitPanel(panel.id, 'horizontal');
    e.preventDefault();
    return;
  }

  // Cmd/Ctrl+Alt+Left / Right — move focus between panels
  if ((e.metaKey || e.ctrlKey) && e.altKey
      && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    const state = TabState.getState();
    const panels = state.panels;
    if (panels.length < 2) { e.preventDefault(); return; }
    const idx = panels.findIndex(p => p.id === state.focusedPanelId);
    const targetIdx = e.key === 'ArrowRight'
      ? Math.min(idx + 1, panels.length - 1)
      : Math.max(idx - 1, 0);
    if (targetIdx !== idx) {
      TabState.setFocusedPanel(panels[targetIdx].id);
    }
    e.preventDefault();
    return;
  }
});

// Escape → clear search and blur
if (searchInputEl) {
  searchInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      searchInputEl.value = '';
      updateSearchClear();
      clearTimeout(searchDebounceTimer);
      contentSearchResults = null;
      clearAllPanelHighlights();
      renderFilteredTree();
      searchInputEl.blur();
    }
  });
}

// ─── Search highlight keyboard navigation (feature 85) ───────────────────────
document.addEventListener('keydown', (e) => {
  if (document.activeElement === searchInputEl) return;
  const focusedPanel = TabState.getFocusedPanel();
  if (!focusedPanel || !_searchHighlightState.has(focusedPanel.id)) return;

  if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    navigateSearchHighlight(focusedPanel.id, 1);
  } else if (e.key === 'Enter' && e.shiftKey && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    navigateSearchHighlight(focusedPanel.id, -1);
  } else if (e.key === 'F3' && !e.shiftKey) {
    e.preventDefault();
    navigateSearchHighlight(focusedPanel.id, 1);
  } else if (e.key === 'F3' && e.shiftKey) {
    e.preventDefault();
    navigateSearchHighlight(focusedPanel.id, -1);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    clearSearchHighlights(focusedPanel.id);
  }
});

// --- Sidebar resize ---
if (sidebarResizeEl && sidebarEl) {
  sidebarResizeEl.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarEl.getBoundingClientRect().width;

    sidebarResizeEl.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.querySelectorAll('.panel .note-frame').forEach(f => { f.style.pointerEvents = 'none'; });

    function onMouseMove(e) {
      const newWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, startWidth + (e.clientX - startX)));
      sidebarEl.style.width = newWidth + 'px';
    }

    function onMouseUp() {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      sidebarResizeEl.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.querySelectorAll('.panel .note-frame').forEach(f => { f.style.pointerEvents = ''; });
      const finalWidth = Math.round(sidebarEl.getBoundingClientRect().width);
      localStorage.setItem('sidebarWidth', finalWidth);
      if (typeof _sendTerminalPanelBounds === 'function') _sendTerminalPanelBounds();
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
}

// --- Right panel (outline) resize ---

if (outlinePanelResizeEl) {
  outlinePanelResizeEl.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const panel = document.getElementById('outline-panel');
    if (!panel) return;
    const startX = e.clientX;
    const startWidth = panel.getBoundingClientRect().width;

    outlinePanelResizeEl.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.querySelectorAll('.panel .note-frame').forEach(f => { f.style.pointerEvents = 'none'; });

    function onMouseMove(e) {
      const newWidth = Math.min(MAX_RIGHT_PANEL_WIDTH, Math.max(MIN_RIGHT_PANEL_WIDTH, startWidth - (e.clientX - startX)));
      panel.style.width = newWidth + 'px';
    }

    function onMouseUp() {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      outlinePanelResizeEl.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.querySelectorAll('.panel .note-frame').forEach(f => { f.style.pointerEvents = ''; });
      const finalWidth = Math.round(panel.getBoundingClientRect().width);
      localStorage.setItem('outlinePanelWidth', finalWidth);
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
}

// --- Drag & drop ---

function cleanupDragState() {
  dragSourcePath = null;
  dragSourceType = null;
  if (currentDropTarget) {
    currentDropTarget.classList.remove('drop-target');
    currentDropTarget = null;
  }
  noteListEl.classList.remove('drop-target-root');
  clearTimeout(dragExpandTimer);
  dragExpandTimer = null;
  dragExpandPath = null;
  if (dragScrollRAF) {
    cancelAnimationFrame(dragScrollRAF);
    dragScrollRAF = null;
  }
}

// ── Split drop zone overlay helpers ────────────────────────────────────────

function createSplitDropOverlays() {
  const state = TabState.getState();
  const { panels, splitDirection } = state;

  if (panels.length >= 3) return;

  let visibleZones;
  if (panels.length === 1) {
    visibleZones = ['left', 'right', 'top', 'bottom'];
  } else if (splitDirection === 'horizontal') {
    visibleZones = ['left', 'right'];
  } else {
    visibleZones = ['top', 'bottom'];
  }

  for (const panel of panels) {
    const panelEl = document.querySelector(`.panel[data-panel-id="${panel.id}"]`);
    if (!panelEl) continue;
    const contentEl = panelEl.querySelector('.panel-content');
    if (!contentEl) continue;

    const overlay = document.createElement('div');
    overlay.className = 'split-drop-overlay';
    overlay.dataset.panelId = panel.id;

    for (const zone of visibleZones) {
      const zoneEl = document.createElement('div');
      zoneEl.className = 'split-drop-zone';
      zoneEl.dataset.zone = zone;
      overlay.appendChild(zoneEl);
    }

    overlay.addEventListener('dragover', onSplitOverlayDragover);
    overlay.addEventListener('drop', onSplitOverlayDrop);
    overlay.addEventListener('dragleave', onSplitOverlayDragleave);

    contentEl.appendChild(overlay);
  }
}

function onSplitOverlayDragover(e) {
  if (!tabDragSourceId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';

  const overlay = e.currentTarget;
  const rect = overlay.getBoundingClientRect();
  const relX = e.clientX - rect.left;
  const relY = e.clientY - rect.top;
  const w = rect.width;
  const h = rect.height;

  const THRESHOLD = 0.20;

  const distances = {
    left:   relX / w,
    right:  1 - (relX / w),
    top:    relY / h,
    bottom: 1 - (relY / h),
  };

  overlay.querySelectorAll('.split-drop-zone-active').forEach(z => {
    z.classList.remove('split-drop-zone-active');
  });

  let minDist = THRESHOLD;
  let activeZoneEl = null;

  for (const [zone, dist] of Object.entries(distances)) {
    const zoneEl = overlay.querySelector(`.split-drop-zone[data-zone="${zone}"]`);
    if (zoneEl && dist < minDist) {
      minDist = dist;
      activeZoneEl = zoneEl;
    }
  }

  if (activeZoneEl) {
    activeZoneEl.classList.add('split-drop-zone-active');
  }
}

function onSplitOverlayDrop(e) {
  if (!tabDragSourceId) return;
  e.preventDefault();

  const overlay = e.currentTarget;
  const activeZoneEl = overlay.querySelector('.split-drop-zone-active');
  if (!activeZoneEl) return;

  const zone = activeZoneEl.dataset.zone;
  const targetPanelId = overlay.dataset.panelId;
  const sourcePanelId = tabDragPanelId;
  const sourceTabId = tabDragSourceId;

  const direction = (zone === 'left' || zone === 'right') ? 'horizontal' : 'vertical';

  let insertBeforePanelId = null;
  if (zone === 'left' || zone === 'top') {
    insertBeforePanelId = targetPanelId;
  } else {
    const panels = TabState.getState().panels;
    const targetIdx = panels.findIndex(p => p.id === targetPanelId);
    const nextPanel = panels[targetIdx + 1];
    insertBeforePanelId = nextPanel ? nextPanel.id : null;
  }

  cleanupTabDragState();

  const newPanel = TabState.splitPanel(targetPanelId, direction, insertBeforePanelId);
  if (!newPanel) return;

  TabState.moveTab(sourcePanelId, newPanel.id, sourceTabId, 0);
}

function onSplitOverlayDragleave(e) {
  if (!tabDragSourceId) return;
  const overlay = e.currentTarget;
  if (overlay.contains(e.relatedTarget)) return;
  overlay.querySelectorAll('.split-drop-zone-active').forEach(z => {
    z.classList.remove('split-drop-zone-active');
  });
}

function cleanupTabDragState() {
  if (tabDragSourceId) {
    const draggingEl = document.querySelector(`.tab[data-tab-id="${tabDragSourceId}"]`);
    if (draggingEl) draggingEl.classList.remove('tab-dragging');
  }
  tabDragSourceId = null;
  tabDragPanelId = null;
  tabDragOriginalIndex = -1;
  tabDragIsPinned = false;
  if (tabDragScrollRAF) {
    cancelAnimationFrame(tabDragScrollRAF);
    tabDragScrollRAF = null;
  }
  document.querySelectorAll('.tab-bar-scroll.tab-bar-drop-target').forEach(el => {
    el.classList.remove('tab-bar-drop-target');
  });
  document.querySelectorAll('.tab-drop-indicator').forEach(el => {
    el.style.display = 'none';
  });
  document.querySelectorAll('.split-drop-overlay').forEach(el => el.remove());
  document.querySelectorAll('.panel .note-frame').forEach(f => { f.style.pointerEvents = ''; });
}

function cleanupFavDragState() {
  if (favDragSourceEl) {
    favDragSourceEl.classList.remove('fav-dragging');
  }
  favDragSourceRelPath = null;
  favDragSourceEl = null;
  if (favDragScrollRAF) {
    cancelAnimationFrame(favDragScrollRAF);
    favDragScrollRAF = null;
  }
  favDropIndicatorEl.style.display = 'none';
}

function computeFavDropIndex(clientY) {
  const items = [...favoritesListEl.querySelectorAll('.favorites-list-item')];
  for (let i = 0; i < items.length; i++) {
    const rect = items[i].getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) return i;
  }
  return items.length;
}

function positionFavDropIndicator(dropIndex) {
  const items = [...favoritesListEl.querySelectorAll('.favorites-list-item')];
  if (items.length === 0) return;
  let top;
  if (dropIndex < items.length) {
    top = items[dropIndex].offsetTop;
  } else {
    const last = items[items.length - 1];
    top = last.offsetTop + last.offsetHeight;
  }
  favDropIndicatorEl.style.top = top + 'px';
  favDropIndicatorEl.style.display = 'block';
}

function resolveDropTarget(e) {
  const row = e.target.closest('.tree-row');

  let targetFolderPath;
  let targetLi;

  if (!row) {
    targetFolderPath = currentWorkspacePath;
    targetLi = null;
  } else {
    const li = row.closest('li');
    if (!li || !li.dataset.path) return null;

    if (li.classList.contains('tree-folder')) {
      targetFolderPath = li.dataset.path;
      targetLi = li;
    } else {
      targetFolderPath = li.dataset.path.substring(0, li.dataset.path.lastIndexOf('/'));
      const parentLi = li.parentElement?.closest('li.tree-folder');
      targetLi = parentLi || null;
    }
  }

  if (!dragSourcePath) return null;
  if (targetLi && targetLi.dataset.path === dragSourcePath) return null;
  if (dragSourceType === 'folder' && targetFolderPath.startsWith(dragSourcePath + '/')) return null;

  const sourceParent = dragSourcePath.substring(0, dragSourcePath.lastIndexOf('/'));
  if (targetFolderPath === sourceParent) return null;

  return { targetFolderPath, targetLi };
}

function findNodeByPath(node, targetPath) {
  if (!node) return null;
  if (node.path === targetPath) return node;
  if (node.children) {
    for (const child of node.children) {
      const found = findNodeByPath(child, targetPath);
      if (found) return found;
    }
  }
  return null;
}

function itemExistsInFolder(folderPath, itemName) {
  const folder = findNodeByPath(currentTree, folderPath);
  if (!folder || !folder.children) return false;
  return folder.children.some(child => child.name === itemName);
}

const DRAG_SCROLL_EDGE = 30;
const DRAG_SCROLL_MAX_SPEED = 8;

function handleDragAutoScroll(e) {
  const rect = noteListEl.getBoundingClientRect();
  const cursorY = e.clientY;

  const distFromTop = cursorY - rect.top;
  const distFromBottom = rect.bottom - cursorY;

  if (distFromTop < DRAG_SCROLL_EDGE && noteListEl.scrollTop > 0) {
    const speed = Math.ceil(DRAG_SCROLL_MAX_SPEED * (1 - distFromTop / DRAG_SCROLL_EDGE));
    startDragAutoScroll(-speed);
  } else if (distFromBottom < DRAG_SCROLL_EDGE &&
             noteListEl.scrollTop < noteListEl.scrollHeight - noteListEl.clientHeight) {
    const speed = Math.ceil(DRAG_SCROLL_MAX_SPEED * (1 - distFromBottom / DRAG_SCROLL_EDGE));
    startDragAutoScroll(speed);
  } else {
    stopDragAutoScroll();
  }
}

function startDragAutoScroll(speed) {
  if (dragScrollRAF !== null) return;

  function scrollStep() {
    noteListEl.scrollBy(0, speed);
    dragScrollRAF = requestAnimationFrame(scrollStep);
  }
  dragScrollRAF = requestAnimationFrame(scrollStep);
}

function stopDragAutoScroll() {
  if (dragScrollRAF !== null) {
    cancelAnimationFrame(dragScrollRAF);
    dragScrollRAF = null;
  }
}

noteListEl.addEventListener('dragover', (e) => {
  // External file drag (e.g. .md files from Finder)
  if (!dragSourcePath) {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
    return;
  }
  e.preventDefault();

  const result = resolveDropTarget(e);

  if (result) {
    e.dataTransfer.dropEffect = 'move';

    if (result.targetLi) {
      if (currentDropTarget !== result.targetLi) {
        clearTimeout(dragExpandTimer);
        dragExpandPath = null;
        if (currentDropTarget) currentDropTarget.classList.remove('drop-target');
        noteListEl.classList.remove('drop-target-root');
        result.targetLi.classList.add('drop-target');
        currentDropTarget = result.targetLi;
      }
    } else {
      if (currentDropTarget) {
        currentDropTarget.classList.remove('drop-target');
        currentDropTarget = null;
      }
      clearTimeout(dragExpandTimer);
      dragExpandPath = null;
      noteListEl.classList.add('drop-target-root');
    }
  } else {
    e.dataTransfer.dropEffect = 'none';
    if (currentDropTarget) {
      currentDropTarget.classList.remove('drop-target');
      currentDropTarget = null;
    }
    noteListEl.classList.remove('drop-target-root');
    clearTimeout(dragExpandTimer);
    dragExpandPath = null;
  }

  handleDragAutoScroll(e);
});

noteListEl.addEventListener('dragenter', (e) => {
  if (!dragSourcePath) return;
  e.preventDefault();

  const row = e.target.closest('.tree-row');
  if (!row) return;
  const li = row.closest('li');
  if (!li) return;

  if (li.classList.contains('tree-folder') && li.dataset.path !== dragSourcePath) {
    const folderPath = li.dataset.path;
    if (!expandedPaths.has(folderPath) && folderPath !== dragExpandPath) {
      clearTimeout(dragExpandTimer);
      dragExpandPath = folderPath;
      dragExpandTimer = setTimeout(() => {
        if (dragSourcePath && !expandedPaths.has(folderPath)) {
          expandedPaths.add(folderPath);
          saveExpandedPaths();
          renderFilteredTree();
        }
        dragExpandPath = null;
      }, 500);
    }
  }
});

noteListEl.addEventListener('dragleave', (e) => {
  if (!dragSourcePath) return;

  if (e.relatedTarget && noteListEl.contains(e.relatedTarget)) return;

  if (currentDropTarget) {
    currentDropTarget.classList.remove('drop-target');
    currentDropTarget = null;
  }
  noteListEl.classList.remove('drop-target-root');
  clearTimeout(dragExpandTimer);
  dragExpandPath = null;
  stopDragAutoScroll();
});

noteListEl.addEventListener('drop', async (e) => {
  e.preventDefault();
  stopDragAutoScroll();

  // Handle external file drops from Finder / OS
  if (!dragSourcePath) {
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const result = resolveDropTarget(e);
      const dropFolderPath = result ? result.targetFolderPath : currentWorkspacePath;

      // Detect folder drops via webkitGetAsEntry
      const items = Array.from(e.dataTransfer.items || []);
      const entries = items.map(item => item.webkitGetAsEntry && item.webkitGetAsEntry()).filter(Boolean);
      const folderEntries = entries.filter(entry => entry.isDirectory);

      if (folderEntries.length > 0) {
        // Folder drop: get absolute path from the File object (Electron extension)
        const allFiles = Array.from(e.dataTransfer.files);
        const folderFile = allFiles.find((f, i) => entries[i] && entries[i].isDirectory);
        const folderPath = folderFile ? folderFile.path : null;
        if (folderPath) {
          startBatchImport(dropFolderPath, { type: 'folder', path: folderPath });
        }
        return;
      }

      const allFiles = Array.from(e.dataTransfer.files);
      const mdFiles = allFiles.filter(f => /\.(?:md|markdown)$/i.test(f.name)).map(f => f.path);
      const txtFiles = allFiles.filter(f => /\.txt$/i.test(f.name)).map(f => f.path);
      const htmlFiles = allFiles.filter(f => /\.html?$/i.test(f.name)).map(f => f.path);
      const otherFiles = allFiles.filter(f => !/\.(?:md|markdown|txt|html?)$/i.test(f.name)).map(f => f.path);

      // Mixed-type drop (more than one category present): use batch import
      const typeCategories = [mdFiles, txtFiles, htmlFiles, otherFiles].filter(arr => arr.length > 0);
      if (typeCategories.length > 1 || otherFiles.length > 0) {
        const allPaths = allFiles.map(f => f.path);
        startBatchImport(dropFolderPath, { type: 'files', paths: allPaths });
        return;
      }

      // Single-type drops: use existing simple import modals (backward compatible)
      if (mdFiles.length > 0) {
        _showMarkdownImportModal(mdFiles, dropFolderPath);
      }
      if (txtFiles.length > 0) {
        _showPlaintextImportModal(txtFiles, dropFolderPath);
      }
    }
    return;
  }

  const result = resolveDropTarget(e);
  if (!result) {
    cleanupDragState();
    return;
  }

  const sourceName = dragSourcePath.split('/').pop();
  const newPath = result.targetFolderPath + '/' + sourceName;

  if (itemExistsInFolder(result.targetFolderPath, sourceName)) {
    console.error('Move failed: an item named "' + sourceName + '" already exists in the target folder.');
    cleanupDragState();
    return;
  }

  const oldPath = dragSourcePath;
  const wasSelected = selectedPath === oldPath;
  const wasFolder = dragSourceType === 'folder';
  const wasInsideMovedFolder = wasFolder && selectedPath && selectedPath.startsWith(oldPath + '/');

  cleanupDragState();

  const moveResult = await window.api.renameItem(oldPath, newPath);

  if (moveResult.success) {
    if (wasSelected) {
      selectedPath = newPath;
    } else if (wasInsideMovedFolder) {
      selectedPath = newPath + selectedPath.substring(oldPath.length);
    }

    if (wasFolder) {
      // Update tabs inside the moved folder
      const tabSnapshot = TabState.getState();
      for (const panel of tabSnapshot.panels) {
        for (const tab of panel.tabs) {
          if (tab.filePath.startsWith(oldPath + '/')) {
            const updatedFilePath = newPath + tab.filePath.slice(oldPath.length);
            TabState.renameTabsByPath(tab.filePath, updatedFilePath, tab.title);
          }
        }
      }

      const updatedExpanded = new Set();
      for (const p of expandedPaths) {
        if (p === oldPath) {
          updatedExpanded.add(newPath);
        } else if (p.startsWith(oldPath + '/')) {
          updatedExpanded.add(newPath + p.substring(oldPath.length));
        } else {
          updatedExpanded.add(p);
        }
      }
      expandedPaths = updatedExpanded;

      if (savedExpandedPaths) {
        const updatedSaved = new Set();
        for (const p of savedExpandedPaths) {
          if (p === oldPath) {
            updatedSaved.add(newPath);
          } else if (p.startsWith(oldPath + '/')) {
            updatedSaved.add(newPath + p.substring(oldPath.length));
          } else {
            updatedSaved.add(p);
          }
        }
        savedExpandedPaths = updatedSaved;
      }
    } else {
      // File move: update the moved file's tab
      TabState.renameTabsByPath(oldPath, newPath, sourceName);
    }

    expandedPaths.add(result.targetFolderPath);
    saveExpandedPaths();
  } else {
    console.error('Move failed:', moveResult.error);
  }
});

// Prevent Electron from navigating to dropped files outside the tree
document.addEventListener('dragover', (e) => {
  if (e.dataTransfer.types.includes('Files')) e.preventDefault();
});
document.addEventListener('drop', (e) => {
  if (e.dataTransfer.types.includes('Files')) e.preventDefault();
});

// --- Context menu ---

function showContextMenu(e, items) {
  e.preventDefault();

  // Build menu items dynamically
  contextMenuEl.innerHTML = '';
  for (const item of items) {
    if (item.separator) {
      const sep = document.createElement('div');
      sep.className = 'context-menu-separator';
      contextMenuEl.appendChild(sep);
    } else {
      const btn = document.createElement('button');
      btn.dataset.action = item.action;
      if (item.disabled) {
        btn.disabled = true;
      }
      if (item.shortcut) {
        btn.classList.add('has-shortcut');
        const labelSpan = document.createElement('span');
        labelSpan.textContent = item.label;
        const hintSpan = document.createElement('span');
        hintSpan.className = 'context-menu-shortcut';
        hintSpan.textContent = item.shortcut;
        btn.appendChild(labelSpan);
        btn.appendChild(hintSpan);
      } else {
        btn.textContent = item.label;
      }
      contextMenuEl.appendChild(btn);
    }
  }

  // Position at click coordinates
  contextMenuEl.classList.remove("hidden");
  contextMenuEl.style.left = e.clientX + "px";
  contextMenuEl.style.top = e.clientY + "px";

  // Viewport clamping — adjust if the menu overflows edges
  const rect = contextMenuEl.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    contextMenuEl.style.left = (window.innerWidth - rect.width - 4) + "px";
  }
  if (rect.bottom > window.innerHeight) {
    contextMenuEl.style.top = (window.innerHeight - rect.height - 4) + "px";
  }
}

function hideContextMenu() {
  contextMenuEl.classList.add("hidden");
  contextMenuTarget = null;
}

noteListEl.addEventListener("contextmenu", (e) => {
  const row = e.target.closest(".tree-row");
  if (!row) return;
  const li = row.closest("li");
  if (!li || !li.dataset.path) return;

  const itemPath = li.dataset.path;
  const itemType = li.classList.contains("tree-folder") ? "folder"
    : li.dataset.itemType === 'note' ? "note"
    : "file";
  contextMenuTarget = { path: itemPath, type: itemType, li, source: 'sidebar' };

  const items = [
    { label: 'Rename',          action: 'rename' },
    { label: 'Delete',          action: 'delete' },
    { separator: true },
    { label: 'New Note',        action: 'new-file' },
    { label: 'New Folder',      action: 'new-folder' },
  ];
  if (itemType === 'note') {
    items.push({ separator: true });
    items.push({ label: 'Duplicate',             action: 'duplicate-note' });
    items.push({ separator: true });
    items.push({ label: 'Export as PDF',         action: 'sidebar-export-pdf' });
    items.push({ label: 'Export as Markdown',    action: 'sidebar-export-markdown' });
    items.push({ label: 'Export as Plain Text',  action: 'sidebar-export-plaintext' });
    items.push({ label: 'Export as HTML (copy)', action: 'sidebar-export-html' });
    items.push({ label: 'Export as Single HTML File', action: 'sidebar-export-single-html' });
    if (isPublished(itemPath)) {
      items.push({ label: 'Republish',                 action: 'sidebar-republish-note' });
      items.push({ label: 'Copy Link',                 action: 'sidebar-copy-share-link' });
      items.push({ label: 'Unpublish',                 action: 'sidebar-unpublish-note' });
    } else {
      items.push({ label: 'Publish as Link',           action: 'sidebar-publish-note' });
    }
    items.push({ label: 'Export as Standalone App', action: 'sidebar-export-standalone' });
    items.push({ label: 'Export App Source Code',   action: 'sidebar-export-standalone-source' });
    items.push({ separator: true });
    items.push({ label: 'Save as Template',      action: 'save-as-template' });
  }
  if (itemType === 'file' && itemPath.toLowerCase().endsWith('.html')) {
    items.push({ separator: true });
    items.push({ label: 'Export as PDF',         action: 'sidebar-export-pdf' });
    items.push({ label: 'Export as Markdown',    action: 'sidebar-export-markdown' });
    items.push({ label: 'Export as Plain Text',  action: 'sidebar-export-plaintext' });
    items.push({ label: 'Export as HTML (copy)', action: 'sidebar-export-html' });
    items.push({ separator: true });
    items.push({ label: 'Save as Template',      action: 'save-as-template' });
  }
  if (itemType === 'folder') {
    items.push({ separator: true });
    items.push({ label: 'Bulk Export\u2026',        action: 'bulk-export' });
    items.push({ label: 'Import Markdown\u2026',    action: 'import-markdown' });
    items.push({ label: 'Import Plain Text\u2026',  action: 'import-plaintext' });
    items.push({ label: 'Import Folder\u2026',      action: 'import-batch' });
    items.push({ separator: true });
    items.push({ label: 'Clip from URL\u2026',      action: 'clip-from-url' });
  }
  // Favorites toggle for file and note entries
  if (itemType === 'file' || itemType === 'note') {
    const favLabel = isFavorited(itemPath)
      ? 'Remove from Favorites'
      : 'Add to Favorites';
    items.push({ separator: true });
    items.push({ label: favLabel, action: 'sidebar-toggle-favorite' });
  }
  showContextMenu(e, items);
});

// Dismiss context menu on click outside
document.addEventListener("mousedown", (e) => {
  if (contextMenuTarget && !contextMenuEl.contains(e.target)) {
    hideContextMenu();
  }
});

// Dismiss on Escape
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && contextMenuTarget) {
    hideContextMenu();
  }
});

// Dismiss on sidebar scroll
noteListEl.addEventListener("scroll", () => {
  if (contextMenuTarget) {
    hideContextMenu();
  }
});

// Dismiss when iframe gains focus (click inside viewer)
window.addEventListener("blur", () => {
  if (contextMenuTarget) {
    hideContextMenu();
  }
});

// --- Context menu actions ---

// ─── Template Picker (feature 113) ───────────────────────────────────────────
const TemplatePicker = {
  _resolve: null,
  _activeIndex: 0,
  _items: [],
  _keyHandler: null,
  _resizeHandler: null,

  /**
   * Open the picker. Returns a Promise that resolves to:
   *   { id: "blank" }   — user chose blank note
   *   { id, path, ... } — user chose a template
   *   null              — user pressed Escape or clicked backdrop (cancel)
   */
  async open(templates, options = {}) {
    if (this._resolve !== null) return null; // already open — guard
    this._items = [
      ...(options.excludeBlank ? [] : [{ id: "blank", name: "Blank note", path: null }]),
      ...templates,
    ];
    this._activeIndex = 0;
    this._render();
    document.getElementById("template-picker-modal").classList.remove("hidden");

    this._keyHandler = (e) => this._handleKeyDown(e);
    document.addEventListener("keydown", this._keyHandler, true);

    this._resizeHandler = () => this._scaleIframes();
    window.addEventListener("resize", this._resizeHandler);

    // Backdrop click cancels
    document.querySelector("#template-picker-modal .modal-backdrop")
      .addEventListener("click", () => this.close(null), { once: true });

    // Confirm / Cancel buttons
    const confirmBtn = document.getElementById("template-picker-confirm");
    const cancelBtn = document.getElementById("template-picker-cancel");
    this._confirmHandler = () => this.close(this._items[this._activeIndex]);
    this._cancelHandler = () => this.close(null);
    confirmBtn.addEventListener("click", this._confirmHandler, { once: true });
    cancelBtn.addEventListener("click", this._cancelHandler, { once: true });
    this._updateConfirmLabel();

    return new Promise((resolve) => {
      this._resolve = resolve;
    });
  },

  close(result) {
    if (this._resolve === null) return;
    document.getElementById("template-picker-modal").classList.add("hidden");
    if (this._keyHandler) {
      document.removeEventListener("keydown", this._keyHandler, true);
      this._keyHandler = null;
    }
    if (this._resizeHandler) {
      window.removeEventListener("resize", this._resizeHandler);
      this._resizeHandler = null;
    }
    // Remove button listeners if not already consumed by {once: true}
    const confirmBtn = document.getElementById("template-picker-confirm");
    const cancelBtn = document.getElementById("template-picker-cancel");
    if (this._confirmHandler) {
      confirmBtn.removeEventListener("click", this._confirmHandler);
      this._confirmHandler = null;
    }
    if (this._cancelHandler) {
      cancelBtn.removeEventListener("click", this._cancelHandler);
      this._cancelHandler = null;
    }
    const resolve = this._resolve;
    this._resolve = null;
    this._items = [];
    resolve(result);
  },

  _render() {
    const list = document.getElementById("template-picker-list");
    list.innerHTML = "";
    this._items.forEach((item, index) => {
      const li = document.createElement("li");
      li.className = "template-picker-item" + (index === this._activeIndex ? " active" : "");
      li.dataset.index = String(index);

      const nameDiv = document.createElement("div");
      nameDiv.className = "template-picker-name";
      nameDiv.textContent = item.name;
      li.appendChild(nameDiv);

      if (item.path) {
        const wrapper = document.createElement("div");
        wrapper.className = "template-picker-preview";
        const iframe = document.createElement("iframe");
        iframe.sandbox = "allow-same-origin";
        iframe.tabIndex = -1;
        iframe.src = "note://notes/_templates/" + encodeURIComponent(item.id) + "/index.html";
        wrapper.appendChild(iframe);
        li.appendChild(wrapper);
      }

      li.addEventListener("click", () => this._setActive(index));
      li.addEventListener("dblclick", () => this.close(item));
      list.appendChild(li);
    });
    // Scale iframes to fit their preview containers after layout
    requestAnimationFrame(() => this._scaleIframes());
  },

  _scaleIframes() {
    const previews = document.querySelectorAll(".template-picker-preview");
    previews.forEach((wrapper) => {
      const iframe = wrapper.querySelector("iframe");
      if (!iframe) return;
      const wrapperW = wrapper.clientWidth;
      if (wrapperW > 0) {
        const scale = wrapperW / 800;
        iframe.style.transform = `scale(${scale})`;
      }
    });
  },

  _setActive(index) {
    const list = document.getElementById("template-picker-list");
    const items = list.querySelectorAll(".template-picker-item");
    items.forEach((el, i) => el.classList.toggle("active", i === index));
    this._activeIndex = index;
    if (items[index]) items[index].scrollIntoView({ block: "nearest" });
    this._updateConfirmLabel();
  },

  _updateConfirmLabel() {
    const btn = document.getElementById("template-picker-confirm");
    if (!btn) return;
    const item = this._items[this._activeIndex];
    btn.textContent = item && item.id === "blank" ? "Create blank note" : "Use this template";
  },

  _handleKeyDown(e) {
    const count = this._items.length;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault();
      this._setActive((this._activeIndex + 1) % count);
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault();
      this._setActive((this._activeIndex - 1 + count) % count);
    } else if (e.key === "Enter") {
      e.preventDefault();
      this.close(this._items[this._activeIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      this.close(null);
    } else if (e.key === "Tab") {
      e.preventDefault(); // trap focus inside modal
    }
  },
};

// ─── Save Template Modal (feature 116) ────────────────────────────────────────
const SaveTemplateModal = {
  _resolve: null,
  _keyHandler: null,
  _onInput: null,
  _onConfirm: null,
  _onCancel: null,
  _existingIds: [],
  _INVALID_CHARS: /[/\\:*?"<>|]/,

  async open(defaultName) {
    if (this._resolve !== null) return null;

    try {
      const templates = await window.api.templatesList();
      this._existingIds = templates.map(t => t.id);
    } catch {
      this._existingIds = [];
    }

    const modal = document.getElementById('save-template-modal');
    const input = document.getElementById('save-template-name');
    const validation = document.getElementById('save-template-validation');
    const confirmBtn = document.getElementById('save-template-confirm');
    const cancelBtn = document.getElementById('save-template-cancel');

    input.value = defaultName;
    validation.textContent = '';
    validation.classList.add('hidden');
    validation.classList.remove('error');
    confirmBtn.disabled = false;

    modal.classList.remove('hidden');
    input.focus();
    input.select();

    this._onInput = () => this._validate(input.value, validation, confirmBtn);
    input.addEventListener('input', this._onInput);

    this._onConfirm = () => {
      const name = this._getValidName(input.value);
      if (name !== null) this.close(name);
    };
    confirmBtn.addEventListener('click', this._onConfirm);

    this._onCancel = () => this.close(null);
    cancelBtn.addEventListener('click', this._onCancel);

    modal.querySelector('.modal-backdrop')
      .addEventListener('click', () => this.close(null), { once: true });

    this._keyHandler = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const name = this._getValidName(input.value);
        if (name !== null) this.close(name);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.close(null);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        const focusable = [input, cancelBtn, confirmBtn];
        const idx = focusable.indexOf(document.activeElement);
        focusable[(idx + 1) % focusable.length].focus();
      }
    };
    document.addEventListener('keydown', this._keyHandler, true);

    return new Promise((resolve) => {
      this._resolve = resolve;
    });
  },

  close(result) {
    if (this._resolve === null) return;

    const modal = document.getElementById('save-template-modal');
    const input = document.getElementById('save-template-name');
    const confirmBtn = document.getElementById('save-template-confirm');
    const cancelBtn = document.getElementById('save-template-cancel');

    modal.classList.add('hidden');

    if (this._keyHandler) {
      document.removeEventListener('keydown', this._keyHandler, true);
      this._keyHandler = null;
    }
    if (this._onInput)   { input.removeEventListener('input', this._onInput);         this._onInput = null; }
    if (this._onConfirm) { confirmBtn.removeEventListener('click', this._onConfirm);  this._onConfirm = null; }
    if (this._onCancel)  { cancelBtn.removeEventListener('click', this._onCancel);    this._onCancel = null; }

    this._existingIds = [];
    const resolve = this._resolve;
    this._resolve = null;
    resolve(result);
  },

  _validate(value, validationEl, confirmBtn) {
    const trimmed = value.trim();

    if (!trimmed) {
      this._showMsg(validationEl, 'Template name cannot be empty.', true);
      confirmBtn.disabled = true;
      return false;
    }
    if (trimmed === '.' || trimmed === '..') {
      this._showMsg(validationEl, 'Invalid template name.', true);
      confirmBtn.disabled = true;
      return false;
    }
    if (this._INVALID_CHARS.test(trimmed)) {
      this._showMsg(validationEl, 'Name cannot contain: / \\ : * ? " < > |', true);
      confirmBtn.disabled = true;
      return false;
    }
    if (this._existingIds.includes(trimmed)) {
      this._showMsg(validationEl, 'A template with this name already exists. Saving will overwrite it.', false);
      confirmBtn.disabled = false;
      return true;
    }

    validationEl.textContent = '';
    validationEl.classList.add('hidden');
    validationEl.classList.remove('error');
    confirmBtn.disabled = false;
    return true;
  },

  _showMsg(el, message, isError) {
    el.textContent = message;
    el.classList.remove('hidden');
    el.classList.toggle('error', isError);
  },

  _getValidName(value) {
    const trimmed = value.trim();
    if (!trimmed || trimmed === '.' || trimmed === '..' || this._INVALID_CHARS.test(trimmed)) return null;
    return trimmed;
  },
};

const PublishModal = {
  _resolve: null,
  _state: null,
  _path: null,
  _onClick: null,
  _onKey: null,
  _onGithubState: null,

  _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  async open(notePath, noteDisplayName) {
    if (this._resolve !== null) return null;
    this._path = notePath;

    const modal = document.getElementById('publish-modal');
    document.getElementById('publish-note-name').textContent = noteDisplayName || notePath || '';
    modal.classList.remove('hidden');

    this._onClick = (e) => this._handleClick(e);
    modal.addEventListener('click', this._onClick);

    this._onKey = (e) => {
      if (e.key === 'Escape' && this._state !== 'working' && this._state !== 'connecting') {
        e.preventDefault(); this.close(null);
      }
    };
    document.addEventListener('keydown', this._onKey, true);

    this._onGithubState = (s) => this._handleGithubState(s);
    _githubStateBroadcaster.add(this._onGithubState);

    const state = await window.api.githubGetState();
    this._renderFromState(state);

    return new Promise((resolve) => { this._resolve = resolve; });
  },

  close(result) {
    if (this._resolve === null) return;
    const modal = document.getElementById('publish-modal');
    modal.classList.add('hidden');
    if (this._onClick) { modal.removeEventListener('click', this._onClick); this._onClick = null; }
    if (this._onKey)   { document.removeEventListener('keydown', this._onKey, true); this._onKey = null; }
    if (this._onGithubState) { _githubStateBroadcaster.remove(this._onGithubState); this._onGithubState = null; }
    this._state = null;
    this._path = null;
    const r = this._resolve;
    this._resolve = null;
    r(result);
  },

  _renderFromState(state) {
    if (!state || state.status === 'disconnected') return this._setState('connect');
    if (state.status === 'connecting') return this._setState('connecting', state);
    if (state.status === 'connected' && !state.repoName) return this._setState('repo', { user: state.user });
    if (state.status === 'connected') return this._setState('ready', { user: state.user, repoName: state.repoName });
  },

  _handleGithubState(state) {
    // Only react while we're in a state that's waiting on auth
    if (this._state !== 'connect' && this._state !== 'connecting') return;
    this._renderFromState(state);
  },

  _setState(name, ctx = {}) {
    this._state = name;
    const body = document.getElementById('publish-modal-body');
    const actions = document.getElementById('publish-modal-actions');

    if (name === 'connect') {
      body.innerHTML = `
        <p>Sharing notes uses your own GitHub account. Notes are stored as gists and rendered via GitHub Pages — no toutkit servers in the path.</p>`;
      actions.innerHTML = `
        <button class="btn-secondary" data-pm-action="cancel">Cancel</button>
        <button class="btn-primary" data-pm-action="connect">Connect GitHub</button>`;
      return;
    }
    if (name === 'connecting') {
      body.innerHTML = `
        <p>Confirm this code in the GitHub page that just opened:</p>
        <p><span class="publish-device-code">${this._esc(ctx.userCode || '')}</span></p>
        <p class="publish-dim">Waiting for authorization…</p>`;
      actions.innerHTML = `
        <button class="btn-secondary" data-pm-action="cancel-connect">Cancel</button>`;
      return;
    }
    if (name === 'repo') {
      const u = ctx.user || {};
      body.innerHTML = `
        <div class="publish-user-line">
          ${u.avatarUrl ? `<img class="publish-user-avatar" src="${this._esc(u.avatarUrl)}" alt="">` : ''}
          <span>Connected as <strong>${this._esc(u.login || '')}</strong></span>
        </div>
        <p>Pick a name for the GitHub repo that will host your share site. We'll create it on your account and add a small renderer page.</p>
        <label class="field-label" for="publish-repo-name">Repo name</label>
        <input type="text" id="publish-repo-name" value="toutkit-shares" autocomplete="off" spellcheck="false" />
        <p id="publish-repo-validation" class="publish-validation hidden"></p>`;
      actions.innerHTML = `
        <button class="btn-secondary" data-pm-action="cancel">Cancel</button>
        <button class="btn-primary" data-pm-action="continue">Continue</button>`;
      const input = document.getElementById('publish-repo-name');
      input.focus(); input.select();
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); this._doSetRepo(); }
      });
      return;
    }
    if (name === 'ready') {
      const u = ctx.user || {};
      body.innerHTML = `
        <div class="publish-user-line">
          ${u.avatarUrl ? `<img class="publish-user-avatar" src="${this._esc(u.avatarUrl)}" alt="">` : ''}
          <span>Connected as <strong>${this._esc(u.login || '')}</strong> — using <code>${this._esc(ctx.repoName || '')}</code></span>
        </div>
        <fieldset class="publish-visibility">
          <legend>Who can see it?</legend>
          <label class="publish-visibility-option">
            <input type="radio" name="publish-visibility" value="secret" checked>
            <div class="publish-visibility-text">
              <span class="publish-visibility-name">Anyone with the link</span>
              <span class="publish-visibility-desc">Stored as a secret gist. Not on your GitHub profile, not crawled by search engines.</span>
            </div>
          </label>
          <label class="publish-visibility-option">
            <input type="radio" name="publish-visibility" value="public">
            <div class="publish-visibility-text">
              <span class="publish-visibility-name">Public on the web</span>
              <span class="publish-visibility-desc">Stored as a public gist. Findable by Google and listed on your GitHub profile.</span>
            </div>
          </label>
        </fieldset>`;
      actions.innerHTML = `
        <button class="btn-secondary" data-pm-action="cancel">Cancel</button>
        <button class="btn-primary" data-pm-action="publish">Publish</button>`;
      return;
    }
    if (name === 'working') {
      const msg = ctx.firstProvision
        ? 'Setting up your share site (one-time, ~30 seconds)…'
        : 'Publishing…';
      body.innerHTML = `
        <div class="publish-working">
          <div class="publish-spinner"></div>
          <span>${this._esc(msg)}</span>
        </div>`;
      actions.innerHTML = '';
      return;
    }
    if (name === 'success') {
      const url = ctx.shareUrl || '';
      body.innerHTML = `
        <p>Link copied to clipboard.</p>
        <input type="text" class="publish-success-url" id="publish-success-url" readonly value="${this._esc(url)}">
        ${ctx.usesBackendAPIs ? `<p class="publish-dim">Note: backend APIs won't work in browser.</p>` : ''}
        ${ctx.sizeWarning ? `<p class="publish-dim">${this._esc(ctx.sizeWarning)}</p>` : ''}`;
      actions.innerHTML = `
        <button class="btn-secondary" data-pm-action="open">Open</button>
        <button class="btn-secondary" data-pm-action="copy">Copy</button>
        <button class="btn-primary" data-pm-action="done">Done</button>`;
      navigator.clipboard.writeText(url).catch(() => {});
      return;
    }
    if (name === 'error') {
      body.innerHTML = `<p class="publish-error">${this._esc(ctx.message || 'Publish failed.')}</p>`;
      actions.innerHTML = `
        <button class="btn-secondary" data-pm-action="cancel">Close</button>
        <button class="btn-primary" data-pm-action="retry">Retry</button>`;
    }
  },

  async _handleClick(e) {
    if (e.target.classList && e.target.classList.contains('modal-backdrop')) {
      if (this._state !== 'working' && this._state !== 'connecting') this.close(null);
      return;
    }
    const btn = e.target.closest('[data-pm-action]');
    if (!btn) return;
    const action = btn.dataset.pmAction;
    if (action === 'cancel') return this.close(null);
    if (action === 'connect') return this._doConnect();
    if (action === 'cancel-connect') {
      try { await window.api.githubCancelConnect(); } catch {}
      return this._setState('connect');
    }
    if (action === 'continue') return this._doSetRepo();
    if (action === 'publish')  return this._doPublish();
    if (action === 'retry') {
      const s = await window.api.githubGetState();
      return this._renderFromState(s);
    }
    if (action === 'open') {
      const url = document.getElementById('publish-success-url')?.value;
      if (url) window.open(url, '_blank');
      return;
    }
    if (action === 'copy') {
      const url = document.getElementById('publish-success-url')?.value;
      if (url) navigator.clipboard.writeText(url).catch(() => {});
      return;
    }
    if (action === 'done') return this.close({ success: true });
  },

  async _doConnect() {
    try {
      const res = await window.api.githubConnect();
      if (res?.ok && res.data) {
        this._setState('connecting', { userCode: res.data.userCode });
      } else {
        this._setState('error', { message: (res && res.error) || 'Could not start GitHub authentication.' });
      }
    } catch (err) {
      this._setState('error', { message: err.message || String(err) });
    }
  },

  async _doSetRepo() {
    const input = document.getElementById('publish-repo-name');
    const validation = document.getElementById('publish-repo-validation');
    const setError = (msg) => {
      validation.textContent = msg;
      validation.classList.remove('hidden', 'publish-validation--info');
    };
    const setInfo = (msg) => {
      validation.textContent = msg;
      validation.classList.remove('hidden');
      validation.classList.add('publish-validation--info');
    };

    const name = (input && input.value || '').trim();
    if (!/^[A-Za-z0-9_.-]{1,100}$/.test(name) || name === '.' || name === '..') {
      return setError('Use letters, numbers, dots, hyphens, underscores. Max 100 chars.');
    }
    if (input) input.disabled = true;
    setInfo('Checking…');
    const check = await window.api.githubCheckRepoName(name);
    if (input) input.disabled = false;
    if (!check || !check.ok) {
      setError((check && check.message) || 'Repo name not available.');
      input?.focus();
      return;
    }
    const res = await window.api.githubSetRepoName(name);
    if (!res || !res.ok) {
      return setError((res && res.error) || 'Could not save repo name.');
    }
    const s = await window.api.githubGetState();
    this._setState('ready', { user: s.user, repoName: s.repoName });
    if (check.status === 'reusable') {
      _showSyncToast(`Repo set to "${name}" — reusing your existing renderer repo.`);
    } else {
      _showSyncToast(`Repo set to "${name}" — will be created on your next publish.`);
    }
  },

  async _doPublish() {
    let visibility = 'secret';
    document.querySelectorAll('input[name="publish-visibility"]').forEach((r) => {
      if (r.checked) visibility = r.value;
    });

    // Heuristic: a slow first-time provisioning is likely if the active user
    // hasn't yet published from this app. We don't actually know — the backend
    // returns `firstProvision: true` when applicable — so the copy nudges the
    // user that one publish may take longer. Better than a blank spinner.
    this._setState('working', { firstProvision: true });

    try {
      const result = await window.api.publishNote(this._path, { visibility });
      if (result && result.error) {
        if (result.error === 'github-not-connected') return this._setState('connect');
        if (result.error === 'github-no-repo-name') {
          const s = await window.api.githubGetState();
          return this._setState('repo', { user: s.user });
        }
        return this._setState('error', { message: result.message || result.error });
      }
      if (result && result.success) {
        return this._setState('success', {
          shareUrl: result.shareUrl,
          usesBackendAPIs: result.usesBackendAPIs,
          sizeWarning: result.sizeWarning,
        });
      }
      this._setState('error', { message: 'Unexpected publish response.' });
    } catch (err) {
      this._setState('error', { message: err.message || String(err) });
    }
  },
};

contextMenuEl.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn || !contextMenuTarget) return;

  const action = btn.dataset.action;
  const target = { ...contextMenuTarget }; // snapshot before hiding
  hideContextMenu();

  switch (action) {
    // ── Favorites actions ─────────────────────────────────────────────────────
    case 'remove-from-favorites': {
      const relPath = target.path.slice(currentWorkspacePath.length + 1);
      window.api.favoritesRemove(relPath);
      break;
    }
    case 'sidebar-toggle-favorite': {
      if (target.path) toggleFavorite(target.path);
      break;
    }
    case 'tab-toggle-favorite': {
      const tabForAction = TabState.getTab(target.tabId);
      if (tabForAction && tabForAction.filePath) toggleFavorite(tabForAction.filePath);
      break;
    }
    // ── Sidebar actions ───────────────────────────────────────────────────────
    case "rename":
      startInlineRename(target);
      break;
    case "delete":
      performDelete(target);
      break;
    case "new-file": {
      const _templates = await window.api.templatesList();
      if (_templates.length === 0) {
        startInlineCreate(target, "note");
      } else {
        const selection = await TemplatePicker.open(_templates);
        if (selection === null) break; // Escape / backdrop click — cancelled
        const templateInfo = selection.id === "blank" ? null : selection;
        startInlineCreate(target, "note", templateInfo);
      }
      break;
    }
    case "new-folder":
      startInlineCreate(target, "folder");
      break;
    case 'duplicate-note': {
      try {
        const result = await window.api.duplicateNote(target.path);
        if (!result.success) console.error('Duplicate failed:', result.error);
      } catch (err) {
        console.error('Duplicate failed:', err.message);
      }
      break;
    }
    // ── Per-file export from sidebar ──────────────────────────────────────────
    case 'sidebar-export-pdf':
      exportNoteAs(target.path, 'pdf');
      break;
    case 'sidebar-export-markdown':
      exportNoteAs(target.path, 'markdown');
      break;
    case 'sidebar-export-plaintext':
      exportNoteAs(target.path, 'plaintext');
      break;
    case 'sidebar-export-html':
      exportNoteAs(target.path, 'html');
      break;
    case 'sidebar-export-single-html': {
      _showSyncToast('Exporting as single HTML file\u2026');
      try {
        const result = await window.api.exportSingleHtml(target.path);
        if (result.error) {
          _showSyncToast(`Export failed: ${result.error}`);
        } else if (result.cancelled) {
          // user cancelled save dialog
        } else {
          const warning = result.usesBackendAPIs ? ' (note: backend APIs won\u2019t work in browser)' : '';
          _showSyncToast(`Exported "${result.title}" as HTML file${warning}`);
        }
      } catch (err) {
        _showSyncToast(`Export failed: ${err.message}`);
      }
      break;
    }
    case 'sidebar-publish-note': {
      const displayName = (target.path || '').split('/').pop() || target.path;
      await PublishModal.open(target.path, displayName);
      await refreshPublishedNotes();
      renderFilteredTree();
      break;
    }
    case 'sidebar-republish-note': {
      // Silent re-upload: skip the modal, reuse stored visibility.
      const info = publishedNotes.get(target.path);
      const visibility = (info && info.visibility) || 'secret';
      _showSyncToast('Republishing note\u2026');
      try {
        const result = await window.api.publishNote(target.path, { visibility });
        if (result && result.error) {
          // GitHub disconnected, repo gone, etc. \u2192 fall back to the modal so
          // the user can reconnect / pick a repo without losing the action.
          if (result.error === 'github-not-connected' || result.error === 'github-no-repo-name') {
            const displayName = (target.path || '').split('/').pop() || target.path;
            await PublishModal.open(target.path, displayName);
            await refreshPublishedNotes();
            renderFilteredTree();
          } else {
            _showSyncToast(`Republish failed: ${result.error}`);
          }
        } else if (result && result.success) {
          _showSyncToast('Note republished');
          await refreshPublishedNotes();
          renderFilteredTree();
        }
      } catch (err) {
        _showSyncToast(`Republish failed: ${err.message || err}`);
      }
      break;
    }
    case 'sidebar-copy-share-link': {
      await copyShareLink(target.path);
      break;
    }
    case 'sidebar-unpublish-note': {
      _showSyncToast('Unpublishing note\u2026');
      try {
        const result = await window.api.unpublishNote(target.path);
        if (result.error) {
          _showSyncToast(`Unpublish failed: ${result.error}`);
        } else if (result.success) {
          _showSyncToast('Note unpublished');
          await refreshPublishedNotes();
          renderFilteredTree();
        }
      } catch (err) {
        _showSyncToast(`Unpublish failed: ${err.message}`);
      }
      break;
    }
    case 'sidebar-export-standalone': {
      _showSyncToast('Preparing standalone app export\u2026');
      try {
        const result = await window.api.exportStandalone(target.path);
        if (result.error) {
          _showSyncToast(`Export failed: ${result.error}`);
        } else if (result.cancelled) {
          // user cancelled save dialog
        } else {
          _showSyncToast(`Exported "${result.title}" as standalone app`);
        }
      } catch (err) {
        _showSyncToast(`Export failed: ${err.message}`);
      }
      break;
    }
    case 'sidebar-export-standalone-source': {
      _showSyncToast('Exporting app source code\u2026');
      try {
        const result = await window.api.exportStandaloneSource(target.path);
        if (result.error) {
          _showSyncToast(`Export failed: ${result.error}`);
        } else if (result.cancelled) {
          // user cancelled folder dialog
        } else {
          _showSyncToast(`Exported "${result.title}" source code`);
        }
      } catch (err) {
        _showSyncToast(`Export failed: ${err.message}`);
      }
      break;
    }

    case 'save-as-template': {
      const defaultName = target.path.split('/').pop();
      const result = await SaveTemplateModal.open(defaultName);
      if (result === null) break;
      const saveResult = await window.api.templatesSaveAsTemplate(target.path, result);
      if (saveResult.ok) {
        const verb = saveResult.overwritten ? 'Updated template' : 'Saved as template';
        _showSyncToast(`${verb}: ${saveResult.templateName}`);
      } else {
        _showSyncToast(`Error: ${saveResult.error}`);
      }
      break;
    }

    case 'bulk-export':
      startBulkExport(target.path);
      break;
    case 'import-markdown':
      startMarkdownImport(target.path);
      break;
    case 'import-plaintext':
      startPlaintextImport(target.path);
      break;
    case 'import-batch':
      startBatchImport(target.path, null);
      break;
    case 'clip-from-url':
      startWebClip(target.path);
      break;

    // ── Tab actions ───────────────────────────────────────────────────────────
    case 'tab-pin': {
      TabState.updateTab(target.tabId, { isPinned: true });
      break;
    }
    case 'tab-unpin': {
      TabState.updateTab(target.tabId, { isPinned: false });
      break;
    }
    case 'tab-close': {
      TabState.removeTab(target.panelId, target.tabId);
      break;
    }
    case 'tab-close-others': {
      const panel = TabState.getPanel(target.panelId);
      if (!panel) break;
      const toRemove = panel.tabs.filter(t => t.id !== target.tabId && !t.isPinned).map(t => t.id);
      for (const id of toRemove) TabState.removeTab(target.panelId, id);
      break;
    }
    case 'tab-close-right': {
      const panel = TabState.getPanel(target.panelId);
      if (!panel) break;
      const idx = panel.tabs.findIndex(t => t.id === target.tabId);
      if (idx === -1) break;
      const toRemove = panel.tabs.slice(idx + 1).filter(t => !t.isPinned).map(t => t.id);
      for (const id of toRemove) TabState.removeTab(target.panelId, id);
      break;
    }
    case 'tab-close-all': {
      const panel = TabState.getPanel(target.panelId);
      if (!panel) break;
      const toRemove = panel.tabs.filter(t => !t.isPinned).map(t => t.id);
      for (const id of toRemove) TabState.removeTab(target.panelId, id);
      break;
    }
    case 'tab-copy-path': {
      const tab = TabState.getTab(target.tabId);
      if (tab) navigator.clipboard.writeText(tab.filePath);
      break;
    }
    case 'tab-reveal-sidebar': {
      const tab = TabState.getTab(target.tabId);
      if (tab && currentTree) {
        expandAncestors(tab.filePath, currentTree);
        saveExpandedPaths();
        renderTree(currentTree);
        const targetRow = [...noteListEl.querySelectorAll('.tree-row')]
          .find(row => row.closest('li')?.dataset.path === tab.filePath);
        if (targetRow) {
          noteListEl.querySelectorAll('.tree-row').forEach(r => r.classList.remove('active'));
          targetRow.classList.add('active');
          targetRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }
      break;
    }
    case 'tab-move-panel': {
      const tab = TabState.getTab(target.tabId);
      const state = TabState.getState();
      const otherPanel = state.panels.find(p => p.id !== target.panelId);
      if (tab && otherPanel) {
        TabState.removeTab(target.panelId, target.tabId);
        TabState.addTab(otherPanel.id, { filePath: tab.filePath, fileType: tab.fileType, title: tab.title });
      }
      break;
    }
    case 'tab-split-right': {
      const tab = TabState.getTab(target.tabId);
      const newPanel = TabState.splitPanel(target.panelId, 'horizontal');
      if (tab && newPanel) {
        TabState.addTab(newPanel.id, { filePath: tab.filePath, fileType: tab.fileType, title: tab.title });
      }
      break;
    }
    case 'tab-split-down': {
      const tab = TabState.getTab(target.tabId);
      const newPanel = TabState.splitPanel(target.panelId, 'vertical');
      if (tab && newPanel) {
        TabState.addTab(newPanel.id, { filePath: tab.filePath, fileType: tab.fileType, title: tab.title });
      }
      break;
    }
    case 'tab-duplicate': {
      TabState.duplicateTab(target.panelId, target.tabId);
      break;
    }
    case 'tab-duplicate-to-panel': {
      const state = TabState.getState();
      const otherPanel = state.panels.find(p => p.id !== target.panelId);
      if (otherPanel) {
        TabState.duplicateTabToPanel(target.panelId, otherPanel.id, target.tabId);
      }
      break;
    }
    // ── Per-tab export from tab context menu ──────────────────────────────────
    case 'tab-export-pdf': {
      const tabForExport = TabState.getTab(target.tabId);
      if (tabForExport && tabForExport.filePath) exportNoteAs(tabForExport.filePath, 'pdf');
      break;
    }
    case 'tab-export-markdown': {
      const tabForExport = TabState.getTab(target.tabId);
      if (tabForExport && tabForExport.filePath) exportNoteAs(tabForExport.filePath, 'markdown');
      break;
    }
    case 'tab-export-plaintext': {
      const tabForExport = TabState.getTab(target.tabId);
      if (tabForExport && tabForExport.filePath) exportNoteAs(tabForExport.filePath, 'plaintext');
      break;
    }
    case 'tab-export-html': {
      const tabForExport = TabState.getTab(target.tabId);
      if (tabForExport && tabForExport.filePath) exportNoteAs(tabForExport.filePath, 'html');
      break;
    }
  }
});

async function performDelete(target) {
  const result = await window.api.trashItem(target.path);
  if (!result.success) {
    console.error("Delete failed:", result.error);
    return;
  }
  // Remove any open tabs pointing to the deleted file (onChange → loadContentForTab handles viewer update)
  TabState.removeTabsByPath(target.path);
  // Tree refresh is handled automatically by chokidar watcher
}

function startInlineRename(target) {
  // Find the <li> in the current DOM by data-path
  const li = noteListEl.querySelector(`li[data-path="${CSS.escape(target.path)}"]`);
  if (!li) return;

  const labelSpan = li.querySelector(".tree-label");
  if (!labelSpan) return;

  inlineEditActive = true;

  const oldName = target.path.split("/").pop();
  const originalText = labelSpan.textContent;

  // Replace label content with an input
  labelSpan.textContent = "";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "inline-edit";
  input.value = oldName;
  labelSpan.appendChild(input);

  // Pre-select name without extension (for files only)
  if (target.type === "file") {
    const dotIndex = oldName.lastIndexOf(".");
    if (dotIndex > 0) {
      input.setSelectionRange(0, dotIndex);
    } else {
      input.select();
    }
  } else {
    input.select();
  }

  input.focus();

  let committed = false;

  async function commit() {
    if (committed) return;
    committed = true;
    inlineEditActive = false;

    const newName = input.value.trim();
    if (!newName || newName === oldName) {
      // No change — revert
      labelSpan.textContent = originalText;
      renderFilteredTree(); // re-render with latest tree data
      return;
    }

    const parentDir = target.path.substring(0, target.path.lastIndexOf("/"));
    const newPath = parentDir + "/" + newName;
    const result = await window.api.renameItem(target.path, newPath);

    if (result.success) {
      // If the renamed item was the selected note, update selectedPath
      if (selectedPath === target.path) {
        selectedPath = newPath;
      }
      // Update any open tabs pointing to the renamed file
      TabState.renameTabsByPath(target.path, newPath, newName);
      // Chokidar handles tree refresh
    } else {
      console.error("Rename failed:", result.error);
      labelSpan.textContent = originalText;
    }
    renderFilteredTree(); // re-render with latest tree data
  }

  function cancel() {
    if (committed) return;
    committed = true;
    inlineEditActive = false;
    labelSpan.textContent = originalText;
    renderFilteredTree(); // re-render with latest tree data
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation(); // prevent the global Escape handler from also firing
      cancel();
    }
  });

  input.addEventListener("blur", () => {
    // Treat blur as confirm (matches Finder/VS Code behavior)
    commit();
  });

  // Prevent clicks on the input from bubbling to the tree-row click handler
  input.addEventListener("mousedown", (e) => e.stopPropagation());
  input.addEventListener("click", (e) => e.stopPropagation());
}

// ─── Template Variable Substitution (feature 114) ────────────────────────────
function startInlineCreate(target, createType, templateInfo = null) {
  // Determine target directory
  let targetDir;
  let targetLi;
  if (target.type === "folder") {
    targetDir = target.path;
    targetLi = noteListEl.querySelector(`li[data-path="${CSS.escape(target.path)}"]`);
  } else {
    targetDir = target.path.substring(0, target.path.lastIndexOf("/"));
    // Find the parent folder's <li>, or use noteListEl if at root
    targetLi = noteListEl.querySelector(`li[data-path="${CSS.escape(targetDir)}"]`);
  }

  // Ensure the target folder is expanded
  if (targetLi && targetLi.classList.contains("tree-folder")) {
    const childUl = targetLi.querySelector(":scope > ul.tree-children");
    if (childUl) {
      childUl.classList.remove("hidden");
      expandedPaths.add(targetDir);
      // Update toggle and icon
      const toggle = targetLi.querySelector(":scope > .tree-row .tree-toggle");
      if (toggle) toggle.classList.add("expanded");
      const iconSpan = targetLi.querySelector(":scope > .tree-row .tree-icon");
      if (iconSpan) iconSpan.innerHTML = ICONS.folderOpen;
      saveExpandedPaths();
    }
  }

  // Find the <ul> to insert into
  let parentUl;
  if (targetLi && targetLi.classList.contains("tree-folder")) {
    parentUl = targetLi.querySelector(":scope > ul.tree-children");
  } else {
    // Root level — insert into noteListEl itself
    parentUl = noteListEl;
  }
  if (!parentUl) return;

  inlineEditActive = true;

  // Determine depth for padding
  let depth = 0;
  let ancestor = parentUl.closest("li.tree-folder");
  while (ancestor) {
    depth++;
    const parentEl = ancestor.parentElement;
    ancestor = parentEl ? parentEl.closest("li.tree-folder") : null;
  }

  // Create temporary <li> with input
  const tempLi = document.createElement("li");
  tempLi.className = createType === "folder" ? "tree-folder" : "tree-file";

  const row = document.createElement("div");
  row.className = "tree-row";

  if (createType === "folder") {
    row.style.paddingLeft = `calc(var(--spacing-3) + ${depth} * var(--spacing-4))`;

    const toggle = document.createElement("span");
    toggle.className = "tree-toggle";
    toggle.textContent = "\u25B6";
    row.appendChild(toggle);
  } else {
    row.style.paddingLeft = `calc(var(--spacing-3) + ${depth} * var(--spacing-4))`;
  }

  const iconSpan = document.createElement("span");
  iconSpan.className = "tree-icon";
  iconSpan.innerHTML = createType === "folder" ? ICONS.folder : createType === "note" ? ICONS.html : ICONS.generic;
  row.appendChild(iconSpan);

  const labelSpan = document.createElement("span");
  labelSpan.className = "tree-label";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "inline-edit";
  input.value = (createType === "folder" || createType === "note") ? "untitled" : "untitled.html";
  labelSpan.appendChild(input);
  row.appendChild(labelSpan);
  tempLi.appendChild(row);

  // Insert at the top of the target folder's children
  parentUl.insertBefore(tempLi, parentUl.firstChild);

  // Pre-select name without extension
  if (createType === "file") {
    const dotIndex = input.value.lastIndexOf(".");
    if (dotIndex > 0) {
      input.setSelectionRange(0, dotIndex);
    } else {
      input.select();
    }
  } else {
    input.select();
  }

  input.focus();

  // Scroll the temporary item into view
  tempLi.scrollIntoView({ block: "nearest" });

  let committed = false;

  async function commit() {
    if (committed) return;
    committed = true;
    inlineEditActive = false;

    const name = input.value.trim();
    if (!name) {
      tempLi.remove();
      renderFilteredTree();
      return;
    }

    const fullPath = targetDir + "/" + name;
    let result;
    if (createType === "folder") {
      result = await window.api.createFolder(fullPath);
    } else if (createType === "note") {
      // Create a note folder from template (recursive copy) or blank
      if (templateInfo) {
        try {
          result = await window.api.createNoteFromTemplate(fullPath, templateInfo.path);
        } catch (err) {
          _showSyncToast("Template not found \u2014 creating blank note.");
          result = null;
        }
      }
      if (!result) {
        const today = new Date().toISOString().slice(0, 10);
        const content = `<article class="note" data-title="${name}" data-created="${today}">\n  <h1>${name}</h1>\n</article>`;
        try {
          result = await window.api.createNote(fullPath, content);
        } catch (err) {
          result = { success: false, error: err.message };
        }
      }
    } else {
      result = await window.api.createFile(fullPath);
    }

    if (!result.success) {
      console.error("Create failed:", result.error);
    }
    tempLi.remove();
    renderFilteredTree();
  }

  function cancel() {
    if (committed) return;
    committed = true;
    inlineEditActive = false;
    tempLi.remove();
    renderFilteredTree();
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    }
  });

  input.addEventListener("blur", () => {
    const name = input.value.trim();
    if (!name) {
      cancel();
    } else {
      commit();
    }
  });

  input.addEventListener("mousedown", (e) => e.stopPropagation());
  input.addEventListener("click", (e) => e.stopPropagation());
}

// ─── Testing API ─────────────────────────────────────────────────────────────
window.ContextState = {
  getContextItems,
  addContextItem,
  removeContextItem,
  clearContextItems,
  clearTransientContextItems,
  buildContextBlock,
  resetLastSentContext,
  renderContextBar,
  getActiveNoteToggle: () => activeNoteToggleOn,
  setActiveNoteToggle: (val) => {
    activeNoteToggleOn = !!val;
    updateActiveNoteToggleUI();
    saveActiveNoteToggle();
  },
  injectActiveNote: () => {
    if (activeNoteToggleOn) {
      contextItems = contextItems.filter(ci => ci.type !== 'active-note');
      const focusedPanel = TabState.getFocusedPanel();
      const activeTab = focusedPanel ? TabState.getActiveTab(focusedPanel.id) : null;
      if (activeTab && activeTab.filePath) {
        addContextItem({ type: 'active-note', path: activeTab.filePath, noteTitle: activeTab.title || activeTab.filePath });
      } else {
        onContextItemsChanged();
      }
    }
  },
  getCurrentSelection: () => currentSelection,
  setOnSelectionChange: setOnSelectionChange,
  getSelectionToolbar: () => document.getElementById('selection-toolbar'),
  isSelectionToolbarVisible: () => {
    const el = document.getElementById('selection-toolbar');
    return el ? !el.classList.contains('hidden') : false;
  },
  getAtTrigger: () => atTrigger,
  setOnAtTriggerChange: setOnAtTriggerChange,
  cancelAtTrigger: () => {
    atTrigger = null;
    _notifyAtTriggerChange();
  },
  getDropdownVisible: () => !atDropdown.classList.contains('hidden'),
  getDropdownItems: () => dropdownFiltered,
  getDropdownSelectedIndex: () => dropdownSelectedIndex,
  setOnNoteSelected: setOnNoteSelected,
};

// ─── Sync Testing API ────────────────────────────────────────────────────────
window.SyncState = {
  getStatus: () => window.api.getSyncStatus(),
  getState: () => window.api.getSyncState(),
  _lastGitStatus: null,
  _lastSyncEvent: null,
  getBadgeState: () => {
    const badge = document.getElementById('sync-status-badge');
    if (!badge) return null;
    return {
      visible: !badge.closest('.hidden'),
      label: badge.querySelector('.sync-badge-label')?.textContent ?? null,
      stateClass: [...badge.classList].find(c => c.startsWith('sync-badge--')) ?? null,
      title: badge.title,
    };
  },
};

// Listen for "Set Up Sync…" menu item (feature 68)
window.api.onOpenSyncSetup(() => {
  SyncSettingsModal.show('github');
});

// Test hooks
window.SyncSetupWizard = SyncSetupWizard;
window.SyncSettingsModal = SyncSettingsModal;

// ── Tags sidebar panel (feature 98) ──────────────────────────────────────────

const tagsSectionEl = document.getElementById('tags-section');
const tagsSectionHeaderEl = document.getElementById('tags-section-header');
const tagsSectionBodyEl = document.getElementById('tags-section-body');
const tagsSectionToggleEl = document.getElementById('tags-section-toggle');
const tagsCountBadgeEl = document.getElementById('tags-count-badge');
const tagsSortBtnEl = document.getElementById('tags-sort-btn');
const tagsEmptyEl = document.getElementById('tags-empty');
const tagsListEl = document.getElementById('tags-list');
const tagFilterBarEl = document.getElementById('tag-filter-bar');
const tagFilterBarNameEl = document.getElementById('tag-filter-bar-name');
const tagFilterClearEl = document.getElementById('tag-filter-clear');

// Load persisted collapse state (per workspace)
async function _tagsLoadState() {
  if (!currentWorkspacePath) return;
  const state = await window.api.getSidebarState(currentWorkspacePath);
  const collapsed = state.tagsCollapsed === true;
  tagsSortMode = state.tagsSortMode || 'alpha';
  tagFilterLogic = state.tagsFilterLogic || 'AND';
  _setTagsCollapsed(collapsed, false);
  _updateTagsSortBtn();
  _updateLogicToggleBtn();
}

function _setTagsCollapsed(collapsed, persist = true) {
  if (collapsed) {
    tagsSectionBodyEl.classList.add('collapsed');
    tagsSectionHeaderEl.setAttribute('aria-expanded', 'false');
    tagsSectionToggleEl.classList.remove('expanded');
  } else {
    tagsSectionBodyEl.classList.remove('collapsed');
    tagsSectionHeaderEl.setAttribute('aria-expanded', 'true');
    tagsSectionToggleEl.classList.add('expanded');
  }
  if (persist && currentWorkspacePath) {
    window.api.setSidebarStateKey(currentWorkspacePath, 'tagsCollapsed', collapsed);
  }
}

function _updateTagsSortBtn() {
  if (tagsSortMode === 'alpha') {
    tagsSortBtnEl.textContent = 'A\u2013Z';
    tagsSortBtnEl.title = 'Sort by count';
  } else {
    tagsSortBtnEl.textContent = '#';
    tagsSortBtnEl.title = 'Sort alphabetically';
  }
}

async function refreshTagsList() {
  if (!window.api) return;
  allTags = await window.api.tagsList() || [];
  renderTagsList();
}

function renderTagsList() {
  // Sort
  const sorted = [...allTags].sort((a, b) => {
    if (tagsSortMode === 'count') return b.count - a.count || a.tag.localeCompare(b.tag);
    return a.tag.localeCompare(b.tag);
  });

  // Update count badge
  tagsCountBadgeEl.textContent = sorted.length || '';

  // Show/hide empty placeholder
  if (sorted.length === 0) {
    tagsEmptyEl.style.display = '';
    tagsListEl.innerHTML = '';
    return;
  }
  tagsEmptyEl.style.display = 'none';

  // Render list items
  tagsListEl.innerHTML = '';
  for (const { tag, count } of sorted) {
    const li = document.createElement('li');
    const isActive = activeTagFilters.has(tag);
    li.className = 'tag-item' + (isActive ? ' active' : '');
    li.dataset.tag = tag;
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(isActive));
    li.setAttribute('tabindex', '0');

    const nameSpan = document.createElement('span');
    nameSpan.className = 'tag-item-name';
    nameSpan.textContent = tag;
    nameSpan.title = tag; // tooltip for long names

    const countSpan = document.createElement('span');
    countSpan.className = 'tag-item-count';
    countSpan.textContent = count;

    li.appendChild(nameSpan);
    li.appendChild(countSpan);

    li.addEventListener('click', (e) => {
      const multi = e.ctrlKey || e.metaKey;
      _onTagClick(tag, multi);
    });
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const multi = e.ctrlKey || e.metaKey;
        _onTagClick(tag, multi);
      }
    });

    tagsListEl.appendChild(li);
  }
}

async function _computeTagFilterPaths() {
  if (activeTagFilters.size === 0) {
    tagFilterPaths = null;
    return;
  }

  // Fetch file sets for each selected tag in parallel
  const entries = await Promise.all(
    [...activeTagFilters].map(async tag => ({
      tag,
      files: new Set(await window.api.tagsFiles(tag) || [])
    }))
  );

  if (tagFilterLogic === 'OR') {
    // Union: merge all sets
    tagFilterPaths = new Set();
    for (const { files } of entries) {
      for (const f of files) tagFilterPaths.add(f);
    }
  } else {
    // AND: sort by smallest set first, intersect progressively
    entries.sort((a, b) => a.files.size - b.files.size);
    tagFilterPaths = new Set(entries[0].files);
    for (let i = 1; i < entries.length; i++) {
      for (const f of tagFilterPaths) {
        if (!entries[i].files.has(f)) tagFilterPaths.delete(f);
      }
    }
  }
}

function _updateFilterBar() {
  if (activeTagFilters.size === 0) {
    tagFilterBarEl.classList.add('hidden');
    tagFilterBarNameEl.textContent = '';
    const countEl = document.getElementById('tag-filter-bar-count');
    if (countEl) countEl.textContent = '';
    return;
  }

  const sorted = [...activeTagFilters].sort();
  const logicWord = tagFilterLogic === 'OR' ? ' OR ' : ' AND ';
  tagFilterBarNameEl.textContent = sorted.join(logicWord);

  const countEl = document.getElementById('tag-filter-bar-count');
  if (countEl) {
    const n = tagFilterPaths ? tagFilterPaths.size : 0;
    countEl.textContent = `(${n} result${n !== 1 ? 's' : ''})`;
  }

  tagFilterBarEl.classList.remove('hidden');
}

function _updateLogicToggleBtn() {
  const container = document.getElementById('tags-logic-toggle');
  if (!container) return;
  const segs = container.querySelectorAll('.logic-seg');
  segs.forEach(seg => {
    seg.classList.toggle('active', seg.dataset.logic === tagFilterLogic);
  });
  // Visually dim when ≤1 tag selected (logic is irrelevant then)
  container.classList.toggle('logic-inactive', activeTagFilters.size <= 1);
}

async function _onLogicToggle(mode) {
  if (mode) {
    if (tagFilterLogic === mode) return; // already in this mode
    tagFilterLogic = mode;
  } else {
    tagFilterLogic = tagFilterLogic === 'AND' ? 'OR' : 'AND';
  }
  // Persist
  if (currentWorkspacePath) {
    window.api.setSidebarStateKey(currentWorkspacePath, 'tagsFilterLogic', tagFilterLogic);
  }
  _updateLogicToggleBtn();
  if (activeTagFilters.size > 0) {
    await _computeTagFilterPaths();
    _updateFilterBar();
    renderFilteredTree();
  }
}

async function _onTagClick(tag, isMultiSelect = false) {
  if (isMultiSelect) {
    // Ctrl/Cmd+Click: toggle this tag in/out of selection
    if (activeTagFilters.has(tag)) {
      activeTagFilters.delete(tag);
    } else {
      activeTagFilters.add(tag);
    }
  } else {
    // Plain click: if this is the only selected tag, deselect it; otherwise select only this tag
    if (activeTagFilters.size === 1 && activeTagFilters.has(tag)) {
      activeTagFilters.clear();
    } else {
      activeTagFilters.clear();
      activeTagFilters.add(tag);
    }
  }

  await _computeTagFilterPaths();
  _updateFilterBar();
  renderFilteredTree();
  renderTagsList();
  _updateLogicToggleBtn();
}

function _clearTagFilter() {
  activeTagFilters.clear();
  tagFilterPaths = null;
  _updateFilterBar();
  renderFilteredTree();
  renderTagsList();
  _updateLogicToggleBtn();
}

// Header click — toggle collapse
tagsSectionHeaderEl.addEventListener('click', (e) => {
  // Don't collapse when clicking the sort or logic button inside the header
  if (e.target === tagsSortBtnEl || tagsSortBtnEl.contains(e.target)) return;
  if (tagsLogicToggleEl && (e.target === tagsLogicToggleEl || tagsLogicToggleEl.contains(e.target))) return;
  const isCollapsed = tagsSectionBodyEl.classList.contains('collapsed');
  _setTagsCollapsed(!isCollapsed);
});

tagsSectionHeaderEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    const isCollapsed = tagsSectionBodyEl.classList.contains('collapsed');
    _setTagsCollapsed(!isCollapsed);
  }
});

// Sort button
tagsSortBtnEl.addEventListener('click', (e) => {
  e.stopPropagation();
  tagsSortMode = tagsSortMode === 'alpha' ? 'count' : 'alpha';
  if (currentWorkspacePath) window.api.setSidebarStateKey(currentWorkspacePath, 'tagsSortMode', tagsSortMode);
  _updateTagsSortBtn();
  renderTagsList();
});

// Tag filter clear button
tagFilterClearEl.addEventListener('click', () => _clearTagFilter());
const tagsLogicToggleEl = document.getElementById('tags-logic-toggle');
if (tagsLogicToggleEl) tagsLogicToggleEl.addEventListener('click', (e) => {
  e.stopPropagation();
  const seg = e.target.closest('.logic-seg');
  if (seg) _onLogicToggle(seg.dataset.logic);
});

// Wire up events
window.api.onTagsChanged(async () => {
  await refreshTagsList();
  // If any selected tags are still valid, recompute the active filter
  if (activeTagFilters.size > 0) {
    // Remove from selection any tags that no longer exist
    const existing = new Set(allTags.map(t => t.tag));
    for (const t of [...activeTagFilters]) {
      if (!existing.has(t)) activeTagFilters.delete(t);
    }
    await _computeTagFilterPaths();
    _updateFilterBar();
    renderFilteredTree();
    renderTagsList();
    _updateLogicToggleBtn();
  }
});

// ── End tags sidebar panel ─────────────────────────────────────────────────────

// ── Notes sidebar section (collapsible) ──────────────────────────────────────

function _setNotesCollapsed(collapsed, persist = true) {
  if (collapsed) {
    notesSectionBodyEl.classList.add('collapsed');
    notesSectionHeaderEl.setAttribute('aria-expanded', 'false');
    notesSectionToggleEl.classList.remove('expanded');
  } else {
    notesSectionBodyEl.classList.remove('collapsed');
    notesSectionHeaderEl.setAttribute('aria-expanded', 'true');
    notesSectionToggleEl.classList.add('expanded');
  }
  if (persist && currentWorkspacePath) {
    window.api.setSidebarStateKey(currentWorkspacePath, 'notesCollapsed', collapsed);
  }
}

async function _notesLoadState() {
  if (!currentWorkspacePath) return;
  const state = await window.api.getSidebarState(currentWorkspacePath);
  _setNotesCollapsed(state.notesCollapsed === true, false);
}

function _countTreeFiles(children) {
  let count = 0;
  for (const item of children) {
    if (item.type === 'file' || item.type === 'note') count++;
    else if (item.type === 'folder' && item.children) count += _countTreeFiles(item.children);
  }
  return count;
}

function _updateNotesCount() {
  const count = currentTree && currentTree.children ? _countTreeFiles(currentTree.children) : 0;
  notesCountBadgeEl.textContent = count || '';
}

notesSectionHeaderEl.addEventListener('click', () => {
  const isCollapsed = notesSectionBodyEl.classList.contains('collapsed');
  _setNotesCollapsed(!isCollapsed);
});

notesSectionHeaderEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    const isCollapsed = notesSectionBodyEl.classList.contains('collapsed');
    _setNotesCollapsed(!isCollapsed);
  }
});

// ── Favorites sidebar section (feature 120) ──────────────────────────────────

function _setFavoritesCollapsed(collapsed, persist = true) {
  if (collapsed) {
    favoritesSectionBodyEl.classList.add('collapsed');
    favoritesSectionHeaderEl.setAttribute('aria-expanded', 'false');
    favoritesSectionToggleEl.classList.remove('expanded');
  } else {
    favoritesSectionBodyEl.classList.remove('collapsed');
    favoritesSectionHeaderEl.setAttribute('aria-expanded', 'true');
    favoritesSectionToggleEl.classList.add('expanded');
  }
  if (persist && currentWorkspacePath) {
    window.api.setSidebarStateKey(currentWorkspacePath, 'favoritesCollapsed', collapsed);
  }
}

async function _favoritesLoadState() {
  if (!currentWorkspacePath) return;
  const state = await window.api.getSidebarState(currentWorkspacePath);
  _setFavoritesCollapsed(state.favoritesCollapsed === true, false);
}

function renderFavoritesSection() {
  if (!currentFavorites.length) {
    favoritesSectionEl.classList.add('hidden');
    return;
  }
  favoritesSectionEl.classList.remove('hidden');

  // Update count badge
  favoritesCountBadgeEl.textContent = currentFavorites.length;

  // Rebuild list
  favoritesListEl.innerHTML = '';
  for (const relPath of currentFavorites) {
    const absPath  = currentWorkspacePath + '/' + relPath;
    const treeNode = findNodeByPath(currentTree, absPath);
    const title    = treeNode?.title || treeNode?.name || relPath.split('/').pop().replace(/\.html$/i, '');

    const li = document.createElement('li');
    li.className = 'favorites-list-item' + (absPath === selectedPath ? ' active' : '');
    li.dataset.path    = absPath;
    li.dataset.relPath = relPath;
    li.title = relPath;

    const iconSpan = document.createElement('span');
    iconSpan.className = 'tree-icon';
    iconSpan.innerHTML = ICONS.html;

    const labelSpan = document.createElement('span');
    labelSpan.className = 'favorites-list-item-label';
    labelSpan.textContent = title;

    li.appendChild(iconSpan);
    li.appendChild(labelSpan);

    li.addEventListener('click', () => {
      selectNote(absPath, title);
    });

    // Feature 122: drag-to-reorder
    li.draggable = true;

    li.addEventListener('dragstart', (e) => {
      e.stopPropagation(); // prevent bubbling to file-tree drag handlers
      favDragSourceRelPath = relPath;
      favDragSourceEl = li;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', relPath);

      // Custom drag image: clean clone positioned off-screen
      const clone = li.cloneNode(true);
      clone.style.cssText = `
        position: fixed; top: -200px; left: -200px;
        opacity: 0.85; pointer-events: none;
        width: ${li.offsetWidth}px;
      `;
      document.body.appendChild(clone);
      e.dataTransfer.setDragImage(clone, e.offsetX, e.offsetY);
      requestAnimationFrame(() => clone.remove());

      li.classList.add('fav-dragging');
    });

    li.addEventListener('dragend', () => {
      cleanupFavDragState();
    });

    favoritesListEl.appendChild(li);
  }

  // Feature 122: keep drop indicator as last child after rebuild
  favoritesListEl.appendChild(favDropIndicatorEl);
}

function updateFavoritesActiveHighlight() {
  favoritesListEl.querySelectorAll('.favorites-list-item').forEach(li => {
    li.classList.toggle('active', li.dataset.path === selectedPath);
  });
}

// Feature 122: favorites drag-to-reorder event handlers
favoritesListEl.addEventListener('dragover', (e) => {
  if (!favDragSourceRelPath) return; // not a favorites drag

  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';

  const dropIndex = computeFavDropIndex(e.clientY);
  positionFavDropIndicator(dropIndex);

  // Auto-scroll when cursor is near top/bottom edge of the favorites section body
  const bodyRect = favoritesSectionBodyEl.getBoundingClientRect();
  const SCROLL_ZONE = 30;
  const SCROLL_SPEED = 8;

  if (favDragScrollRAF) {
    cancelAnimationFrame(favDragScrollRAF);
    favDragScrollRAF = null;
  }

  if (e.clientY < bodyRect.top + SCROLL_ZONE) {
    const scroll = () => {
      favoritesSectionBodyEl.scrollTop -= SCROLL_SPEED;
      favDragScrollRAF = requestAnimationFrame(scroll);
    };
    favDragScrollRAF = requestAnimationFrame(scroll);
  } else if (e.clientY > bodyRect.bottom - SCROLL_ZONE) {
    const scroll = () => {
      favoritesSectionBodyEl.scrollTop += SCROLL_SPEED;
      favDragScrollRAF = requestAnimationFrame(scroll);
    };
    favDragScrollRAF = requestAnimationFrame(scroll);
  }
});

favoritesListEl.addEventListener('dragleave', (e) => {
  // Ignore if cursor moved to a child element (prevents flicker)
  if (favoritesListEl.contains(e.relatedTarget)) return;
  favDropIndicatorEl.style.display = 'none';
  if (favDragScrollRAF) {
    cancelAnimationFrame(favDragScrollRAF);
    favDragScrollRAF = null;
  }
});

favoritesListEl.addEventListener('drop', async (e) => {
  if (!favDragSourceRelPath) return;

  e.preventDefault();

  const dropIndex = computeFavDropIndex(e.clientY);
  const draggedRelPath = favDragSourceRelPath; // capture before cleanup

  cleanupFavDragState();

  // Build new ordered array: remove dragged item, insert at drop index
  const oldArray = [...currentFavorites];
  const sourceIndex = oldArray.indexOf(draggedRelPath);
  if (sourceIndex === -1) return; // item no longer in list (edge case)

  const newArray = [...oldArray];
  newArray.splice(sourceIndex, 1);
  // Adjust drop index: if source was before the drop position, the index shifts by -1
  const adjustedIndex = dropIndex > sourceIndex ? dropIndex - 1 : dropIndex;
  if (adjustedIndex === sourceIndex) return; // no-op: dropped in same position
  newArray.splice(adjustedIndex, 0, draggedRelPath);

  // Optimistic update
  currentFavorites = newArray;
  renderFavoritesSection();

  try {
    await window.api.favoritesReorder(newArray);
  } catch (err) {
    // Revert on failure
    currentFavorites = oldArray;
    renderFavoritesSection();
    _showErrorToast('Failed to reorder favorites');
  }
});

favoritesSectionHeaderEl.addEventListener('click', () => {
  const isCollapsed = favoritesSectionBodyEl.classList.contains('collapsed');
  _setFavoritesCollapsed(!isCollapsed);
  favAutoCollapsedBySearch = false; // user took control
});

favoritesSectionHeaderEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    const isCollapsed = favoritesSectionBodyEl.classList.contains('collapsed');
    _setFavoritesCollapsed(!isCollapsed);
    favAutoCollapsedBySearch = false; // user took control
  }
});

favoritesListEl.addEventListener('contextmenu', (e) => {
  const li = e.target.closest('.favorites-list-item');
  if (!li || !li.dataset.path) return;

  const absPath = li.dataset.path;
  contextMenuTarget = { path: absPath, type: 'file', li, source: 'favorites' };

  const items = [
    { label: 'Remove from Favorites', action: 'remove-from-favorites' },
    { separator: true },
    { label: 'Rename',  action: 'rename' },
    { label: 'Delete',  action: 'delete' },
  ];
  if (absPath.toLowerCase().endsWith('.html')) {
    items.push({ separator: true });
    items.push({ label: 'Export as PDF',         action: 'sidebar-export-pdf' });
    items.push({ label: 'Export as Markdown',    action: 'sidebar-export-markdown' });
    items.push({ label: 'Export as Plain Text',  action: 'sidebar-export-plaintext' });
    items.push({ label: 'Export as HTML (copy)', action: 'sidebar-export-html' });
    items.push({ separator: true });
    items.push({ label: 'Save as Template',      action: 'save-as-template' });
  }
  showContextMenu(e, items);
});

function isFavorited(absPath) {
  if (!currentWorkspacePath || !absPath) return false;
  const relPath = absPath.slice(currentWorkspacePath.length + 1);
  return currentFavorites.includes(relPath);
}

function refreshAllStarIcons() {
  // Sidebar file tree stars
  document.querySelectorAll('.tree-star').forEach(starEl => {
    const li = starEl.closest('li');
    if (!li || !li.dataset.path) return;
    const fav = isFavorited(li.dataset.path);
    starEl.innerHTML = fav ? ICONS.starFilled : ICONS.starOutline;
    starEl.classList.toggle('favorited', fav);
  });

  // Tab header stars
  document.querySelectorAll('.tab-star').forEach(starEl => {
    const tabEl = starEl.closest('.tab');
    if (!tabEl || !tabEl.dataset.tabId) return;
    const tab = TabState.getTab(tabEl.dataset.tabId);
    if (!tab || !tab.filePath) return;
    const fav = isFavorited(tab.filePath);
    starEl.innerHTML = fav ? ICONS.starFilled : ICONS.starOutline;
    starEl.classList.toggle('favorited', fav);
  });
}

async function toggleFavorite(absPath) {
  if (!currentWorkspacePath || !absPath) return;
  const relPath = absPath.slice(currentWorkspacePath.length + 1);
  const wasFavorited = currentFavorites.includes(relPath);

  // Optimistic update
  if (wasFavorited) {
    currentFavorites = currentFavorites.filter(p => p !== relPath);
  } else {
    currentFavorites = [...currentFavorites, relPath];
  }
  refreshAllStarIcons();
  renderFavoritesSection();

  try {
    if (wasFavorited) {
      await window.api.favoritesRemove(relPath);
    } else {
      await window.api.favoritesAdd(relPath);
    }
  } catch (err) {
    // Revert on failure
    if (wasFavorited) {
      currentFavorites = [...currentFavorites, relPath];
    } else {
      currentFavorites = currentFavorites.filter(p => p !== relPath);
    }
    refreshAllStarIcons();
    renderFavoritesSection();
    _showErrorToast('Failed to update favorites');
  }
}

window.api.onFavoritesChanged((newList) => {
  const incoming = newList || [];

  // Feature 123: animate removal of stale items if the section is visible
  const isExpanded = !favoritesSectionEl.classList.contains('hidden') &&
    !favoritesSectionBodyEl.classList.contains('collapsed');

  if (isExpanded && incoming.length < currentFavorites.length) {
    const removedRelPaths = currentFavorites.filter(p => !incoming.includes(p));
    for (const relPath of removedRelPaths) {
      const li = favoritesListEl.querySelector(`[data-rel-path="${CSS.escape(relPath)}"]`);
      if (li) li.classList.add('fav-removing');
    }
    // Wait for CSS transition before re-rendering
    setTimeout(() => {
      currentFavorites = incoming;
      renderFavoritesSection();
      refreshAllStarIcons();
    }, 300);
  } else {
    currentFavorites = incoming;
    renderFavoritesSection();
    refreshAllStarIcons();  // Feature 121: sync star icons across sidebar tree + tabs
  }
});

window.api.onWorkspaceLoaded(async () => {
  currentFavorites = await window.api.favoritesList() || [];
  _favoritesLoadState();
  renderFavoritesSection();
  refreshAllStarIcons();
});

// ── End favorites sidebar section ─────────────────────────────────────────────

// Feature 99: load file tags cache on workspace open and update pills
window.api.onWorkspaceLoaded(() => {
  setTimeout(() => {
    loadFileTagsCache().then(() => {
      document.querySelectorAll('li.tree-file').forEach(li => {
        updatePillsForFile(li.dataset.path);
      });
    });
  }, 0);
});

// Feature 99: update file pills on tag changes
window.api.onTagsChanged((changes) => {
  if (!changes) {
    // Null payload = build-complete or bulk change: full cache reload
    loadFileTagsCache().then(() => {
      document.querySelectorAll('li.tree-file').forEach(li => {
        updatePillsForFile(li.dataset.path);
      });
    });
  } else {
    // Incremental update: only touch the changed files
    for (const { filePath, newTags } of changes) {
      if (newTags && newTags.length > 0) {
        fileTagsCache.set(filePath, newTags);
      } else {
        fileTagsCache.delete(filePath);
      }
      updatePillsForFile(filePath);
    }
  }
});

// Graph view (feature 127)
window.api.onGraphOpen(() => openGraphView());

const graphModal = document.getElementById('graph-modal');
const graphCloseBtn = document.getElementById('graph-close-btn');
if (graphCloseBtn) graphCloseBtn.addEventListener('click', closeGraphView);
if (graphModal) {
  graphModal.querySelector('.modal-backdrop')?.addEventListener('click', closeGraphView);
}

// Backlinks section refresh (feature 126)
window.api.onBacklinksChanged((affectedRelPaths) => {
  if (!_rightPanelVisible || _rightPanelActiveTab !== 'outline') return;
  const state = TabState.getState();
  const panel = TabState.getPanel(state.focusedPanelId);
  const tab = panel ? TabState.getActiveTab(state.focusedPanelId) : null;
  if (!tab || !tab.filePath) return;
  if (affectedRelPaths.includes(tab.filePath)) {
    _backlinksCache.delete(tab.filePath); // invalidate cached result
    renderBacklinksSection();
  }
});

// --- Bulk Export (feature 106) ---

let _bulkExportActive = false;

// Set up the IPC progress listener once at startup
window.api.onBulkExportProgress(({ processed, total, currentFile }) => {
  _updateBulkExportBanner(processed, total, currentFile);
});

/** Entry point called from the context menu action handler. */
function startBulkExport(folderPath) {
  _showBulkExportFormatPicker(folderPath);
}

async function exportNoteAs(filePath, format) {
  try {
    let result;
    switch (format) {
      case 'pdf':       result = await window.api.exportSavePdf(filePath);       break;
      case 'markdown':  result = await window.api.exportSaveMarkdown(filePath);  break;
      case 'plaintext': result = await window.api.exportSavePlaintext(filePath); break;
      case 'html':      result = await window.api.exportSaveHtml(filePath);      break;
      default:
        _showSyncToast(`Unknown export format: ${format}`);
        return;
    }
    if (!result) return;
    if (result.cancelled) return;
    if (result.error) {
      _showSyncToast(`Export failed: ${result.error}`);
      return;
    }
    if (result.success && result.filePath) {
      _showSyncToast(`Exported to ${result.filePath}`);
    }
  } catch (err) {
    _showSyncToast(`Export failed: ${err.message}`);
  }
}

function showExportFormatPicker() {
  const panel = TabState.getFocusedPanel();
  const targetPanel = panel || TabState.getState().panels.find(p => p.activeTabId);
  if (!targetPanel) {
    _showSyncToast('No note open to export');
    return;
  }
  const activeTab = TabState.getActiveTab(targetPanel.id);
  if (!activeTab || !activeTab.filePath) {
    _showSyncToast('No note open to export');
    return;
  }
  const filePath = activeTab.filePath;

  document.getElementById('export-format-picker')?.remove();

  const picker = document.createElement('div');
  picker.id = 'export-format-picker';
  picker.className = 'export-format-picker';
  picker.innerHTML =
    '<div class="export-format-picker-title">Export Note as\u2026</div>' +
    '<button data-fmt="pdf">PDF</button>' +
    '<button data-fmt="markdown">Markdown (.md)</button>' +
    '<button data-fmt="plaintext">Plain Text (.txt)</button>' +
    '<button data-fmt="html">HTML (copy)</button>' +
    '<button class="export-format-picker-cancel">Cancel</button>';

  picker.querySelectorAll('button[data-fmt]').forEach(btn => {
    btn.addEventListener('click', () => {
      picker.remove();
      document.removeEventListener('keydown', onPickerKeydown);
      exportNoteAs(filePath, btn.dataset.fmt);
    });
  });

  picker.querySelector('.export-format-picker-cancel').addEventListener('click', () => {
    picker.remove();
    document.removeEventListener('keydown', onPickerKeydown);
  });

  function onPickerKeydown(e) {
    if (e.key === 'Escape') {
      picker.remove();
      document.removeEventListener('keydown', onPickerKeydown);
    }
  }
  document.addEventListener('keydown', onPickerKeydown);

  setTimeout(() => {
    document.addEventListener('mousedown', function dismiss(e) {
      if (!picker.contains(e.target)) {
        picker.remove();
        document.removeEventListener('keydown', onPickerKeydown);
        document.removeEventListener('mousedown', dismiss);
      }
    });
  }, 0);

  document.body.appendChild(picker);
}

/** Shows a small in-app modal to choose the export format. */
function _showBulkExportFormatPicker(folderPath) {
  document.getElementById('bulk-export-picker')?.remove();

  const picker = document.createElement('div');
  picker.id = 'bulk-export-picker';
  picker.className = 'bulk-export-picker';
  picker.innerHTML =
    '<div class="bulk-export-picker-title">Choose Export Format</div>' +
    '<button data-fmt="html">HTML (as-is)</button>' +
    '<button data-fmt="pdf">PDF</button>' +
    '<button data-fmt="markdown">Markdown (.md)</button>' +
    '<button data-fmt="plaintext">Plain Text (.txt)</button>' +
    '<button class="bulk-export-picker-cancel">Cancel</button>';

  picker.querySelectorAll('button[data-fmt]').forEach(btn => {
    btn.addEventListener('click', () => {
      picker.remove();
      _triggerBulkExport(folderPath, btn.dataset.fmt);
    });
  });

  picker.querySelector('.bulk-export-picker-cancel').addEventListener('click', () => {
    picker.remove();
  });

  // Click outside dismisses picker
  setTimeout(() => {
    document.addEventListener('mousedown', function dismiss(e) {
      if (!picker.contains(e.target)) {
        picker.remove();
        document.removeEventListener('mousedown', dismiss);
      }
    });
  }, 0);

  document.body.appendChild(picker);
}

/** Triggers the actual export after format is selected. */
async function _triggerBulkExport(folderPath, format) {
  if (_bulkExportActive) {
    _showSyncToast('A bulk export is already in progress.');
    return;
  }
  _bulkExportActive = true;

  const result = await window.api.exportBulk(folderPath, format);

  _bulkExportActive = false;
  _hideBulkExportBanner();

  if (result.cancelled) {
    // User cancelled — no toast needed
  } else if (result.error) {
    _showSyncToast('Export failed: ' + result.error);
  } else if (result.success) {
    const fileName = result.filePath.replace(/.*[\\/]/, '');
    _showSyncToast('Exported: ' + fileName);
  }
}

/** Creates or updates the progress banner at the bottom of the screen. */
function _updateBulkExportBanner(processed, total, currentFile) {
  let banner = document.getElementById('bulk-export-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'bulk-export-banner';
    banner.className = 'bulk-export-banner';
    banner.innerHTML =
      '<span class="bulk-export-banner-text"></span>' +
      '<button class="bulk-export-banner-cancel">Cancel</button>';
    banner.querySelector('.bulk-export-banner-cancel').addEventListener('click', () => {
      window.api.exportBulkCancel();
      _hideBulkExportBanner();
    });
    document.body.appendChild(banner);
  }

  const msg = total > 0
    ? `Exporting ${processed}/${total} \u2014 ${currentFile}`
    : currentFile;
  banner.querySelector('.bulk-export-banner-text').textContent = msg;
}

function _hideBulkExportBanner() {
  document.getElementById('bulk-export-banner')?.remove();
}

// --- Markdown Import (feature 107) ---

/**
 * Entry point called from context menu action handler.
 * @param {string} folderPath - the target folder to import into
 */
async function startMarkdownImport(folderPath) {
  const filePaths = await window.api.browseMarkdownFiles();
  if (!filePaths || filePaths.length === 0) return;
  _showMarkdownImportModal(filePaths, folderPath);
}

/**
 * Shows the import choice modal.
 * @param {string[]} filePaths  - source .md file paths
 * @param {string}   targetDir  - destination folder in workspace
 */
function _showMarkdownImportModal(filePaths, targetDir) {
  document.getElementById('md-import-modal')?.remove();

  const count = filePaths.length;
  const label = count === 1
    ? `Import "${filePaths[0].replace(/.*[\\/]/, '')}"`
    : `Import ${count} Markdown files`;

  const modal = document.createElement('div');
  modal.id = 'md-import-modal';
  modal.className = 'md-import-modal';
  modal.innerHTML =
    `<div class="md-import-modal-title">${label}</div>` +
    `<div class="md-import-modal-desc">Choose import format:</div>` +
    `<button data-mode="html">Convert to HTML</button>` +
    `<button data-mode="markdown">Keep as Markdown (.md)</button>` +
    `<button class="md-import-modal-cancel">Cancel</button>`;

  modal.querySelectorAll('button[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      modal.remove();
      _runMarkdownImport(filePaths, targetDir, btn.dataset.mode);
    });
  });

  modal.querySelector('.md-import-modal-cancel').addEventListener('click', () => {
    modal.remove();
  });

  // Click outside dismisses modal
  setTimeout(() => {
    document.addEventListener('mousedown', function dismiss(e) {
      if (!modal.contains(e.target)) {
        modal.remove();
        document.removeEventListener('mousedown', dismiss);
      }
    });
  }, 0);

  document.body.appendChild(modal);
}

/**
 * Calls the import IPC and shows result feedback.
 * @param {string[]} filePaths
 * @param {string}   targetDir
 * @param {'html'|'markdown'} mode
 */
async function _runMarkdownImport(filePaths, targetDir, mode) {
  const result = await window.api.importMarkdown(filePaths, targetDir, mode);

  if (result.error) {
    _showSyncToast('Import failed: ' + result.error);
    return;
  }

  const { imported, errors } = result;

  if (imported.length > 0) {
    const msg = imported.length === 1
      ? `Imported: ${imported[0].targetName}`
      : `Imported ${imported.length} files`;
    _showSyncToast(msg);
  }

  if (errors.length > 0) {
    const errNames = errors.map(e => e.sourcePath.replace(/.*[\\/]/, '')).join(', ');
    _showSyncToast(`Import errors: ${errNames}`);
  }
}

async function startPlaintextImport(folderPath) {
  const filePaths = await window.api.browsePlaintextFiles();
  if (!filePaths || filePaths.length === 0) return;
  _showPlaintextImportModal(filePaths, folderPath);
}

/* ─── Web Clip ─────────────────────────────────────────────────────────────── */

async function startWebClip(folderPath) {
  // Remove any existing modal
  document.getElementById('web-clip-modal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'web-clip-modal';
  modal.className = 'web-clip-modal';
  modal.innerHTML =
    '<div class="web-clip-modal-title">Clip from URL</div>' +
    '<input type="url" class="web-clip-url-input" placeholder="https://example.com/article" spellcheck="false">' +
    '<div class="web-clip-modal-buttons">' +
      '<button class="web-clip-btn-clip">Clip</button>' +
      '<button class="web-clip-btn-cancel">Cancel</button>' +
    '</div>';

  const urlInput = modal.querySelector('.web-clip-url-input');
  const clipBtn  = modal.querySelector('.web-clip-btn-clip');
  const cancelBtn = modal.querySelector('.web-clip-btn-cancel');

  // Pre-fill from clipboard if it contains a URL
  try {
    const text = await navigator.clipboard.readText();
    if (text && /^https?:\/\//i.test(text.trim())) {
      urlInput.value = text.trim();
    }
  } catch {}

  function close() { modal.remove(); }

  async function doClip() {
    const url = urlInput.value.trim();
    if (!url) return;
    close();

    _showSyncToast('Clipping from URL\u2026');

    try {
      const result = await window.api.clipFromUrl(url, folderPath);
      if (result.error) {
        _showSyncToast('Clip failed: ' + result.error);
      } else {
        _showSyncToast('Clipped: ' + result.title);
      }
    } catch (err) {
      _showSyncToast('Clip failed: ' + err.message);
    }
  }

  clipBtn.addEventListener('click', doClip);
  cancelBtn.addEventListener('click', close);
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doClip();
    if (e.key === 'Escape') close();
  });

  document.body.appendChild(modal);
  urlInput.focus();
}

/**
 * Entry point for batch import.
 * @param {string} targetFolderPath   - workspace folder to import into
 * @param {{ type: 'folder', path: string } | { type: 'files', paths: string[] } | null} source
 *   If null, opens a folder picker dialog.
 */
async function startBatchImport(targetFolderPath, source) {
  let manifest;

  if (!source) {
    // Open folder picker
    const folderPath = await window.api.batchBrowseFolder();
    if (!folderPath) return;
    manifest = await window.api.batchScanFolder(folderPath);
  } else if (source.type === 'folder') {
    manifest = await window.api.batchScanFolder(source.path);
  } else {
    manifest = await window.api.batchScanFiles(source.paths);
  }

  if (manifest.error) {
    _showSyncToast('Batch import error: ' + manifest.error);
    return;
  }

  _showBatchImportPreviewDialog(manifest, targetFolderPath);
}

/**
 * Shows the batch import preview dialog.
 * @param {Object} manifest  - result from batchScanFolder/batchScanFiles
 * @param {string} targetDir - workspace folder to import into
 */
function _showBatchImportPreviewDialog(manifest, targetDir) {
  document.getElementById('batch-import-modal')?.remove();

  const { files, totalSize, totalSizeLabel, typeCounts } = manifest;
  const SIZE_WARNING_BYTES = 100 * 1024 * 1024; // 100 MB

  // Build a mutable copy of files so actions can be updated in the UI
  const fileItems = files.map(f => Object.assign({}, f));

  // Action options per file type
  const ACTION_OPTIONS = {
    html:           [{ value: 'copy',              label: 'Copy as-is' },           { value: 'skip', label: 'Skip' }],
    md:             [{ value: 'convert-html-md',   label: 'Convert to HTML' },      { value: 'copy', label: 'Copy as .md' }, { value: 'skip', label: 'Skip' }],
    txt:            [{ value: 'convert-html-pre',  label: 'Convert to HTML (pre)' },{ value: 'convert-html-p', label: 'Convert to HTML (paragraphs)' }, { value: 'copy', label: 'Copy as .txt' }, { value: 'skip', label: 'Skip' }],
    image:          [{ value: 'copy',              label: 'Copy as attachment' },    { value: 'skip', label: 'Skip' }],
    binary:         [{ value: 'copy',              label: 'Copy as attachment' },    { value: 'skip', label: 'Skip' }],
    'unknown-text': [{ value: 'convert-html-pre',  label: 'Convert to HTML (pre)' },{ value: 'convert-html-p', label: 'Convert to HTML (paragraphs)' }, { value: 'copy', label: 'Copy as .txt' }, { value: 'skip', label: 'Skip' }],
  };

  const TYPE_LABELS = { html: 'HTML', md: 'Markdown', txt: 'Plain Text', image: 'Image', binary: 'Binary', 'unknown-text': 'Unknown Text' };

  // Summary line: "42 files — 18 HTML, 12 Markdown, 8 Plain Text, 4 Image"
  const summaryParts = Object.entries(typeCounts)
    .filter(([, n]) => n > 0)
    .map(([t, n]) => `${n}\u00a0${TYPE_LABELS[t] || t}`);
  const summaryText = `${files.length} file${files.length !== 1 ? 's' : ''} — ${summaryParts.join(', ')}`;

  // Build per-type action selectors (only for types present)
  const presentTypes = Object.entries(typeCounts).filter(([, n]) => n > 0).map(([t]) => t);

  const typeControlsHtml = presentTypes.map(type => {
    const opts = (ACTION_OPTIONS[type] || [{ value: 'skip', label: 'Skip' }])
      .map(o => `<option value="${o.value}">${o.label}</option>`).join('');
    // Default to the first action option for this type
    const defaultAction = fileItems.find(f => f.type === type)?.defaultAction || 'skip';
    return `
      <div class="batch-import-modal__type-row">
        <span class="batch-import-modal__type-label">All ${TYPE_LABELS[type] || type}:</span>
        <select class="batch-import-modal__type-select" data-type="${type}">
          ${opts}
        </select>
      </div>`;
  }).join('');

  // Build file table rows
  function buildRowHtml(file, idx) {
    const opts = (ACTION_OPTIONS[file.type] || [{ value: 'skip', label: 'Skip' }])
      .map(o => `<option value="${o.value}"${file.action === o.value ? ' selected' : ''}>${o.label}</option>`).join('');
    return `
      <tr class="batch-import-modal__row" data-idx="${idx}">
        <td><input type="checkbox" class="batch-import-modal__check" data-idx="${idx}" ${file.action !== 'skip' ? 'checked' : ''}></td>
        <td class="batch-import-modal__path" title="${file.relativePath}">${file.relativePath}</td>
        <td><span class="batch-import-modal__type-badge batch-import-modal__type-badge--${file.type}">${TYPE_LABELS[file.type] || file.type}</span></td>
        <td class="batch-import-modal__size">${file.sizeLabel}</td>
        <td>
          <select class="batch-import-modal__action-select" data-idx="${idx}">
            ${opts}
          </select>
        </td>
      </tr>`;
  }

  const rowsHtml = fileItems.map((f, i) => buildRowHtml(f, i)).join('');
  const emptyNote = files.length === 0 ? '<p class="batch-import-modal__empty">No importable files found.</p>' : '';

  const warningHtml = totalSize > SIZE_WARNING_BYTES
    ? `<div class="batch-import-modal__size-warning">⚠ Total size is ${totalSizeLabel} — this may significantly increase your workspace size.</div>`
    : '';

  const modal = document.createElement('div');
  modal.id = 'batch-import-modal';
  modal.className = 'batch-import-modal';
  modal.innerHTML = `
    <div class="batch-import-modal__backdrop"></div>
    <div class="batch-import-modal__box">
      <div class="batch-import-modal__header">
        <span class="batch-import-modal__title">Batch Import</span>
        <span class="batch-import-modal__summary">${summaryText} &nbsp;·&nbsp; ${totalSizeLabel} total</span>
      </div>
      ${warningHtml}
      <div class="batch-import-modal__type-controls">${typeControlsHtml}</div>
      ${emptyNote}
      <div class="batch-import-modal__table-wrap">
        <table class="batch-import-modal__table">
          <thead>
            <tr>
              <th><input type="checkbox" id="batch-import-select-all" ${files.length > 0 ? 'checked' : ''}></th>
              <th>File</th>
              <th>Type</th>
              <th>Size</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
      <div class="batch-import-modal__footer">
        <button class="batch-import-modal__cancel-btn">Cancel</button>
        <button class="batch-import-modal__import-btn" ${files.length === 0 ? 'disabled' : ''}>
          Import <span class="batch-import-modal__import-count">${fileItems.filter(f => f.action !== 'skip').length}</span> files
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Helper: update the import button count
  function updateImportCount() {
    const count = fileItems.filter(f => f.action !== 'skip').length;
    modal.querySelector('.batch-import-modal__import-count').textContent = count;
    modal.querySelector('.batch-import-modal__import-btn').disabled = count === 0;
  }

  // Per-type action selectors: update all files of that type
  modal.querySelectorAll('.batch-import-modal__type-select').forEach(sel => {
    sel.addEventListener('change', () => {
      const type = sel.dataset.type;
      const newAction = sel.value;
      fileItems.forEach((file, idx) => {
        if (file.type !== type) return;
        file.action = newAction;
        // Update the per-file select
        const rowSel = modal.querySelector(`.batch-import-modal__action-select[data-idx="${idx}"]`);
        if (rowSel) rowSel.value = newAction;
        // Update checkbox
        const check = modal.querySelector(`.batch-import-modal__check[data-idx="${idx}"]`);
        if (check) check.checked = newAction !== 'skip';
      });
      updateImportCount();
    });
  });

  // Per-file action selects
  modal.querySelectorAll('.batch-import-modal__action-select').forEach(sel => {
    sel.addEventListener('change', () => {
      const idx = parseInt(sel.dataset.idx, 10);
      fileItems[idx].action = sel.value;
      const check = modal.querySelector(`.batch-import-modal__check[data-idx="${idx}"]`);
      if (check) check.checked = sel.value !== 'skip';
      updateImportCount();
    });
  });

  // Per-file checkboxes: toggle between defaultAction and 'skip'
  modal.querySelectorAll('.batch-import-modal__check').forEach(check => {
    check.addEventListener('change', () => {
      const idx = parseInt(check.dataset.idx, 10);
      const file = fileItems[idx];
      file.action = check.checked ? file.defaultAction : 'skip';
      const rowSel = modal.querySelector(`.batch-import-modal__action-select[data-idx="${idx}"]`);
      if (rowSel) rowSel.value = file.action;
      updateImportCount();
    });
  });

  // Select-all checkbox
  const selectAllCheck = modal.querySelector('#batch-import-select-all');
  if (selectAllCheck) {
    selectAllCheck.addEventListener('change', () => {
      const checked = selectAllCheck.checked;
      fileItems.forEach((file, idx) => {
        file.action = checked ? file.defaultAction : 'skip';
        const rowSel = modal.querySelector(`.batch-import-modal__action-select[data-idx="${idx}"]`);
        if (rowSel) rowSel.value = file.action;
        const rowCheck = modal.querySelector(`.batch-import-modal__check[data-idx="${idx}"]`);
        if (rowCheck) rowCheck.checked = checked;
      });
      updateImportCount();
    });
  }

  // Cancel button
  modal.querySelector('.batch-import-modal__cancel-btn').addEventListener('click', () => {
    modal.remove();
  });

  // Backdrop click dismisses
  modal.querySelector('.batch-import-modal__backdrop').addEventListener('click', () => {
    modal.remove();
  });

  // Import button
  modal.querySelector('.batch-import-modal__import-btn').addEventListener('click', () => {
    modal.remove();
    _executeBatchImport(fileItems, targetDir);
  });
}

/**
 * Executes the confirmed batch import and shows a progress banner.
 * @param {Array}  files     - file manifests with user-adjusted actions
 * @param {string} targetDir - destination folder in workspace
 */
async function _executeBatchImport(files, targetDir) {
  // Show progress banner
  document.getElementById('batch-import-progress')?.remove();
  const progressEl = document.createElement('div');
  progressEl.id = 'batch-import-progress';
  progressEl.className = 'batch-import-progress';
  progressEl.innerHTML = `
    <div class="batch-import-progress__text">Preparing import…</div>
    <div class="batch-import-progress__bar-wrap"><div class="batch-import-progress__bar" style="width:0%"></div></div>
    <button class="batch-import-progress__cancel">Cancel</button>
  `;
  document.body.appendChild(progressEl);

  progressEl.querySelector('.batch-import-progress__cancel').addEventListener('click', () => {
    window.api.batchImportCancel();
    progressEl.querySelector('.batch-import-progress__text').textContent = 'Cancelling…';
    progressEl.querySelector('.batch-import-progress__cancel').disabled = true;
  });

  // Listen for progress events
  window.api.onBatchImportProgress(({ processed, total, currentFile }) => {
    const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
    progressEl.querySelector('.batch-import-progress__text').textContent =
      `Importing ${processed}/${total} — ${currentFile}`;
    progressEl.querySelector('.batch-import-progress__bar').style.width = pct + '%';
  });

  const result = await window.api.batchImportExecute(files, targetDir);

  progressEl.remove();

  if (result.error) {
    _showSyncToast('Batch import failed: ' + result.error);
    return;
  }

  const { imported, skipped, errors, cancelled } = result;

  if (cancelled) {
    const msg = imported.length > 0
      ? `Import cancelled — ${imported.length} file${imported.length !== 1 ? 's' : ''} imported before cancel`
      : 'Import cancelled';
    _showSyncToast(msg);
    return;
  }

  if (imported.length > 0) {
    const msg = imported.length === 1
      ? `Imported: ${imported[0].targetPath.replace(/.*[\\/]/, '')}`
      : `Imported ${imported.length} files`;
    _showSyncToast(msg);
  } else {
    _showSyncToast('Nothing imported (all files skipped or errored)');
  }

  if (errors.length > 0) {
    const names = errors.slice(0, 3).map(e => e.relativePath.replace(/.*[\\/]/, '')).join(', ');
    const more = errors.length > 3 ? ` and ${errors.length - 3} more` : '';
    _showSyncToast(`Import errors: ${names}${more}`);
  }
}

/**
 * Shows the plain text import choice modal.
 * @param {string[]} filePaths  - source .txt file paths
 * @param {string}   targetDir  - destination folder in workspace
 */
function _showPlaintextImportModal(filePaths, targetDir) {
  document.getElementById('txt-import-modal')?.remove();

  const count = filePaths.length;
  const label = count === 1
    ? `Import "${filePaths[0].replace(/.*[\\/]/, '')}"`
    : `Import ${count} plain text files`;

  const modal = document.createElement('div');
  modal.id = 'txt-import-modal';
  modal.className = 'md-import-modal';
  modal.innerHTML =
    `<div class="md-import-modal-title">${label}</div>` +
    `<div class="md-import-modal-desc">Choose import format:</div>` +
    `<button data-mode="pre">Preformatted (monospace)</button>` +
    `<button data-mode="p">Paragraphs</button>` +
    `<button data-mode="txt">Keep as .txt</button>` +
    `<button class="md-import-modal-cancel">Cancel</button>`;

  modal.querySelectorAll('button[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      modal.remove();
      _runPlaintextImport(filePaths, targetDir, btn.dataset.mode);
    });
  });

  modal.querySelector('.md-import-modal-cancel').addEventListener('click', () => {
    modal.remove();
  });

  // Click outside dismisses modal
  setTimeout(() => {
    document.addEventListener('mousedown', function dismiss(e) {
      if (!modal.contains(e.target)) {
        modal.remove();
        document.removeEventListener('mousedown', dismiss);
      }
    });
  }, 0);

  document.body.appendChild(modal);
}

/**
 * Calls the plain text import IPC and shows result feedback.
 * @param {string[]} filePaths
 * @param {string}   targetDir
 * @param {'pre'|'p'|'txt'} mode
 */
async function _runPlaintextImport(filePaths, targetDir, mode) {
  const result = await window.api.importPlaintext(filePaths, targetDir, mode);

  if (result.error) {
    _showSyncToast('Import failed: ' + result.error);
    return;
  }

  const { imported, errors } = result;

  if (imported.length > 0) {
    const msg = imported.length === 1
      ? `Imported: ${imported[0].targetName}`
      : `Imported ${imported.length} files`;
    _showSyncToast(msg);
  }

  if (errors.length > 0) {
    const errNames = errors.map(e => e.sourcePath.replace(/.*[\\/]/, '')).join(', ');
    _showSyncToast(`Import errors: ${errNames}`);
  }
}

// Expose TemplatePicker for testing (feature 113)
window.TemplatePicker = TemplatePicker;

// ─── Auth state (feature 141) ─────────────────────────────────────────────────

async function initAuthUI() {
  // Set up auth state change listener from main process
  window.api.onAuthStateChanged((user) => {
    _updateAuthUI(user);
  });

  // Check initial auth state
  const isLoggedIn = await window.api.authIsLoggedIn();
  if (isLoggedIn) {
    const user = await window.api.authGetUser();
    _updateAuthUI(user);
  }

  // Warn if encryption unavailable (Linux without keyring)
  const noEncryption = await window.api.authIsEncryptionUnavailable();
  if (noEncryption) {
    const errEl = document.getElementById('auth-error');
    if (errEl) {
      errEl.textContent = 'Session will not persist (no system keyring available)';
      errEl.classList.remove('hidden');
    }
  }
}

function _updateAuthUI(userOrError) {
  const loggedOutEl = document.getElementById('auth-logged-out');
  const loggedInEl = document.getElementById('auth-logged-in');
  const emailEl = document.getElementById('auth-user-email');
  const errorEl = document.getElementById('auth-error');

  if (!loggedOutEl || !loggedInEl) return;

  // Handle error payloads from auth state changes
  if (userOrError && userOrError.error) {
    loggedOutEl.classList.remove('hidden');
    loggedInEl.classList.add('hidden');
    if (errorEl) {
      errorEl.textContent = 'Sign in failed. Please try again.';
      errorEl.classList.remove('hidden');
      setTimeout(() => errorEl.classList.add('hidden'), 5000);
    }
    return;
  }

  const user = userOrError;

  if (user && user.email) {
    // Logged in
    loggedOutEl.classList.add('hidden');
    loggedInEl.classList.remove('hidden');
    if (emailEl) {
      emailEl.textContent = user.email;
      emailEl.title = user.email;
    }
    if (errorEl) errorEl.classList.add('hidden');
    AwsSyncConsentModal.checkAndShow();
  } else {
    // Logged out
    loggedOutEl.classList.remove('hidden');
    loggedInEl.classList.add('hidden');
    if (emailEl) emailEl.textContent = '';
    if (errorEl) errorEl.classList.add('hidden');
  }
}

// Auth button handlers (feature 141)
const _authSigninBtn = document.getElementById('auth-signin-btn');
const _authSignupBtn = document.getElementById('auth-signup-btn');
const _authSignoutBtn = document.getElementById('auth-signout-btn');

if (_authSigninBtn) {
  _authSigninBtn.addEventListener('click', () => {
    window.api.authLogin();
  });
}

if (_authSignupBtn) {
  _authSignupBtn.addEventListener('click', () => {
    window.api.authSignup();
  });
}

if (_authSignoutBtn) {
  _authSignoutBtn.addEventListener('click', async () => {
    await window.api.authLogout();
  });
}

initAuthUI();

// ─── AWS Content Sync — Conflict handling (feature 143) ───────────────────────

let _awsConflicts = [];

function _syncAwsConflictIndicator() {
  if (typeof UnifiedSyncIndicator !== 'undefined' && UnifiedSyncIndicator.setAwsConflictCount) {
    UnifiedSyncIndicator.setAwsConflictCount(_awsConflicts.length);
  }
}

function _formatRelativeTime(ms) {
  if (!ms) return 'unknown time';
  const diff = Date.now() - ms;
  const abs = Math.abs(diff);
  const sec = Math.round(abs / 1000);
  if (sec < 60) return diff >= 0 ? 'just now' : 'in a moment';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min${min === 1 ? '' : 's'} ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? '' : 's'} ago`;
  return new Date(ms).toLocaleDateString();
}

function _formatByteSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function _countWords(html) {
  if (!html) return 0;
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .trim();
  if (!text) return 0;
  return text.split(/\s+/).length;
}

function _extractNoteTitle(html, fallbackPath) {
  if (html) {
    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1) {
      const txt = h1[1].replace(/<[^>]+>/g, '').trim();
      if (txt) return txt;
    }
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (title) {
      const txt = title[1].trim();
      if (txt) return txt;
    }
  }
  if (!fallbackPath) return 'Untitled';
  const base = fallbackPath.split('/').pop() || fallbackPath;
  return base.replace(/\.html?$/i, '');
}

let _conflictModalBusy = false;

async function _showConflictResolveModal() {
  if (_awsConflicts.length === 0) return;
  if (_conflictModalBusy) return;
  const conflictPath = _awsConflicts[0];

  const modal = document.getElementById('conflict-resolve-modal');
  if (!modal) return;

  const detailsRes = await window.api.awsSyncGetConflictDetails(conflictPath);
  if (!detailsRes?.ok) {
    window.alert(`Could not load conflict details: ${detailsRes?.error || 'unknown error'}`);
    return;
  }
  const d = detailsRes.data;

  const displayPath = d.localRelPath;
  document.getElementById('conflict-resolve-filepath').textContent = displayPath;

  const remaining = _awsConflicts.length;
  const remainingEl = document.getElementById('conflict-resolve-remaining');
  remainingEl.textContent = remaining > 1 ? `${remaining} conflicts remaining` : '';

  const localTitle = _extractNoteTitle(d.localContent, d.localRelPath);
  const remoteTitle = _extractNoteTitle(d.remoteContent, d.localRelPath);
  document.getElementById('conflict-local-title').textContent = localTitle;
  document.getElementById('conflict-remote-title').textContent = remoteTitle;

  const localMeta = [
    `modified ${_formatRelativeTime(d.localMtime)}`,
    `${_countWords(d.localContent).toLocaleString()} words`,
    _formatByteSize(d.localSize),
  ].filter(Boolean).join(' · ');
  const remoteMeta = [
    `modified ${_formatRelativeTime(d.remoteMtime)}`,
    `${_countWords(d.remoteContent).toLocaleString()} words`,
    _formatByteSize(d.remoteSize),
  ].filter(Boolean).join(' · ');
  document.getElementById('conflict-local-meta').textContent = localMeta;
  document.getElementById('conflict-remote-meta').textContent = remoteMeta;

  const localFrame = document.getElementById('conflict-local-preview');
  const remoteFrame = document.getElementById('conflict-remote-preview');
  localFrame.srcdoc = d.localContent || '<p style="padding:12px;color:#888;font-family:sans-serif">(empty)</p>';
  remoteFrame.srcdoc = d.remoteContent || '<p style="padding:12px;color:#888;font-family:sans-serif">(empty)</p>';

  modal.classList.remove('hidden');

  const close = () => {
    modal.classList.add('hidden');
    localFrame.srcdoc = '';
    remoteFrame.srcdoc = '';
  };

  const resolve = async (choice) => {
    if (_conflictModalBusy) return;
    _conflictModalBusy = true;
    try {
      const result = await window.api.awsSyncResolveConflict(conflictPath, choice);
      if (result?.ok) {
        _awsConflicts.shift();
        _syncAwsConflictIndicator();
        window.api.listNotes().then(tree => renderTree(tree));
        close();
        if (_awsConflicts.length > 0) {
          setTimeout(() => _showConflictResolveModal(), 50);
        }
      } else {
        window.alert(`Could not resolve conflict: ${result?.error || 'unknown error'}`);
      }
    } finally {
      _conflictModalBusy = false;
    }
  };

  const bind = (id, handler) => {
    const btn = document.getElementById(id);
    const clone = btn.cloneNode(true);
    btn.parentNode.replaceChild(clone, btn);
    clone.addEventListener('click', handler);
    return clone;
  };

  bind('conflict-keep-local', () => resolve('keep-local'));
  bind('conflict-keep-remote', () => resolve('keep-remote'));
  bind('conflict-keep-both', () => resolve('keep-both'));
  bind('conflict-resolve-cancel', () => close());
}

window.api.onAwsSyncContentStatus((data) => {
  if (data.event === 'conflict' && data.conflict) {
    const conflictFile = data.conflict.conflict || data.conflict.server;
    if (conflictFile && !_awsConflicts.includes(conflictFile)) {
      _awsConflicts.push(conflictFile);
    }
    _syncAwsConflictIndicator();
  }
  if (data.event === 'sync-complete' && data.conflicts?.length > 0) {
    for (const c of data.conflicts) {
      if (!_awsConflicts.includes(c.conflict)) _awsConflicts.push(c.conflict);
    }
    _syncAwsConflictIndicator();
  }
});

// Load any existing conflict files on startup
window.api.awsSyncGetConflicts?.().then((result) => {
  if (result?.ok && result.data.conflicts.length > 0) {
    _awsConflicts = result.data.conflicts;
    _syncAwsConflictIndicator();
  }
});

// ─── Theme toggle (feature 153) ───────────────────────────────────────────────

const ICON_MOON = `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
  <path d="M6 .278a.768.768 0 0 1 .08.858 7.208 7.208 0 0 0-.878 3.46c0 4.021 3.278 7.277 7.318 7.277.527 0 1.04-.055 1.533-.16a.787.787 0 0 1 .81.316.733.733 0 0 1-.031.893A8.349 8.349 0 0 1 8.344 16C3.734 16 0 12.286 0 7.71 0 4.266 2.114 1.312 5.124.06A.752.752 0 0 1 6 .278z"/>
</svg>`;

const ICON_SUN = `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
  <path d="M8 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM8 0a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 0zm0 13a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 13zm8-5a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2a.5.5 0 0 1 .5.5zM3 8a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2A.5.5 0 0 1 3 8zm10.657-5.657a.5.5 0 0 1 0 .707l-1.414 1.415a.5.5 0 1 1-.707-.708l1.414-1.414a.5.5 0 0 1 .707 0zm-9.193 9.193a.5.5 0 0 1 0 .707L3.05 13.657a.5.5 0 0 1-.707-.707l1.414-1.414a.5.5 0 0 1 .707 0zm9.193 2.121a.5.5 0 0 1-.707 0l-1.414-1.414a.5.5 0 0 1 .707-.707l1.414 1.414a.5.5 0 0 1 0 .707zM4.464 4.465a.5.5 0 0 1-.707 0L2.343 3.05a.5.5 0 1 1 .707-.707l1.414 1.414a.5.5 0 0 1 0 .707z"/>
</svg>`;

(function initThemeToggle() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;

  function getCurrentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }

  function updateIcon(theme) {
    btn.innerHTML = theme === 'light' ? ICON_SUN : ICON_MOON;
  }

  // Set initial icon based on the theme already applied by preload.
  updateIcon(getCurrentTheme());

  btn.addEventListener('click', () => {
    const current = getCurrentTheme();
    const next = current === 'light' ? 'dark' : 'light';

    if (next === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }

    document.querySelectorAll('webview').forEach(wv => {
      const js = next === 'light'
        ? `document.documentElement.setAttribute('data-theme', 'light')`
        : `document.documentElement.removeAttribute('data-theme')`;
      wv.executeJavaScript(js).catch(() => {});
    });

    updateIcon(next);
    window.api.setTheme(next); // async fire-and-forget — DOM is already updated
  });
})();

// Server sync (SSH/SFTP) — feed conflicts into the unified sync indicator
window.api.onServerSyncContentStatus?.((data) => {
  if (data.event === 'conflict' && data.conflict) {
    const conflictFile = data.conflict.conflict || data.conflict.server;
    if (conflictFile && !_awsConflicts.includes(conflictFile)) {
      _awsConflicts.push(conflictFile);
    }
    _syncAwsConflictIndicator();
  }
  if (data.event === 'sync-complete' && data.conflicts?.length > 0) {
    for (const c of data.conflicts) {
      if (!_awsConflicts.includes(c.conflict)) _awsConflicts.push(c.conflict);
    }
    _syncAwsConflictIndicator();
  }
});

// ─── Terminal visibility ──────────────────────────────────────────────────────
window.api.onTerminalVisibilityChanged((visible, _height) => {
  const termBtn = document.getElementById('bottom-terminal-btn');
  if (termBtn) termBtn.classList.toggle('active', visible);
  syncBottomBarDisclaimer();
  // If terminal just opened, hide chat
  if (visible) {
    const chatBtn = document.getElementById('bottom-chat-btn');
    if (chatBtn) chatBtn.classList.remove('active');
    if (aiExpandState !== 'hidden') {
      closeHistoryPanel();
      setExpanded('hidden');
    }
  }
});

// ─── Terminal panel bounds ───────────────────────────────────────────────────
// Send layout offsets to the main process so it can compute the note panel area
// in screen coordinates using mainWindow.getContentBounds().
function _sendTerminalPanelBounds() {
  if (!window.api.sendTerminalPanelBounds) return;
  const sidebar = document.getElementById('sidebar');
  const sidebarResize = document.getElementById('sidebar-resize');
  const titleBar = document.getElementById('title-bar');
  const rightBar = document.getElementById('right-panel-bar');

  const bottomBar = document.getElementById('bottom-bar');

  const sidebarLeft = (sidebar ? sidebar.getBoundingClientRect().width : 0)
    + (sidebarResize ? sidebarResize.getBoundingClientRect().width : 0);
  const titleBarHeight = titleBar ? titleBar.getBoundingClientRect().height : 0;
  const rightBarWidth = rightBar ? rightBar.getBoundingClientRect().width : 0;
  const bottomBarHeight = bottomBar ? bottomBar.getBoundingClientRect().height : 0;

  window.api.sendTerminalPanelBounds({
    sidebarLeft: Math.round(sidebarLeft),
    titleBarHeight: Math.round(titleBarHeight),
    rightBarWidth: Math.round(rightBarWidth),
    bottomBarHeight: Math.round(bottomBarHeight),
  });
}
// Send on load and whenever layout changes
window.addEventListener('resize', _sendTerminalPanelBounds);
requestAnimationFrame(() => _sendTerminalPanelBounds());
