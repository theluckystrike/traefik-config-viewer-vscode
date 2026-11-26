'use strict';
// PROINFO (2026-11-13.proinfo, lane PROMOD): the Zovo Pro info panel and the per-listing card tag.
// No network, no browser. Run: node --test test/proinfo.test.js
// In an extension repo apply.sh copies this file to test/license-proinfo.test.js and the module to src/license/.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

// factory folder, or an extension repo (src/license, or src/zovo for XLSX: apply.sh with ZOVO_LICENSE_DIR=src/zovo)
const dir = ['..', '../src/license', '../src/zovo'].find((d) => fs.existsSync(path.join(__dirname, d, 'proinfo.js'))) || '../src/license';
const P = require(`${dir}/proinfo.js`);
const IDX = require(`${dir}/index.js`);

const CARD = 'https://license.zovo.one/buy/zovo-pro';
const ID = '0b5c3c2e-1111-4a2b-9c3d-1234567890ab';
const INFO = {
  triesKey: 'hexViewer.proTrial',
  tools: [
    { id: 'checksums', title: 'Checksums of File', line: 'CRC-32, MD5 and SHA hashes of the file or the selection.' },
    { id: 'strings', title: 'Extract Strings', line: 'Lists the text strings of a file with their offsets.' },
  ],
};
const refOfUrl = (u) => new URL(u).searchParams.get('client_reference_id');
const tick = () => new Promise((r) => setImmediate(r));

// A fake VS Code API with webview panels. log.panels: every created panel; panel.send(msg) plays a button click.
function fakeVscode({ pick, webview = true } = {}) {
  const log = { info: [], warn: [], opened: [], commands: {}, picks: [], pickCalls: [], panels: [] };
  const vscode = {
    Uri: { parse: (s) => ({ toString: () => s, s }) },
    ViewColumn: { Active: -1, One: 1 },
    env: { openExternal: async (u) => { log.opened.push(u.s); return true; } },
    window: {
      showInformationMessage: async (msg, ...rest) => { log.info.push(msg); return log.modalAnswer && rest[0] && rest[0].modal ? log.modalAnswer : undefined; },
      showWarningMessage: async (msg) => { log.warn.push(msg); },
      showErrorMessage: async (msg) => { log.warn.push(msg); },
      showInputBox: async () => undefined,
      showQuickPick: async (items, o) => {
        log.picks.push(items.map((i) => i.label));
        log.pickCalls.push({ items, o });
        const want = typeof pick === 'function' ? pick(items) : pick;
        return want ? items.find((i) => i.label === want) : undefined;
      },
      state: { focused: true },
      onDidChangeWindowState: (fn) => { log.win = fn; return { dispose() {} }; },
    },
    commands: { registerCommand: (id, fn) => { log.commands[id] = fn; return { dispose() {} }; } },
  };
  if (webview) {
    vscode.window.createWebviewPanel = (viewType, title, column, options) => {
      let onMsg = null; let onDispose = null;
      const panel = {
        viewType, title, column, options, reveals: 0,
        webview: { html: '', cspSource: 'vscode-webview://x', onDidReceiveMessage: (fn) => { onMsg = fn; return { dispose() { onMsg = null; } }; } },
        reveal() { panel.reveals += 1; },
        onDidDispose: (fn) => { onDispose = fn; return { dispose() {} }; },
        send: (m) => (onMsg ? onMsg(m) : undefined),
        dispose() { if (onDispose) onDispose(); },
      };
      log.panels.push(panel);
      return panel;
    };
  }
  const global = new Map();
  const context = {
    subscriptions: [],
    secrets: { get: async () => undefined, store: async () => {}, delete: async () => {}, onDidChange: () => ({ dispose() {} }) },
    globalState: { get: (k) => global.get(k), update: async (k, v) => { global.set(k, v); } },
  };
  return { vscode, context, log, global };
}

const sponsorsStub = () => ({ id: 'github-sponsors', ready: Promise.resolve(), isPro: () => false, unlock: async () => ({ pro: false, reason: 'cancelled', message: '' }), refresh: async () => false, remove: async () => {}, state: () => null, onDidChange: () => ({ dispose() {} }) });
const mk = (f, extra = {}) => IDX.createLicense({
  vscode: f.vscode, context: f.context, sku: 'hex-pro', name: 'Zovo', product: 'Hex Viewer', commandPrefix: 'hexViewer',
  cardBuyUrl: CARD, listing: 'hex', proInfo: INFO, rails: [sponsorsStub()], sharedFile: '', ...extra,
});

// ---- pure helpers ----
test('PROINFO version and surfaces', () => {
  assert.equal(IDX.MODULE_VERSION, '2026-11-21.reach2'); // SPON1
  assert.equal(P.PROINFO_VERSION, '2026-11-13.proinfo');
  for (const s of ['toolbar', 'ctx', 'panel', 'title', 'status', 'pick', 'footer', 'palette']) assert.ok(IDX.SURFACES.includes(s), s);
  assert.equal(IDX.surfaceOf('pick'), 'pick');
  assert.equal(IDX.surfaceOf({ surface: 'status' }), 'status');
});

test('refOf: <install id>_<surface>_<listing>, bad listing falls back to the CARD2 tag', () => {
  assert.equal(P.refOf(ID, 'toolbar', 'hex'), `${ID}_toolbar_hex`);
  assert.equal(P.refOf(ID, 'panel', 'XLSX'), `${ID}_panel_xlsx`, 'lower case');
  assert.equal(P.refOf(ID, 'ctx', ''), `${ID}_ctx`);
  assert.equal(P.refOf(ID, 'ctx', undefined), `${ID}_ctx`);
  for (const bad of ['hex_viewer', 'a-b', '../x', 'x'.repeat(17), 42, { a: 1 }]) assert.equal(P.refOf(ID, 'menu', bad), `${ID}_menu`, String(bad));
  assert.equal(P.listingOf(' Hex '), 'hex');
  assert.equal(P.listingOf('pdf2'), 'pdf2');
  assert.match(P.refOf(ID, 'toolbar', 'hex'), /^[A-Za-z0-9_-]{1,199}$/);
});

test('toolsWithTries reads the listing tries store; triesText words', () => {
  const gs = { get: (k) => (k === 'hexViewer.proTrial' ? { checksums: 1, strings: 3 } : undefined) };
  // TRIES1: 1 free try per Pro tool; an old count of 2 or 3 reads as 0 left
  assert.equal(P.TRIES_MAX, 1);
  const t = P.toolsWithTries(INFO, gs);
  assert.deepEqual(t.map((x) => [x.id, x.left]), [['checksums', 0], ['strings', 0]]);
  assert.equal(P.toolsWithTries(INFO, { get: () => undefined })[0].left, 1);
  // pro_info.triesMax (a listing that still counts 3)
  assert.deepEqual(P.toolsWithTries({ ...INFO, triesMax: 3 }, gs).map((x) => x.left), [2, 0]);
  assert.equal(P.triesMaxOf({ triesMax: 'x' }), 1);
  assert.equal(P.triesMaxOf({ triesMax: 0 }), 1);
  assert.equal(P.triesMaxOf(null), 1);
  // older product: titles only, no tries shown
  const old = P.toolsWithTries(null, gs, ['Merge PDFs', 'Split PDF']);
  assert.deepEqual(old.map((x) => [x.title, x.left]), [['Merge PDFs', null], ['Split PDF', null]]);
  assert.equal(P.triesText(3), '3 free tries left');
  assert.equal(P.triesText(1), '1 free try left');
  assert.equal(P.triesText(0), 'no free tries left');
  assert.equal(P.triesText(null), '');
  // junk in the store or the info never throws
  assert.equal(P.toolsWithTries({ triesKey: 'k', tools: [{ id: 'a', title: 'A' }, null, { title: '' }] }, { get: () => 'x' }).length, 1);
});

test('renderHtml: the facts the buyer needs, two buttons, strict CSP, no remote content, escaped text', () => {
  const html = P.renderHtml({ product: 'Hex Viewer', tools: P.toolsWithTries(INFO, { get: () => ({ checksums: 1 }) }), nonce: 'abc123', trust: 'VS Code will ask to open license.zovo.one, our Stripe checkout. Choose Open.' });
  for (const want of [
    'One key turns on Pro in every Zovo extension, for life. USD 19 once.',
    'Team: 5 seats USD 59.',
    'Pro tools in Hex Viewer',
    'Checksums of File', 'CRC-32, MD5 and SHA hashes', 'no free tries left', 'Extract Strings', '1 free try left',
    'Your key shows on the next page. Click Open in VS Code and Pro turns on.', 'Or click Copy key',
    'Zovo Pro: Enter a key',
    'Made by Zovo. The seller name on the card page is BeLikeNative.',
    '>Pay by card</button>', '>Other ways (GitHub Sponsors, PayPal)</button>',
    'Choose Open.',
  ]) assert.ok(html.includes(want), want);
  assert.equal((html.match(/<button /g) || []).length, 2);
  // the CSP sits in an attribute, so its quotes are HTML-escaped (the browser reads them back as ')
  assert.ok(html.includes("content=\"default-src &#39;none&#39;; style-src &#39;nonce-abc123&#39;; script-src &#39;nonce-abc123&#39;\""));
  assert.ok(!/https?:\/\//.test(html), 'no links or remote loads in the page');
  assert.ok(!/<a /.test(html));
  const evil = P.renderHtml({ tools: [{ title: '<img src=x onerror=alert(1)>', line: '"quoted" & more', left: 3 }], nonce: 'n' });
  assert.ok(!evil.includes('<img'));
  assert.ok(evil.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(evil.includes('&quot;quoted&quot; &amp; more'));
  // without the card rail: one button, no card
  const nocard = P.renderHtml({ tools: [], cardOn: false, nonce: 'n' });
  assert.equal((nocard.match(/<button /g) || []).length, 1);
  assert.ok(!nocard.includes('>Pay by card<'));
});

// ---- the facade ----
test('Get Zovo Pro (palette) opens the info panel first: nothing at activation, no browser, no popup or toast', async () => {
  const f = fakeVscode();
  const pro = mk(f);
  await pro.ready;
  f.log.win && f.log.win({ focused: false }); f.log.win && f.log.win({ focused: true }); await tick();
  assert.equal(f.log.panels.length, 0, 'no panel at activation');
  assert.equal(await f.log.commands['hexViewer.getPro'](), false);
  assert.equal(f.log.panels.length, 1);
  const p = f.log.panels[0];
  assert.equal(p.viewType, 'zovoProInfo');
  assert.equal(p.title, 'Zovo Pro');
  assert.equal(p.options.enableScripts, true);
  assert.equal(p.options.enableCommandUris, false);
  assert.deepEqual(p.options.localResourceRoots, []);
  assert.ok(p.webview.html.includes('Checksums of File'));
  assert.ok(p.webview.html.includes('1 free try left'));
  assert.deepEqual(f.log.opened, [], 'the browser waits for Pay by card');
  assert.equal(f.log.info.length + f.log.warn.length + f.log.picks.length, 0, 'no toast, no popup, no pick');
  assert.equal(f.global.size, 0, 'no install id until a card click');
});

test('Pay by card in the panel opens the Worker link tagged <install id>_<surface>_<listing>_<host>', async () => {
  const f = fakeVscode();
  const pro = mk(f);
  await pro.ready;
  await pro.getPro({ surface: 'title' });
  await f.log.panels[0].send({ type: 'card' });
  assert.equal(f.log.opened.length, 1);
  assert.match(f.log.opened[0], /^https:\/\/license\.zovo\.one\/buy\/zovo-pro\?client_reference_id=[0-9a-f-]{36}_title_hex_vscode$/);
  // a second click elsewhere reveals the same panel, with that click's surface
  await f.log.commands['hexViewer.getPro']([{ scheme: 'file', path: '/w/a.bin' }]);
  assert.equal(f.log.panels.length, 1);
  assert.equal(f.log.panels[0].reveals, 1);
  await f.log.panels[0].send({ type: 'card' });
  assert.ok(refOfUrl(f.log.opened[1]).endsWith('_menu_hex_vscode'));
  assert.equal(refOfUrl(f.log.opened[0]).slice(0, 36), refOfUrl(f.log.opened[1]).slice(0, 36), 'one install id');
  // every surface that still opens the info tab (CONV2: toolbar and status go straight to the Worker page)
  for (const s of ['ctx', 'pick', 'palette', 'title', 'pill', 'support']) { // CONV3: footer goes straight to the Worker page
    await pro.getPro(s === 'palette' ? undefined : { surface: s });
    await f.log.panels[0].send({ type: 'card' });
    assert.ok(refOfUrl(f.log.opened.at(-1)).endsWith(`_${s}_hex_vscode`), s);
  }
  // unknown messages do nothing
  const n = f.log.opened.length;
  await f.log.panels[0].send({ type: 'evil', url: 'https://example.com' });
  await f.log.panels[0].send('card');
  await f.log.panels[0].send(null);
  assert.equal(f.log.opened.length, n);
  // closed panel: the next click makes a new one
  f.log.panels[0].dispose();
  await pro.getPro('pill');
  assert.equal(f.log.panels.length, 2);
});

test('Other ways: GitHub Sponsors, PayPal, team by card, Enter a key; no single-seat card row', async () => {
  const f = fakeVscode({ pick: undefined });
  const pro = mk(f);
  await pro.ready;
  await pro.getPro({ surface: 'pill' });
  await f.log.panels[0].send({ type: 'other' });
  assert.deepEqual(f.log.picks[0], ['GitHub Sponsors', 'PayPal', 'Team of 5 by card, USD 59', 'Enter a key']);
  assert.deepEqual(f.log.opened, [], 'Escape opens nothing');
  const t = fakeVscode({ pick: 'Team of 5 by card, USD 59' });
  const tp = mk(t);
  await tp.getPro({ surface: 'ctx' });
  await t.log.panels[0].send({ type: 'other' });
  assert.match(t.log.opened[0], /^https:\/\/license\.zovo\.one\/buy\/zovo-pro-team\?client_reference_id=[0-9a-f-]{36}_ctx_hex_vscode$/);
  const s = fakeVscode({ pick: 'GitHub Sponsors' });
  const sp = mk(s);
  await sp.getPro('pill');
  await s.log.panels[0].send({ type: 'other' });
  assert.deepEqual(s.log.opened, ['https://github.com/sponsors/theluckystrike/sponsorships?tier_id=679878']);
  // a direct Stripe Payment Link as card_buy_url: no team row (no known team link)
  const d = fakeVscode();
  const dp = mk(d, { cardBuyUrl: 'https://buy.stripe.com/test_eVq3cw2oagsgeklaYZ43S0Q' });
  await dp.getPro('pill');
  await d.log.panels[0].send({ type: 'other' });
  assert.deepEqual(d.log.picks[0], ['GitHub Sponsors', 'PayPal', 'Enter a key']);
});

test('OFFER: the Pro panel card button goes straight to the Worker link with its surface (no info tab)', async () => {
  const f = fakeVscode();
  f.log.modalAnswer = 'See details';
  const pro = mk(f);
  await pro.ready;
  assert.equal(await pro.requirePro('Checksums of File', { detail: 'x', triesUsed: 3, surface: 'ctx' }), false);
  assert.equal(f.log.panels.length, 0, 'no info tab from the Pro panel');
  assert.equal(f.log.opened.length, 1);
  assert.ok(refOfUrl(f.log.opened[0]).endsWith('_ctx_hex_vscode'));
  await pro.requirePro('Checksums of File', { triesUsed: 3 });
  assert.ok(refOfUrl(f.log.opened[1]).endsWith('_panel_hex_vscode'));
  assert.equal(f.log.panels.length, 0);
});

test('payByCard command stays direct (no panel) and tagged with the listing; enterKey command exists', async () => {
  const f = fakeVscode();
  await mk(f).ready;
  await f.log.commands['hexViewer.payByCard']({ surface: 'pill' });
  assert.equal(f.log.panels.length, 0);
  assert.ok(refOfUrl(f.log.opened[0]).endsWith('_pill_hex_vscode'));
  assert.ok('hexViewer.enterKey' in f.log.commands);
  f.vscode.env.clipboard = { readText: async () => 'not a key' };
  const r = await f.log.commands['hexViewer.enterKey']();
  assert.deepEqual(Object.keys(r).sort(), ['pro', 'reason']);
  assert.equal(r.pro, false);
});

test('fallbacks: no listing = CARD2 tag; no webview API or proInfo false = CARD2 pick; no card rail = no panel', async () => {
  const a = fakeVscode();
  const ap = mk(a, { listing: '' });
  await ap.getPro('pill');
  await a.log.panels[0].send({ type: 'card' });
  assert.match(refOfUrl(a.log.opened[0]), /^[0-9a-f-]{36}_pill$/);
  const b = fakeVscode({ webview: false, pick: 'Pay by card, USD 19, no account' });
  await mk(b).getPro('pill');
  assert.deepEqual(b.log.picks[0], IDX.PICK_LABELS);
  assert.ok(refOfUrl(b.log.opened[0]).endsWith('_pill_hex_vscode'));
  const c = fakeVscode({ pick: undefined });
  await mk(c, { proInfo: false }).getPro('pill');
  assert.equal(c.log.panels.length, 0);
  assert.deepEqual(c.log.picks[0], IDX.PICK_LABELS);
  const d = fakeVscode();
  const dp = mk(d, { cardBuyUrl: '' });
  await dp.getPro('pill');
  assert.equal(d.log.panels.length, 0);
  assert.deepEqual(d.log.opened, ['https://github.com/sponsors/theluckystrike/sponsorships?tier_id=679878']);
  assert.ok(!('hexViewer.enterKey' in d.log.commands));
  // without proInfo the panel lists the proTools titles (no tries line)
  const e = fakeVscode();
  const ep = mk(e, { proInfo: null, proTools: ['Merge PDFs'] });
  await ep.getPro('pill');
  assert.ok(e.log.panels[0].webview.html.includes('Merge PDFs'));
  assert.ok(!e.log.panels[0].webview.html.includes('free tries left'));
});

test('the panel shows the tries left at each open', async () => {
  const f = fakeVscode();
  const pro = mk(f);
  await pro.getPro('ctx');
  assert.ok(f.log.panels[0].webview.html.includes('1 free try left'));
  assert.ok(!f.log.panels[0].webview.html.includes('3 free tries left'));
  await f.context.globalState.update('hexViewer.proTrial', { checksums: 1 });
  await pro.getPro('ctx');
  const h = f.log.panels[0].webview.html;
  assert.ok(h.includes('no free tries left'));
  assert.ok(h.includes('1 free try left'));
});

test('panel language follows vscode.env.language; tool names, lines and the command stay English', async () => {
  assert.equal(P.localeOf('de-DE'), 'de');
  assert.equal(P.localeOf('pt-br'), 'pt');
  assert.equal(P.localeOf('zh-cn'), 'zh');
  assert.equal(P.localeOf('zh-tw'), 'en');
  assert.equal(P.localeOf('ko'), 'en');
  assert.equal(P.localeOf(undefined), 'en');
  for (const lang of Object.keys(P.STRINGS)) {
    const T = P.STRINGS[lang];
    for (const k of ['price', 'team', 'toolsHead', 'toolsNone', 'keyHead', 'step1', 'step2', 'step3', 'keyNoCard', 'whoHead', 'seller', 'card', 'other', 'tries']) assert.ok(T[k], `${lang}.${k}`);
    const html = P.renderHtml({ product: 'Hex Viewer', tools: [{ title: 'Checksums of File', line: 'Computes hashes.', left: 2 }], nonce: 'n', lang });
    for (const want of ['USD 19', 'USD 59', 'BeLikeNative', 'Zovo Pro: Enter a key', 'Hex Viewer', 'Checksums of File', 'Computes hashes.', 'Copy key', 'Stripe', 'GitHub Sponsors, PayPal']) assert.ok(html.includes(want), `${lang}: ${want}`);
    assert.ok(!html.includes('{p}') && !html.includes('{c}'), lang);
    assert.equal((html.match(/<button /g) || []).length, 2, lang);
    for (const n of [0, 1, 2, 3]) assert.ok(T.tries(n).length > 3, `${lang} tries ${n}`);
  }
  assert.equal(P.triesText(1, 'ru'), 'осталась 1 бесплатная попытка');
  assert.equal(P.triesText(3, 'pl'), 'zostały 3 darmowe próby');
  assert.equal(P.triesText(2, 'de'), 'noch 2 Gratis-Versuche');
  const f = fakeVscode();
  f.vscode.env.language = 'fr';
  await mk(f).getPro('pill');
  const h = f.log.panels[0].webview.html;
  assert.ok(h.includes('<html lang="fr">'));
  assert.ok(h.includes('Payer par carte'));
  assert.ok(h.includes('USD 19 une seule fois, tous les visualiseurs Zovo, à vie.'));
  assert.ok(h.includes('Checksums of File'));
  await f.log.panels[0].send({ type: 'card' });
  assert.ok(refOfUrl(f.log.opened[0]).endsWith('_pill_hex_vscode'));
});

// ---- CONV2 (15 Nov) and CONV3 (16 Nov) sent the row, the status bar pick and the footer to the Worker /buy page.
// ---- CONV8 (20 Nov): they open the in-editor Pro panel; the browser opens only after a panel button ----
const BADGE_TITLE = /^The Pro tools (of [^.]+ )?are part of Zovo Pro\.$/;
test('CONV8: Get Zovo Pro from the toolbar row and the status bar opens the in-editor Pro panel; no browser before a button', async () => {
  const f = fakeVscode();
  f.vscode.env.language = 'de';
  const pro = mk(f);
  await pro.ready;
  assert.equal(await f.log.commands['hexViewer.getPro']([{ surface: 'toolbar' }]), false);
  assert.equal(await f.log.commands['hexViewer.getPro']({ surface: 'status' }), false);
  assert.equal(await pro.getPro('toolbar'), false);
  assert.equal(f.log.panels.length, 0, 'no info tab from the row or the status bar');
  assert.equal(f.log.picks.length + f.log.warn.length, 0, 'no pick');
  assert.equal(f.log.info.length, 3);
  for (const m of f.log.info) assert.match(m, BADGE_TITLE);
  assert.deepEqual(f.log.opened, [], 'Escape on the panel opens nothing');
  f.log.modalAnswer = 'Pay USD 19 by card';
  await pro.getPro([{ surface: 'toolbar' }]);
  await pro.getPro({ surface: 'status' });
  assert.equal(f.log.opened.length, 2);
  assert.match(f.log.opened[0], /^https:\/\/license\.zovo\.one\/pay\/zovo-pro\?client_reference_id=[0-9a-f-]{36}_toolbar_hex_vscode$/); // /pay/ links carry no lang (as the panel card button)
  assert.match(f.log.opened[1], /^https:\/\/license\.zovo\.one\/pay\/zovo-pro\?client_reference_id=[0-9a-f-]{36}_status_hex_vscode$/);
  assert.equal(refOfUrl(f.log.opened[0]).slice(0, 36), refOfUrl(f.log.opened[1]).slice(0, 36), 'one install id');
  assert.ok(f.log.opened.every((u) => !/stripe\.com|\/buy\//.test(u)), 'never a Stripe link or the /buy page from a badge card click');
  // the palette (no argument) and the other surfaces keep the info tab
  f.log.modalAnswer = undefined;
  await f.log.commands['hexViewer.getPro']();
  assert.equal(f.log.panels.length, 1);
  assert.equal(f.log.opened.length, 2, 'the palette opens no browser');
  assert.deepEqual(IDX.DIRECT_SURFACES, ['toolbar', 'status', 'footer']);
  assert.deepEqual(IDX.BADGE_SURFACES, ['toolbar', 'status', 'footer', 'panel']);
});

test('CONV2: with a direct Stripe link as card_buy_url the row still opens the info tab (no live Stripe from a click)', async () => {
  const f = fakeVscode();
  const pro = mk(f, { cardBuyUrl: 'https://buy.stripe.com/test_eVq3cw2oagsgeklaYZ43S0Q' });
  await pro.ready;
  await pro.getPro({ surface: 'toolbar' });
  await pro.getPro({ surface: 'status' });
  assert.equal(f.log.panels.length, 1);
  assert.deepEqual(f.log.opened, []);
});

test('CONV8: the test Worker host also gets the panel; its card button opens the test host /pay/', async () => {
  const f = fakeVscode();
  const pro = mk(f, { cardBuyUrl: 'https://license-test.zovo.one/buy/zovo-pro' });
  await pro.ready;
  f.log.modalAnswer = 'Pay USD 19 by card';
  await pro.getPro({ surface: 'toolbar' });
  assert.match(f.log.opened[0], /^https:\/\/license-test\.zovo\.one\/pay\/zovo-pro\?client_reference_id=[0-9a-f-]{36}_toolbar_hex/);
  assert.equal(f.log.panels.length, 0);
});

test('CONV8: the footer link opens the Pro panel, its links tagged _footer_<listing>; palette and title keep the info tab', async () => {
  const f = fakeVscode();
  f.vscode.env.language = 'en';
  const pro = mk(f);
  await pro.ready;
  f.log.modalAnswer = 'See details';
  assert.equal(await f.log.commands['hexViewer.getPro'](['footer']), false); // the footer link passes ["footer"]
  f.log.modalAnswer = 'Pay USD 19 by card';
  assert.equal(await pro.getPro('footer'), false);
  assert.equal(f.log.panels.length, 0, 'no info tab from the footer');
  assert.equal(f.log.opened.length, 2);
  assert.match(f.log.opened[0], /^https:\/\/license\.zovo\.one\/buy\/zovo-pro\?client_reference_id=[0-9a-f-]{36}_footer_hex_vscode&lang=en$/);
  assert.match(f.log.opened[1], /^https:\/\/license\.zovo\.one\/pay\/zovo-pro\?client_reference_id=[0-9a-f-]{36}_footer_hex_vscode$/);
  f.log.modalAnswer = undefined;
  await pro.getPro({ surface: 'title' });
  await f.log.commands['hexViewer.getPro']();
  assert.equal(f.log.panels.length, 1, 'title bar and palette: the info tab');
  assert.equal(f.log.opened.length, 2);
  // a direct Stripe link as card_buy_url: the footer still opens the info tab (a click never reaches a live Stripe page)
  const s = fakeVscode();
  await mk(s, { cardBuyUrl: 'https://buy.stripe.com/test_eVq3cw2oagsgeklaYZ43S0Q' }).getPro('footer');
  assert.equal(s.log.panels.length, 1);
  assert.deepEqual(s.log.opened, []);
});

test('CONV8: { surface: pick, direct: true } (the REACH1 result line) opens the Pro panel, tagged _pick_; plain pick keeps the tab', async () => {
  const f = fakeVscode();
  const pro = mk(f);
  await pro.ready;
  assert.equal(IDX.directOf({ surface: 'pick', direct: true }), true);
  assert.equal(IDX.directOf([{ surface: 'pick', direct: true }]), true);
  assert.equal(IDX.directOf({ surface: 'pick' }), false);
  assert.equal(IDX.directOf({ surface: 'pick', direct: 'yes' }), false);
  assert.equal(IDX.directOf({ scheme: 'file', path: '/a', direct: true }), false);
  f.log.modalAnswer = 'Pay USD 19 by card';
  await f.log.commands['hexViewer.getPro']({ surface: 'pick', direct: true });
  assert.equal(f.log.panels.length, 0);
  assert.equal(f.log.opened.length, 1);
  assert.ok(refOfUrl(f.log.opened[0]).endsWith('_pick_hex_vscode'));
  f.log.modalAnswer = undefined;
  await f.log.commands['hexViewer.getPro']({ surface: 'pick' });
  assert.equal(f.log.panels.length, 1, 'a tool pick row without direct still opens the info tab');
  assert.equal(f.log.opened.length, 1);
  const s = fakeVscode();
  await mk(s, { cardBuyUrl: 'https://buy.stripe.com/test_eVq3cw2oagsgeklaYZ43S0Q' }).getPro({ surface: 'pick', direct: true });
  assert.deepEqual(s.log.opened, [], 'never straight to a Stripe link');
});

test('CONV3/CONV6: the Pro panel has "Pay USD 19 by card" first and "See details" second; See details opens the same tagged page', async () => {
  const f = fakeVscode();
  f.log.modalAnswer = 'See details';
  const pro = mk(f);
  await pro.ready;
  assert.equal(IDX.SEE_PRO_LABEL, 'See details');
  assert.equal(pro.buttons()[0], 'Pay USD 19 by card'); // CONV8: card first
  assert.equal(pro.buttons()[1], 'Pay with GitHub Sponsors (USD 19 once)');
  assert.equal(pro.buttons()[2], 'See details');
  assert.ok(!pro.buttons().includes('Pay by card (USD 19)'));
  assert.equal(await pro.requirePro('Checksums of File', { detail: 'x', surface: 'toolbar' }), false);
  assert.equal(f.log.panels.length, 0);
  assert.match(f.log.opened[0], /^https:\/\/license\.zovo\.one\/buy\/zovo-pro\?client_reference_id=[0-9a-f-]{36}_toolbar_hex_vscode$/);
  // the old label is still understood (a product that names it)
  const o = fakeVscode();
  o.log.modalAnswer = 'Pay by card (USD 19)';
  await mk(o).requirePro('Checksums of File', { detail: 'x' });
  assert.ok(refOfUrl(o.log.opened[0]).endsWith('_panel_hex_vscode'));
  // a direct Stripe link keeps "Pay by card (USD 19)": that click goes to Stripe
  const s = mk(fakeVscode(), { cardBuyUrl: 'https://buy.stripe.com/test_eVq3cw2oagsgeklaYZ43S0Q' });
  assert.equal(s.buttons()[0], 'Pay by card (USD 19)');
  // no new amount anywhere
  assert.doesNotMatch(IDX.SEE_PRO_LABEL, /USD (?!19\b)\d+/);
});

test('CONV3: a short panel ({ value }, tools: []) has the value line and no "free try used" lines', async () => {
  const f = fakeVscode();
  const pro = mk(f);
  await pro.ready;
  const d = pro.panelDetail('Checksums of File', { detail: 'Hashes.', value: 'You tried Checksums of File once for free on a.bin. Zovo Pro keeps it on for every file, with the other 1 Pro tool of Hex Viewer.', triesUsed: 1, toolId: 'checksums', tools: [] });
  assert.match(d, /on a\.bin\. Zovo Pro keeps it on for every file, with the other 1 Pro tool of Hex Viewer\.\nHashes\.\n\n/);
  assert.doesNotMatch(d, /You used the free try/, 'the value line takes the place of the tries line');
  // no value: the old tries line, as before
  assert.match(pro.panelDetail('Checksums of File', { detail: 'Hashes.', triesUsed: 1, tools: [] }), /You used the free try of Checksums of File on this computer\.\nHashes\./);
  assert.doesNotMatch(d, /free tr(y|ies) used/);
  assert.doesNotMatch(d, /Other Pro tools/);
  assert.match(d, /^One key turns on Pro in every Zovo extension, for life\. USD 19 once\.\n\nYou tried Checksums of File once for free on a\.bin\./);
  assert.match(d, /Free features stay free\. USD 19 once funds the Pro tools\./);
});

// ---- Open VSX host telemetry, 4-segment refOf, IDE appName branding, in-editor Not Now ----
test('hostOf: normalizes known IDE schemes and appNames (Cursor, Windsurf, VSCodium, Trae, Antigravity, VS Code, Kiro, Positron) and sanitizes unknowns', () => {
  assert.equal(P.hostOf({ uriScheme: 'vscode', appName: 'Visual Studio Code' }), 'vscode');
  assert.equal(P.hostOf({ uriScheme: 'vscode-insiders', appName: 'Visual Studio Code - Insiders' }), 'vscode-insiders');
  assert.equal(P.hostOf({ uriScheme: 'vscode-exploration', appName: 'Visual Studio Code - Exploration' }), 'vscode-exploration');
  assert.equal(P.hostOf({ uriScheme: 'cursor', appName: 'Cursor' }), 'cursor');
  assert.equal(P.hostOf({ uriScheme: 'windsurf', appName: 'Windsurf' }), 'windsurf');
  assert.equal(P.hostOf({ uriScheme: 'vscodium', appName: 'VSCodium' }), 'vscodium');
  assert.equal(P.hostOf({ uriScheme: 'codium', appName: 'VSCodium' }), 'vscodium');
  assert.equal(P.hostOf({ uriScheme: 'trae', appName: 'Trae' }), 'trae');
  assert.equal(P.hostOf({ uriScheme: 'antigravity', appName: 'Antigravity' }), 'antigravity');
  assert.equal(P.hostOf({ uriScheme: 'kiro', appName: 'Kiro' }), 'kiro');
  assert.equal(P.hostOf({ uriScheme: 'positron', appName: 'Positron' }), 'positron');
  // appName fallback when uriScheme is missing or generic 'vscode'
  assert.equal(P.hostOf({ appName: 'Cursor' }), 'cursor');
  assert.equal(P.hostOf({ uriScheme: 'vscode', appName: 'Windsurf' }), 'windsurf');
  assert.equal(P.hostOf({ appName: 'VSCodium' }), 'vscodium');
  assert.equal(P.hostOf({ appName: 'Trae' }), 'trae');
  assert.equal(P.hostOf({ appName: 'Antigravity' }), 'antigravity');
  assert.equal(P.hostOf({ appName: 'Visual Studio Code - Insiders' }), 'vscode-insiders');
  // custom sanitized host matching [a-z][a-z0-9-]{1,23}
  assert.equal(P.hostOf({ uriScheme: 'my-custom-ide' }), 'my-custom-ide');
  assert.equal(P.hostOf({ uriScheme: 'My_Custom!IDE' }), 'my-custom-ide');
  // invalid / missing env falls back to 'vscode'
  for (const bad of [undefined, null, {}, { uriScheme: '' }, { uriScheme: 'a' }, { uriScheme: '123bad' }, { uriScheme: '!!!' }]) {
    assert.equal(P.hostOf(bad), 'vscode', JSON.stringify(bad));
  }
});

test('refOf: 4-segment <id>_<surface>_<listing>_<host> when host is provided, strictly matching /^[A-Za-z0-9_-]{1,199}$/', () => {
  assert.equal(P.refOf(ID, 'toolbar', 'hex', 'cursor'), `${ID}_toolbar_hex_cursor`);
  assert.equal(P.refOf(ID, 'panel', 'pdf', 'windsurf'), `${ID}_panel_pdf_windsurf`);
  assert.equal(P.refOf(ID, 'footer', 'xlsx', 'vscodium'), `${ID}_footer_xlsx_vscodium`);
  assert.equal(P.refOf(ID, 'status', 'hex', 'trae'), `${ID}_status_hex_trae`);
  assert.equal(P.refOf(ID, 'palette', 'hex', 'antigravity'), `${ID}_palette_hex_antigravity`);
  assert.equal(P.refOf(ID, 'panel', 'hex', 'vscode-insiders'), `${ID}_panel_hex_vscode-insiders`);
  assert.match(P.refOf(ID, 'toolbar', 'hex', 'antigravity'), /^[A-Za-z0-9_-]{1,199}$/);
  // invalid host falls back to 3-segment; missing listing falls back to 2-segment
  assert.equal(P.refOf(ID, 'panel', 'hex', 'bad_host'), `${ID}_panel_hex`);
  assert.equal(P.refOf(ID, 'panel', 'hex', '123'), `${ID}_panel_hex`);
  assert.equal(P.refOf(ID, 'panel', '', 'cursor'), `${ID}_panel`);
  // overlong id falls back safely within 199 chars
  assert.ok(P.refOf('a'.repeat(185), 'panel', 'hex', 'antigravity').length <= 199);
});

test('cardTag, trustHint, and panel/modal messages use IDE host & appName for Cursor, Windsurf, VSCodium, Trae, Antigravity', async () => {
  const ides = [
    ['cursor', 'Cursor'],
    ['windsurf', 'Windsurf'],
    ['vscodium', 'VSCodium'],
    ['trae', 'Trae'],
    ['antigravity', 'Antigravity'],
  ];
  for (const [scheme, appName] of ides) {
    const f = fakeVscode();
    f.vscode.env.uriScheme = scheme;
    f.vscode.env.appName = appName;
    f.log.modalAnswer = 'Pay USD 19 by card';
    const pro = mk(f);
    await pro.ready;
    assert.equal(pro.trustHint(), `${appName} will ask to open license.zovo.one, our Stripe checkout. Choose Open.`);
    assert.equal(IDX.trustHint('https://buy.stripe.com/test_abc', appName), `${appName} will ask to open stripe.com. Choose Open.`);
    const detail = pro.panelDetail('Checksums of File', { triesUsed: 1 });
    assert.ok(detail.includes(`${appName} will ask to open license.zovo.one`), `${appName} in panelDetail`);
    assert.ok(!detail.includes('VS Code'), `no hardcoded VS Code in panelDetail for ${appName}`);
    await pro.getPro({ surface: 'toolbar' });
    assert.ok(refOfUrl(f.log.opened[0]).endsWith(`_toolbar_hex_${scheme}`), `${scheme} in cardTag`);
    // Not now dismisses cleanly in-editor without opening external browser
    const nn = fakeVscode();
    nn.vscode.env.uriScheme = scheme;
    nn.vscode.env.appName = appName;
    nn.log.modalAnswer = IDX.NOT_NOW_LABEL;
    const nnp = mk(nn);
    await nnp.ready;
    assert.equal(await nnp.requirePro('Checksums of File', { triesUsed: 1 }), false);
    assert.equal(await nnp.getPro({ surface: 'toolbar' }), false);
    assert.deepEqual(nn.log.opened, [], `Not now opens no browser in ${appName}`);
  }
});
