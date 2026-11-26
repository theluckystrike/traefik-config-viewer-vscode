'use strict';
module.exports = {
  prefix: 'zovoTraefik',
  triesKey: 'zovoTraefik.proTrial',
  slot: '#protools',
  tools: [
    { id: 'auditSecurity', title: 'Audit Traefik TLS, dashboard and routing', command: 'zovoTraefik.auditSecurity' },
    { id: 'diffConfigs', title: 'Compare two Traefik config files', command: 'zovoTraefik.diffConfigs' },
    { id: 'exportRouteMap', title: 'Export Mermaid route map and inventory', command: 'zovoTraefik.exportRouteMap' },
  ],
};
