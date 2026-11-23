# No CORS; a Host/Origin guard rejects cross-site and DNS-rebinding requests

Both servers run every request through `guard::middleware` (`backend/src/guard.rs`) and send no CORS headers. A request is rejected with 403 when:

- its `Host` is not in the allow-list (DNS rebinding), or
- it is a mutation (anything but `GET`/`HEAD`/`OPTIONS`) whose `Origin` is present and neither the request's own `Host` nor in the allow-list (cross-site request, including `Origin: null`).

Comparison is on lower-case host names; ports are ignored. Requests without `Host` or `Origin` (curl, scripts) pass.

## Why

Web mode has no authentication. With `allow_any_origin()` CORS, any page the user visited could read every board and attachment from `localhost:8080` and archive and delete them, or point `data_dir` at an attacker share. Removing CORS stops cross-origin reads; the `Origin` check stops blind writes (`text/plain` form posts, raw-body attachment uploads); the `Host` check stops a rebound attacker domain from becoming same-origin. The UI is same-origin and the Vite dev server proxies `/api`, so nothing needs CORS.

## Rules

- **Allow-list** (`AllowedHosts::for_web`): always `localhost`, `127.0.0.1`, `::1`; plus `ALLOWED_HOSTS` (comma-separated, `*` = any `Host`). Unset, a loopback `HOST` is loopback-only, a concrete `HOST` adds itself, and `0.0.0.0`/`::` (the Docker image) allows any `Host`, so LAN/proxy setups keep working; mutations then still need a same-host or listed `Origin`. Set `ALLOWED_HOSTS` to the public name behind a reverse proxy to get rebinding protection there too, and when the proxy rewrites `Host`.
- **Desktop mode** uses the loopback list in front of the token check (ADR-0003).
- Never re-add CORS middleware. A cross-origin client that needs the API must be same-origin via a proxy.

## Considered and rejected

- **CORS limited to a configured origin.** Nothing legitimate is cross-origin.
- **Token auth in web mode.** Breaks bookmarks, PWA installs and the reverse-proxy setups (`docs/docker/`), which already authenticate in front.
- **`Sec-Fetch-Site`.** Not sent by every client the app supports; `Origin` is.
