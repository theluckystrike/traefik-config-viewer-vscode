'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
// factory folder, or an extension repo after apply.sh (src/license; src/zovo for XLSX)
const dir = ['..', '../src/license', '../src/zovo'].find((d) => require('fs').existsSync(require('path').join(__dirname, d, 'reach1.js'))) || '..';
const reach = require(`${dir}/reach1`);
const idx = require(`${dir}/index`);

const tools = [
  { id: 'merge', title: 'Merge PDFs', command: 'pdf.merge', extensions: ['.pdf'] },
  { id: 'split', title: 'Split PDF', command: 'pdf.split', extensions: ['pdf'] },
];

test('REACH1 tries label reads the existing counter as a remaining count', () => {
  // TRIES1 (15 Nov): 1 free try per Pro tool
  assert.equal(reach.DEFAULT_TRIES, 1);
  assert.equal(reach.triesLabel(1), '1 free try');
  assert.equal(reach.triesLabel(0), '0 tries left');
  assert.equal(reach.triesLabel(2), '2 tries left');
  assert.deepEqual(reach.remainingTries({ get: (key) => key === 'viewer.proTrial' ? { merge: 1, split: 3 } : {} }, 'viewer.proTrial', tools), { merge: 0, split: 0 });
  assert.deepEqual(reach.remainingTries({ get: () => ({}) }, 'viewer.proTrial', tools), { merge: 1, split: 1 });
  assert.deepEqual(reach.remainingTries({ get: (key) => key === 'viewer.proTrial' ? { merge: 1, split: 3 } : {} }, 'viewer.proTrial', tools, 3), { merge: 2, split: 0 });
});

test('REACH1 card links carry toolbar and context surface tags', () => {
  assert.ok(idx.SURFACES.includes('toolbar'));
  assert.ok(idx.SURFACES.includes('ctx'));
  const html = reach.renderToolbarRow({ tools, tries: { merge: 3 }, commandPrefix: 'pdfViewer' });
  const href = html.match(/class="zovo-reach1-buy" href="([^"]+)/)[1];
  const url = new URL(href.replace('&amp;', '&'));
  assert.equal(url.pathname, 'pdfViewer.getPro');
  assert.deepEqual(JSON.parse(decodeURIComponent(url.search.slice(1))), [{ surface: 'toolbar' }]);
  assert.deepEqual(reach.explorerMenus(tools).map((m) => m.title), ['Zovo Pro: Merge PDFs', 'Zovo Pro: Split PDF']);
  assert.ok(idx.SURFACES.includes('ctx'), 'ctx is accepted by card2 surface validation');
  assert.equal(idx.surfaceOf({ surface: 'toolbar' }), 'toolbar');
  assert.equal(idx.surfaceOf({ surface: 'ctx' }), 'ctx');
});

test('REACH1 row hides after close for the rest of the session', () => {
  const values = new Map();
  const session = { getItem: (k) => values.get(k) || null, setItem: (k, v) => values.set(k, v) };
  assert.equal(reach.isClosed(session), false);
  const root = { addEventListener(_name, fn) { this.click = fn; }, removeEventListener() {} };
  const row = { hidden: false };
  const close = { closest: (selector) => selector === '.zovo-reach1' ? row : null };
  reach.bindToolbarRow(root, { session });
  root.click({ target: { closest: (selector) => selector === '.zovo-reach1-close' ? close : null } });
  assert.equal(row.hidden, true);
  assert.equal(reach.isClosed(session), true);
  assert.equal(reach.renderToolbarRow({ tools, commandPrefix: 'pdfViewer', closed: reach.isClosed(session) }), '');
});

test('REACH1 emits no row when the listing has no Pro tools', () => {
  assert.equal(reach.renderToolbarRow({ tools: [], commandPrefix: 'viewer' }), '');
  assert.equal(reach.renderToolbarRow({ commandPrefix: 'viewer' }), '');
});

// ---- CONV3 (wave18, 16 Nov 2026): REACH1 picks 1, 2 and 5 ----
test('CONV3 result line: names the tool and the file, USD 19 once, one direct link tagged pick; escapes', () => {
  const html = reach.renderUsedLine({ title: 'Merge PDFs', file: 'a <b>.pdf' }, 'pdfViewer');
  assert.match(html, /^<span class="zovo-reach1-used" role="status">You used your free try of Merge PDFs on a &lt;b&gt;\.pdf\. Zovo Pro keeps it on, USD 19 once\. <a class="zovo-reach1-used-buy" href="command:pdfViewer\.getPro\?[^"]+">See Zovo Pro<\/a><\/span>$/);
  const href = html.match(/href="([^"]+)"/)[1];
  assert.deepEqual(JSON.parse(decodeURIComponent(href.split('?')[1])), [{ surface: 'pick', direct: true }]);
  assert.equal(idx.surfaceOf(JSON.parse(decodeURIComponent(href.split('?')[1]))), 'pick');
  assert.equal(reach.renderUsedLine({ title: 'Merge PDFs', file: '' }, 'pdfViewer').includes(' on .'), false);
  assert.match(reach.renderUsedLine({ title: 'Merge PDFs' }, 'pdfViewer'), /free try of Merge PDFs\. Zovo Pro/);
  assert.equal(reach.renderUsedLine(null, 'pdfViewer'), '');
  assert.equal(reach.renderUsedLine({ title: 'x' }, ''), '');
  assert.doesNotMatch(html, /USD (?!19\b)\d+/);
});

test('CONV3 status text: the first tool with a free try left, then "Pro tools"', () => {
  assert.equal(reach.statusText(tools, { merge: 1, split: 1 }), '$(tools) Merge PDFs: 1 free try');
  assert.equal(reach.statusText(tools, { merge: 0, split: 1 }), '$(tools) Split PDF: 1 free try');
  assert.equal(reach.statusText(tools, { merge: 0, split: 0 }), '$(tools) Pro tools');
  assert.equal(reach.statusText([], {}), '$(tools) Pro tools');
});

test('CONV3 value line (the Hex 0.3.14 panel copy) and file names', () => {
  assert.equal(reach.valueLine({ tool: 'Merge PDFs', file: 'a.pdf', others: 5, product: 'PDF Viewer' }), 'You tried Merge PDFs once for free on a.pdf. Zovo Pro keeps it on for every file, with the other 5 Pro tools of PDF Viewer.');
  assert.equal(reach.valueLine({ tool: 'Merge PDFs', others: 1, product: 'PDF Viewer' }), 'You tried Merge PDFs once for free. Zovo Pro keeps it on for every file, with the other 1 Pro tool of PDF Viewer.');
  assert.equal(reach.valueLine({ tool: 'Merge PDFs', tried: false, others: 2, product: 'PDF Viewer' }), 'Zovo Pro turns on Merge PDFs for every file, with the other 2 Pro tools of PDF Viewer.');
  assert.equal(reach.fileNameOf('file:///Users/x/My%20Deck.pptx'), 'My Deck.pptx');
  assert.equal(reach.fileNameOf({ path: '/w/a.npy' }), 'a.npy');
  assert.equal(reach.fileNameOf('C:\\w\\b.docx'), 'b.docx');
  assert.equal(reach.fileNameOf(undefined), '');
});

test('CONV3 used tracker: a drop in tries left gives one note with the file; the file name is kept for the panel', async () => {
  const store = new Map();
  const gs = { get: (k) => store.get(k), update: async (k, v) => { store.set(k, v); } };
  const left = { merge: 1, split: 1 };
  const tr = reach.createUsedTracker({ globalState: gs, tools, triesOf: (t) => left[t.id] });
  assert.equal(tr.check('/w/a.pdf'), null, 'first call only takes the values');
  left.split = 0;
  const n = tr.check({ path: '/w/report.pdf' });
  assert.deepEqual(n, { id: 'split', title: 'Split PDF', file: 'report.pdf' });
  assert.deepEqual(tr.note, n);
  await new Promise((r) => setImmediate(r));
  assert.equal(reach.triedOn(gs, 'split'), 'report.pdf');
  assert.equal(reach.triedOn(gs, 'merge'), '');
  assert.equal(tr.check('/w/x.pdf'), null, 'no new drop: no new note');
  assert.deepEqual(tr.note, n, 'the note stays until clear()');
  tr.clear();
  assert.equal(tr.note, null);
  // base() before the run catches the first try
  const l2 = { merge: 1 };
  const t2 = reach.createUsedTracker({ globalState: gs, tools, triesOf: (t) => l2[t.id] });
  t2.base(); l2.merge = 0;
  assert.equal(t2.check('').title, 'Merge PDFs');
  // a store that throws gives no note and no error
  const t3 = reach.createUsedTracker({ globalState: gs, tools, triesOf: () => { throw new Error('x'); } });
  t3.base();
  assert.equal(t3.check('a'), null);
});

// REACH2 (21 Nov 2026): the "Also:" line, the palette title and the quiet status item for text-editor listings
test('REACH2 alsoText and paletteTitle', () => {
  assert.equal(reach.alsoText('Export selection'), 'Also: Export selection (1 free try)');
  assert.equal(reach.alsoText('Export selection', 1), 'Also: Export selection (1 free try)');
  assert.equal(reach.alsoText('Export selection', 0), 'Also: Export selection (Pro)');
  assert.equal(reach.alsoText(''), '');
  assert.equal(reach.paletteTitle('Batch convert'), 'Batch convert (Pro, 1 free try)');
  assert.equal(reach.paletteTitle(' '), '');
});

test('REACH2 createAlsoStatus: one item, the tool command, hidden after the time; no message, no popup', async () => {
  const items = [];
  const shown = [];
  const vscode = {
    StatusBarAlignment: { Left: 1, Right: 2 },
    window: {
      createStatusBarItem: (id, align, prio) => { const it = { id, align, prio, shown: false, show() { this.shown = true; }, hide() { this.shown = false; }, dispose() { this.disposed = true; } }; items.push(it); return it; },
      showInformationMessage: async (m) => { shown.push(m); },
    },
  };
  const a = reach.createAlsoStatus(vscode);
  assert.equal(a.show({ title: 'Sanitizer report' }), null, 'no command, no item');
  const it = a.show({ title: 'Sanitizer report', command: 'runCpp.sanitize', args: { surface: 'also' }, ms: 1000 });
  assert.equal(items.length, 1);
  assert.equal(it.text, '$(tools) Also: Sanitizer report (1 free try)');
  assert.deepEqual(it.command, { command: 'runCpp.sanitize', title: 'Sanitizer report', arguments: [{ surface: 'also' }] });
  assert.equal(it.shown, true);
  a.show({ title: 'Sanitizer report', left: 0, command: 'runCpp.sanitize', ms: 1000 });
  assert.equal(items.length, 1, 'the same item');
  assert.equal(it.text, '$(tools) Also: Sanitizer report (Pro)');
  assert.equal(it.command, 'runCpp.sanitize');
  await new Promise((r) => setTimeout(r, 1100));
  assert.equal(it.shown, false, 'hidden after the time');
  a.dispose();
  assert.equal(it.disposed, true);
  assert.deepEqual(shown, []);
});
