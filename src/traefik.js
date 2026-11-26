'use strict';
// Offline Traefik YAML/TOML config parser, route/TLS analyzer, static security auditor and Pro report builders.
// Zero Traefik server, shell, network or cloud calls.

function stripComment(line) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === '#' && !inSingle && !inDouble) return line.slice(0, i);
  }
  return line;
}

function unquote(val) {
  const s = String(val == null ? '' : val).trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function parseScalar(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((p) => unquote(p)).filter(Boolean);
  }
  return unquote(s);
}

function maskSecrets(str) {
  let out = String(str || '');
  // Mask basicAuth user:plaintextPass (when not already hashed with $apr1$, $2y$, $2a$, $2b$, {SHA})
  out = out.replace(/([a-zA-Z0-9._-]+):((?!\$apr1\$|\$2[aby]\$|\{SHA\})[^\s"',\]}]+)/g, (m, user, pass) => {
    if (/^(http|https|tcp|udp|ws|wss|address|port|url|rule|service|entryPoints|certResolver|localhost|127\.0\.0\.1|0\.0\.0\.0|\d+)$/i.test(user)) return m;
    if (/^\d+$/.test(pass)) return m; // host:port
    if (pass.startsWith('//')) return m; // scheme://
    return `${user}:***`;
  });
  out = out.replace(/(\b(?:password|passwd|secret|token|apikey|api_key|authorization)\s*[:=]\s*["']?)([^"'\s,\]]+)/gi, '$1***');
  return out;
}

function isPlaintextBasicAuthEntry(entry) {
  const s = unquote(entry);
  const idx = s.indexOf(':');
  if (idx <= 0) return false;
  const pass = s.slice(idx + 1).trim();
  if (!pass) return false;
  if (/^(\$apr1\$|\$2[aby]\$|\{SHA\})/.test(pass)) return false;
  return true;
}

function parseTomlToFlat(text) {
  const lines = text.split(/\r?\n/);
  const entries = [];
  let sectionPath = [];
  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1;
    const raw = lines[i];
    const clean = stripComment(raw).trim();
    if (!clean) continue;
    const arrSec = clean.match(/^\[\[(.+)\]\]$/);
    if (arrSec) {
      sectionPath = arrSec[1].split('.').map((p) => unquote(p.trim())).filter(Boolean);
      entries.push({ path: sectionPath.join('.'), key: sectionPath[sectionPath.length - 1] || '', value: '', isArrayItem: true, line: lineNo, raw });
      continue;
    }
    const sec = clean.match(/^\[(.+)\]$/);
    if (sec) {
      sectionPath = sec[1].split('.').map((p) => unquote(p.trim())).filter(Boolean);
      entries.push({ path: sectionPath.join('.'), key: sectionPath[sectionPath.length - 1] || '', value: '', isSection: true, line: lineNo, raw });
      continue;
    }
    const kv = clean.match(/^([a-zA-Z0-9_."'-]+)\s*=\s*(.+)$/);
    if (kv) {
      const kParts = kv[1].split('.').map((p) => unquote(p.trim())).filter(Boolean);
      const fullPath = sectionPath.concat(kParts);
      entries.push({
        path: fullPath.join('.'),
        key: fullPath[fullPath.length - 1] || '',
        value: parseScalar(kv[2]),
        line: lineNo,
        raw,
      });
    }
  }
  return { lines, entries };
}

function parseYamlToFlat(text) {
  const lines = text.split(/\r?\n/);
  const entries = [];
  const stack = []; // { indent, key }
  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1;
    const raw = lines[i];
    const clean = stripComment(raw);
    const trimmed = clean.trim();
    if (!trimmed || trimmed === '---' || trimmed === '...') continue;

    const indent = raw.search(/\S/);
    while (stack.length && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    if (trimmed.startsWith('- ')) {
      const itemText = trimmed.slice(2).trim();
      const parentPath = stack.map((s) => s.key);
      const kv = itemText.match(/^([a-zA-Z0-9_.-]+)\s*:\s*(.*)$/);
      if (kv) {
        const k = unquote(kv[1]);
        const v = kv[2].trim();
        const fullPath = parentPath.concat(k);
        entries.push({ path: fullPath.join('.'), key: k, value: parseScalar(v), isListItem: true, line: lineNo, raw });
        if (!v) stack.push({ indent: indent + 2, key: k });
      } else {
        entries.push({ path: parentPath.join('.'), key: parentPath[parentPath.length - 1] || '', value: parseScalar(itemText), isListItem: true, line: lineNo, raw });
      }
      continue;
    }

    const kv = trimmed.match(/^(['"]?[^:'"]+['"]?)\s*:\s*(.*)$/);
    if (kv) {
      const k = unquote(kv[1]);
      const v = kv[2].trim();
      const fullPath = stack.map((s) => s.key).concat(k);
      if (!v || v === '{}' || v === '[]') {
        entries.push({ path: fullPath.join('.'), key: k, value: v === '[]' ? [] : '', isSection: !v, line: lineNo, raw });
        if (!v) stack.push({ indent, key: k });
      } else {
        entries.push({ path: fullPath.join('.'), key: k, value: parseScalar(v), line: lineNo, raw });
      }
    }
  }
  return { lines, entries };
}

function parseTraefik(input, fileName = 'traefik.yml') {
  const text = Buffer.isBuffer(input) ? input.toString('utf8') : String(input || '');
  const isToml = /\.toml$/i.test(fileName);
  const { lines, entries } = isToml ? parseTomlToFlat(text) : parseYamlToFlat(text);

  const entryPointsMap = new Map();
  const routersMap = new Map();
  const middlewaresMap = new Map();
  const servicesMap = new Map();
  const certResolversMap = new Map();
  const apiInfo = { dashboard: false, insecure: false, line: 0, insecureLine: 0 };
  const transportInfo = { insecureSkipVerify: false, line: 0 };

  const rows = [];
  const findings = [];
  let rowIndex = 0;

  const ensureEp = (name, line) => {
    if (!entryPointsMap.has(name)) {
      entryPointsMap.set(name, { name, address: '', redirectTo: '', redirectScheme: '', tls: false, line, index: 0 });
    }
    return entryPointsMap.get(name);
  };
  const ensureRouter = (proto, name, line) => {
    const id = `${proto}:${name}`;
    if (!routersMap.has(id)) {
      routersMap.set(id, { id, protocol: proto, name, rule: '', entryPoints: [], middlewares: [], service: '', tls: false, certResolver: '', line, index: 0 });
    }
    return routersMap.get(id);
  };
  const ensureMw = (proto, name, line) => {
    const id = `${proto}:${name}`;
    if (!middlewaresMap.has(id)) {
      middlewaresMap.set(id, { id, protocol: proto, name, kind: '', details: [], users: [], hasAuth: false, line, index: 0 });
    }
    return middlewaresMap.get(id);
  };
  const ensureSvc = (proto, name, line) => {
    const id = `${proto}:${name}`;
    if (!servicesMap.has(id)) {
      servicesMap.set(id, { id, protocol: proto, name, servers: [], passHostHeader: '', healthCheck: '', line, index: 0 });
    }
    return servicesMap.get(id);
  };
  const ensureResolver = (name, line) => {
    if (!certResolversMap.has(name)) {
      certResolversMap.set(name, { name, email: '', storage: '', challenge: '', caServer: '', line, index: 0 });
    }
    return certResolversMap.get(name);
  };

  const addFinding = (severity, category, rule, line, section, message, rowRef = null) => {
    const f = { severity, category, rule, line, section, message };
    findings.push(f);
    if (rowRef) {
      rowRef.findings.push(f);
      if (severity === 'error') rowRef.errorCount += 1;
      else rowRef.warningCount += 1;
    }
  };

  const AUTH_MW_RE = /^(basicauth|digestauth|forwardauth|ipallowlist|ipwhitelist)$/i;

  for (const e of entries) {
    const parts = e.path.split('.').filter(Boolean);
    if (!parts.length) continue;
    const top = parts[0];
    const maskedRaw = maskSecrets(e.raw.trim());
    const valStr = Array.isArray(e.value) ? e.value.join(', ') : String(e.value == null ? '' : e.value);
    const maskedVal = maskSecrets(valStr);

    let category = 'other';
    let section = top;
    let badge = '';

    // 1. entryPoints.<name>...
    if (top === 'entryPoints' && parts.length >= 2) {
      category = 'entrypoint';
      const epName = parts[1];
      section = `entryPoints.${epName}`;
      const ep = ensureEp(epName, e.line);
      if (parts[2] === 'address' && valStr) ep.address = valStr;
      if (parts.includes('redirections') && parts.includes('to') && valStr) ep.redirectTo = valStr;
      if (parts.includes('redirections') && parts.includes('scheme') && valStr) ep.redirectScheme = valStr;
      if (parts.includes('tls')) ep.tls = true;
      badge = 'entryPoint';
    }

    // 2. http/tcp/udp routers, middlewares, services
    if ((top === 'http' || top === 'tcp' || top === 'udp') && parts.length >= 3) {
      const sub = parts[1];
      const itemName = parts[2];
      section = `${top}.${sub}.${itemName}`;
      if (sub === 'routers') {
        category = 'router';
        badge = `${top.toUpperCase()} router`;
        const rt = ensureRouter(top, itemName, e.line);
        if (parts[3] === 'rule' && valStr) rt.rule = valStr;
        if (parts[3] === 'service' && valStr) rt.service = valStr;
        if (parts[3] === 'entryPoints') {
          if (Array.isArray(e.value)) rt.entryPoints.push(...e.value);
          else if (valStr) rt.entryPoints.push(valStr);
        }
        if (parts[3] === 'middlewares') {
          if (Array.isArray(e.value)) rt.middlewares.push(...e.value);
          else if (valStr) rt.middlewares.push(valStr);
        }
        if (parts[3] === 'tls') {
          rt.tls = true;
          if (parts[4] === 'certResolver' && valStr) rt.certResolver = valStr;
        }
      } else if (sub === 'middlewares') {
        category = 'middleware';
        badge = 'middleware';
        const mw = ensureMw(top, itemName, e.line);
        if (parts.length >= 4 && !mw.kind) {
          mw.kind = parts[3];
          if (AUTH_MW_RE.test(mw.kind)) mw.hasAuth = true;
        }
        if (parts.includes('users')) {
          if (Array.isArray(e.value)) mw.users.push(...e.value);
          else if (valStr) mw.users.push(valStr);
        }
        if (parts.length >= 4 && valStr) {
          mw.details.push(`${parts.slice(3).join('.')}=${maskedVal}`);
        }
      } else if (sub === 'services') {
        category = 'service';
        badge = `${top.toUpperCase()} service`;
        const svc = ensureSvc(top, itemName, e.line);
        if ((parts.includes('url') || parts.includes('address')) && valStr) svc.servers.push(valStr);
        if (parts.includes('passHostHeader') && valStr) svc.passHostHeader = valStr;
        if (parts.includes('healthCheck') && parts.includes('path') && valStr) svc.healthCheck = valStr;
      }
    }

    // 3. certificatesResolvers.<name>...
    if (top === 'certificatesResolvers' && parts.length >= 2) {
      category = 'tls';
      const rName = parts[1];
      section = `certificatesResolvers.${rName}`;
      badge = 'TLS ACME';
      const res = ensureResolver(rName, e.line);
      if (parts.includes('email') && valStr) res.email = valStr;
      if (parts.includes('storage') && valStr) res.storage = valStr;
      if (parts.includes('caServer') && valStr) res.caServer = valStr;
      if (parts.includes('httpChallenge')) res.challenge = 'httpChallenge';
      if (parts.includes('tlsChallenge')) res.challenge = 'tlsChallenge';
      if (parts.includes('dnsChallenge')) res.challenge = 'dnsChallenge';
    }

    // 4. api & serversTransport
    if (top === 'api') {
      category = 'api';
      section = 'api';
      badge = 'API';
      if (parts[1] === 'dashboard' && e.value === true) { apiInfo.dashboard = true; apiInfo.line = e.line; }
      if (parts[1] === 'insecure' && e.value === true) { apiInfo.insecure = true; apiInfo.insecureLine = e.line; }
    }
    if (top === 'serversTransport' || parts.includes('insecureSkipVerify')) {
      category = 'tls';
      if (parts[parts.length - 1] === 'insecureSkipVerify' && e.value === true) {
        transportInfo.insecureSkipVerify = true;
        transportInfo.line = e.line;
        badge = 'TLS';
      }
    }

    rowIndex += 1;
    const row = {
      index: rowIndex,
      line: e.line,
      section,
      directive: e.path,
      value: maskedVal,
      category,
      badge,
      raw: maskedRaw,
      findings: [],
      errorCount: 0,
      warningCount: 0,
      attrs: [
        { key: 'Path', value: e.path },
        { key: 'Section', value: section },
        { key: 'Category', value: category },
        { key: 'Value', value: maskedVal || '(section)' },
      ],
    };
    rows.push(row);

    // Link first row index to model objects
    if (top === 'entryPoints' && parts[1] && entryPointsMap.get(parts[1]).index === 0) entryPointsMap.get(parts[1]).index = rowIndex;
    if ((top === 'http' || top === 'tcp' || top === 'udp') && parts[1] === 'routers' && parts[2]) {
      const rt = routersMap.get(`${top}:${parts[2]}`);
      if (rt && rt.index === 0) rt.index = rowIndex;
    }
    if ((top === 'http' || top === 'tcp' || top === 'udp') && parts[1] === 'middlewares' && parts[2]) {
      const mw = middlewaresMap.get(`${top}:${parts[2]}`);
      if (mw && mw.index === 0) mw.index = rowIndex;
    }
    if ((top === 'http' || top === 'tcp' || top === 'udp') && parts[1] === 'services' && parts[2]) {
      const svc = servicesMap.get(`${top}:${parts[2]}`);
      if (svc && svc.index === 0) svc.index = rowIndex;
    }
    if (top === 'certificatesResolvers' && parts[1] && certResolversMap.get(parts[1]).index === 0) {
      certResolversMap.get(parts[1]).index = rowIndex;
    }

    // Immediate per-row static security findings
    if (top === 'api' && parts[1] === 'insecure' && e.value === true) {
      addFinding('error', 'Dashboard', 'api-insecure', e.line, 'api', 'api.insecure is enabled: Traefik dashboard and API are exposed on port 8080 without authentication or TLS.', row);
    }
    if (parts[parts.length - 1] === 'insecureSkipVerify' && e.value === true) {
      addFinding('error', 'TLS', 'insecure-skip-verify', e.line, section, 'insecureSkipVerify is true: Traefik skips TLS certificate verification for upstream backends.', row);
    }
    if (category === 'middleware') {
      if (parts.includes('users')) {
        const list = Array.isArray(e.value) ? e.value : (valStr ? [valStr] : []);
        if (list.some((item) => isPlaintextBasicAuthEntry(item))) {
          addFinding('error', 'Credentials', 'plaintext-middleware-creds', e.line, section, 'Middleware basicAuth/digestAuth user entry appears to contain a plaintext password instead of a bcrypt/apr1/SHA hash.', row);
        }
      } else if (/(password|passwd|secret|token|authorization|apikey)/i.test(e.key) && valStr && !/^\$\{/.test(valStr) && !/^\*+$/.test(valStr)) {
        addFinding('error', 'Credentials', 'plaintext-middleware-creds', e.line, section, `Plaintext credential value detected in middleware key "${e.key}".`, row);
      }
    }
  }

  // Post-pass findings across parsed structures
  const entryPoints = Array.from(entryPointsMap.values());
  const routers = Array.from(routersMap.values());
  const middlewares = Array.from(middlewaresMap.values());
  const services = Array.from(servicesMap.values());
  const certResolvers = Array.from(certResolversMap.values());

  const mwByName = new Map();
  for (const mw of middlewares) mwByName.set(mw.name, mw);
  const svcNames = new Set(services.map((s) => s.name));

  // Missing HTTPS redirect on HTTP port 80 entryPoint
  const hasHttpsEp = entryPoints.some((ep) => /:443\b/.test(ep.address) || /secure|https/i.test(ep.name));
  for (const ep of entryPoints) {
    if ((/:80\b/.test(ep.address) || /^web$|^http$/i.test(ep.name)) && !ep.redirectTo && !ep.redirectScheme && hasHttpsEp) {
      const rowRef = rows.find((r) => r.index === ep.index) || null;
      addFinding('warning', 'TLS', 'missing-https-redirect', ep.line, `entryPoints.${ep.name}`, `HTTP entryPoint "${ep.name}" (${ep.address || 'port 80'}) has no redirections.entryPoint to HTTPS.`, rowRef);
    }
  }

  // Exposed dashboard without auth
  const dashboardRouters = routers.filter((rt) => rt.service === 'api@internal' || /dashboard/i.test(rt.name));
  if (apiInfo.dashboard && !apiInfo.insecure) {
    if (!dashboardRouters.length) {
      const rowRef = rows.find((r) => r.line === apiInfo.line) || null;
      addFinding('warning', 'Dashboard', 'exposed-dashboard-no-auth', apiInfo.line, 'api', 'api.dashboard is enabled without an explicit authenticated router in this config.', rowRef);
    }
  }
  for (const rt of dashboardRouters) {
    const hasAuthMw = rt.middlewares.some((mName) => {
      const cleanName = mName.split('@')[0];
      const mw = mwByName.get(cleanName);
      return (mw && mw.hasAuth) || /auth|whitelist|allowlist/i.test(cleanName);
    });
    if (!hasAuthMw) {
      const rowRef = rows.find((r) => r.index === rt.index) || null;
      addFinding('error', 'Dashboard', 'exposed-dashboard-no-auth', rt.line, `${rt.protocol}.routers.${rt.name}`, `Dashboard router "${rt.name}" targets ${rt.service || 'api@internal'} without an authentication or IP allowlist middleware.`, rowRef);
    }
  }

  // Router referencing undefined local service
  for (const rt of routers) {
    if (rt.service && !rt.service.includes('@') && services.length > 0 && !svcNames.has(rt.service)) {
      const rowRef = rows.find((r) => r.index === rt.index) || null;
      addFinding('warning', 'Routing', 'undefined-service', rt.line, `${rt.protocol}.routers.${rt.name}`, `Router "${rt.name}" references service "${rt.service}" which is not defined in this file.`, rowRef);
    }
  }

  const findingErrors = findings.filter((f) => f.severity === 'error').length;
  const findingWarnings = findings.filter((f) => f.severity === 'warning').length;

  return {
    title: fileName,
    format: isToml ? 'TOML' : 'YAML',
    totalLines: lines.length,
    entryPoints,
    routers,
    middlewares,
    services,
    certResolvers,
    apiInfo,
    transportInfo,
    rows,
    findings,
    stats: {
      entryPointCount: entryPoints.length,
      routerCount: routers.length,
      middlewareCount: middlewares.length,
      serviceCount: services.length,
      certResolverCount: certResolvers.length,
      tlsRouterCount: routers.filter((r) => r.tls || r.certResolver).length,
      rowCount: rows.length,
      findingErrors,
      findingWarnings,
    },
  };
}

function buildAuditMarkdown(entries) {
  const out = ['# Traefik TLS, Dashboard & Routing Security Audit', ''];
  let totalErrors = 0;
  let totalWarnings = 0;
  for (const { fileName, parsed } of entries) {
    totalErrors += parsed.stats.findingErrors;
    totalWarnings += parsed.stats.findingWarnings;
    out.push(`## ${fileName} (${parsed.format})`);
    out.push(`- EntryPoints: ${parsed.stats.entryPointCount} | Routers: ${parsed.stats.routerCount} (${parsed.stats.tlsRouterCount} TLS) | Middlewares: ${parsed.stats.middlewareCount} | Services: ${parsed.stats.serviceCount} | CertResolvers: ${parsed.stats.certResolverCount}`);
    out.push(`- Findings: ${parsed.stats.findingErrors} error(s), ${parsed.stats.findingWarnings} warning(s)`);
    out.push('');
    if (!parsed.findings.length) {
      out.push('_No security or routing findings detected._', '');
    } else {
      out.push('| Severity | Category | Rule | Line | Section | Finding |');
      out.push('| --- | --- | --- | ---: | --- | --- |');
      for (const f of parsed.findings) {
        out.push(`| ${f.severity.toUpperCase()} | ${f.category} | \`${f.rule}\` | ${f.line} | \`${f.section}\` | ${f.message.replace(/\|/g, '\\|')} |`);
      }
      out.push('');
    }
  }
  out.splice(2, 0, `**Files audited:** ${entries.length} · **Total errors:** ${totalErrors} · **Total warnings:** ${totalWarnings}`, '');
  return out.join('\n');
}

function buildDiffMarkdown(leftName, left, rightName, right) {
  const out = [`# Traefik Config Diff: ${leftName} vs ${rightName}`, ''];
  const diffSet = (label, aList, bList) => {
    const aSet = new Set(aList);
    const bSet = new Set(bList);
    const added = bList.filter((x) => !aSet.has(x));
    const removed = aList.filter((x) => !bSet.has(x));
    out.push(`## ${label}`);
    if (!added.length && !removed.length) {
      out.push('_No changes._', '');
      return;
    }
    for (const x of added) out.push(`- **Added:** \`${x}\``);
    for (const x of removed) out.push(`- **Removed:** \`${x}\``);
    out.push('');
  };

  diffSet('EntryPoint Changes', left.entryPoints.map((e) => `${e.name} (${e.address})`), right.entryPoints.map((e) => `${e.name} (${e.address})`));
  diffSet('Router Changes', left.routers.map((r) => `${r.protocol}:${r.name} -> ${r.service || '-'} [${r.rule || '-'}]`), right.routers.map((r) => `${r.protocol}:${r.name} -> ${r.service || '-'} [${r.rule || '-'}]`));
  diffSet('Service Changes', left.services.map((s) => `${s.protocol}:${s.name} (${s.servers.join(', ') || 'none'})`), right.services.map((s) => `${s.protocol}:${s.name} (${s.servers.join(', ') || 'none'})`));
  diffSet('Security Finding Changes', left.findings.map((f) => `${f.severity}:${f.rule} @ ${f.section}`), right.findings.map((f) => `${f.severity}:${f.rule} @ ${f.section}`));
  return out.join('\n');
}

function safeId(s) {
  return String(s || 'node').replace(/[^a-zA-Z0-9_]/g, '_');
}

function buildRouteMapMermaid(parsed) {
  const lines = ['flowchart LR'];
  for (const ep of parsed.entryPoints) {
    lines.push(`  ep_${safeId(ep.name)}["EntryPoint: ${ep.name} (${ep.address || '?'})"]`);
    if (ep.redirectTo) {
      lines.push(`  ep_${safeId(ep.name)} -->|redirect| ep_${safeId(ep.redirectTo)}`);
    }
  }
  for (const rt of parsed.routers) {
    const rId = `rt_${safeId(rt.id)}`;
    const tlsTag = rt.certResolver ? ` TLS:${rt.certResolver}` : (rt.tls ? ' TLS' : '');
    lines.push(`  ${rId}["${rt.protocol.toUpperCase()} Router: ${rt.name}${tlsTag}"]`);
    for (const epName of rt.entryPoints) {
      lines.push(`  ep_${safeId(epName)} --> ${rId}`);
    }
    let prev = rId;
    for (const mwName of rt.middlewares) {
      const mId = `mw_${safeId(mwName)}`;
      lines.push(`  ${mId}["Middleware: ${mwName}"]`);
      lines.push(`  ${prev} --> ${mId}`);
      prev = mId;
    }
    if (rt.service) {
      const sId = `svc_${safeId(rt.service)}`;
      lines.push(`  ${sId}["Service: ${rt.service}"]`);
      lines.push(`  ${prev} --> ${sId}`);
    }
  }
  return lines.join('\n');
}

function buildInventoryCsv(parsed) {
  const escCsv = (v) => {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const out = ['kind,protocol,name,target,tls,detail,line'];
  for (const ep of parsed.entryPoints) {
    out.push(['entryPoint', 'net', ep.name, ep.address, ep.tls ? 'true' : 'false', ep.redirectTo ? `redirect->${ep.redirectTo}` : '', ep.line].map(escCsv).join(','));
  }
  for (const rt of parsed.routers) {
    out.push(['router', rt.protocol, rt.name, rt.service, rt.certResolver || (rt.tls ? 'tls' : 'none'), rt.rule, rt.line].map(escCsv).join(','));
  }
  for (const mw of parsed.middlewares) {
    out.push(['middleware', mw.protocol, mw.name, mw.kind, '', mw.details.slice(0, 3).join('; '), mw.line].map(escCsv).join(','));
  }
  for (const svc of parsed.services) {
    out.push(['service', svc.protocol, svc.name, svc.servers.join(' '), '', svc.healthCheck ? `health=${svc.healthCheck}` : '', svc.line].map(escCsv).join(','));
  }
  for (const cr of parsed.certResolvers) {
    out.push(['certResolver', 'acme', cr.name, cr.challenge || 'acme', 'true', cr.storage || cr.email, cr.line].map(escCsv).join(','));
  }
  return out.join('\n') + '\n';
}

function buildRouteMapSummaryMarkdown(parsed, fileName = 'traefik.yml') {
  const out = [
    `# Traefik Route & TLS Map: ${fileName}`,
    '',
    `- **Format:** ${parsed.format}`,
    `- **EntryPoints:** ${parsed.stats.entryPointCount}`,
    `- **Routers:** ${parsed.stats.routerCount} (${parsed.stats.tlsRouterCount} with TLS)`,
    `- **Middlewares:** ${parsed.stats.middlewareCount}`,
    `- **Services:** ${parsed.stats.serviceCount}`,
    `- **CertResolvers:** ${parsed.stats.certResolverCount}`,
    `- **Security Findings:** ${parsed.stats.findingErrors} error(s), ${parsed.stats.findingWarnings} warning(s)`,
    '',
    '## Routing Diagram',
    '',
    '```mermaid',
    buildRouteMapMermaid(parsed),
    '```',
    '',
  ];
  return out.join('\n');
}

module.exports = {
  parseTraefik,
  buildAuditMarkdown,
  buildDiffMarkdown,
  buildRouteMapMermaid,
  buildInventoryCsv,
  buildRouteMapSummaryMarkdown,
  maskSecrets,
};
