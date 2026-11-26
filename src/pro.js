'use strict';
// Zovo Pro for Traefik Route & TLS Viewer, on top of the shared license module (src/license).
const { createLicense } = require('./license');
const { currentSurface } = require('./reach');

const SKU = 'traefik-config-viewer-pro';
const TRIES = 1;
const TRIAL_KEY = 'zovoTraefik.proTrial';

const FEATURES = {
  auditSecurity: {
    title: 'Audit Traefik TLS, dashboard and routing',
    detail: 'Generates a Markdown Traefik TLS, dashboard and routing security audit for one config file or a folder.',
  },
  diffConfigs: {
    title: 'Compare two Traefik config files',
    detail: 'Diffs two Traefik config files in Markdown showing entryPoint, router, service and security finding deltas.',
  },
  exportRouteMap: {
    title: 'Export Mermaid route map and inventory',
    detail: 'Writes a Mermaid routing diagram plus Markdown and CSV router/service inventory locally. Never overwrites an existing file.',
  },
};
const TOOLS = Object.values(FEATURES).map((f) => f.title);

function surfaceOf(arg) {
  const s = currentSurface();
  if (s) return s;
  if (arg && typeof arg === 'object' && typeof arg.surface === 'string') return arg.surface;
  return undefined;
}

function createPro({ vscode, context, license, prefix = 'zovoTraefik', productName = 'Traefik Route & TLS Viewer' }) {
  const emitter = new vscode.EventEmitter();
  const lic = license || createLicense({ vscode, context, sku: SKU, name: 'Zovo', product: productName, commandPrefix: prefix, proTools: TOOLS });
  if (lic.onDidChange) lic.onDidChange(() => emitter.fire(lic.isPro(SKU)));

  const seen = {};
  const used = (f) => Math.max(Number((context.globalState.get(TRIAL_KEY) || {})[f]) || 0, seen[f] || 0);
  const left = (f) => (FEATURES[f] ? Math.max(0, TRIES - used(f)) : 0);
  const licensed = () => lic.isPro(SKU);

  async function allowed(f, arg) {
    if (licensed()) { if (lic.refresh) lic.refresh(); return true; }
    if (left(f) > 0) return true;
    const feat = FEATURES[f] || { title: 'This tool', detail: '' };
    const surface = surfaceOf(arg);
    return !!(await lic.requirePro(feat.title, { detail: feat.detail, toolId: f, triesUsed: used(f), ...(surface ? { surface } : {}) }));
  }

  async function produced(f) {
    if (licensed() || !FEATURES[f]) return;
    const m = { ...(context.globalState.get(TRIAL_KEY) || {}) };
    for (const k of Object.keys(seen)) m[k] = Math.max(Number(m[k]) || 0, seen[k]);
    m[f] = used(f) + 1;
    seen[f] = m[f];
    await context.globalState.update(TRIAL_KEY, m);
    const l = left(f);
    vscode.window.setStatusBarMessage(`Zovo Pro: free try ${used(f)} of ${TRIES} of "${FEATURES[f].title}" used${l ? `, ${l} left` : ''} on this computer.`, 8000);
    emitter.fire(false);
  }

  context.subscriptions.push(emitter);
  return {
    SKU, FEATURES, TRIES, TRIAL_USES: TRIES,
    get licensed() { return licensed(); },
    ready: lic.ready,
    allowed, produced, left, used,
    tries: () => Object.fromEntries(Object.keys(FEATURES).map((f) => [f, left(f)])),
    handleUri: (uri) => (lic.handleUri ? lic.handleUri(uri) : undefined),
    noteOpen: (uri) => { try { if (lic.noteOpen) lic.noteOpen(uri); } catch (e) { /* a count only */ } },
    onDidChange: emitter.event,
    license: lic,
  };
}

module.exports = { createPro, FEATURES, SKU, TRIES, TRIAL_USES: TRIES, TRIAL_KEY, TOOLS, surfaceOf };
