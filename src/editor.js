'use strict';
// Custom editor for traefik.yml, traefik.yaml, traefik.toml, *.traefik.yml and *.traefik.yaml files.
const vscode = require('vscode');
const path = require('path');
const { editorHtml } = require('./html');
const support = require('./support');
const { parseTraefik } = require('./traefik');
const { TraefikViewModel } = require('./view');

const VIEW_TYPE = 'zovo-traefik.viewer';
const PREFIX = 'zovoTraefik';
const setting = (k, d) => vscode.workspace.getConfiguration(PREFIX).get(k, d);
const PAGE_MAX = 500;

class TraefikEditorProvider {
  constructor(context, hooks = {}) {
    this.context = context;
    this.hooks = hooks;
    this.docs = new Set();
    this.active = null;
    this.activePanel = null;
  }

  dispose() {
    this.docs.clear();
  }

  openCustomDocument(uri) {
    const doc = {
      uri,
      name: path.posix.basename(uri.path),
      panels: new Set(),
      rawBuf: null,
      model: null,
      failed: null,
      rendered: false,
      dispose: () => {
        this.docs.delete(doc);
        if (this.active === doc) this.active = null;
      },
    };
    this.docs.add(doc);
    return doc;
  }

  async load(doc) {
    if (doc.model || doc.failed) return;
    const maxMB = Number(setting('maxFileMB', 16)) || 16;
    try {
      if (!doc.rawBuf) {
        const bytes = await vscode.workspace.fs.readFile(doc.uri);
        doc.rawBuf = Buffer.from(bytes);
      }
      if (doc.rawBuf.length > maxMB * 1024 * 1024) {
        throw new Error(`This file is ${(doc.rawBuf.length / 1048576).toFixed(1)} MB, above the limit of ${maxMB} MB (setting zovoTraefik.maxFileMB).`);
      }
      const parsed = parseTraefik(doc.rawBuf, doc.name);
      doc.model = new TraefikViewModel(parsed, doc.name, doc.rawBuf.length);
    } catch (e) {
      doc.failed = String((e && e.message) || e);
    }
  }

  async resolveCustomEditor(doc, panel) {
    doc.panels.add(panel);
    const ext = this.context.extensionUri;
    const media = vscode.Uri.joinPath(ext, 'media');
    const reach = this.hooks.reach ? this.hooks.reach() : null;
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [media],
      enableCommandUris: (reach ? reach.commandIds() : []).concat(support.commandUris(PREFIX)),
    };
    const u = (f) => panel.webview.asWebviewUri(vscode.Uri.joinPath(media, f)).toString();
    panel.webview.html = editorHtml({
      cspSource: panel.webview.cspSource,
      script: u('viewer.js'),
      styleUri: u('viewer.css'),
      title: doc.name,
      head: reach ? (n) => reach.headHtml(n) : undefined,
      showSupportLinks: setting('showSupportLinks', true) !== false,
    });
    if (reach) reach.attach(panel.webview, panel);
    const setActive = () => { if (panel.active) { this.active = doc; this.activePanel = panel; } };
    setActive();
    panel.onDidChangeViewState(setActive);
    panel.onDidDispose(() => {
      doc.panels.delete(panel);
      panel.disposed = true;
      if (this.activePanel === panel) {
        this.activePanel = null;
        if (this.active === doc) this.active = null;
      }
    });
    panel.webview.onDidReceiveMessage(async (m) => {
      if (reach && reach.onMessage(m)) return;
      if (!m || typeof m !== 'object' || typeof m.type !== 'string') return;
      try { await this.onMessage(doc, panel, m); }
      catch (e) { this.send(panel.webview, { type: 'hint', text: String((e && e.message) || e), req: m.req }); }
    });
  }

  send(webview, msg) {
    try {
      const r = webview.postMessage(msg);
      if (r && r.then) r.then(undefined, () => false);
      return r;
    } catch (e) {
      return undefined;
    }
  }

  async onMessage(doc, panel, m) {
    const n = Math.max(1, Math.min(PAGE_MAX, Number(m.n) || 100));
    const from = Math.max(0, Number(m.from) || 0);
    switch (m.type) {
      case 'ready': {
        await this.load(doc);
        if (doc.failed) {
          this.send(panel.webview, { type: 'init', name: doc.name, error: doc.failed });
          if (this.hooks.onFailure) this.hooks.onFailure(doc);
          return;
        }
        this.send(panel.webview, {
          type: 'init',
          name: doc.name,
          summary: doc.model.summary(),
          pageSize: Number(setting('pageSize', 100)) || 100,
        });
        doc.rendered = true;
        if (this.hooks.onSuccess) this.hooks.onSuccess(doc);
        return;
      }
      case 'page':
        if (!doc.model) return;
        this.send(panel.webview, {
          type: 'pageResult',
          req: m.req,
          from,
          total: doc.model.count(),
          rows: doc.model.rows(from, n),
        });
        return;
      case 'filter': {
        if (!doc.model) return;
        const count = doc.model.setFilter(m.filter || null);
        this.send(panel.webview, {
          type: 'filterResult',
          req: m.req,
          count,
          total: doc.model.totalCount(),
          filter: doc.model.filter,
        });
        if (doc.model.filter.text && this.hooks.onFilter) this.hooks.onFilter(doc, panel);
        return;
      }
      case 'detail':
        if (!doc.model) return;
        this.send(panel.webview, { type: 'detailResult', req: m.req, detail: doc.model.detail(Number(m.index) || 1) });
        return;
      case 'runTool':
        if (typeof m.tool === 'string' && /^(auditSecurity|diffConfigs|exportRouteMap)$/.test(m.tool)) {
          if (!panel.active) panel.reveal(undefined, false);
          await vscode.commands.executeCommand(`${PREFIX}.${m.tool}`, { surface: 'toolbar' });
        }
        return;
      default:
    }
  }
}

module.exports = { TraefikEditorProvider, VIEW_TYPE };
