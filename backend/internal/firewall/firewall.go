// Package firewall implements an application-level IP firewall backed by
// the database. Rules are evaluated in priority order (lowest number first).
// The first matching rule wins; if no rule matches the request is allowed.
package firewall

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Rule struct {
	ID          uuid.UUID  `json:"id"`
	Priority    int        `json:"priority"`
	Action      string     `json:"action"`      // "allow" | "deny"
	CIDR        string     `json:"cidr"`
	Description string     `json:"description"`
	IsActive    bool       `json:"is_active"`
	CreatedBy   *uuid.UUID `json:"created_by,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
}

type Service struct {
	pool *pgxpool.Pool
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

func (s *Service) ListRules(ctx context.Context) ([]Rule, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, priority, action, cidr, description, is_active, created_by, created_at
		FROM firewall_rules ORDER BY priority, created_at
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var rules []Rule
	for rows.Next() {
		var r Rule
		if err := rows.Scan(&r.ID, &r.Priority, &r.Action, &r.CIDR, &r.Description, &r.IsActive, &r.CreatedBy, &r.CreatedAt); err != nil {
			return nil, err
		}
		rules = append(rules, r)
	}
	return rules, nil
}

func (s *Service) AddRule(ctx context.Context, action, cidr, description string, priority int, createdBy uuid.UUID) (*Rule, error) {
	// Validate CIDR before storing
	if _, _, err := net.ParseCIDR(cidr); err != nil {
		// Try as plain IP — convert to /32 or /128
		ip := net.ParseIP(cidr)
		if ip == nil {
			return nil, fmt.Errorf("invalid IP or CIDR: %s", cidr)
		}
		if ip.To4() != nil {
			cidr = cidr + "/32"
		} else {
			cidr = cidr + "/128"
		}
	}
	if action != "allow" && action != "deny" {
		return nil, fmt.Errorf("action must be 'allow' or 'deny'")
	}

	var r Rule
	err := s.pool.QueryRow(ctx, `
		INSERT INTO firewall_rules (action, cidr, description, priority, created_by)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, priority, action, cidr, description, is_active, created_by, created_at
	`, action, cidr, description, priority, createdBy).
		Scan(&r.ID, &r.Priority, &r.Action, &r.CIDR, &r.Description, &r.IsActive, &r.CreatedBy, &r.CreatedAt)
	return &r, err
}

func (s *Service) DeleteRule(ctx context.Context, id uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM firewall_rules WHERE id = $1`, id)
	return err
}

func (s *Service) ToggleRule(ctx context.Context, id uuid.UUID, active bool) error {
	_, err := s.pool.Exec(ctx, `UPDATE firewall_rules SET is_active = $1 WHERE id = $2`, active, id)
	return err
}

// CheckIP evaluates active rules against the given IP address.
// Returns ("allow", nil) if permitted, ("deny", rule) if blocked.
// Falls through to "allow" if no rule matches.
func (s *Service) CheckIP(ctx context.Context, ipStr string) (string, *Rule, error) {
	ip := net.ParseIP(ipStr)
	if ip == nil {
		return "allow", nil, nil // unparseable IP — let it through, log elsewhere
	}

	rules, err := s.ListRules(ctx)
	if err != nil {
		return "allow", nil, err // DB error — fail open so we don't lock everyone out
	}

	for i := range rules {
		r := &rules[i]
		if !r.IsActive {
			continue
		}
		_, network, err := net.ParseCIDR(r.CIDR)
		if err != nil {
			continue
		}
		if network.Contains(ip) {
			return r.Action, r, nil
		}
	}
	return "allow", nil, nil
}

// Middleware returns an HTTP middleware that blocks requests from denied IPs.
// The onBlock callback (if non-nil) is called for logging purposes.
func (s *Service) Middleware(onBlock func(r *http.Request, rule *Rule)) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip := realIP(r)
			action, rule, _ := s.CheckIP(r.Context(), ip)
			if action == "deny" {
				if onBlock != nil {
					onBlock(r, rule)
				}
				http.Error(w, "403 Forbidden", http.StatusForbidden)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func realIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := splitTrim(xff, ",")
		if len(parts) > 0 {
			return parts[0]
		}
	}
	if xri := r.Header.Get("X-Real-IP"); xri != "" {
		return xri
	}
	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return ip
}

func splitTrim(s, sep string) []string {
	var out []string
	for _, p := range splitStr(s, sep) {
		if t := trimStr(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}

func splitStr(s, sep string) []string {
	var out []string
	start := 0
	for i := 0; i <= len(s)-len(sep); i++ {
		if s[i:i+len(sep)] == sep {
			out = append(out, s[start:i])
			start = i + len(sep)
		}
	}
	out = append(out, s[start:])
	return out
}

func trimStr(s string) string {
	for len(s) > 0 && (s[0] == ' ' || s[0] == '\t') {
		s = s[1:]
	}
	for len(s) > 0 && (s[len(s)-1] == ' ' || s[len(s)-1] == '\t') {
		s = s[:len(s)-1]
	}
	return s
}
