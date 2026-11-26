'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  parseTraefik,
  buildAuditMarkdown,
  buildDiffMarkdown,
  buildRouteMapMermaid,
  buildInventoryCsv,
  buildRouteMapSummaryMarkdown,
} = require('../src/traefik');
const { TraefikViewModel } = require('../src/view');
const { editorHtml, csp } = require('../src/html');

test('parses sample traefik.yml with api.insecure, insecureSkipVerify, missing HTTPS redirect, exposed dashboard and plaintext creds', () => {
  const buf = fs.readFileSync(path.join(__dirname, '..', 'samples', 'traefik.yml'));
  const parsed = parseTraefik(buf, 'traefik.yml');
  assert.equal(parsed.format, 'YAML');
  assert.equal(parsed.stats.entryPointCount, 2);
  assert.equal(parsed.stats.routerCount, 4);
  assert.equal(parsed.stats.middlewareCount, 1);
  assert.equal(parsed.stats.serviceCount, 2);
  assert.equal(parsed.stats.certResolverCount, 1);
  const rules = new Set(parsed.findings.map((f) => f.rule));
  assert.ok(rules.has('api-insecure'));
  assert.ok(rules.has('insecure-skip-verify'));
  assert.ok(rules.has('missing-https-redirect'));
  assert.ok(rules.has('exposed-dashboard-no-auth'));
  assert.ok(rules.has('plaintext-middleware-creds'));
  assert.ok(rules.has('undefined-service'));
  // Ensure plaintext password is masked in row output
  assert.ok(!parsed.rows.some((r) => r.raw.includes('example_plain_pass')));
});

test('parses hardened.traefik.yml with zero security findings', () => {
  const buf = fs.readFileSync(path.join(__dirname, '..', 'samples', 'hardened.traefik.yml'));
  const parsed = parseTraefik(buf, 'hardened.traefik.yml');
  assert.equal(parsed.stats.entryPointCount, 2);
  assert.equal(parsed.stats.routerCount, 2);
  assert.equal(parsed.stats.tlsRouterCount, 2);
  assert.equal(parsed.findings.length, 0);
});

test('parses traefik.toml static and dynamic sections offline', () => {
  const buf = fs.readFileSync(path.join(__dirname, '..', 'samples', 'traefik.toml'));
  const parsed = parseTraefik(buf, 'traefik.toml');
  assert.equal(parsed.format, 'TOML');
  assert.equal(parsed.stats.entryPointCount, 2);
  assert.equal(parsed.stats.routerCount, 1);
  assert.equal(parsed.stats.serviceCount, 1);
  assert.equal(parsed.stats.certResolverCount, 1);
  const rules = new Set(parsed.findings.map((f) => f.rule));
  assert.ok(rules.has('api-insecure'));
  assert.ok(rules.has('missing-https-redirect'));
});

test('TraefikViewModel filters by category, findings and text', () => {
  const buf = fs.readFileSync(path.join(__dirname, '..', 'samples', 'traefik.yml'));
  const parsed = parseTraefik(buf, 'traefik.yml');
  const vm = new TraefikViewModel(parsed, 'traefik.yml', buf.length);
  assert.ok(vm.setFilter({ text: '', kind: 'router' }) >= 4);
  assert.ok(vm.setFilter({ text: '', kind: 'findings' }) >= 4);
  assert.ok(vm.setFilter({ text: 'letsencrypt', kind: '' }) >= 1);
  const det = vm.detail(1);
  assert.ok(det && det.section === 'api');
});

test('Pro report builders produce security audit, config diff, Mermaid route map and CSV inventory', () => {
  const baseline = parseTraefik(fs.readFileSync(path.join(__dirname, '..', 'samples', 'traefik.yml')), 'traefik.yml');
  const target = parseTraefik(fs.readFileSync(path.join(__dirname, '..', 'samples', 'hardened.traefik.yml')), 'hardened.traefik.yml');
  const audit = buildAuditMarkdown([{ fileName: 'traefik.yml', parsed: baseline }]);
  assert.match(audit, /Traefik TLS, Dashboard & Routing Security Audit/);
  assert.match(audit, /api-insecure/);
  const diff = buildDiffMarkdown('traefik.yml', baseline, 'hardened.traefik.yml', target);
  assert.match(diff, /Router Changes/);
  assert.match(diff, /Security Finding Changes/);
  const mermaid = buildRouteMapMermaid(baseline);
  assert.match(mermaid, /flowchart LR/);
  assert.match(mermaid, /ep_websecure/);
  const csv = buildInventoryCsv(baseline);
  assert.match(csv, /^kind,protocol,name,target,tls,detail,line/);
  const md = buildRouteMapSummaryMarkdown(baseline, 'traefik.yml');
  assert.match(md, /```mermaid/);
});

test('editorHtml enforces strict CSP with nonce and no unsafe-inline', () => {
  const html = editorHtml({ cspSource: 'vscode-webview://test', script: 'v.js', styleUri: 'v.css', title: 'traefik.yml', nonce: 'traf123' });
  assert.match(html, /default-src 'none'/);
  assert.match(html, /script-src 'nonce-traf123'/);
  assert.doesNotMatch(csp('vscode-webview://test', 'traf123'), /unsafe-inline/);
});
