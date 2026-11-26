'use strict';
// Traefik Route & TLS Viewer by Zovo: opens traefik.yml, traefik.yaml, traefik.toml and *.traefik.yml offline.
// No Traefik server, shell, network or cloud calls, no telemetry. Activation shows nothing: no message, no popup.
const vscode = require('vscode');
const { TraefikEditorProvider, VIEW_TYPE } = require('./editor');
const { createTools } = require('./tools');
const { createPro } = require('./pro');
const { createRatingPrompt } = require('./rate');
const support = require('./support');
const { createReach } = require('./reach');
const reachConfig = require('./reach-config');

const PREFIX = 'zovoTraefik';
const EXT_ID = 'zovo.zovo-traefik-config-viewer';
const setting = (k, d) => vscode.workspace.getConfiguration(PREFIX).get(k, d);

function openWithCommand(uri) {
  const u = uri && uri.scheme ? uri : (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri);
  if (!u) {
    vscode.window.showInformationMessage('Select a traefik.yml, traefik.yaml, traefik.toml or *.traefik.yml file first.');
    return undefined;
  }
  return vscode.commands.executeCommand('vscode.openWith', u, VIEW_TYPE);
}

function activate(context) {
  const sub = (d) => context.subscriptions.push(d);
  let rating = { success() {}, failure() {} };
  try { rating = createRatingPrompt({ vscode, context, extensionId: EXT_ID, section: PREFIX, name: 'Traefik Route & TLS Viewer', policy: 'reach2' }); } catch (e) { /* rating is optional */ }
  support.registerSupport({ vscode, context, prefix: PREFIX, selfId: EXT_ID });
  const pro = createPro({ vscode, context });
  const reach = createReach({ vscode, ...reachConfig, maximum: pro.TRIES, context, licensed: () => !!pro.licensed, shown: () => setting('showProTools', true) !== false });
  reach.registerCtx();
  reach.registerTitle();
  sub(pro.onDidChange(() => reach.refresh()));

  const provider = new TraefikEditorProvider(context, {
    reach: () => reach,
    onSuccess: (doc) => { rating.success(doc.uri); pro.noteOpen(doc.uri); },
    onFailure: () => rating.failure(),
    onFilter: (doc, panel) => reach.also(panel.webview, 'exportRouteMap', 'filterBtn'),
  });
  sub(vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: true }));
  sub(provider);
  const tools = createTools({ context, provider, pro, reach });

  const reg = (id, fn) => sub(vscode.commands.registerCommand(id, async (...a) => {
    try { return await fn(...a); } catch (e) { vscode.window.showErrorMessage(String((e && e.message) || e)); return undefined; }
  }));
  const target = (uri) => (uri && uri.scheme ? uri : undefined);
  const extra = (x) => (x && typeof x === 'object' && !x.scheme && !Array.isArray(x) ? x : {});
  reg(`${PREFIX}.openWith`, openWithCommand);
  reg(`${PREFIX}.openSample`, () => vscode.commands.executeCommand('vscode.openWith', vscode.Uri.joinPath(context.extensionUri, 'samples', 'traefik.yml'), VIEW_TYPE));
  reg(`${PREFIX}.openWalkthrough`, () => vscode.commands.executeCommand('workbench.action.openWalkthrough', `${EXT_ID}#${PREFIX}.start`, false));
  for (const id of ['auditSecurity', 'diffConfigs', 'exportRouteMap']) {
    reg(`${PREFIX}.${id}`, reach.wrap((uri, x) => tools[id](target(uri), extra(uri && !uri.scheme ? uri : x))));
  }
  sub(vscode.workspace.onDidChangeConfiguration((e) => { if (e.affectsConfiguration(`${PREFIX}.showProTools`)) reach.refresh(); }));
  sub(vscode.window.registerUriHandler({ handleUri: (uri) => pro.handleUri(uri) }));
  return { provider, tools, pro, reach };
}

function deactivate() {}

module.exports = { activate, deactivate };
