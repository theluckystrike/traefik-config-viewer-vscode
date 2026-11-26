'use strict';

// TRIES1 (15 Nov, owner decision 09:40): 1 free try per Pro tool (was 3).
const DEFAULT_TRIES = 1;
const CLOSED_KEY = 'zovo.reach1.closed';

function triesLabel(left) {
  const n = Math.max(0, Number(left) || 0);
  return n === DEFAULT_TRIES ? `${n} free ${n === 1 ? 'try' : 'tries'}` : `${n} ${n === 1 ? 'try' : 'tries'} left`;
}

function remainingTries(globalState, key, tools, maximum = DEFAULT_TRIES) {
  const used = globalState && typeof globalState.get === 'function' ? globalState.get(key) || {} : {};
  return Object.fromEntries((tools || []).map((tool) => [tool.id, Math.max(0, maximum - (Number(used[tool.id]) || 0))]));
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function commandUri(command, args) {
  return `command:${command}?${encodeURIComponent(JSON.stringify(args))}`;
}

// CONV6 (wave18, 17 Nov 2026, CI1/CI2 point-of-use pattern): each Pro tool link in the row carries a small "PRO"
// mark, and a lock mark once its free try is used (tries left is 0). No new view, no toast. The pick rows get the same
// marks with pickItem(): "PRO" in the description and $(lock) before the label after the free try.
const PRO_MARK = '<span class="zovo-reach1-pro" aria-hidden="true">PRO</span>';
const LOCK_MARK = '<span class="zovo-reach1-lock" title="Free try used" aria-hidden="true"><svg width="9" height="10" viewBox="0 0 9 10" focusable="false"><path fill="currentColor" d="M2 4V3a2.5 2.5 0 0 1 5 0v1h1v6H1V4h1zm1 0h3V3a1.5 1.5 0 0 0-3 0v1z"/></svg></span>';
/** True when the free try of a tool is used: its tries-left value is a number that is 0 or less. */
function triedOut(left) {
  if (left === undefined || left === null || left === '') return false;
  const n = Number(left);
  return Number.isFinite(n) && n <= 0;
}
/** A QuickPick item with the CONV6 marks: "PRO" first in the description; $(lock) before the label when tried out. */
function pickItem(item, left) {
  if (!item || typeof item.label !== 'string') return item;
  const lock = triedOut(left) && !item.label.startsWith('$(lock) ') ? '$(lock) ' : '';
  const d = typeof item.description === 'string' && item.description ? item.description : '';
  return Object.assign({}, item, { label: `${lock}${item.label}`, description: /^PRO\b/.test(d) ? d : (d ? `PRO \u00b7 ${d}` : 'PRO') });
}

function renderToolbarRow({ tools = [], tries = {}, commandPrefix, closed = false, getProLabel = 'Get Zovo Pro' } = {}) {
  if (closed || !Array.isArray(tools) || tools.length === 0) return '';
  const buttons = tools.map((tool) => {
    if (!tool || !tool.id || !tool.title || !tool.command) return '';
    const label = triesLabel(tries[tool.id]);
    const out = triedOut(tries[tool.id]); // CONV6: PRO mark always, lock mark after the free try
    return `<a class="zovo-reach1-tool" href="${esc(commandUri(tool.command, [{ surface: 'toolbar' }]))}" aria-label="${esc(`${tool.title}, Zovo Pro, ${out ? 'free try used' : label}`)}">${esc(tool.title)}${PRO_MARK}${out ? LOCK_MARK : ''} <small>${esc(label)}</small></a>`;
  }).filter(Boolean).join('');
  if (!buttons) return '';
  const buy = commandUri(`${commandPrefix}.getPro`, [{ surface: 'toolbar' }]);
  return `<nav class="zovo-reach1" aria-label="Zovo Pro tools">${buttons}<a class="zovo-reach1-buy" href="${esc(buy)}">${esc(getProLabel)}</a><button class="zovo-reach1-close" type="button" aria-label="Close Pro tools row">×</button></nav>`;
}

function bindToolbarRow(root, { session = globalThis.sessionStorage, key = CLOSED_KEY } = {}) {
  if (!root || typeof root.addEventListener !== 'function') return { dispose() {} };
  const click = (event) => {
    const close = event.target && event.target.closest && event.target.closest('.zovo-reach1-close');
    if (!close) return;
    if (session && typeof session.setItem === 'function') session.setItem(key, '1');
    const row = close.closest('.zovo-reach1');
    if (row) row.hidden = true;
  };
  root.addEventListener('click', click);
  return { dispose() { root.removeEventListener('click', click); } };
}

function isClosed(session = globalThis.sessionStorage, key = CLOSED_KEY) {
  return !!(session && typeof session.getItem === 'function' && session.getItem(key) === '1');
}

function explorerMenus(tools) {
  if (!Array.isArray(tools)) return [];
  return tools.filter((t) => t && t.command && t.title && Array.isArray(t.extensions) && t.extensions.length)
    .flatMap((tool) => tool.extensions.map((extension) => ({
      command: tool.command,
      title: `Zovo Pro: ${tool.title}`,
      when: `resourceExtname == ${extension.startsWith('.') ? extension : `.${extension}`}`,
      group: 'zovoPro@1',
    })));
}

// ---- CONV3 (wave18, 16 Nov 2026, REACH1 picks 1, 2 and 5) ----
// The moment of value is the free try. Right after it counts, the Pro tools row shows one line (never a popup, toast or
// modal): "You used your free try of <tool> on <file>. Zovo Pro keeps it on, USD 19 once. See Zovo Pro". Its link runs
// <prefix>.getPro with { surface: 'pick', direct: true }: the license Worker page, tagged <install id>_pick_<listing>.
// The line closes with the row (its close button) and is gone when Pro is on. The file name of the try is kept on this
// computer only (globalState TRIED_ON_KEY, tool id -> file name), so the Pro panel can name it too.
const TRIED_ON_KEY = 'zovo.reach1.triedOn';
const PRICE_ONE = 19;

/** The last path part of a Uri, a Uri string or a path; '' for nothing. At most 120 characters. */
function fileNameOf(u) {
  try {
    if (!u) return '';
    const p = typeof u === 'string' ? (/^[a-z][a-z0-9+.-]*:/i.test(u) ? decodeURIComponent(new URL(u).pathname) : u) : String(u.path || u.fsPath || '');
    return p.split(/[\\/]/).filter(Boolean).pop().slice(0, 120);
  } catch (e) { return ''; }
}

/** The row's result line after a free try. note: { title, file }. '' without a note or a command prefix. */
function renderUsedLine(note, commandPrefix) {
  if (!note || !note.title || !commandPrefix) return '';
  const on = note.file ? ` on ${note.file}` : '';
  const href = commandUri(`${commandPrefix}.getPro`, [{ surface: 'pick', direct: true }]);
  return `<span class="zovo-reach1-used" role="status">You used your free try of ${esc(note.title)}${esc(on)}. Zovo Pro keeps it on, USD ${PRICE_ONE} once. <a class="zovo-reach1-used-buy" href="${esc(href)}">See Zovo Pro</a></span>`;
}
/** CSS for the result line (a full-width line under the row's links). */
// CONV6: the PRO and lock marks (MARK_CSS) ride with USED_CSS, so every listing that loads USED_CSS shows them.
const MARK_CSS = '.zovo-reach1 .zovo-reach1-pro{display:inline-block;margin-left:4px;padding:0 3px;border-radius:2px;font-size:8.5px;font-weight:600;line-height:12px;letter-spacing:.3px;vertical-align:1px;background:var(--vscode-badge-background,#4d4d4d);color:var(--vscode-badge-foreground,#fff)}'
  + '.zovo-reach1 .zovo-reach1-lock{display:inline-block;margin-left:3px;line-height:0;vertical-align:-1px;color:var(--vscode-descriptionForeground)}';
const USED_CSS = '.zovo-reach1 .zovo-reach1-used{flex-basis:100%;white-space:normal;color:var(--vscode-foreground)}'
  + '.zovo-reach1 .zovo-reach1-used a{margin-left:2px}' + MARK_CSS;

/** The status bar text: the first tool with a free try left, "$(tools) <tool>: 1 free try"; "$(tools) Pro tools" after. */
function statusText(tools, tries) {
  const t = (Array.isArray(tools) ? tools : []).find((x) => x && x.title && (Number((tries || {})[x.id]) || 0) > 0);
  return t ? `$(tools) ${t.title}: ${triesLabel(tries[t.id])}` : '$(tools) Pro tools';
}

/**
 * The Pro panel's value line (the copy of Hex 0.3.14): names the tool and the file of the free try.
 * o: { tool, file, tried (the free try is used), others (the count of the listing's other Pro tools), product }
 */
function valueLine({ tool, file = '', tried = true, others = 0, product = '' } = {}) {
  const n = Math.max(0, Number(others) || 0);
  const with_ = n > 0 && product ? `, with the other ${n} Pro ${n === 1 ? 'tool' : 'tools'} of ${product}` : '';
  if (!tried) return `Zovo Pro turns on ${tool} for every file${with_}.`;
  return `You tried ${tool} once for free${file ? ` on ${file}` : ''}. Zovo Pro keeps it on for every file${with_}.`;
}

/** The file name of a tool's free try on this computer ('' when unknown). */
function triedOn(globalState, id) {
  try { const v = ((globalState && globalState.get(TRIED_ON_KEY)) || {})[id]; return typeof v === 'string' ? v : ''; } catch (e) { return ''; }
}

/**
 * Sees a free try count: compares the tries left now with the last values. o: { globalState, tools: [{ id, title }],
 * triesOf(tool) -> tries left }. check(file) returns the new note { id, title, file } or null, and keeps the file name
 * in globalState. base() takes the first values (call it before the first run).
 */
function createUsedTracker({ globalState, tools, triesOf }) {
  const list = (Array.isArray(tools) ? tools : []).filter((t) => t && t.id && t.title);
  let last = null;
  let note = null;
  const now = () => { const m = {}; for (const t of list) { let n; try { n = Number(triesOf(t)); } catch (e) { n = NaN; } m[t.id] = Number.isFinite(n) ? n : null; } return m; };
  function base() { if (!last) last = now(); }
  function check(file) {
    const cur = now();
    let hit = null;
    if (last) for (const t of list) if (cur[t.id] !== null && last[t.id] !== null && cur[t.id] < last[t.id]) hit = t;
    last = cur;
    if (!hit) return null;
    note = { id: hit.id, title: hit.title, file: fileNameOf(file) };
    if (note.file && globalState && typeof globalState.update === 'function') {
      try {
        const m = Object.assign({}, globalState.get(TRIED_ON_KEY) || {}, { [hit.id]: note.file });
        Promise.resolve(globalState.update(TRIED_ON_KEY, m)).catch(() => {});
      } catch (e) { /* the file name is optional */ }
    }
    return note;
  }
  return { base, check, get note() { return note; }, clear() { note = null; } };
}

// REACH2 (21 Nov 2026): the Pro tool where the user acts. Text only; each product places it (no popup, no toast, not on open).
// alsoText: the one quiet line right after a related free action ends ("Also: <tool> (1 free try)"; after the try "(Pro)").
// paletteTitle: the Command Palette title "<tool> (Pro, 1 free try)".
// createAlsoStatus: for text-editor listings with no viewer: one status bar item with that text for `ms` (default 20 s)
//   after the free action, then hidden. A click runs the tool command. A new call replaces the old item text.
const ALSO_MS = 20000;
function alsoText(title, left = DEFAULT_TRIES) {
  const t = String(title || '').trim();
  if (!t) return '';
  return Number(left) > 0 ? `Also: ${t} (1 free try)` : `Also: ${t} (Pro)`;
}
function paletteTitle(title) {
  const t = String(title || '').trim();
  return t ? `${t} (Pro, 1 free try)` : '';
}
function createAlsoStatus(vscode, { id = 'zovo.reach2.also', priority = 99 } = {}) {
  let item = null;
  let timer = null;
  function show({ title, left = DEFAULT_TRIES, command, args, tooltip, ms = ALSO_MS } = {}) {
    const text = alsoText(title, left);
    if (!text || !command) return null;
    try {
      if (!item) item = vscode.window.createStatusBarItem(id, vscode.StatusBarAlignment.Left, priority);
      item.text = `$(tools) ${text}`;
      item.tooltip = tooltip || `${text}. Runs ${String(title).trim()}.`;
      item.command = args === undefined ? command : { command, title: String(title).trim(), arguments: Array.isArray(args) ? args : [args] };
      item.show();
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { try { item.hide(); } catch (e) { /* closed */ } }, Math.max(1000, Number(ms) || ALSO_MS));
      if (timer && typeof timer.unref === 'function') timer.unref();
      return item;
    } catch (e) { return null; }
  }
  function hide() { if (timer) clearTimeout(timer); timer = null; try { if (item) item.hide(); } catch (e) { /* closed */ } }
  function dispose() { hide(); try { if (item) item.dispose(); } catch (e) { /* closed */ } item = null; }
  return { show, hide, dispose, get item() { return item; } };
}

module.exports = {
  DEFAULT_TRIES, CLOSED_KEY, triesLabel, remainingTries, renderToolbarRow, bindToolbarRow, isClosed, explorerMenus,
  TRIED_ON_KEY, fileNameOf, renderUsedLine, USED_CSS, statusText, valueLine, triedOn, createUsedTracker,
  PRO_MARK, LOCK_MARK, MARK_CSS, triedOut, pickItem,
  ALSO_MS, alsoText, paletteTitle, createAlsoStatus, // REACH2
};
