'use strict';
// View model for Traefik Route & TLS Viewer: pagination, filtering by category/text, routers, services and findings.

class TraefikViewModel {
  constructor(parsed, name, fileSize) {
    this.parsed = parsed;
    this.name = name;
    this.fileSize = fileSize;
    this.filter = { text: '', kind: '' };
    this.filtered = parsed.rows.slice();
  }

  summary() {
    const p = this.parsed;
    const s = p.stats;
    return {
      name: this.name,
      fileSize: this.fileSize,
      title: p.title,
      format: p.format,
      totalLines: p.totalLines,
      entryPointCount: s.entryPointCount,
      routerCount: s.routerCount,
      middlewareCount: s.middlewareCount,
      serviceCount: s.serviceCount,
      certResolverCount: s.certResolverCount,
      tlsRouterCount: s.tlsRouterCount,
      rowCount: s.rowCount,
      findingErrors: s.findingErrors,
      findingWarnings: s.findingWarnings,
      entryPoints: p.entryPoints,
      routers: p.routers,
      middlewares: p.middlewares,
      services: p.services,
      certResolvers: p.certResolvers,
      findings: p.findings,
    };
  }

  totalCount() {
    return this.parsed.rows.length;
  }

  count() {
    return this.filtered.length;
  }

  setFilter(f) {
    const text = f && typeof f.text === 'string' ? f.text.trim().toLowerCase() : '';
    const kind = f && typeof f.kind === 'string' ? f.kind.trim() : '';
    this.filter = { text, kind };
    this.filtered = this.parsed.rows.filter((r) => {
      if (kind === 'entrypoint' && r.category !== 'entrypoint') return false;
      if (kind === 'router' && r.category !== 'router') return false;
      if (kind === 'middleware' && r.category !== 'middleware') return false;
      if (kind === 'service' && r.category !== 'service') return false;
      if (kind === 'tls' && r.category !== 'tls' && !/tls|cert|acme|skipverify/i.test(r.directive)) return false;
      if (kind === 'findings' && !r.errorCount && !r.warningCount) return false;
      if (text) {
        const hay = `${r.section} ${r.directive} ${r.value} ${r.badge} ${r.raw}`.toLowerCase();
        if (!hay.includes(text)) return false;
      }
      return true;
    });
    return this.filtered.length;
  }

  rows(from, limit) {
    const start = Math.max(0, Number(from) || 0);
    const n = Math.max(1, Math.min(500, Number(limit) || 100));
    return this.filtered.slice(start, start + n).map((r) => ({
      index: r.index,
      line: r.line,
      section: r.section,
      directive: r.directive,
      value: r.value,
      category: r.category,
      badge: r.badge,
      errorCount: r.errorCount,
      warningCount: r.warningCount,
    }));
  }

  detail(index) {
    const r = this.parsed.rows.find((x) => x.index === index) || this.parsed.rows[0] || null;
    if (!r) return null;
    return {
      index: r.index,
      line: r.line,
      section: r.section,
      directive: r.directive,
      value: r.value,
      badge: r.badge,
      raw: r.raw,
      findings: r.findings,
      attrs: r.attrs,
    };
  }
}

module.exports = { TraefikViewModel };
