#!/usr/bin/env bash
# =============================================================================
#  OpenPortal — Update Script
#  Run after `git pull` to rebuild and restart services.
#  Usage: bash update.sh [--docker | --bare-metal]
# =============================================================================

set -euo pipefail

BOLD='\033[1m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${GREEN}  ✓${NC}  $*"; }
warn()  { echo -e "${YELLOW}  !${NC}  $*"; }
error() { echo -e "\033[0;31m  ✗${NC}  $*" >&2; exit 1; }
step()  { echo -e "\n${BOLD}${BLUE}▸${NC}${BOLD} $*${NC}"; }

# ── Resolve repo root ─────────────────────────────────────────────────────────
if command -v realpath &>/dev/null; then
  SCRIPT_DIR="$(cd "$(dirname "$(realpath "${BASH_SOURCE[0]}")")" && pwd)"
else
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi
REPO_ROOT="$SCRIPT_DIR"

[[ -f "$REPO_ROOT/docker-compose.yml" ]] || error "Run from the OpenPortal repo root."

# ── Banner ────────────────────────────────────────────────────────────────────
echo -e "${BOLD}"
echo "  ╔═══════════════════════════════════════════╗"
echo "  ║         OpenPortal — Update                ║"
echo "  ╚═══════════════════════════════════════════╝"
echo -e "${NC}"

# ── Detect mode ───────────────────────────────────────────────────────────────
MODE="${1:-}"
case "$MODE" in
  --docker)     MODE="docker"     ;;
  --bare-metal) MODE="bare-metal" ;;
  --help|-h)
    echo "Usage: bash update.sh [--docker | --bare-metal]"
    exit 0 ;;
  "")
    if command -v docker &>/dev/null && docker compose -f "$REPO_ROOT/docker-compose.yml" ps 2>/dev/null | grep -q "Up\|running"; then
      MODE="docker"
    elif systemctl is-active --quiet openportal 2>/dev/null; then
      MODE="bare-metal"
    else
      echo -e "  ${CYAN}?${NC}  How is OpenPortal running?\n"
      echo "  1) Docker Compose"
      echo "  2) Bare-metal (systemd)"
      read -rp "$(echo -e "  ${CYAN}›${NC}  Choice [1-2]: ")" choice
      case "$choice" in
        1) MODE="docker"     ;;
        2) MODE="bare-metal" ;;
        *) error "Invalid choice" ;;
      esac
    fi
    info "Detected: $MODE" ;;
  *) error "Unknown flag: $1" ;;
esac

# ── Show what changed ─────────────────────────────────────────────────────────
step "Changes in this update"
git -C "$REPO_ROOT" log --oneline HEAD@{1}..HEAD 2>/dev/null | head -10 || \
  git -C "$REPO_ROOT" log --oneline -5 2>/dev/null || true

# ── Docker ────────────────────────────────────────────────────────────────────
if [[ "$MODE" == "docker" ]]; then
  if docker compose version &>/dev/null 2>&1; then COMPOSE="docker compose"
  else COMPOSE="docker-compose"; fi

  step "Rebuilding images"
  cd "$REPO_ROOT"
  $COMPOSE build --parallel

  step "Restarting services"
  $COMPOSE up -d

  info "Done. Logs: $COMPOSE logs -f"
  exit 0
fi

# ── Bare-metal ────────────────────────────────────────────────────────────────
[[ "$EUID" -ne 0 ]] && error "Bare-metal update requires root: sudo bash update.sh --bare-metal"

GO_BIN=$(command -v go 2>/dev/null || echo "/usr/local/go/bin/go")
[[ -x "$GO_BIN" ]] || error "Go not found. Run setup.sh first."
NODE_BIN=$(command -v node 2>/dev/null) || error "Node not found. Run setup.sh first."
info "Go:   $($GO_BIN version | awk '{print $3}')"
info "Node: $($NODE_BIN --version)"

# ── Backend ───────────────────────────────────────────────────────────────────
step "Building backend"
cd "$REPO_ROOT/backend"
GOPATH=/tmp/go-cache "$GO_BIN" mod tidy
CGO_ENABLED=0 GOPATH=/tmp/go-cache "$GO_BIN" build -ldflags="-s -w" -o /tmp/openportal-new ./cmd/server
info "Binary compiled"

# ── Frontend ──────────────────────────────────────────────────────────────────
step "Building frontend"
cd "$REPO_ROOT/frontend"
rm -rf node_modules package-lock.json
npm install
VITE_API_URL="" npm run build
[[ -d dist ]] || error "Build failed — no dist/ folder produced"
info "Frontend built"

# ── Deploy ────────────────────────────────────────────────────────────────────
step "Deploying"

systemctl stop openportal

cp -r "$REPO_ROOT/backend/migrations/"* /opt/openportal/migrations/
mv /tmp/openportal-new /opt/openportal/openportal
chown openportal:openportal /opt/openportal/openportal
chmod 755 /opt/openportal/openportal

rm -rf /var/www/openportal/*
cp -r "$REPO_ROOT/frontend/dist/"* /var/www/openportal/
chown -R www-data:www-data /var/www/openportal 2>/dev/null || \
  chown -R nginx:nginx /var/www/openportal 2>/dev/null || true

systemctl start openportal
info "Service restarted"

# Update nginx config if it changed
if [[ -f "$REPO_ROOT/deploy/nginx.conf" ]]; then
  NGINX_CONF=""
  if [[ -d /etc/nginx/sites-available ]]; then
    NGINX_CONF="/etc/nginx/sites-available/openportal"
  elif [[ -d /etc/nginx/conf.d ]]; then
    NGINX_CONF="/etc/nginx/conf.d/openportal.conf"
  fi
  if [[ -n "$NGINX_CONF" && -f "$NGINX_CONF" ]]; then
    # Preserve the server_name from the existing config
    SERVER_NAME=$(grep "server_name" "$NGINX_CONF" 2>/dev/null | head -1 | awk '{print $2}' | tr -d ';' || echo "localhost")
    sed "s/proxy\.yourcompany\.com/${SERVER_NAME}/g"       "$REPO_ROOT/deploy/nginx.conf" > "$NGINX_CONF" 2>/dev/null || true
  fi
fi
nginx -t &>/dev/null && systemctl reload nginx && info "nginx reloaded" || true

echo ""
info "Update complete — journalctl -u openportal -f"
