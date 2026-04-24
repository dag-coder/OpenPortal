package wireguard

import (
        "bytes"
        "context"
        "crypto/rand"
        "encoding/base64"
        "fmt"
        "io"
        "log"
        "net"
        "net/http"
        "os"
        "os/exec"
        "strconv"
        "strings"
        "sync"
        "text/template"
        "time"

        "github.com/google/uuid"
        "github.com/jackc/pgx/v5/pgxpool"
        "github.com/openproxy/openproxy/internal/config"
        "golang.org/x/crypto/curve25519"
)

type Peer struct {
        ID            uuid.UUID `json:"id"`
        Name          string    `json:"name"`
        InternalIP    string    `json:"internal_ip"`
        PublicKey     string    `json:"public_key"`
        LastHandshake *string   `json:"last_handshake"`
        Status        string    `json:"status"`
}

type Service struct {
        cfg  *config.Config
        pool *pgxpool.Pool
}

// detectedIP caches the auto-detected public IP so we only fetch it once.
var (
        detectedIP   string
        detectedOnce sync.Once
)

// autoDetectPublicIP tries several well-known IP-echo services and returns
// the first successful result. Falls back to an empty string on failure.
func autoDetectPublicIP() string {
        services := []string{
                "https://api.ipify.org",
                "https://ifconfig.me/ip",
                "https://icanhazip.com",
                "https://checkip.amazonaws.com",
        }
        client := &http.Client{Timeout: 5 * time.Second}
        for _, url := range services {
                resp, err := client.Get(url)
                if err != nil {
                        continue
                }
                body, err := io.ReadAll(resp.Body)
                resp.Body.Close()
                if err != nil || resp.StatusCode != 200 {
                        continue
                }
                ip := strings.TrimSpace(string(body))
                if net.ParseIP(ip) != nil {
                        return ip
                }
        }
        return ""
}

func NewService(cfg *config.Config, pool *pgxpool.Pool) *Service {
        // Public IP auto-detection (endpoint only; key is handled by InitKeys).
        if cfg.WGPublicEndpoint == "" {
                detectedOnce.Do(func() {
                        detectedIP = autoDetectPublicIP()
                        if detectedIP != "" {
                                log.Printf("wireguard: auto-detected public IP %s (set WG_PUBLIC_ENDPOINT to override)", detectedIP)
                        } else {
                                log.Printf("wireguard: could not auto-detect public IP; set WG_PUBLIC_ENDPOINT manually")
                        }
                })
        }
        return &Service{cfg: cfg, pool: pool}
}

// generatePrivateKey creates a new random Curve25519 private key, applies
// RFC 7748 clamping, and returns it base64-encoded (WireGuard format).
func generatePrivateKey() (string, error) {
        var priv [32]byte
        if _, err := rand.Read(priv[:]); err != nil {
                return "", fmt.Errorf("generate key: %w", err)
        }
        // Curve25519 clamping as per RFC 7748 §5
        priv[0] &= 248
        priv[31] &= 127
        priv[31] |= 64
        return base64.StdEncoding.EncodeToString(priv[:]), nil
}

// InitKeys ensures the service has a WireGuard private key:
//  1. If WG_PRIVATE_KEY env var is set, it is used as-is (allows manual override).
//  2. Otherwise the database is checked for a persisted key.
//  3. If none exists, a new key is generated, stored, and used.
//
// Call this once after migrations have run, before serving requests.
func (s *Service) InitKeys(ctx context.Context) error {
        // 1. Explicit env var wins.
        if s.cfg.WGPrivateKey != "" {
                log.Println("wireguard: using WG_PRIVATE_KEY from environment")
                return nil
        }

        // 2. Try loading from the database.
        var stored string
        err := s.pool.QueryRow(ctx,
                `SELECT value FROM server_settings WHERE key = 'wg_private_key'`,
        ).Scan(&stored)
        if err == nil && stored != "" {
                log.Println("wireguard: loaded private key from database")
                s.cfg.WGPrivateKey = stored
                return nil
        }

        // 3. Generate a new key and persist it.
        key, err := generatePrivateKey()
        if err != nil {
                return fmt.Errorf("wireguard: %w", err)
        }
        _, err = s.pool.Exec(ctx,
                `INSERT INTO server_settings (key, value) VALUES ('wg_private_key', $1)
                 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
                key,
        )
        if err != nil {
                return fmt.Errorf("wireguard: persist private key: %w", err)
        }
        s.cfg.WGPrivateKey = key
        log.Println("wireguard: generated and stored new private key")
        return nil
}

// ServerPublicKey derives the WireGuard server public key from the configured
// private key using Curve25519 scalar base multiplication.
func (s *Service) ServerPublicKey() (string, error) {
        if s.cfg.WGPrivateKey == "" {
                return "", fmt.Errorf("WG_PRIVATE_KEY not configured")
        }
        privBytes, err := base64.StdEncoding.DecodeString(s.cfg.WGPrivateKey)
        if err != nil {
                return "", fmt.Errorf("invalid WG_PRIVATE_KEY (expected base64): %w", err)
        }
        if len(privBytes) != 32 {
                return "", fmt.Errorf("WG_PRIVATE_KEY must decode to 32 bytes, got %d", len(privBytes))
        }
        pubBytes, err := curve25519.X25519(privBytes, curve25519.Basepoint)
        if err != nil {
                return "", fmt.Errorf("key derivation failed: %w", err)
        }
        return base64.StdEncoding.EncodeToString(pubBytes), nil
}

// ServerInfo returns the public key, public endpoint, listen port, and subnet.
// publicEndpoint is taken from WGPublicEndpoint config; if empty a placeholder
// is returned so the caller can signal the user to fill it in.
type ServerInfo struct {
        PublicKey string `json:"server_public_key"`
        Endpoint  string `json:"server_endpoint"`
        Port      int    `json:"listen_port"`
        Subnet    string `json:"subnet"`
}

func (s *Service) ServerInfo() ServerInfo {
        pubKey, _ := s.ServerPublicKey()

        // Use explicit config first; fall back to auto-detected IP.
        endpoint := s.cfg.WGPublicEndpoint
        if endpoint == "" {
                endpoint = detectedIP // may still be "" if detection failed
        }

        return ServerInfo{
                PublicKey: pubKey,
                Endpoint:  endpoint,
                Port:      s.cfg.WGListenPort,
                Subnet:    s.cfg.WGSubnet,
        }
}

func (s *Service) ListPeers(ctx context.Context) ([]Peer, error) {
        rows, err := s.pool.Query(ctx, `
                SELECT id, name, internal_ip, public_key,
                       TO_CHAR(last_handshake, 'YYYY-MM-DD HH24:MI:SS'), status
                FROM wg_peers ORDER BY created_at
        `)
        if err != nil {
                return nil, err
        }
        defer rows.Close()
        peers := make([]Peer, 0)
        for rows.Next() {
                var p Peer
                if err := rows.Scan(&p.ID, &p.Name, &p.InternalIP, &p.PublicKey, &p.LastHandshake, &p.Status); err != nil {
                        return nil, err
                }
                peers = append(peers, p)
        }
        return peers, nil
}

func (s *Service) AddPeer(ctx context.Context, name, ip, pubkey string) (*Peer, error) {
        // Validate IP is within subnet
        _, subnet, err := net.ParseCIDR(s.cfg.WGSubnet)
        if err != nil {
                return nil, fmt.Errorf("invalid WG subnet: %w", err)
        }
        parsedIP := net.ParseIP(ip)
        if parsedIP == nil || !subnet.Contains(parsedIP) {
                return nil, fmt.Errorf("IP %s is not within subnet %s", ip, s.cfg.WGSubnet)
        }

        var p Peer
        err = s.pool.QueryRow(ctx, `
                INSERT INTO wg_peers (name, internal_ip, public_key)
                VALUES ($1, $2, $3)
                RETURNING id, name, internal_ip, public_key, NULL::text, status
        `, name, ip, pubkey).Scan(&p.ID, &p.Name, &p.InternalIP, &p.PublicKey, &p.LastHandshake, &p.Status)
        if err != nil {
                return nil, err
        }
        return &p, nil
}

func (s *Service) DeletePeer(ctx context.Context, id uuid.UUID) error {
        _, err := s.pool.Exec(ctx, `DELETE FROM wg_peers WHERE id = $1`, id)
        return err
}

// GenerateServerConfig returns the full wg0.conf content for the server.
func (s *Service) GenerateServerConfig(ctx context.Context) (string, error) {
        peers, err := s.ListPeers(ctx)
        if err != nil {
                return "", err
        }

        const tmpl = `[Interface]
# OpenPortal WireGuard Server
Address = {{ .ServerIP }}/24
ListenPort = {{ .ListenPort }}
PrivateKey = {{ .PrivateKey }}
{{ range .Peers }}
[Peer]
# {{ .Name }}
PublicKey = {{ .PublicKey }}
AllowedIPs = {{ .InternalIP }}/32
{{ end }}`

        t, err := template.New("wg").Parse(tmpl)
        if err != nil {
                return "", err
        }
        var buf bytes.Buffer
        err = t.Execute(&buf, map[string]interface{}{
                "ServerIP":   s.cfg.WGServerIP,
                "ListenPort": s.cfg.WGListenPort,
                "PrivateKey": s.cfg.WGPrivateKey,
                "Peers":      peers,
        })
        return buf.String(), err
}

// GeneratePeerConfig returns the wg config for a peer to connect back to the server.
func (s *Service) GeneratePeerConfig(serverPubKey, peerIP string) string {
        return fmt.Sprintf(`[Interface]
PrivateKey = <PEER_PRIVATE_KEY>
Address = %s/32

[Peer]
# OpenPortal server
PublicKey = %s
Endpoint = <SERVER_PUBLIC_IP>:%d
AllowedIPs = %s
PersistentKeepalive = 25
`, peerIP, serverPubKey, s.cfg.WGListenPort, s.cfg.WGSubnet)
}

// SyncPeerStatus runs `wg show <iface> dump` and updates each peer's
// last_handshake and status columns in the DB based on actual kernel state.
//   - handshake ≤ 180s ago → "connected"
//   - handshake ≤ 600s ago → "idle"
//   - otherwise            → "disconnected"
// If the wg binary or interface is unavailable, this is a no-op.
func (s *Service) SyncPeerStatus(ctx context.Context) error {
        wgBin, err := exec.LookPath("wg")
        if err != nil {
                return nil // wg not installed — skip silently
        }
        cmd := exec.CommandContext(ctx, wgBin, "show", s.cfg.WGInterface, "dump")
        out, err := cmd.Output()
        if err != nil {
                return nil // interface not up — skip silently
        }

        now := time.Now()
        lines := strings.Split(strings.TrimSpace(string(out)), "\n")
        // First line is the interface itself; peers follow.
        for i, line := range lines {
                if i == 0 || line == "" {
                        continue
                }
                fields := strings.Split(line, "\t")
                // Peer dump columns: pubkey, psk, endpoint, allowed-ips, last-handshake, rx, tx, keepalive
                if len(fields) < 5 {
                        continue
                }
                pubkey := fields[0]
                hsUnix, parseErr := strconv.ParseInt(fields[4], 10, 64)
                if parseErr != nil {
                        continue
                }
                var (
                        handshakeTime *time.Time
                        status        = "disconnected"
                )
                if hsUnix > 0 {
                        t := time.Unix(hsUnix, 0)
                        handshakeTime = &t
                        age := now.Sub(t)
                        switch {
                        case age <= 180*time.Second:
                                status = "connected"
                        case age <= 600*time.Second:
                                status = "idle"
                        }
                }
                _, err := s.pool.Exec(ctx, `
                        UPDATE wg_peers
                           SET last_handshake = $2, status = $3
                         WHERE public_key = $1
                `, pubkey, handshakeTime, status)
                if err != nil {
                        log.Printf("wireguard: status update for peer %s: %v", pubkey[:8]+"…", err)
                }
        }
        return nil
}

// SyncInterface applies the current peer list to the live WireGuard interface
// by calling `wg syncconf`. Falls back to `wg setconf` for older wg-tools.
// If `wg` is not installed or the interface does not exist, logs a warning and
// returns nil so the caller can degrade gracefully.
func (s *Service) SyncInterface(ctx context.Context) error {
        if s.cfg.WGPrivateKey == "" {
                return nil // WireGuard not configured yet
        }

        wgBin, err := exec.LookPath("wg")
        if err != nil {
                log.Printf("wireguard: `wg` binary not found — skipping interface sync (peers saved to DB)")
                return nil
        }

        peers, err := s.ListPeers(ctx)
        if err != nil {
                return fmt.Errorf("wireguard sync: list peers: %w", err)
        }

        // Build a wg-setconf/wg-syncconf compatible config.
        // `Address` is a wg-quick extension — omit it here.
        var buf bytes.Buffer
        fmt.Fprintf(&buf, "[Interface]\nListenPort = %d\nPrivateKey = %s\n", s.cfg.WGListenPort, s.cfg.WGPrivateKey)
        for _, p := range peers {
                fmt.Fprintf(&buf, "\n[Peer]\n# %s\nPublicKey = %s\nAllowedIPs = %s/32\n", p.Name, p.PublicKey, p.InternalIP)
        }

        // Write to a temp file (wg setconf/syncconf require a file path, not stdin).
        tmp, err := os.CreateTemp("", "openportal-wg-*.conf")
        if err != nil {
                return fmt.Errorf("wireguard sync: create temp: %w", err)
        }
        defer os.Remove(tmp.Name())
        if _, err := tmp.WriteString(buf.String()); err != nil {
                tmp.Close()
                return fmt.Errorf("wireguard sync: write temp: %w", err)
        }
        tmp.Close()

        // Try wg syncconf first (graceful, doesn't disconnect existing peers).
        // Fall back to wg setconf (replaces all config atomically).
        for _, subcmd := range []string{"syncconf", "setconf"} {
                cmd := exec.CommandContext(ctx, wgBin, subcmd, s.cfg.WGInterface, tmp.Name())
                out, err := cmd.CombinedOutput()
                if err == nil {
                        log.Printf("wireguard: synced interface %s via `wg %s` (%d peer(s))", s.cfg.WGInterface, subcmd, len(peers))
                        return nil
                }
                log.Printf("wireguard: `wg %s` failed: %v — %s", subcmd, err, strings.TrimSpace(string(out)))
        }

        log.Printf("wireguard: interface sync failed — peers saved to DB; apply manually with `sudo wg syncconf %s <(wg-quick strip /etc/wireguard/%s.conf)`",
                s.cfg.WGInterface, s.cfg.WGInterface)
        return nil // non-fatal: peer is saved, just not live yet
}
