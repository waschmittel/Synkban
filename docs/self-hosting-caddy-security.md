# Self-Hosting Synkban behind Caddy + `caddy-security` (cookie session login)

This guide sets up Synkban behind a [Caddy](https://caddyserver.com/) reverse proxy that uses the
[`caddy-security`](https://github.com/greenpau/caddy-security) plugin to provide a **login form** and a
**long-lived session cookie**. Authenticate once, get a signed JWT cookie, stay logged in across browser
restarts, and get a real **Log out** action.

It serves **plain HTTP** — no TLS is configured. See the [security model](#security-model) before exposing this anywhere.

> Why a plugin? Synkban's web server has **no authentication of its own** (single-user MVP). The stock Caddy
> build only offers stateless HTTP Basic Auth (no cookie, no logout). `caddy-security` adds the session/cookie
> layer.

---

## Security model

- **Synkban has zero auth.** Anyone who reaches its port `8080` has full read/write to every board. It must
  stay on an internal Docker network with **no published ports**. Caddy is the only thing the outside world
  talks to.
- **No HTTPS here.** Plain HTTP sends the login credentials and the session cookie in the clear. The cookie is
  therefore **not** marked `Secure`. Only run this on a trusted network: a LAN, a VPN (WireGuard/Tailscale), or
  behind a separate TLS-terminating layer you already operate (upstream load balancer, `cloudflared` tunnel,
  etc.). **Do not expose port 80 directly to the public internet.**
- **No per-user data.** Synkban has no concept of users, so every authenticated person shares the same board
  set. The portal controls *who gets in*, not *what they can see*.

---

## Prerequisites

- Docker + Docker Compose.
- A hostname that resolves to this machine on your trusted network (e.g. `kanban.example.com`, or just use
  `localhost` for a single-machine trial).
- The Synkban source (this repo) to build the image, or your own pre-built Synkban image.

---

## Step 1 — Project directory

Create a working directory with these files (all created in the steps below):

```
synkban-deploy/
├── docker-compose.yml
├── Caddy.Dockerfile
└── Caddyfile
```

If you are building Synkban from source, run these from the repo root (so `build:` can find the Synkban
`Dockerfile`), or set the Synkban `image:` to a pre-built image and put the deploy files anywhere.

---

## Step 2 — Build a Caddy image with the plugin

The stock `caddy` image does not include `caddy-security`. Build a custom image with
[`xcaddy`](https://github.com/caddyserver/xcaddy) (the official Caddy build tool, available as a builder image).

Create **`Caddy.Dockerfile`**:

```dockerfile
FROM caddy:2-builder AS builder
RUN xcaddy build --with github.com/greenpau/caddy-security

FROM caddy:2-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
```

The first stage compiles a `caddy` binary with the plugin baked in; the second stage drops it into the slim
runtime image.

---

## Step 3 — `docker-compose.yml`

Create **`docker-compose.yml`**:

```yaml
services:
  synkban:
    # Build from this repo, or replace with your pre-built image.
    build: .
    # image: synkban:latest
    restart: unless-stopped
    environment:
      HOST: "0.0.0.0"   # listen on all interfaces *within the internal network*
      PORT: "8080"
      DATA_DIR: "/app/data"
    volumes:
      - synkban-data:/app/data
    networks:
      - internal
    # NOTE: no `ports:` — Synkban is NOT reachable from the host or internet.
    read_only: true
    tmpfs:
      - /tmp
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL

  caddy:
    build:
      context: .
      dockerfile: Caddy.Dockerfile
    restart: unless-stopped
    depends_on:
      - synkban
    ports:
      - "80:80"     # HTTP only — no TLS configured here
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data        # holds users.json + signing keys — back this up
      - caddy-config:/config
    networks:
      - internal
    security_opt:
      - no-new-privileges:true

networks:
  internal:
    driver: bridge

volumes:
  synkban-data:    # all your boards (JSON) — back this up
  caddy-data:      # caddy-security user DB + crypto keys — back this up
  caddy-config:
```

Key points:

- **Synkban has no `ports:`** — it is only reachable from inside the `internal` network.
- The `caddy-data` volume persists the `caddy-security` user database (`users.json`) and signing keys. **Losing
  it logs everyone out and deletes your portal users.** Back it up alongside `synkban-data`.

---

## Step 4 — `Caddyfile`

Create **`Caddyfile`**:

```caddyfile
{
    # Register the plugin's directives in the request-handling order.
    order authenticate before respond
    order authorize before reverse_proxy

    security {
        # Local user database, stored as JSON inside the caddy-data volume.
        local identity store localdb {
            realm local
            path /data/users.json
        }

        # Login portal. The cookie + token lifetime is what makes the session "long-lived".
        authentication portal myportal {
            crypto default token lifetime 2592000   # JWT valid for 30 days (seconds)
            cookie lifetime 2592000                  # browser keeps the cookie 30 days
            enable identity store localdb
        }

        # Who is allowed through after logging in.
        authorization policy gate {
            set auth url /auth/oauth2/local
            allow roles authp/user authp/admin
        }
    }
}

# `http://` (or a bare `:80`) makes Caddy serve plain HTTP and skip automatic HTTPS.
http://kanban.example.com {
    # Login / logout / portal pages live under /auth.
    route /auth* {
        authenticate with myportal
    }

    # Everything else needs the session cookie. Unauthenticated requests
    # are redirected to /auth to log in.
    route {
        authorize with gate
        reverse_proxy synkban:8080
    }

    encode gzip
}
```

Adjust:

- Replace `kanban.example.com` with your hostname. For a single-machine trial use `http://localhost`.
- Change the two `2592000` values (seconds) to set how long the session lasts. `2592000` = 30 days;
  `604800` = 7 days; `31536000` = 1 year.

---

## Step 5 — Start it

```bash
docker compose up -d --build
```

The `--build` flag builds both the Synkban image and the custom Caddy image. Watch the logs for the
auto-generated admin credentials on first run:

```bash
docker compose logs -f caddy
```

On first start `caddy-security` creates a default admin user in `/data/users.json` and prints its username and
a generated password to the log. Note them down.

---

## Step 6 — Log in and create your users

1. Open `http://kanban.example.com/auth` (or `http://localhost/auth`).
2. Log in with the admin credentials from the Caddy log.
3. Use the portal's user-management screens to **change the admin password** and add your own user accounts
   (assign the `authp/user` or `authp/admin` role so the `gate` policy lets them through).
4. Visit `http://kanban.example.com/` — you are redirected to the portal if not logged in; once authenticated
   the session cookie is set and Synkban loads. The cookie persists for the lifetime you configured, so you
   stay logged in across browser restarts. Use the portal's **Log out** to end the session early.

---

## Maintenance

- **Backups:** snapshot both `synkban-data` (your boards) and `caddy-data` (users + signing keys) volumes.
- **Updates:** rebuild to pick up new Synkban/Caddy/plugin versions:
  ```bash
  docker compose build --no-cache
  docker compose up -d
  ```
- **Rotate the signing key / force-logout everyone:** delete the keys in the `caddy-data` volume and restart
  Caddy (existing cookies become invalid).
- **Firewall:** restrict port 80 to your trusted network only.

---

## Troubleshooting

- **`unknown directive: authenticate`** — Caddy is running without the plugin. Confirm the `caddy` service uses
  `Caddy.Dockerfile` (not the stock `caddy:2-alpine` image) and rebuild with `--no-cache`.
- **Redirect loop / always sent to /auth** — the user's role doesn't match the `allow roles` in the `gate`
  policy. Give the account `authp/user` or `authp/admin`.
- **Can't find the first-run password** — it's printed once to the Caddy log on the first start with an empty
  `users.json`. If you missed it, stop Caddy, delete `users.json` from the `caddy-data` volume, and restart to
  regenerate.
- **Logged out unexpectedly** — the `caddy-data` volume (signing keys) was recreated, or the token lifetime
  elapsed.
