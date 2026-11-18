# Self-Hosting Synkban as a PWA (Docker, Traefik & Tinyauth)

Each Synkban release publishes a multi-arch (`linux/amd64`, `linux/arm64`) Docker image to `ghcr.io/waschmittel/synkban`. The container runs the unauthenticated Synkban server directly on port `8080` so you can place it behind your own reverse proxy or run it on a private network.

## Standalone Container (Local / Private Network)

For local use, Tailscale, or behind an existing reverse proxy:

```sh
docker run -d \
  --name synkban \
  -p 127.0.0.1:8080:8080 \
  -e DATA_DIR=/data \
  -v /path/on/host/data:/data \
  -v /path/on/host/config:/app/config \
  ghcr.io/waschmittel/synkban:latest
```

### Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `DATA_DIR` | `/app/data` | Directory where boards, cards, and attachments are stored |
| `SYNKBAN_CONFIG_DIR` | `/app/config` | Directory for `synkban.toml` (settings) and `draft.json` (crash recovery) |
| `HOST` | `0.0.0.0` | Bind address inside the container |
| `PORT` | `8080` | Bind port inside the container |

> **Note:** The container runs as non-root user `app` (UID `10001`). Make sure host-mounted directories are writable by UID `10001` (e.g. `chown -R 10001:10001 ./data ./config`).

---

## Internet-Facing PWA with Traefik + Tinyauth

For internet-facing deployments with persistent, single-prompt login that feels like a native app, use the example [`docker-compose.yml`](docker-compose.yml) in this directory. It pairs Synkban with **Traefik** (automatic HTTPS via Let's Encrypt) and **Tinyauth** (`forwardAuth`).

### 1. Prepare Directories & `.env`

```sh
cd docs/docker
cp .env.example .env
mkdir -p data config
sudo chown -R 10001:10001 data config
```

Generate a Tinyauth user password hash:

```sh
docker run --rm ghcr.io/tinyauthapp/tinyauth:v5 user create --interactive
```

Edit `.env` and set:
- `SYNKBAN_DOMAIN` & `TINYAUTH_DOMAIN` — **must share the same parent domain** (e.g. `synkban.example.com` and `auth.example.com`) so Tinyauth's session cookie on `.example.com` authenticates Synkban.
- `ACME_EMAIL` — your email for Let's Encrypt TLS certificates.
- `TINYAUTH_USERS` — the `user:hash` output from `tinyauth user create`.
- `SYNKBAN_HOST_DATA_DIR` / `SYNKBAN_HOST_CONFIG_DIR` — host paths for your boards and settings.

### 2. Start the Stack

```sh
docker compose up -d
```

### 3. Install as a PWA

Open `https://<SYNKBAN_DOMAIN>`, sign in once, and install:
- **Desktop (Chrome / Edge / Brave)**: Click the **Install Synkban** icon in the address bar.
- **Android (Chrome)**: Menu → **Install app** / **Add to Home screen**.
- **iOS / iPadOS (Safari)**: Share → **Add to Home Screen**.

### Why It Prompts Once & Remembers Login

1. **Long-lived session cookie**: `TINYAUTH_AUTH_SESSIONEXPIRY` is set to `31536000` (1 year) with `TINYAUTH_AUTH_SESSIONMAXLIFETIME=0` and `TINYAUTH_AUTH_SECURE=true`, so the session survives closing the app and restarting your device.
2. **iOS standalone cookie jar**: On iOS, Home Screen PWAs have a separate cookie store from Safari. After adding Synkban to your Home Screen, launch it from the Home Screen icon and sign in **once** inside the app — subsequent launches reuse that persistent cookie automatically.

### Why PWA Metadata Paths Bypass Auth

The `synkban-pwa` Traefik router (priority `100`, no `tinyauth` middleware) exposes only static PWA metadata without authentication:

- `/manifest.webmanifest`
- `/sw.js`
- `/favicon.png`
- `/apple-touch-icon.png`
- `/icons/*`

Mobile OS installers (Android WebAPK builder, iOS Home Screen icon fetcher) and browser Service Worker update checks fetch these files outside the authenticated tab context. Excluding them prevents `302` login redirects from breaking the app icon or manifest, while `/` and `/api/*` remain strictly behind Tinyauth.

---

## Building the Image Locally

From the repository root:

```sh
./docker-build.sh            # defaults to synkban:latest
./docker-build.sh myapp 1.0  # custom name:tag
# or directly:
docker build -t synkban .
```

The `Dockerfile` is a multi-stage build:

1. **node:22** — builds the frontend
2. **rust:1.99.1** — copies `frontend/dist` into `static/` and compiles the backend with embedded assets
3. **debian:bookworm-slim** — minimal runtime image with just the binary
