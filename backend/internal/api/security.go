package api

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/openproxy/openproxy/internal/auth"
	"github.com/openproxy/openproxy/internal/auditlog"
	"github.com/openproxy/openproxy/internal/banmanager"
)

// GET /api/admin/security/status
func (h *handler) securityStatus(w http.ResponseWriter, r *http.Request) {
	bans, err := h.ban.ListBans(r.Context())
	if err != nil {
		respondErr(w, 500, err.Error())
		return
	}

	failures, err := h.ban.RecentFailures(r.Context())
	if err != nil {
		respondErr(w, 500, err.Error())
		return
	}

	cfg, err := h.ban.GetSettings(r.Context())
	if err != nil {
		respondErr(w, 500, err.Error())
		return
	}

	f2b := banmanager.GetFail2banStatus()

	respond(w, 200, map[string]interface{}{
		"settings":        cfg,
		"active_bans":     bans,
		"recent_failures": failures,
		"fail2ban":        f2b,
	})
}

// GET /api/admin/security/settings
func (h *handler) securityGetSettings(w http.ResponseWriter, r *http.Request) {
	cfg, err := h.ban.GetSettings(r.Context())
	if err != nil {
		respondErr(w, 500, err.Error())
		return
	}
	respond(w, 200, cfg)
}

// PUT /api/admin/security/settings
func (h *handler) securityUpdateSettings(w http.ResponseWriter, r *http.Request) {
	claims, _ := r.Context().Value(claimsKey).(*auth.Claims)
	var body banmanager.Settings
	if err := decode(r, &body); err != nil {
		respondErr(w, 400, "invalid body")
		return
	}
	if body.MaxRetries < 1 {
		body.MaxRetries = 1
	}
	if body.FindTimeSeconds < 30 {
		body.FindTimeSeconds = 30
	}
	if err := h.ban.UpdateSettings(r.Context(), body); err != nil {
		respondErr(w, 500, err.Error())
		return
	}
	uid, _ := uuid.Parse(claims.UserID)
	auditlog.Log(r.Context(), h.pool, auditlog.Event{
		ActorID: &uid, ActorEmail: claims.Email,
		Action:       "security_settings_updated",
		ResourceType: "security",
		IPAddress:    auditlog.ClientIP(r), UserAgent: r.UserAgent(),
		Severity: auditlog.Info,
	})
	respond(w, 200, map[string]string{"ok": "settings updated"})
}

// POST /api/admin/security/bans
func (h *handler) securityBanIP(w http.ResponseWriter, r *http.Request) {
	claims, _ := r.Context().Value(claimsKey).(*auth.Claims)
	var body struct {
		IP     string `json:"ip"`
		Reason string `json:"reason"`
	}
	if err := decode(r, &body); err != nil || body.IP == "" {
		respondErr(w, 400, "ip required")
		return
	}
	actorID, _ := uuid.Parse(claims.UserID)
	if err := h.ban.BanIP(r.Context(), body.IP, body.Reason, actorID); err != nil {
		respondErr(w, 500, err.Error())
		return
	}
	auditlog.Log(r.Context(), h.pool, auditlog.Event{
		ActorID: &actorID, ActorEmail: claims.Email,
		Action:       "manual_ban",
		ResourceType: "ip", ResourceID: body.IP,
		Details:   body.Reason,
		IPAddress: auditlog.ClientIP(r), UserAgent: r.UserAgent(),
		Severity: auditlog.Warn,
	})
	respond(w, 200, map[string]string{"ok": "banned"})
}

// DELETE /api/admin/security/bans/{id}
func (h *handler) securityUnbanID(w http.ResponseWriter, r *http.Request) {
	claims, _ := r.Context().Value(claimsKey).(*auth.Claims)
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		respondErr(w, 400, "invalid id")
		return
	}
	if err := h.ban.UnbanID(r.Context(), id); err != nil {
		respondErr(w, 500, err.Error())
		return
	}
	actorID, _ := uuid.Parse(claims.UserID)
	auditlog.Log(r.Context(), h.pool, auditlog.Event{
		ActorID: &actorID, ActorEmail: claims.Email,
		Action:       "manual_unban",
		ResourceType: "firewall_rule", ResourceID: id.String(),
		IPAddress: auditlog.ClientIP(r), UserAgent: r.UserAgent(),
		Severity: auditlog.Info,
	})
	respond(w, 200, map[string]string{"ok": "unbanned"})
}
