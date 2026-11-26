# Traefik Route & TLS Viewer for VS Code

Inspect `traefik.yml`, `traefik.yaml`, `traefik.toml`, `*.traefik.yml` and `*.traefik.yaml` reverse-proxy files in VS Code without running a Traefik server or making network calls. Production Traefik configs split entryPoints, HTTP and TCP routers, middlewares, backend services and ACME TLS certResolvers across nested YAML or TOML blocks where `api.insecure: true`, `insecureSkipVerify: true`, missing HTTPS redirects, unauthenticated dashboards or plaintext middleware credentials are easy to miss. This extension parses Traefik configs locally in plain JavaScript with zero shell or cloud calls.

![Traefik Route & TLS Viewer showing entryPoints, HTTP/TCP routers, middlewares, services, TLS certResolvers and static security findings](images/screenshot.png)

## What it opens

- `traefik.yml`, `traefik.yaml`, `traefik.toml`, `*.traefik.yml` and `*.traefik.yaml` files.
- Any open Traefik config file via the Command Palette or Explorer context menu (Open in Traefik Route & TLS Viewer).
- Nothing to install, no Traefik binary required, no network or cloud calls.

## The free part

- EntryPoints and TLS certResolver explorer: lists every entryPoint address, HTTPS redirection target, ACME email, storage path and challenge type (`httpChallenge`, `tlsChallenge`, `dnsChallenge`).
- HTTP and TCP router table: maps router rules, entryPoints, attached middlewares, target services and TLS settings in one searchable grid.
- Middleware and service inspector: surfaces load-balancer server URLs, middleware types and masked credential warnings with line numbers.
- Static security findings: flags `api.insecure: true`, `insecureSkipVerify: true`, HTTP entryPoints missing an HTTPS redirect, dashboards exposed without auth middleware, and plaintext middleware credentials.

## The Pro tools, with 1 free try

Pro adds the audit, diff and export steps: generate a Markdown Traefik TLS, dashboard and routing audit for one file or a folder, compare two Traefik config files in Markdown for entryPoint, router, service and finding changes, or export a Mermaid routing diagram plus Markdown and CSV router/service inventory locally. Your first try of each Pro tool is free. Zovo Pro is USD 19 once, and the team licence is USD 59.

## Why not plain text

Scanning a nested 400-line `traefik.yml` or `traefik.toml` in plain text hides whether a dashboard router has an auth middleware attached or whether `serversTransport` sets `insecureSkipVerify: true`. A local viewer puts entryPoints, routers, middlewares, services, TLS certResolvers and security findings on one screen.

## More tools by Zovo

See full docs and install options at [vscode.zovo.one/extensions/zovo-traefik-config-viewer/](https://vscode.zovo.one/extensions/zovo-traefik-config-viewer/), browse all Zovo VS Code extensions at [vscode.zovo.one](https://vscode.zovo.one/), or explore [Zovo Pro](https://vscode.zovo.one/pro/).
