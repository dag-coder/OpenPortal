#!/usr/bin/env bash
# =============================================================================
#  OpenPortal — Universal Setup Script
#  Supports: Docker Compose · bare-metal (Ubuntu/Debian/Fedora/Arch) · dev mode
#  Usage: bash setup.sh [--docker | --bare-metal | --dev | --uninstall]
# =============================================================================

set -euo pipefail
IFS=$'\n\t'

# ── Formatting ────────────────────────────────────────────────────────────────
BOLD='\033[1m'; DIM='\033[2m'
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'

info()   { echo -e "${GREEN}  ✓${NC}  $*"; }
warn()   { echo -e "${YELLOW}  !${NC}  $*"; }
error()  { echo -e "${RED}  ✗${NC}  $*" >&2; exit 1; }
step()   { echo -e "\n${BOLD}${BLUE}▸${NC}${BOLD} $*${NC}"; }
detail() { echo -e "     ${DIM}$*${NC}"; }

banner() {
  echo -e "${BOLD}"
  echo "  ╔═══════════════════════════════════════════╗"
  echo "  ║           OpenPortal  Setup                ║"
  echo "  ║   Centralized tool access dashboard       ║"
  echo "  ╚═══════════════════════════════════════════╝"
  echo -e "${NC}"
}

# ── Globals ───────────────────────────────────────────────────────────────────
if command -v realpath &>/dev/null; then
  SCRIPT_DIR="$(cd "$(dirname "$(realpath "${BASH_SOURCE[0]}")")" && pwd)"
else
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi
REPO_ROOT="$SCRIPT_DIR"
LOG_FILE="$REPO_ROOT/setup.log"
SETUP_MODE=""
DOMAIN=""; ADMIN_EMAIL=""; ADMIN_PASSWORD=""; DB_PASSWORD=""
JWT_SECRET=""; MASTER_KEY=""; WG_PRIVATE_KEY=""; WG_PUBLIC_KEY=""
WG_PUBLIC_ENDPOINT=""
PORT_API=8080; PORT_FRONTEND=5173
# Random WireGuard port in the high ephemeral range (49152–65535) for security by obscurity
WG_PORT=$(( RANDOM % 16383 + 49152 ))
FRONTEND_URL=""; DB_HOST="localhost"

exec 2> >(tee -a "$LOG_FILE" >&2)
echo "=== OpenPortal setup $(date) ===" >> "$LOG_FILE"

# ── Helpers ───────────────────────────────────────────────────────────────────

confirm() {
  read -rp "$(echo -e "     ${CYAN}?${NC}  ${1:-Continue?} [y/N] ")" _a
  [[ "$_a" =~ ^[Yy]$ ]]
}

prompt() {
  local var="$1" label="$2" default="${3:-}" hint=""
  [[ -n "$default" ]] && hint=" (${DIM}default: $default${NC})"
  read -rp "$(echo -e "     ${CYAN}›${NC}  ${label}${hint}: ")" _v
  printf -v "$var" '%s' "${_v:-$default}"
}

prompt_secret() {
  local var="$1" label="$2"
  read -rsp "$(echo -e "     ${CYAN}›${NC}  ${label}: ")" _v; echo
  printf -v "$var" '%s' "$_v"
}

prompt_secret_confirm() {
  local var="$1" label="$2" _v1 _v2
  while true; do
    read -rsp "$(echo -e "     ${CYAN}›${NC}  ${label}: ")" _v1; echo
    read -rsp "$(echo -e "     ${CYAN}›${NC}  Confirm ${label}: ")" _v2; echo
    if [[ "$_v1" == "$_v2" ]]; then
      printf -v "$var" '%s' "$_v1"
      break
    fi
    warn "Passwords do not match — please try again."
  done
}

check_port() {
  ! lsof -Pi ":$1" -sTCP:LISTEN -t &>/dev/null 2>&1
}

detect_os() {
  if [[ -f /etc/os-release ]]; then
    # shellcheck disable=SC1091
    . /etc/os-release; echo "${ID:-unknown}"
  elif [[ "$(uname)" == "Darwin" ]]; then echo "macos"
  else echo "unknown"; fi
}

detect_arch() {
  case "$(uname -m)" in
    x86_64)        echo "amd64" ;;
    aarch64|arm64) echo "arm64" ;;
    *)             uname -m ;;
  esac
}

pkg_mgr_for_os() {
  case "$1" in
    ubuntu|debian|linuxmint|pop|raspbian) echo "apt"    ;;
    fedora|rhel|centos|rocky|almalinux)   echo "dnf"    ;;
    arch|manjaro|endeavouros|garuda)      echo "pacman" ;;
    macos)                                echo "brew"   ;;
    *)                                    echo ""       ;;
  esac
}

# ── Dependency installer ──────────────────────────────────────────────────────
# ensure_cmd <cmd> <human-name> <apt-pkg> <dnf-pkg> <pacman-pkg> <brew-formula>
ensure_cmd() {
  local cmd="$1" name="$2" apt_pkg="$3" dnf_pkg="$4" pac_pkg="$5" brew_pkg="$6"
  if command -v "$cmd" &>/dev/null; then
    detail "$name: $(command -v "$cmd")"
    return 0
  fi
  warn "$name not found — installing..."
  local os; os=$(detect_os)
  local mgr; mgr=$(pkg_mgr_for_os "$os")
  case "$mgr" in
    apt)
      apt-get update -qq -o Acquire::ForceIPv4=true
      DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$apt_pkg"
      ;;
    dnf)
      dnf install -y -q "$dnf_pkg"
      ;;
    pacman)
      pacman -S --noconfirm --needed "$pac_pkg" &>/dev/null
      ;;
    brew)
      brew install "$brew_pkg" &>/dev/null
      ;;
    *)
      error "Cannot auto-install $name on this OS. Install it manually and re-run."
      ;;
  esac
  command -v "$cmd" &>/dev/null || error "Failed to install $name. Install it manually and re-run."
  info "$name installed"
}

# ── Bootstrap: ensure openssl + curl are available before anything else ───────
bootstrap_base() {
  step "Checking base utilities"
  local os; os=$(detect_os)
  local mgr; mgr=$(pkg_mgr_for_os "$os")

  # On apt systems, update once upfront to avoid repeated slow updates
  if [[ "$mgr" == "apt" ]] && ! command -v curl &>/dev/null; then
    info "Updating package index..."
    apt-get update -qq -o Acquire::ForceIPv4=true 2>&1 | tee -a "$LOG_FILE" | tail -1 || true
  fi

  ensure_cmd curl    "curl"    "curl"    "curl"    "curl"    "curl"
  ensure_cmd openssl "openssl" "openssl" "openssl" "openssl" "openssl"
  ensure_cmd lsof    "lsof"    "lsof"    "lsof"    "lsof"    "lsof"
}

# ── Install Docker + Compose ──────────────────────────────────────────────────
install_docker() {
  if command -v docker &>/dev/null; then
    info "Docker already installed: $(docker --version)"
    return 0
  fi

  warn "Docker not found — installing..."
  local os; os=$(detect_os)

  case "$os" in
    ubuntu|debian|linuxmint|pop|raspbian)
      # Official Docker install script (most reliable)
      curl -fsSL https://get.docker.com | sh
      ;;
    fedora|rhel|centos|rocky|almalinux)
      dnf -y install dnf-plugins-core &>/dev/null
      dnf config-manager --add-repo https://download.docker.com/linux/fedora/docker-ce.repo &>/dev/null
      dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
      ;;
    arch|manjaro|endeavouros|garuda)
      pacman -S --noconfirm --needed docker docker-compose &>/dev/null
      ;;
    macos)
      error "On macOS, install Docker Desktop manually: https://www.docker.com/products/docker-desktop/"
      ;;
    *)
      error "Cannot auto-install Docker on '$os'. See: https://docs.docker.com/engine/install/"
      ;;
  esac

  # Enable and start Docker daemon
  if command -v systemctl &>/dev/null; then
    systemctl enable docker &>/dev/null || true
    systemctl start  docker &>/dev/null || true
  fi

  command -v docker &>/dev/null || error "Docker installation failed."
  info "Docker installed: $(docker --version)"
}

install_docker_compose() {
  # Compose v2 as a plugin (preferred)
  if docker compose version &>/dev/null 2>&1; then
    info "Docker Compose (plugin): $(docker compose version --short 2>/dev/null || echo 'ok')"
    return 0
  fi
  # Compose v1 standalone fallback
  if command -v docker-compose &>/dev/null; then
    info "Docker Compose (standalone): $(docker-compose --version)"
    return 0
  fi

  warn "Docker Compose not found — installing..."
  local os; os=$(detect_os)
  case "$(pkg_mgr_for_os "$os")" in
    apt)
      DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker-compose-plugin 2>/dev/null || \
      DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker-compose
      ;;
    dnf)
      dnf install -y docker-compose-plugin 2>/dev/null || dnf install -y docker-compose
      ;;
    pacman)
      pacman -S --noconfirm --needed docker-compose &>/dev/null
      ;;
    *)
      # Manual install of latest release
      local ver
      ver=$(curl -fsSL https://api.github.com/repos/docker/compose/releases/latest \
            | grep '"tag_name"' | cut -d'"' -f4)
      curl -fsSL \
        "https://github.com/docker/compose/releases/download/${ver}/docker-compose-$(uname -s)-$(uname -m)" \
        -o /usr/local/bin/docker-compose
      chmod +x /usr/local/bin/docker-compose
      ;;
  esac

  docker compose version &>/dev/null 2>&1 || \
  docker-compose --version &>/dev/null 2>&1 || \
  error "Docker Compose installation failed."
  info "Docker Compose installed"
}

# ── Install Go ────────────────────────────────────────────────────────────────
install_go() {
  local GO_VERSION="1.22.4"
  local arch; arch=$(detect_arch)

  # Already installed and correct version?
  if command -v go &>/dev/null && go version 2>/dev/null | grep -q "go${GO_VERSION}"; then
    info "Go ${GO_VERSION} already installed"
    return 0
  fi

  # Distro-packaged go might be available (version check relaxed to 1.22+)
  if command -v go &>/dev/null; then
    local installed_ver
    installed_ver=$(go version | grep -oP 'go\K[0-9]+\.[0-9]+' | head -1)
    local major minor
    major=$(echo "$installed_ver" | cut -d. -f1)
    minor=$(echo "$installed_ver" | cut -d. -f2)
    if [[ "$major" -ge 1 && "$minor" -ge 22 ]]; then
      info "Go $(go version | awk '{print $3}') already installed (>= 1.22)"
      return 0
    fi
    warn "Go $installed_ver found but need >= 1.22 — installing official binary"
  else
    warn "Go not found — installing ${GO_VERSION}..."
  fi

  local os; os=$(detect_os)

  # Try package manager first (faster, handles updates)
  case "$(pkg_mgr_for_os "$os")" in
    apt)
      DEBIAN_FRONTEND=noninteractive apt-get install -y -qq golang-go 2>/dev/null && \
        command -v go &>/dev/null && \
        go version 2>/dev/null | grep -qP 'go1\.2[2-9]' && { info "Go installed via apt"; return 0; } || true
      ;;
    dnf)
      dnf install -y golang 2>/dev/null && \
        command -v go &>/dev/null && { info "Go installed via dnf"; return 0; } || true
      ;;
    pacman)
      pacman -S --noconfirm --needed go &>/dev/null && { info "Go installed via pacman"; return 0; } || true
      ;;
    brew)
      brew install go &>/dev/null && { info "Go installed via brew"; return 0; } || true
      ;;
  esac

  # Fallback: download official binary
  info "Downloading Go ${GO_VERSION} official binary..."
  local url="https://go.dev/dl/go${GO_VERSION}.linux-${arch}.tar.gz"
  [[ "$(uname)" == "Darwin" ]] && url="https://go.dev/dl/go${GO_VERSION}.darwin-${arch}.tar.gz"

  curl -fsSL "$url" -o /tmp/go.tar.gz
  rm -rf /usr/local/go
  tar -C /usr/local -xzf /tmp/go.tar.gz
  rm -f /tmp/go.tar.gz

  # Add to PATH for this session and system-wide
  export PATH="$PATH:/usr/local/go/bin"
  echo 'export PATH=$PATH:/usr/local/go/bin' > /etc/profile.d/go.sh
  chmod +x /etc/profile.d/go.sh

  command -v go &>/dev/null || error "Go installation failed."
  info "Go $(go version | awk '{print $3}') installed → /usr/local/go"
}

# ── Install Node.js ───────────────────────────────────────────────────────────
install_node() {
  local WANT_MAJOR=20

  # Already installed and correct major version?
  if command -v node &>/dev/null; then
    local installed_major
    installed_major=$(node --version | grep -oP 'v\K[0-9]+')
    if [[ "$installed_major" -ge "$WANT_MAJOR" ]]; then
      info "Node.js $(node --version) already installed"
      return 0
    fi
    warn "Node.js v$installed_major found but need >= v${WANT_MAJOR} — upgrading..."
  else
    warn "Node.js not found — installing v${WANT_MAJOR}..."
  fi

  local os; os=$(detect_os)
  case "$(pkg_mgr_for_os "$os")" in
    apt)
      # NodeSource repo gives us a current LTS version
      curl -fsSL "https://deb.nodesource.com/setup_${WANT_MAJOR}.x" | bash - &>/dev/null
      DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs
      ;;
    dnf)
      curl -fsSL "https://rpm.nodesource.com/setup_${WANT_MAJOR}.x" | bash - &>/dev/null
      dnf install -y nodejs
      ;;
    pacman)
      pacman -S --noconfirm --needed nodejs npm &>/dev/null
      ;;
    brew)
      brew install "node@${WANT_MAJOR}" &>/dev/null
      brew link --overwrite "node@${WANT_MAJOR}" &>/dev/null || true
      ;;
    *)
      error "Cannot auto-install Node.js on this OS. Install it manually from https://nodejs.org"
      ;;
  esac

  command -v node &>/dev/null || error "Node.js installation failed."
  info "Node.js $(node --version) installed"
}

# ── Install PostgreSQL ────────────────────────────────────────────────────────
install_postgres() {
  if command -v psql &>/dev/null; then
    info "PostgreSQL client already installed"
    return 0
  fi

  warn "PostgreSQL not found — installing..."
  local os; os=$(detect_os)
  case "$(pkg_mgr_for_os "$os")" in
    apt)
      DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql postgresql-contrib
      ;;
    dnf)
      dnf install -y postgresql-server postgresql
      postgresql-setup --initdb 2>/dev/null || true
      ;;
    pacman)
      pacman -S --noconfirm --needed postgresql &>/dev/null
      sudo -u postgres initdb --locale=en_US.UTF-8 -D /var/lib/postgres/data 2>/dev/null || true
      ;;
    brew)
      brew install postgresql@16 &>/dev/null
      brew services start postgresql@16 &>/dev/null || true
      ;;
    *)
      error "Cannot auto-install PostgreSQL on this OS."
      ;;
  esac

  if command -v systemctl &>/dev/null; then
    systemctl enable postgresql &>/dev/null || true
    systemctl start  postgresql &>/dev/null || true
  fi

  command -v psql &>/dev/null || error "PostgreSQL installation failed."
  info "PostgreSQL installed"
}

# ── Install WireGuard ─────────────────────────────────────────────────────────
install_wireguard() {
  if command -v wg &>/dev/null; then
    info "WireGuard already installed"
    return 0
  fi

  warn "WireGuard not found — installing..."
  local os; os=$(detect_os)
  case "$(pkg_mgr_for_os "$os")" in
    apt)
      DEBIAN_FRONTEND=noninteractive apt-get install -y -qq wireguard wireguard-tools
      ;;
    dnf)
      dnf install -y wireguard-tools
      ;;
    pacman)
      pacman -S --noconfirm --needed wireguard-tools &>/dev/null
      ;;
    brew)
      brew install wireguard-tools &>/dev/null || \
        warn "WireGuard tools not available on macOS via brew — use the App Store WireGuard client"
      ;;
    *)
      warn "Cannot auto-install WireGuard — install wireguard-tools manually"
      return 0
      ;;
  esac
  command -v wg &>/dev/null && info "WireGuard installed" || warn "WireGuard install may need a reboot/kernel module load"
}

# ── Install nginx ─────────────────────────────────────────────────────────────
install_nginx() {
  if command -v nginx &>/dev/null; then
    info "nginx already installed"
    return 0
  fi
  warn "nginx not found — installing..."
  local os; os=$(detect_os)
  case "$(pkg_mgr_for_os "$os")" in
    apt)    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nginx ;;
    dnf)    dnf install -y nginx ;;
    pacman) pacman -S --noconfirm --needed nginx &>/dev/null ;;
    brew)   brew install nginx &>/dev/null ;;
    *)      error "Cannot auto-install nginx on this OS." ;;
  esac
  command -v nginx &>/dev/null || error "nginx installation failed."
  if command -v systemctl &>/dev/null; then
    systemctl enable nginx &>/dev/null || true
    systemctl start  nginx &>/dev/null || true
  fi
  info "nginx installed"
}

# ── Secrets ───────────────────────────────────────────────────────────────────
generate_secrets() {
  step "Generating secrets"
  JWT_SECRET=$(openssl rand -base64 48 | tr -d '\n')
  MASTER_KEY=$(openssl rand -hex 32)
  DB_PASSWORD=$(openssl rand -base64 24 | tr -d '\n/+=' | head -c 24)

  if command -v wg &>/dev/null; then
    WG_PRIVATE_KEY=$(wg genkey)
    WG_PUBLIC_KEY=$(echo "$WG_PRIVATE_KEY" | wg pubkey)
    info "WireGuard keys generated"
  else
    WG_PRIVATE_KEY="REPLACE_WITH_OUTPUT_OF: wg genkey"
    WG_PUBLIC_KEY="REPLACE_WITH_OUTPUT_OF: echo \$WG_PRIVATE_KEY | wg pubkey"
    warn "wg not found — fill WG_PRIVATE_KEY in .env manually"
  fi
  info "JWT secret, AES-256 master key, DB password generated"
}

write_env() {
  local env_file="${1:-.env}"
  step "Writing $env_file"
  cat > "$REPO_ROOT/$env_file" << EOF
# ─────────────────────────────────────────
#  OpenPortal — generated by setup.sh on $(date)
# ─────────────────────────────────────────

DATABASE_URL=postgres://openportal:${DB_PASSWORD}@${DB_HOST}:5432/openportal?sslmode=disable
POSTGRES_USER=openportal
POSTGRES_PASSWORD=${DB_PASSWORD}
POSTGRES_DB=openportal

JWT_SECRET=${JWT_SECRET}
JWT_EXPIRY_HOURS=8

# AES-256-GCM key — DO NOT share or commit
MASTER_KEY=${MASTER_KEY}

WG_INTERFACE=wg0
WG_SERVER_IP=10.10.0.1
WG_SUBNET=10.10.0.0/24
WG_LISTEN_PORT=${WG_PORT}
WG_PRIVATE_KEY=${WG_PRIVATE_KEY}
WG_PUBLIC_ENDPOINT=${WG_PUBLIC_ENDPOINT}

PORT=${PORT_API}
FRONTEND_URL=${FRONTEND_URL}
PROXY_BASE_DOMAIN=${DOMAIN}

ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
EOF
  chmod 600 "$REPO_ROOT/$env_file"
  info "Written: $env_file"
}

# ── Setup: Docker ─────────────────────────────────────────────────────────────
setup_docker() {
  step "Checking dependencies"

  # Docker and Compose — auto-install if missing
  install_docker
  install_docker_compose

  # Set COMPOSE_CMD
  if docker compose version &>/dev/null 2>&1; then
    COMPOSE_CMD="docker compose"
  else
    COMPOSE_CMD="docker-compose"
  fi

  # Docker daemon must be running
  if ! docker info &>/dev/null 2>&1; then
    warn "Docker daemon is not running — attempting to start..."
    systemctl start docker 2>/dev/null || \
      error "Could not start Docker daemon. Run 'sudo systemctl start docker' and retry."
  fi
  info "Docker daemon: running"

  step "Collecting configuration"
  prompt DOMAIN        "Domain / hostname"          "localhost"
  prompt ADMIN_EMAIL   "Admin email"                "admin@example.com"
  while true; do
    prompt_secret_confirm ADMIN_PASSWORD "Admin password (min 8 chars)"
    [[ ${#ADMIN_PASSWORD} -ge 8 ]] && break
    warn "Password must be at least 8 characters — try again."
  done

  # WireGuard public endpoint — needed for peer config generation
  local default_wg_ep="$DOMAIN"
  [[ "$DOMAIN" == "localhost" || "$DOMAIN" == "127.0.0.1" ]] && \
    default_wg_ep=$(curl -fsSL --max-time 5 https://api.ipify.org 2>/dev/null || echo "")
  prompt WG_PUBLIC_ENDPOINT "Server public IP / hostname for WireGuard peers" "$default_wg_ep"

  prompt PORT_API      "API port"                   "8080"
  prompt PORT_FRONTEND "Frontend port"              "5173"

  FRONTEND_URL="http://${DOMAIN}:${PORT_FRONTEND}"
  [[ "$DOMAIN" != "localhost" && "$DOMAIN" != "127.0.0.1" ]] && \
    FRONTEND_URL="https://${DOMAIN}"

  generate_secrets
  DB_HOST=postgres
  write_env ".env"

  if [[ "$PORT_API" != "8080" || "$PORT_FRONTEND" != "5173" ]]; then
    sed -i.bak \
      -e "s/\"8080:8080\"/\"${PORT_API}:8080\"/" \
      -e "s/\"5173:80\"/\"${PORT_FRONTEND}:80\"/" \
      "$REPO_ROOT/docker-compose.yml"
    info "docker-compose.yml ports updated"
  fi

  step "Building images"
  cd "$REPO_ROOT"
  $COMPOSE_CMD build --parallel 2>&1 | tee -a "$LOG_FILE" | grep -E '(Step|=>|ERROR|error|successfully)' || true

  step "Starting services"
  $COMPOSE_CMD up -d 2>&1 | tee -a "$LOG_FILE"

  step "Waiting for backend"
  local i=0
  until curl -sf "http://localhost:${PORT_API}/api/me" &>/dev/null || (( i >= 30 )); do
    sleep 2; (( i++ )); printf "."
  done; echo ""
  (( i >= 30 )) && warn "Backend slow to start — check: $COMPOSE_CMD logs backend" || info "Backend is ready"

  print_summary "docker"
}

# ── Security Hardening Functions ──────────────────────────────────────────────

install_fail2ban() {
  local os; os=$(detect_os)
  local mgr; mgr=$(pkg_mgr_for_os "$os")

  if command -v fail2ban-client &>/dev/null; then
    info "fail2ban already installed"
  else
    warn "Installing fail2ban..."
    case "$mgr" in
      apt)    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq fail2ban ;;
      dnf)    dnf install -y fail2ban ;;
      pacman) pacman -S --noconfirm --needed fail2ban &>/dev/null ;;
      *)      warn "Cannot auto-install fail2ban on $os — install it manually"; return 0 ;;
    esac
    command -v fail2ban-client &>/dev/null || { warn "fail2ban installation failed — skipping"; return 0; }
    info "fail2ban installed"
  fi

  # Enable and start the daemon
  if command -v systemctl &>/dev/null; then
    systemctl enable fail2ban &>/dev/null || true
    systemctl start  fail2ban &>/dev/null || true
  fi

  # Write the filter rule that matches OpenPortal JSON audit log entries
  mkdir -p /etc/fail2ban/filter.d
  cat > /etc/fail2ban/filter.d/openportal-auth.conf << 'FILTEREOF'
[Definition]
# Matches OpenPortal structured log lines: "action":"LOGIN_FAILED","ip_address":"<ip>"
# The action constant is uppercase in the audit log.
failregex = .*"action":"LOGIN_FAILED".*"ip_address":"<HOST>".*
ignoreregex =
FILTEREOF

  # Write the jail configuration
  mkdir -p /etc/fail2ban/jail.d
  cat > /etc/fail2ban/jail.d/openportal.conf << JAILEOF
[openportal-auth]
enabled  = true
filter   = openportal-auth
backend  = systemd
journalmatch = _SYSTEMD_UNIT=openportal.service
maxretry = 5
findtime = 600
bantime  = 1800
action   = iptables-multiport[name=openportal, port="80,443,${PORT_API}"]
JAILEOF

  # Reload fail2ban to pick up the new jail
  fail2ban-client reload 2>/dev/null || systemctl restart fail2ban 2>/dev/null || true

  info "fail2ban: openportal-auth jail configured (maxretry=5, findtime=10m, bantime=30m)"
  detail "OS-level bans will block IPs at port 80, 443, and ${PORT_API}"
}

setup_ufw() {
  local os; os=$(detect_os)
  local mgr; mgr=$(pkg_mgr_for_os "$os")

  if ! command -v ufw &>/dev/null; then
    warn "Installing UFW..."
    case "$mgr" in
      apt)    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ufw ;;
      dnf)    dnf install -y ufw ;;
      pacman) pacman -S --noconfirm --needed ufw &>/dev/null ;;
      *)      warn "Cannot auto-install UFW on $os — configure a firewall manually"; return 0 ;;
    esac
    command -v ufw &>/dev/null || { warn "UFW installation failed — configure a firewall manually"; return 0; }
    info "UFW installed"
  fi

  # Default policy: deny all incoming, allow all outgoing
  ufw default deny incoming  &>/dev/null || true
  ufw default allow outgoing &>/dev/null || true

  # Allow SSH (must come before enable or you'll lock yourself out)
  ufw allow 22/tcp   comment 'SSH'          &>/dev/null || true
  ufw allow 80/tcp   comment 'HTTP'         &>/dev/null || true
  ufw allow 443/tcp  comment 'HTTPS'        &>/dev/null || true
  ufw allow "${PORT_API}/tcp" comment 'OpenPortal API' &>/dev/null || true
  ufw allow "${WG_PORT}/udp"  comment 'WireGuard VPN' &>/dev/null || true

  # Enable non-interactively
  ufw --force enable &>/dev/null || true

  info "UFW enabled — rules:"
  ufw status numbered 2>/dev/null | grep -v "^$" | head -15 || true
  warn "If you use a non-standard SSH port, add it manually: sudo ufw allow <port>/tcp"
}

setup_unattended_upgrades() {
  local os; os=$(detect_os)
  local mgr; mgr=$(pkg_mgr_for_os "$os")

  case "$mgr" in
    apt)
      DEBIAN_FRONTEND=noninteractive apt-get install -y -qq unattended-upgrades apt-listchanges
      # Configure automatic security updates
      cat > /etc/apt/apt.conf.d/50openportal-auto-upgrades << 'UPGEOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
Unattended-Upgrade::Mail "root";
UPGEOF
      dpkg-reconfigure -f noninteractive unattended-upgrades &>/dev/null || true
      info "Unattended security upgrades enabled (apt)"
      ;;
    dnf)
      dnf install -y dnf-automatic
      sed -i 's/^apply_updates = .*/apply_updates = yes/' /etc/dnf/automatic.conf 2>/dev/null || true
      systemctl enable --now dnf-automatic.timer &>/dev/null || true
      info "Automatic updates enabled (dnf-automatic)"
      ;;
    *)
      warn "Unattended upgrades not available for this OS — enable them manually"
      ;;
  esac
}

harden_sysctl() {
  cat > /etc/sysctl.d/99-openportal-hardening.conf << 'SYSCTLEOF'
# ── OpenPortal system hardening ────────────────────────────────────────────────
# Reverse-path filtering (anti-spoofing)
net.ipv4.conf.all.rp_filter=1
net.ipv4.conf.default.rp_filter=1
# SYN flood protection
net.ipv4.tcp_syncookies=1
# Disable ICMP redirects (prevents MITM on local network)
net.ipv4.conf.all.accept_redirects=0
net.ipv4.conf.default.accept_redirects=0
net.ipv4.conf.all.send_redirects=0
net.ipv4.conf.default.send_redirects=0
# Disable source routing
net.ipv4.conf.all.accept_source_route=0
net.ipv4.conf.default.accept_source_route=0
# Ignore broadcast pings and bogus errors
net.ipv4.icmp_echo_ignore_broadcasts=1
net.ipv4.icmp_ignore_bogus_error_responses=1
# Log martian packets (for debugging intrusion attempts)
net.ipv4.conf.all.log_martians=1
# Disable IPv6 redirects
net.ipv6.conf.all.accept_redirects=0
net.ipv6.conf.default.accept_redirects=0
# Restrict dmesg access
kernel.dmesg_restrict=1
# Hide kernel pointers from unprivileged users
kernel.kptr_restrict=2
SYSCTLEOF
  sysctl -p /etc/sysctl.d/99-openportal-hardening.conf &>/dev/null || true
  info "Kernel hardening parameters applied"
}

run_hardening() {
  echo ""
  echo -e "  ${BOLD}${BLUE}▸${NC}${BOLD} System Hardening (optional but strongly recommended)${NC}"
  echo -e "  ${DIM}These steps improve the security posture of the host system.${NC}"
  echo ""

  if confirm "Apply kernel network hardening (sysctl — recommended)"; then
    harden_sysctl
  fi

  if confirm "Enable automatic security updates (unattended-upgrades / dnf-automatic)"; then
    setup_unattended_upgrades
  fi

  if confirm "Install and configure fail2ban (OS-level brute-force protection)"; then
    install_fail2ban
  fi

  if confirm "Set up UFW firewall (block all ports except SSH, HTTP, HTTPS, WireGuard, API)"; then
    setup_ufw
  fi

  echo ""
}

# ── Setup: Bare-metal ─────────────────────────────────────────────────────────
setup_bare_metal() {
  [[ "$EUID" -ne 0 ]] && error "Bare-metal install requires root. Run: sudo bash setup.sh --bare-metal"

  local os arch
  os=$(detect_os); arch=$(detect_arch)
  step "Detected OS: $os ($arch)"
  [[ -z "$(pkg_mgr_for_os "$os")" ]] && \
    error "Unsupported OS: $os. Use --docker instead."

  # ── Install all dependencies ────────────────────────────────────────────────
  step "Installing dependencies"
  install_wireguard
  install_postgres
  install_nginx
  install_go
  install_node

  # Extra build tools
  case "$(pkg_mgr_for_os "$os")" in
    apt)
      ensure_cmd gcc    "gcc"    "gcc"    "gcc"    "gcc"    "gcc"
      ensure_cmd make   "make"   "make"   "make"   "make"   "make"
      ;;
    dnf)
      ensure_cmd gcc    "gcc"    "gcc"    "gcc"    "gcc"    "gcc"
      ;;
  esac

  # ── Collect config ──────────────────────────────────────────────────────────
  step "Collecting configuration"
  prompt DOMAIN        "Domain / hostname (e.g. proxy.myco.com)" "localhost"
  prompt ADMIN_EMAIL   "Admin email"                              "admin@example.com"
  while true; do
    prompt_secret_confirm ADMIN_PASSWORD "Admin password (min 8 chars)"
    [[ ${#ADMIN_PASSWORD} -ge 8 ]] && break
    warn "Password must be at least 8 characters — try again."
  done

  # WireGuard public endpoint
  local default_wg_ep="$DOMAIN"
  [[ "$DOMAIN" == "localhost" || "$DOMAIN" == "127.0.0.1" ]] && \
    default_wg_ep=$(curl -fsSL --max-time 5 https://api.ipify.org 2>/dev/null || echo "")
  prompt WG_PUBLIC_ENDPOINT "Server public IP / hostname for WireGuard peers" "$default_wg_ep"

  FRONTEND_URL="https://${DOMAIN}"
  [[ "$DOMAIN" == "localhost" || "$DOMAIN" == "127.0.0.1" ]] && \
    FRONTEND_URL="http://localhost"

  generate_secrets

  # ── PostgreSQL ──────────────────────────────────────────────────────────────
  step "Configuring PostgreSQL"
  systemctl enable --now postgresql &>/dev/null || \
    service postgresql start &>/dev/null || true

  # Wait for postgres to be ready
  local pg_tries=0
  until pg_isready -q 2>/dev/null || (( pg_tries >= 15 )); do
    sleep 2; (( pg_tries++ ))
  done

  sudo -u postgres psql -c \
    "CREATE USER openportal WITH PASSWORD '${DB_PASSWORD}';" 2>/dev/null || \
  sudo -u postgres psql -c \
    "ALTER USER openportal WITH PASSWORD '${DB_PASSWORD}';" 2>/dev/null || true
  sudo -u postgres psql -c \
    "CREATE DATABASE openportal OWNER openportal;" 2>/dev/null || \
    warn "Database already exists"
  info "PostgreSQL: database 'openportal' ready"

  # ── Service user ────────────────────────────────────────────────────────────
  step "Creating service user"
  useradd --system --home-dir /opt/openportal --create-home \
    --shell /bin/false openportal 2>/dev/null || true
  info "User: openportal"

  # ── Build backend ───────────────────────────────────────────────────────────
  step "Building backend"
  local GO_BIN
  GO_BIN=$(command -v go || echo "/usr/local/go/bin/go")
  mkdir -p /opt/openportal/migrations
  cd "$REPO_ROOT/backend"
  info "Running go mod tidy (resolves dependencies, generates go.sum)..."
  GOPATH=/tmp/go-cache "$GO_BIN" mod tidy  2>&1 | tee -a "$LOG_FILE"
  GOPATH=/tmp/go-cache "$GO_BIN" mod download 2>&1 | tee -a "$LOG_FILE"
  info "Compiling..."
  CGO_ENABLED=0 GOPATH=/tmp/go-cache "$GO_BIN" build \
    -ldflags="-s -w" -o /opt/openportal/openportal ./cmd/server
  cp -r migrations/ /opt/openportal/
  info "Binary: /opt/openportal/openportal"

  # ── Build frontend ──────────────────────────────────────────────────────────
  step "Building frontend"
  cd "$REPO_ROOT/frontend"

  # Verify node and npm versions
  local node_ver npm_ver
  node_ver=$(node --version 2>/dev/null) || error "node not found after install — re-run setup"
  npm_ver=$(npm --version 2>/dev/null)   || error "npm not found after install — re-run setup"
  info "Node $node_ver  npm v$npm_ver"

  # npm install — works with or without package-lock.json
  info "Cleaning previous install (avoids npm rollup bug)..."
  rm -rf node_modules package-lock.json
  info "Installing npm dependencies (this may take a few minutes)..."
  npm install 2>&1 | tee -a "$LOG_FILE"
  local npm_exit=${PIPESTATUS[0]}
  if [[ $npm_exit -ne 0 ]]; then
    error "npm install failed (exit $npm_exit). Last lines:\n$(tail -20 "$LOG_FILE")"
  fi
  # Explicitly install rollup native binary if still missing (npm optional-dep bug guard)
  if ! node -e "require('@rollup/rollup-linux-x64-gnu')" &>/dev/null 2>&1; then
    warn "Rollup native binary missing — installing directly..."
    npm install --no-save @rollup/rollup-linux-x64-gnu 2>&1 | tee -a "$LOG_FILE" ||     npm install --no-save @rollup/rollup-linux-x64-musl 2>&1 | tee -a "$LOG_FILE" || true
  fi
  info "npm dependencies installed"

  # Build the production bundle
  info "Building production bundle..."
  VITE_API_URL="" npm run build 2>&1 | tee -a "$LOG_FILE"
  local build_exit=${PIPESTATUS[0]}
  if [[ $build_exit -ne 0 ]]; then
    error "npm run build failed (exit $build_exit). Last lines:\n$(tail -30 "$LOG_FILE")"
  fi

  [[ ! -d "$REPO_ROOT/frontend/dist" ]] && \
    error "Build succeeded but dist/ not found — check $LOG_FILE"

  mkdir -p /var/www/openportal
  cp -r dist/* /var/www/openportal/
  chown -R www-data:www-data /var/www/openportal 2>/dev/null || \
    chown -R nginx:nginx    /var/www/openportal 2>/dev/null || true
  info "Frontend: /var/www/openportal"

  # ── Write .env ──────────────────────────────────────────────────────────────
  DB_HOST=localhost
  write_env ".env"
  cp "$REPO_ROOT/.env" /opt/openportal/.env
  chmod 600 /opt/openportal/.env
  chown openportal:openportal /opt/openportal/.env

  # ── WireGuard ───────────────────────────────────────────────────────────────
  step "Configuring WireGuard"
  mkdir -p /etc/wireguard
  cat > /etc/wireguard/wg0.conf << WGEOF
[Interface]
Address = 10.10.0.1/24
ListenPort = ${WG_PORT}
PrivateKey = ${WG_PRIVATE_KEY}

PostUp   = iptables -A FORWARD -i %i -j ACCEPT; iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
PostDown = iptables -D FORWARD -i %i -j ACCEPT; iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE

# Peers managed by OpenPortal — do not edit manually
WGEOF
  chmod 600 /etc/wireguard/wg0.conf
  echo "net.ipv4.ip_forward=1" > /etc/sysctl.d/99-openportal-wg.conf
  sysctl -p /etc/sysctl.d/99-openportal-wg.conf &>/dev/null || true
  systemctl enable --now wg-quick@wg0 2>/dev/null || \
    wg-quick up wg0 2>/dev/null || \
    warn "Could not bring up wg0 — run: wg-quick up wg0"
  info "WireGuard: wg0 (10.10.0.1/24)"

  # ── nginx ───────────────────────────────────────────────────────────────────
  step "Configuring nginx"
  local nginx_conf="/etc/nginx/sites-available/openportal"
  # Write a basic HTTP config (setup-domain.sh adds TLS)
  cat > "$nginx_conf" << NGINXEOF
server {
    listen 80;
    server_name ${DOMAIN};
    root /var/www/openportal;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:${PORT_API};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 60s;
    }
    location /proxy/ {
        proxy_pass http://127.0.0.1:${PORT_API};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
        client_max_body_size 100m;
    }
    location / { try_files \$uri \$uri/ /index.html; }
    location ~ /\. { deny all; }
}
NGINXEOF

  # Handle both sites-enabled (Debian/Ubuntu) and conf.d (RHEL/Arch)
  if [[ -d /etc/nginx/sites-enabled ]]; then
    ln -sf "$nginx_conf" /etc/nginx/sites-enabled/openportal
    rm -f /etc/nginx/sites-enabled/default
  else
    cp "$nginx_conf" /etc/nginx/conf.d/openportal.conf
    rm -f /etc/nginx/conf.d/default.conf 2>/dev/null || true
  fi
  nginx -t 2>&1 | tee -a "$LOG_FILE"
  systemctl enable --now nginx &>/dev/null || service nginx start &>/dev/null || true
  systemctl reload nginx &>/dev/null || service nginx reload &>/dev/null || true
  info "nginx configured"

  # ── systemd service ─────────────────────────────────────────────────────────
  step "Installing systemd service"
  cp "$REPO_ROOT/deploy/openportal.service" /etc/systemd/system/openportal.service
  systemctl daemon-reload
  systemctl enable --now openportal
  info "Service: openportal (systemd)"

  chown -R openportal:openportal /opt/openportal

  # ── Optional system hardening ──────────────────────────────────────────────────
  run_hardening

  print_summary "bare-metal"
}

# ── Setup: Dev ────────────────────────────────────────────────────────────────
setup_dev() {
  step "Checking and installing dev dependencies"

  local os; os=$(detect_os)
  local mgr; mgr=$(pkg_mgr_for_os "$os")

  # On Linux, offer to install missing tools; on macOS expect brew
  if [[ "$mgr" == "apt" || "$mgr" == "dnf" || "$mgr" == "pacman" ]]; then
    # Need sudo for package installs — check if we can get it
    local use_sudo=""
    if [[ "$EUID" -ne 0 ]]; then
      if command -v sudo &>/dev/null; then
        use_sudo="sudo"
        info "Will use sudo for package installs"
      else
        warn "Not root and sudo not found — will check tools but cannot auto-install"
      fi
    fi

    # Temporarily alias package managers to go through sudo if needed
    if [[ -n "$use_sudo" ]]; then
      alias apt-get="sudo apt-get"
      alias dnf="sudo dnf"
      alias pacman="sudo pacman"
    fi
  fi

  install_go
  install_node
  install_postgres

  # Ensure npm is available (sometimes separate from node)
  ensure_cmd npm "npm" "npm" "npm" "npm" "node"

  unalias apt-get dnf pacman 2>/dev/null || true

  info "Go:   $(go version | awk '{print $3}')"
  info "Node: $(node --version)"
  info "npm:  $(npm --version)"

  step "Collecting configuration"
  prompt ADMIN_EMAIL    "Admin email"    "admin@example.com"
  while true; do
    prompt_secret_confirm ADMIN_PASSWORD "Admin password (min 8 chars)"
    [[ ${#ADMIN_PASSWORD} -ge 8 ]] && break
    warn "Password must be at least 8 characters — try again."
  done

  check_port 8080 || warn "Port 8080 in use — set PORT= in .env after setup"
  check_port 5173 || warn "Port 5173 in use — Vite will pick the next available port"

  generate_secrets
  DB_HOST=localhost; DOMAIN=localhost; FRONTEND_URL="http://localhost:5173"
  WG_PUBLIC_ENDPOINT="localhost"
  write_env ".env"

  step "Installing frontend dependencies"
  cd "$REPO_ROOT/frontend"
  info "Running npm install..."
  # Remove node_modules and lock file to avoid npm optional-dep bug with rollup
  rm -rf node_modules package-lock.json
  npm install 2>&1 | tee -a "$LOG_FILE"
  [[ ${PIPESTATUS[0]} -ne 0 ]] && error "npm install failed — check $LOG_FILE"
  info "node_modules ready"

  step "Resolving Go dependencies"
  cd "$REPO_ROOT/backend"
  info "Running go mod tidy (generates go.sum)..."
  go mod tidy   2>&1 | tee -a "$LOG_FILE" | tail -5
  go mod download 2>&1 | tee -a "$LOG_FILE" | tail -3
  info "Go modules cached"

  step "Setting up local database"
  if pg_isready -q 2>/dev/null; then
    # Try to create user/db, gracefully handle already-exists
    local pgcmd
    if [[ "$EUID" -eq 0 ]]; then
      pgcmd="sudo -u postgres"
    elif command -v sudo &>/dev/null; then
      pgcmd="sudo -u postgres"
    else
      pgcmd=""
    fi

    if [[ -n "$pgcmd" ]]; then
      $pgcmd psql -c "CREATE USER openportal WITH PASSWORD '${DB_PASSWORD}';" 2>/dev/null || \
      $pgcmd psql -c "ALTER USER openportal WITH PASSWORD '${DB_PASSWORD}';"  2>/dev/null || true
      $pgcmd psql -c "CREATE DATABASE openportal OWNER openportal;" 2>/dev/null || \
        warn "Database already exists — skipping"
      info "Database 'openportal' ready"
    else
      # Try as current user
      createuser -s openportal 2>/dev/null || true
      createdb -O openportal openportal 2>/dev/null || warn "Could not create database — do it manually"
    fi
  else
    warn "PostgreSQL not running — start it, or spin one up with Docker:"
    echo ""
    echo "       docker run -d --name openportal-db \\"
    echo "         -e POSTGRES_USER=openportal \\"
    echo "         -e POSTGRES_PASSWORD=${DB_PASSWORD} \\"
    echo "         -e POSTGRES_DB=openportal \\"
    echo "         -p 5432:5432 postgres:16-alpine"
    echo ""
    echo "       Then update DATABASE_URL in .env to use that password."
  fi

  print_summary "dev"
}

# ── Uninstall ─────────────────────────────────────────────────────────────────
setup_uninstall() {
  [[ "$EUID" -ne 0 ]] && error "Uninstall requires root."
  warn "This will remove all OpenPortal services, files, and data."
  confirm "Continue?" || { echo "  Aborted."; exit 0; }

  step "Stopping services"
  systemctl stop  openportal    2>/dev/null && info "Stopped openportal"  || true
  systemctl stop  wg-quick@wg0 2>/dev/null && info "Stopped WireGuard" || true
  systemctl disable openportal    2>/dev/null || true
  systemctl disable wg-quick@wg0 2>/dev/null || true

  step "Removing files"
  rm -f  /etc/systemd/system/openportal.service
  rm -f  /etc/nginx/sites-enabled/openportal
  rm -f  /etc/nginx/sites-available/openportal
  rm -f  /etc/nginx/conf.d/openportal.conf
  rm -f  /etc/wireguard/wg0.conf
  rm -f  /etc/sysctl.d/99-openportal-wg.conf
  rm -rf /opt/openportal
  rm -rf /var/www/openportal
  systemctl daemon-reload
  nginx -t &>/dev/null && systemctl reload nginx 2>/dev/null || true

  if confirm "Also drop the PostgreSQL database and user?"; then
    sudo -u postgres psql -c "DROP DATABASE IF EXISTS openportal;" 2>/dev/null || true
    sudo -u postgres psql -c "DROP USER IF EXISTS openportal;" 2>/dev/null || true
    info "Database removed"
  fi
  info "OpenPortal uninstalled"
}

# ── Summary ───────────────────────────────────────────────────────────────────
print_summary() {
  echo ""
  echo -e "${BOLD}${GREEN}"
  echo "  ╔═══════════════════════════════════════════╗"
  echo "  ║        Setup complete!                    ║"
  echo "  ╚═══════════════════════════════════════════╝"
  echo -e "${NC}"
  case "$1" in
    docker)
      echo -e "  ${BOLD}Frontend:${NC}  http://localhost:${PORT_FRONTEND}"
      echo -e "  ${BOLD}API:${NC}       http://localhost:${PORT_API}"
      echo ""
      echo -e "  ${DIM}Manage:${NC}"
      echo "    docker compose logs -f        # live logs"
      echo "    docker compose restart        # restart all"
      echo "    docker compose down           # stop"
      ;;
    bare-metal)
      echo -e "  ${BOLD}URL:${NC}  http://${DOMAIN}  (add HTTPS: sudo bash setup-domain.sh)"
      echo ""
      echo -e "  ${DIM}Manage:${NC}"
      echo "    systemctl status openportal    # service status"
      echo "    journalctl -u openportal -f    # live logs"
      echo "    systemctl restart openportal   # restart"
      ;;
    dev)
      echo -e "  ${BOLD}Start backend:${NC}   cd backend  && go run ./cmd/server"
      echo -e "  ${BOLD}Start frontend:${NC}  cd frontend && npm run dev"
      echo ""
      echo "    Frontend → http://localhost:5173"
      echo "    API      → http://localhost:8080"
      ;;
  esac
  echo ""
  echo -e "  ${BOLD}Admin:${NC}    ${ADMIN_EMAIL}"
  echo -e "  ${BOLD}Password:${NC} ${ADMIN_PASSWORD}"
  if [[ -n "$WG_PUBLIC_KEY" && "$WG_PUBLIC_KEY" != *"REPLACE"* ]]; then
    echo ""
    echo -e "  ${BOLD}WireGuard server public key:${NC}"
    echo "    ${WG_PUBLIC_KEY}"
  fi
  echo ""
  warn "Change the admin password after first login."
  echo -e "  ${DIM}Full log: $LOG_FILE${NC}"
  echo ""
}

# ── Mode selector ─────────────────────────────────────────────────────────────
choose_mode() {
  echo ""
  echo -e "  How would you like to run OpenPortal?\n"
  echo -e "  ${BOLD}1)${NC} Docker Compose  ${DIM}— recommended, works on any OS with Docker${NC}"
  echo -e "  ${BOLD}2)${NC} Bare-metal      ${DIM}— installs directly on this Linux server${NC}"
  echo -e "  ${BOLD}3)${NC} Dev mode        ${DIM}— local development, no root required${NC}"
  echo -e "  ${BOLD}4)${NC} Uninstall       ${DIM}— remove a bare-metal installation${NC}"
  echo ""
  read -rp "$(echo -e "  ${CYAN}?${NC}  Enter choice [1-4]: ")" _choice
  case "$_choice" in
    1) SETUP_MODE="docker"     ;;
    2) SETUP_MODE="bare-metal" ;;
    3) SETUP_MODE="dev"        ;;
    4) SETUP_MODE="uninstall"  ;;
    *) error "Invalid choice: $_choice" ;;
  esac
}

# ── Preflight ─────────────────────────────────────────────────────────────────
preflight() {
  if [[ ! -f "$REPO_ROOT/docker-compose.yml" ]]; then
    error "Cannot find docker-compose.yml (looked in: $REPO_ROOT). Run setup.sh from the openportal repo root."
  fi

  # Warn if dev mode is run as root
  if [[ "$SETUP_MODE" == "dev" && "$EUID" -eq 0 ]]; then
    warn "Running dev setup as root is not recommended."
    confirm "Continue anyway?" || exit 0
  fi
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
  banner

  case "${1:-}" in
    --docker)      SETUP_MODE="docker"     ;;
    --bare-metal)  SETUP_MODE="bare-metal" ;;
    --dev)         SETUP_MODE="dev"        ;;
    --uninstall)   SETUP_MODE="uninstall"  ;;
    --help|-h)
      echo "Usage: bash setup.sh [--docker | --bare-metal | --dev | --uninstall]"
      exit 0 ;;
    "") choose_mode ;;
    *)  error "Unknown flag: ${1}. Use --help for usage." ;;
  esac

  preflight

  # Bootstrap curl/openssl/lsof before anything else
  # (only on modes that might need to install things)
  if [[ "$SETUP_MODE" != "uninstall" ]]; then
    bootstrap_base
  fi

  case "$SETUP_MODE" in
    docker)     setup_docker     ;;
    bare-metal) setup_bare_metal ;;
    dev)        setup_dev        ;;
    uninstall)  setup_uninstall  ;;
  esac
}

main "$@"
