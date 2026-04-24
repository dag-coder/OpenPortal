// Package banmanager implements automatic IP ban logic based on failed login
// attempts recorded in audit_logs, and manages bans via firewall_rules.
// It also wraps fail2ban-client for OS-level enforcement when available.
package banmanager

import (
        "context"
        "fmt"
        "net"
        "os/exec"
        "strconv"
        "strings"
        "time"

        "github.com/google/uuid"
        "github.com/jackc/pgx/v5/pgxpool"
)

// Settings mirrors the ban_settings table rows.
type Settings struct {
        Enabled             bool `json:"enabled"`
        MaxRetries          int  `json:"max_retries"`
        FindTimeSeconds     int  `json:"find_time_seconds"`
        BanDurationSeconds  int  `json:"ban_duration_seconds"`
}

// FailureEntry represents a single IP's recent failure count.
type FailureEntry struct {
        IP        string    `json:"ip"`
        Count     int       `json:"count"`
        LastSeen  time.Time `json:"last_seen"`
        IsBanned  bool      `json:"is_banned"`
}

// BanEntry is an active ban record sourced from firewall_rules.
type BanEntry struct {
        ID          uuid.UUID  `json:"id"`
        IP          string     `json:"ip"`
        Description string     `json:"description"`
        CreatedAt   time.Time  `json:"created_at"`
        ExpiresAt   *time.Time `json:"expires_at,omitempty"`
        Source      string     `json:"source"` // "auto" | "manual" | "fail2ban"
}

// Fail2banStatus reflects the host-level fail2ban daemon state.
type Fail2banStatus struct {
        Available   bool   `json:"available"`
        Running     bool   `json:"running"`
        JailActive  bool   `json:"jail_active"`
        BannedCount int    `json:"banned_count"`
        Version     string `json:"version"`
}

// Status is the full picture returned by GetStatus.
type Status struct {
        Settings        Settings         `json:"settings"`
        ActiveBans      []BanEntry       `json:"active_bans"`
        RecentFailures  []FailureEntry   `json:"recent_failures"`
        Fail2ban        Fail2banStatus   `json:"fail2ban"`
}

// Service provides auto-ban management.
type Service struct {
        pool *pgxpool.Pool
}

func NewService(pool *pgxpool.Pool) *Service {
        return &Service{pool: pool}
}

// GetSettings reads ban_settings from the database.
func (s *Service) GetSettings(ctx context.Context) (Settings, error) {
        rows, err := s.pool.Query(ctx, `SELECT key, value FROM ban_settings`)
        if err != nil {
                return Settings{}, err
        }
        defer rows.Close()

        m := map[string]string{}
        for rows.Next() {
                var k, v string
                if err := rows.Scan(&k, &v); err != nil {
                        return Settings{}, err
                }
                m[k] = v
        }

        return Settings{
                Enabled:            parseBool(m["enabled"]),
                MaxRetries:         parseInt(m["max_retries"], 5),
                FindTimeSeconds:    parseInt(m["find_time_seconds"], 600),
                BanDurationSeconds: parseInt(m["ban_duration_seconds"], 1800),
        }, nil
}

// UpdateSettings writes updated values back to ban_settings.
func (s *Service) UpdateSettings(ctx context.Context, cfg Settings) error {
        updates := map[string]string{
                "enabled":              boolStr(cfg.Enabled),
                "max_retries":          strconv.Itoa(cfg.MaxRetries),
                "find_time_seconds":    strconv.Itoa(cfg.FindTimeSeconds),
                "ban_duration_seconds": strconv.Itoa(cfg.BanDurationSeconds),
        }
        for k, v := range updates {
                _, err := s.pool.Exec(ctx,
                        `INSERT INTO ban_settings (key, value) VALUES ($1,$2)
                         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, k, v)
                if err != nil {
                        return err
                }
        }
        return nil
}

// CheckAndBan is called after every failed login. If the IP has exceeded the
// configured threshold within the findTime window, a firewall deny rule is
// created automatically and, if fail2ban is available, the IP is also banned
// at the OS level.
func (s *Service) CheckAndBan(ctx context.Context, ip string) (banned bool, err error) {
        cfg, err := s.GetSettings(ctx)
        if err != nil || !cfg.Enabled {
                return false, err
        }

        // Count recent failures from audit_logs
        windowStart := time.Now().Add(-time.Duration(cfg.FindTimeSeconds) * time.Second)
        var count int
        err = s.pool.QueryRow(ctx, `
                SELECT COUNT(*) FROM audit_logs
                WHERE action = 'LOGIN_FAILED'
                  AND ip_address = $1
                  AND ts >= $2
        `, ip, windowStart).Scan(&count)
        if err != nil || count < cfg.MaxRetries {
                return false, err
        }

        // Threshold exceeded — add a firewall deny rule if not already banned
        var existing int
        _ = s.pool.QueryRow(ctx, `
                SELECT COUNT(*) FROM firewall_rules
                WHERE cidr = $1 AND action = 'deny' AND is_active = true
        `, normalizeIP(ip)).Scan(&existing)
        if existing > 0 {
                return true, nil // already banned
        }

        expDesc := fmt.Sprintf("auto-ban: %d failed logins (auto-expires)", count)
        if cfg.BanDurationSeconds <= 0 {
                expDesc = fmt.Sprintf("auto-ban: %d failed logins (permanent)", count)
        }

        _, err = s.pool.Exec(ctx, `
                INSERT INTO firewall_rules (action, cidr, description, priority, is_active)
                VALUES ('deny', $1, $2, 1, true)
                ON CONFLICT DO NOTHING
        `, normalizeIP(ip), expDesc)
        if err != nil {
                return false, err
        }

        // Try OS-level ban via fail2ban if available
        if fail2banAvailable() {
                _ = exec.Command("fail2ban-client", "set", "openportal-auth", "banip", ip).Run()
        }

        // Schedule unban if duration is finite
        if cfg.BanDurationSeconds > 0 {
                go func(banIP string, duration int) {
                        time.Sleep(time.Duration(duration) * time.Second)
                        unbanCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
                        defer cancel()
                        _ = s.unbanByIP(unbanCtx, banIP)
                }(ip, cfg.BanDurationSeconds)
        }

        return true, nil
}

// ListBans returns all active deny rules that were created by the ban engine.
func (s *Service) ListBans(ctx context.Context) ([]BanEntry, error) {
        rows, err := s.pool.Query(ctx, `
                SELECT id, cidr, description, created_at
                FROM firewall_rules
                WHERE action = 'deny' AND is_active = true
                ORDER BY created_at DESC
        `)
        if err != nil {
                return nil, err
        }
        defer rows.Close()

        bans := []BanEntry{}
        for rows.Next() {
                var b BanEntry
                if err := rows.Scan(&b.ID, &b.IP, &b.Description, &b.CreatedAt); err != nil {
                        return nil, err
                }
                b.Source = "manual"
                if strings.HasPrefix(b.Description, "auto-ban:") {
                        b.Source = "auto"
                }
                bans = append(bans, b)
        }
        return bans, nil
}

// BanIP manually adds an IP deny rule.
func (s *Service) BanIP(ctx context.Context, ip, reason string, actorID uuid.UUID) error {
        cidr := normalizeIP(ip)
        desc := "manual-ban: " + reason
        if reason == "" {
                desc = "manual-ban"
        }
        _, err := s.pool.Exec(ctx, `
                INSERT INTO firewall_rules (action, cidr, description, priority, is_active, created_by)
                VALUES ('deny', $1, $2, 1, true, $3)
        `, cidr, desc, actorID)
        if err != nil {
                return err
        }
        if fail2banAvailable() {
                _ = exec.Command("fail2ban-client", "set", "openportal-auth", "banip", ip).Run()
        }
        return nil
}

// UnbanID removes a ban by its firewall_rule ID.
func (s *Service) UnbanID(ctx context.Context, id uuid.UUID) error {
        // Look up the IP first so we can also unban from fail2ban
        var cidr string
        _ = s.pool.QueryRow(ctx, `SELECT cidr FROM firewall_rules WHERE id = $1`, id).Scan(&cidr)

        _, err := s.pool.Exec(ctx, `DELETE FROM firewall_rules WHERE id = $1`, id)
        if err == nil && cidr != "" && fail2banAvailable() {
                ip := strings.TrimSuffix(strings.TrimSuffix(cidr, "/32"), "/128")
                _ = exec.Command("fail2ban-client", "set", "openportal-auth", "unbanip", ip).Run()
        }
        return err
}

// unbanByIP removes active deny rules matching an exact CIDR (internal use).
func (s *Service) unbanByIP(ctx context.Context, ip string) error {
        cidr := normalizeIP(ip)
        _, err := s.pool.Exec(ctx,
                `DELETE FROM firewall_rules WHERE cidr = $1 AND action = 'deny'`, cidr)
        return err
}

// RecentFailures returns top IPs with failed login attempts in the last hour.
func (s *Service) RecentFailures(ctx context.Context) ([]FailureEntry, error) {
        since := time.Now().Add(-1 * time.Hour)
        rows, err := s.pool.Query(ctx, `
                SELECT ip_address, COUNT(*) AS cnt, MAX(ts) AS last_seen
                FROM audit_logs
                WHERE action = 'LOGIN_FAILED' AND ts >= $1 AND ip_address IS NOT NULL
                GROUP BY ip_address
                ORDER BY cnt DESC
                LIMIT 50
        `, since)
        if err != nil {
                return nil, err
        }
        defer rows.Close()

        var entries []FailureEntry
        for rows.Next() {
                var e FailureEntry
                if err := rows.Scan(&e.IP, &e.Count, &e.LastSeen); err != nil {
                        return nil, err
                }
                entries = append(entries, e)
        }

        // Mark which IPs are currently banned
        for i := range entries {
                var banned int
                _ = s.pool.QueryRow(ctx, `
                        SELECT COUNT(*) FROM firewall_rules
                        WHERE cidr = $1 AND action='deny' AND is_active=true
                `, normalizeIP(entries[i].IP)).Scan(&banned)
                entries[i].IsBanned = banned > 0
        }

        return entries, nil
}

// Fail2banStatus queries the host system for fail2ban state.
func GetFail2banStatus() Fail2banStatus {
        st := Fail2banStatus{}

        path, err := exec.LookPath("fail2ban-client")
        if err != nil || path == "" {
                return st
        }
        st.Available = true

        // Version
        if out, err := exec.Command("fail2ban-client", "--version").Output(); err == nil {
                lines := strings.Split(string(out), "\n")
                if len(lines) > 0 {
                        st.Version = strings.TrimSpace(lines[0])
                }
        }

        // Running?
        if err := exec.Command("fail2ban-client", "ping").Run(); err == nil {
                st.Running = true
        } else {
                return st
        }

        // Jail status
        out, err := exec.Command("fail2ban-client", "status", "openportal-auth").Output()
        if err == nil {
                st.JailActive = true
                txt := string(out)
                for _, line := range strings.Split(txt, "\n") {
                        if strings.Contains(line, "Currently banned:") {
                                parts := strings.SplitN(line, ":", 2)
                                if len(parts) == 2 {
                                        n, _ := strconv.Atoi(strings.TrimSpace(parts[1]))
                                        st.BannedCount = n
                                }
                        }
                }
        }
        return st
}

// ── helpers ──────────────────────────────────────────────────────────────────

func fail2banAvailable() bool {
        _, err := exec.LookPath("fail2ban-client")
        return err == nil
}

func normalizeIP(ip string) string {
        parsed := net.ParseIP(ip)
        if parsed == nil {
                if _, _, err := net.ParseCIDR(ip); err == nil {
                        return ip
                }
                return ip
        }
        if parsed.To4() != nil {
                return ip + "/32"
        }
        return ip + "/128"
}

func parseBool(s string) bool {
        return s == "true" || s == "1"
}

func boolStr(b bool) string {
        if b {
                return "true"
        }
        return "false"
}

func parseInt(s string, def int) int {
        n, err := strconv.Atoi(s)
        if err != nil {
                return def
        }
        return n
}
