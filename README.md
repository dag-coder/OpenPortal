# OpenPortal

**One place for all your internal tools — with built-in access control, private networking, and automatic sign-in.**

OpenPortal is a self-hosted dashboard that gives your team a single URL to reach every internal tool — Grafana, Kibana, Jupyter, custom admin panels, anything with a web UI. You control who sees what, sensitive tools stay off the public internet, and users never have to manage passwords for individual services.

> **Self-hosted.** Your data, your server, no cloud vendor.

---

## What it does

Think of OpenPortal as a secure front door for all your internal web applications.

Without OpenPortal, your team bookmarks a dozen different URLs, each with its own login. Some tools are only reachable on the office VPN. Credentials get shared over Slack. New employees spend their first day asking "how do I get access to X?"

With OpenPortal:
- Every tool shows up in a single dashboard, filtered to what the user is allowed to see.
- Users click a tool and are automatically signed in — no separate credentials to remember.
- Tools that should never be on the public internet are kept inside a private WireGuard tunnel. They're only reachable *through* OpenPortal.
- Access is controlled by roles. Give someone the "DevOps" role and they instantly see all DevOps tools.

---

## How it works

```
User's browser → OpenPortal → (WireGuard tunnel) → Private tool server
```

1. A user signs in to OpenPortal with their account (optional two-factor authentication supported).
2. They see a grid of tools their role permits them to access.
3. Clicking a tool routes them through OpenPortal's reverse proxy, which silently injects the tool's credentials (password, API token, or cookie) into the request.
4. If the tool is marked "private", traffic travels through an encrypted WireGuard tunnel — the tool server never needs a public IP.

All credential storage is AES-256 encrypted at rest. Session tokens are short-lived JWTs. Every login attempt and admin action is written to an immutable audit log.

---

## Features

| Area | What's included |
|---|---|
| **Dashboard** | Tool grid with live status indicators, category filter, search |
| **Access control** | Roles → tools mapping; assign users to roles |
| **Credential vault** | Per-tool credentials stored encrypted; injected automatically at proxy time |
| **Private networking** | WireGuard VPN — tools can live on servers with no public internet exposure |
| **Two-factor auth** | TOTP (authenticator app) per user, optional |
| **Security hardening** | Auto-ban after failed logins, IP firewall, structured audit log |
| **Admin panel** | Manage tools, users, roles, WireGuard peers, firewall rules |
| **Zero-downtime updates** | `bash update.sh` rebuilds and restarts with no manual steps |
| **PWA / installable** | Works as an installable app on desktop and mobile via the browser |

---

## Quick setup

### The easy way — interactive setup script

Run this on your server and follow the prompts:

```bash
git clone https://github.com/your-org/openportal.git
cd openportal
bash setup.sh
```

The script detects your environment and walks you through everything — it generates all secrets, configures the database, sets up WireGuard, and starts the service. No manual configuration required.

**Three deployment modes are available:**

| Mode | Best for | Requirements |
|---|---|---|
| **Docker Compose** | Any server, easiest path | Docker installed |
| **Bare-metal** | VPS or dedicated Linux server | Ubuntu, Debian, Fedora, or Arch; sudo access |
| **Dev mode** | Local development | Go 1.22+, Node.js 20+, PostgreSQL |

You can also skip the interactive menu with a flag:

```bash
bash setup.sh --docker       # Docker Compose
bash setup.sh --bare-metal   # Direct system install (requires sudo)
bash setup.sh --dev          # Local development setup
bash setup.sh --uninstall    # Remove a bare-metal installation
```

After setup, log in with the admin email and password you chose. The first thing to do is add your tools in the **Tools** tab.

---

### Manual Docker Compose setup

If you prefer to configure things yourself:

```bash
git clone https://github.com/your-org/openportal.git
cd openportal
cp .env.example .env
```

Edit `.env` and fill in the required values (marked below), then:

```bash
docker compose up -d
```

Open `http://your-server:5173` in a browser.

---

## Connecting private tools (WireGuard)

If you have tools on servers that shouldn't have a public IP (internal databases, admin panels, staging environments), mark those tools as **Private** in the tool settings. OpenPortal will route traffic through an encrypted WireGuard tunnel.

**To add a private server:**

1. In the admin panel, go to **WireGuard** and click **Add private host**.
2. Follow the 5-step wizard — it walks you through opening the firewall port, installing WireGuard on the host, generating keys, and downloading a pre-filled config file.
3. Drop the config file on the host, fill in the private key, then run:
   ```bash
   sudo systemctl enable --now wg-quick@wg0
   ```
4. The host shows as **Connected** in the dashboard within a minute.

> The server's WireGuard private key is auto-generated on first boot. You don't need to generate or manage it manually.

---

## Updating

After pulling new code, a single command handles everything:

```bash
git pull
bash update.sh
```

This rebuilds the backend binary and frontend bundle, applies any database migrations, and restarts the service — all automatically. It detects whether you're running Docker or bare-metal.

---

## Configuration

`setup.sh` generates and writes all of these automatically. If you are configuring manually, copy `.env.example` to `.env`.

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `JWT_SECRET` | ✅ | Signs session tokens — generate with `openssl rand -base64 48` |
| `MASTER_KEY` | ✅ | AES-256 key for the credential vault — generate with `openssl rand -hex 32` |
| `ADMIN_EMAIL` | ✅ | Initial admin account email |
| `ADMIN_PASSWORD` | ✅ | Initial admin password (min 8 characters) |
| `WG_PUBLIC_ENDPOINT` | ✅ | Your server's public IP or hostname — used in WireGuard peer configs |
| `WG_LISTEN_PORT` | | WireGuard UDP port (default: random high port generated at setup time) |
| `WG_INTERFACE` | | WireGuard interface name (default: `wg0`) |
| `WG_SERVER_IP` | | VPN server address (default: `10.10.0.1`) |
| `WG_SUBNET` | | VPN subnet (default: `10.10.0.0/24`) |
| `PORT` | | API server port (default: `8080`) |
| `FRONTEND_URL` | | URL of the frontend, for CORS (default set by setup script) |
| `JWT_EXPIRY_HOURS` | | Session length in hours (default: `8`) |

---

## Troubleshooting

### The app won't start / backend won't connect

- Check logs: `docker compose logs backend` (Docker) or `journalctl -u openportal -f` (bare-metal).
- Confirm PostgreSQL is running and `DATABASE_URL` is correct.
- Make sure `ADMIN_EMAIL` and `ADMIN_PASSWORD` are both set in `.env` — the server won't start without them.

### I can't log in

- Double-check the admin email and password you set during setup.
- If you forgot the password, stop the service, change `ADMIN_PASSWORD` in `.env`, and restart — the admin account is re-seeded on startup.

### A tool shows "Offline"

- OpenPortal health-checks each tool's URL every 30 seconds.
- Verify the URL in the tool settings is correct and reachable *from the OpenPortal server* (not just your laptop).
- If the tool is private, confirm the WireGuard peer is connected (green dot in the WireGuard tab).

### WireGuard peer won't connect

1. Confirm the UDP port is open on the OpenPortal server:
   ```bash
   sudo ufw allow <WG_LISTEN_PORT>/udp
   sudo ufw reload
   ```
2. Check `WG_PUBLIC_ENDPOINT` in `.env` is set to a reachable public IP or hostname — `localhost` won't work for remote hosts.
3. On the peer host, run `sudo wg show` and look for a `latest handshake` line. If it's missing, the host can't reach the server's endpoint.
4. If a peer was just added, force a sync on the OpenPortal server:
   ```bash
   sudo wg syncconf wg0 <(wg-quick strip /etc/wireguard/wg0.conf)
   ```

### Credentials aren't being injected

- Make sure the tool has credentials configured in the tool's settings (Basic Auth, Bearer token, or cookie).
- Check that `MASTER_KEY` hasn't changed since the credentials were saved — changing it makes stored credentials unreadable.

### Auto-ban is blocking legitimate logins

- Check the ban list in **Admin → Security → Auto-Ban**.
- Unban an IP from the same panel, or restart fail2ban: `sudo systemctl restart fail2ban`.

---

## Compatibility

### Server (where OpenPortal runs)

| Platform | Docker mode | Bare-metal |
|---|---|---|
| Ubuntu 22.04 / 24.04 | ✅ | ✅ |
| Debian 11 / 12 | ✅ | ✅ |
| Fedora 38+ / RHEL 9+ | ✅ | ✅ |
| Arch Linux | ✅ | ✅ |
| macOS (Apple Silicon / Intel) | ✅ (Docker Desktop) | Development only |
| Windows | ✅ (Docker Desktop + WSL2) | Not supported |

Minimum specs: **1 vCPU, 512 MB RAM, 2 GB disk**. PostgreSQL 14+ required.

### Private tool hosts (WireGuard peers)

Any Linux server with kernel 5.6+ (WireGuard is built in). For older kernels, install the `wireguard` kernel module separately. Tested on Ubuntu, Debian, Fedora, and Arch.

### Browser (dashboard users)

Any modern browser: Chrome 100+, Firefox 100+, Safari 16+, Edge 100+. The dashboard is also installable as a PWA from any of these browsers.

---

## Technical details

### Architecture

```
openportal/
├── frontend/          # Vite + React 18 SPA / PWA
│   ├── src/
│   │   ├── pages/     # Dashboard, Login, Admin (Tools, Users, Roles, WireGuard, Security, Settings)
│   │   ├── components/# Shared UI components
│   │   └── lib/       # API client, auth store
│   ├── src-tauri/     # Optional Tauri desktop wrapper
│   └── capacitor.config.ts  # Optional Capacitor mobile wrapper
│
├── backend/           # Go 1.22 — single binary
│   └── internal/
│       ├── api/       # HTTP routes (Chi router)
│       ├── auth/      # JWT, TOTP, session management
│       ├── proxy/     # Reverse proxy + credential injection
│       ├── wireguard/ # wg0.conf management, peer registration
│       ├── banmanager/# Auto-ban (failed logins → fail2ban)
│       └── db/        # PostgreSQL (pgx/v5), auto-migrations
│
└── deploy/
    ├── docker-compose.yml
    ├── openportal.service   # systemd unit
    └── nginx.conf           # Reverse proxy for bare-metal
```

### Security design

- **Credential encryption**: AES-256-GCM with a key never stored in the database. The `MASTER_KEY` env var is the only decryption key.
- **Session tokens**: HS256 JWTs with configurable expiry (default 8 hours). Tokens are invalidated on logout.
- **WireGuard**: Server private key auto-generated using the kernel's `wg genkey`. Peer configs are generated server-side and never transmitted over plaintext.
- **WireGuard port**: A random port in the 49152–65535 range is chosen at setup time (security through obscurity on top of cryptographic authentication).
- **Auto-ban**: 5 failed logins within 10 minutes → 30-minute IP ban. Applied at both the application layer (in-memory + database) and the OS level (fail2ban → iptables).
- **Audit log**: Every login, logout, tool access, and admin action is written to `audit_logs` with timestamp, IP, user, and action type.
- **Hardening** (bare-metal, via `setup.sh --bare-metal`): UFW firewall, sysctl network hardening (IP forwarding only for WireGuard, SYN cookies, RP filter), automatic security updates, fail2ban with OpenPortal-specific filter.

### Database

PostgreSQL 14+. Schema migrations run automatically on server startup — no migration tool or manual SQL required. The schema lives in `backend/internal/db/migrations/`.

### Proxy behaviour

OpenPortal acts as an authenticating reverse proxy. For each tool:
- The user's session is verified (JWT + RBAC).
- Stored credentials are decrypted and injected into the upstream request as a `Authorization: Basic …`, `Authorization: Bearer …`, or `Cookie:` header.
- The upstream response is streamed back to the browser. WebSocket upgrades are supported.
- Private tools are reached via the WireGuard tunnel IP (e.g. `10.10.0.x`), never directly from the internet.

---

## License

MIT — do whatever you want with it. Pull requests welcome.
