// Package auditlog provides forensic-quality, append-only event logging.
// Every authentication event, admin action, and policy change is recorded.
package auditlog

import (
	"context"
	"log"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Severity levels
const (
	Info     = "info"
	Warn     = "warn"
	Critical = "critical"
)

// Action constants — every loggable event has a named constant.
const (
	// Auth
	ActionLoginSuccess      = "LOGIN_SUCCESS"
	ActionLoginFailed       = "LOGIN_FAILED"
	ActionLoginSuspended    = "LOGIN_SUSPENDED"
	ActionTOTPRequired      = "LOGIN_TOTP_REQUIRED"
	ActionTOTPSuccess       = "LOGIN_TOTP_SUCCESS"
	ActionTOTPFailed        = "LOGIN_TOTP_FAILED"
	ActionLogout            = "LOGOUT"
	ActionTokenRejected     = "TOKEN_REJECTED"

	// MFA management
	ActionTOTPEnabled       = "TOTP_ENABLED"
	ActionTOTPDisabled      = "TOTP_DISABLED"

	// User management
	ActionUserCreated       = "USER_CREATED"
	ActionUserUpdated       = "USER_UPDATED"
	ActionUserDeleted       = "USER_DELETED"
	ActionUserSuspended     = "USER_SUSPENDED"
	ActionUserActivated     = "USER_ACTIVATED"
	ActionUserRoleChanged   = "USER_ROLE_CHANGED"
	ActionPasswordChanged   = "PASSWORD_CHANGED"

	// Tool management
	ActionToolCreated       = "TOOL_CREATED"
	ActionToolUpdated       = "TOOL_UPDATED"
	ActionToolDeleted       = "TOOL_DELETED"
	ActionCredentialSet     = "CREDENTIAL_SET"
	ActionCredentialDeleted = "CREDENTIAL_DELETED"

	// Role management
	ActionRoleCreated       = "ROLE_CREATED"
	ActionRoleDeleted       = "ROLE_DELETED"
	ActionRoleGrantsUpdated = "ROLE_GRANTS_UPDATED"

	// WireGuard
	ActionPeerAdded         = "WG_PEER_ADDED"
	ActionPeerDeleted       = "WG_PEER_DELETED"

	// Firewall
	ActionFirewallRuleAdded   = "FIREWALL_RULE_ADDED"
	ActionFirewallRuleDeleted = "FIREWALL_RULE_DELETED"
	ActionFirewallBlocked     = "FIREWALL_BLOCKED"

	// Proxy access
	ActionProxyAccess       = "PROXY_ACCESS"
	ActionProxyDenied       = "PROXY_DENIED"

	// Settings
	ActionSettingsUpdated   = "SETTINGS_UPDATED"
)

// Event is a single audit record.
type Event struct {
	ActorID      *uuid.UUID
	ActorEmail   string
	Action       string
	ResourceType string
	ResourceID   string
	Details      string
	IPAddress    string
	UserAgent    string
	Severity     string
}

// Log writes an audit event to the database. Never panics — failures are
// logged to stderr so the main request path is never blocked.
func Log(ctx context.Context, pool *pgxpool.Pool, e Event) {
	if e.Severity == "" {
		e.Severity = Info
	}

	// Use a short-lived context so a slow DB never stalls the caller.
	writeCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	_, err := pool.Exec(writeCtx, `
		INSERT INTO audit_logs
			(actor_id, actor_email, action, resource_type, resource_id, details, ip_address, user_agent, severity)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`,
		e.ActorID, e.ActorEmail, e.Action,
		nilIfEmpty(e.ResourceType), nilIfEmpty(e.ResourceID), nilIfEmpty(e.Details),
		nilIfEmpty(e.IPAddress), nilIfEmpty(e.UserAgent), e.Severity,
	)
	if err != nil {
		log.Printf("auditlog: write failed: %v (action=%s)", err, e.Action)
	}
}

// ClientIP extracts the real client IP from a request, respecting
// X-Forwarded-For and X-Real-IP headers set by trusted proxies.
func ClientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		// Take the first (leftmost) address — that's the client.
		if parts := strings.Split(xff, ","); len(parts) > 0 {
			if ip := strings.TrimSpace(parts[0]); ip != "" {
				return ip
			}
		}
	}
	if xri := r.Header.Get("X-Real-IP"); xri != "" {
		return strings.TrimSpace(xri)
	}
	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return ip
}

func nilIfEmpty(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}
