package api

import (
        "context"
        "encoding/json"
        "errors"
        "fmt"
        "io"
        "net/http"
        "os"
        "strings"
        "time"

        "github.com/go-chi/chi/v5"
        "github.com/go-chi/chi/v5/middleware"
        "github.com/go-chi/cors"
        "github.com/google/uuid"
        "github.com/jackc/pgx/v5/pgxpool"
        "github.com/openproxy/openproxy/internal/auth"
        "github.com/openproxy/openproxy/internal/auditlog"
        "github.com/openproxy/openproxy/internal/banmanager"
        "github.com/openproxy/openproxy/internal/config"
        "github.com/openproxy/openproxy/internal/firewall"
        "github.com/openproxy/openproxy/internal/proxy"
        "github.com/openproxy/openproxy/internal/rbac"
        "github.com/openproxy/openproxy/internal/vault"
        "github.com/openproxy/openproxy/internal/wireguard"
        "golang.org/x/crypto/bcrypt"
)

type Server struct {
        *http.Server
}

func NewServer(cfg *config.Config, pool *pgxpool.Pool) *Server {
        authSvc := auth.NewService(cfg, pool)
        vaultSvc := vault.NewService(cfg, pool)
        rbacSvc := rbac.NewService(pool)
        wgSvc := wireguard.NewService(cfg, pool)
        fwSvc := firewall.NewService(pool)
        banSvc := banmanager.NewService(pool)
        proxyHandler := proxy.NewHandler(pool, authSvc, rbacSvc, vaultSvc)

        h := &handler{cfg: cfg, pool: pool, auth: authSvc, vault: vaultSvc, rbac: rbacSvc, wg: wgSvc, fw: fwSvc, ban: banSvc, proxy: proxyHandler}

        r := chi.NewRouter()
        r.Use(middleware.Logger)
        r.Use(middleware.Recoverer)
        r.Use(middleware.RealIP)
        r.Use(securityHeaders)

        // Application-level IP firewall — evaluated before any route
        r.Use(fwSvc.Middleware(func(req *http.Request, rule *firewall.Rule) {
                auditlog.Log(req.Context(), pool, auditlog.Event{
                        Action:       auditlog.ActionFirewallBlocked,
                        IPAddress:    auditlog.ClientIP(req),
                        UserAgent:    req.UserAgent(),
                        Details:      fmt.Sprintf("rule %s: %s %s", rule.ID, rule.Action, rule.CIDR),
                        Severity:     auditlog.Warn,
                })
        }))

        allowedOrigins := []string{cfg.FrontendURL, "http://localhost:5000", "http://localhost:5173"}
        if extra := os.Getenv("EXTRA_CORS_ORIGINS"); extra != "" {
                for _, o := range strings.Split(extra, ",") {
                        if o = strings.TrimSpace(o); o != "" {
                                allowedOrigins = append(allowedOrigins, o)
                        }
                }
        }
        r.Use(cors.Handler(cors.Options{
                AllowedOrigins:   allowedOrigins,
                AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
                AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type"},
                AllowCredentials: true,
                MaxAge:           300,
        }))

        // Public — rate-limited auth endpoints
        r.With(rateLimitLogin).Post("/api/auth/login", h.login)
        r.With(rateLimitLogin).Post("/api/auth/totp", h.verifyTOTPLogin)
        r.Post("/api/auth/logout", h.logout)

        // Authenticated
        r.Group(func(r chi.Router) {
                r.Use(h.requireAuth)

                r.Get("/api/me", h.getMe)

                // TOTP management (self-service)
                r.Get("/api/me/totp", h.totpStatus)
                r.Post("/api/me/totp/setup", h.totpSetup)
                r.Post("/api/me/totp/enable", h.totpEnable)
                r.Delete("/api/me/totp", h.totpDisable)

                // Tools (user-facing)
                r.Get("/api/tools", h.listTools)

                // Proxy endpoint
                r.HandleFunc("/proxy/{toolID}/*", h.serveProxy)
                r.HandleFunc("/proxy/{toolID}", h.serveProxy)
        })

        // Admin-only
        r.Group(func(r chi.Router) {
                r.Use(h.requireAuth)
                r.Use(h.requireAdmin)

                // Tools admin
                r.Get("/api/admin/tools", h.adminListTools)
                r.Post("/api/admin/tools", h.createTool)
                r.Put("/api/admin/tools/{id}", h.updateTool)
                r.Delete("/api/admin/tools/{id}", h.deleteTool)
                r.Put("/api/admin/tools/{id}/credentials", h.setCredentials)

                // Users
                r.Get("/api/admin/users", h.listUsers)
                r.Post("/api/admin/users", h.createUser)
                r.Put("/api/admin/users/{id}", h.updateUser)
                r.Patch("/api/admin/users/{id}/status", h.updateUserStatus)
                r.Put("/api/admin/users/{id}/role", h.updateUserRole)
                r.Delete("/api/admin/users/{id}", h.deleteUser)

                // Per-user credentials
                r.Put("/api/admin/users/{userID}/tools/{toolID}/credentials", h.setUserCredentials)
                r.Get("/api/admin/users/{userID}/tools/{toolID}/credentials", h.getUserCredentials)
                r.Delete("/api/admin/users/{userID}/tools/{toolID}/credentials", h.deleteUserCredentials)

                // Roles
                r.Get("/api/admin/roles", h.listRoles)
                r.Post("/api/admin/roles", h.createRole)
                r.Delete("/api/admin/roles/{id}", h.deleteRole)
                r.Put("/api/admin/roles/{id}/tools", h.setRoleTools)

                // WireGuard
                r.Get("/api/admin/wg/peers", h.listPeers)
                r.Post("/api/admin/wg/peers", h.addPeer)
                r.Delete("/api/admin/wg/peers/{id}", h.deletePeer)
                r.Get("/api/admin/wg/config", h.getWGConfig)
                r.Get("/api/admin/wg/server-info", h.getWGServerInfo)

                // Settings
                r.Get("/api/admin/settings", h.getSettings)
                r.Put("/api/admin/settings", h.updateSettings)

                // Auth detection
                r.Post("/api/admin/detect-auth", h.detectAuth)

                // Audit logs
                r.Get("/api/admin/audit-logs", h.listAuditLogs)

                // Firewall rules
                r.Get("/api/admin/firewall", h.listFirewallRules)
                r.Post("/api/admin/firewall", h.addFirewallRule)
                r.Delete("/api/admin/firewall/{id}", h.deleteFirewallRule)
                r.Patch("/api/admin/firewall/{id}/toggle", h.toggleFirewallRule)

				// Security / auto-ban
				r.Get("/api/admin/security/status", h.securityStatus)
				r.Get("/api/admin/security/settings", h.securityGetSettings)
				r.Put("/api/admin/security/settings", h.securityUpdateSettings)
				r.Post("/api/admin/security/bans", h.securityBanIP)
				r.Delete("/api/admin/security/bans/{id}", h.securityUnbanID)
        })

        return &Server{
                Server: &http.Server{
                        Addr:         ":" + cfg.Port,
                        Handler:      r,
                        ReadTimeout:  30 * time.Second,
                        WriteTimeout: 60 * time.Second,
                        IdleTimeout:  120 * time.Second,
                },
        }
}

// ── handler ──────────────────────────────────────────────────────────────────

type handler struct {
        cfg   *config.Config
        pool  *pgxpool.Pool
        auth  *auth.Service
        vault *vault.Service
        rbac  *rbac.Service
        wg    *wireguard.Service
        fw    *firewall.Service
        ban   *banmanager.Service
        proxy *proxy.Handler
}

// ── helpers ──────────────────────────────────────────────────────────────────

func respond(w http.ResponseWriter, status int, v interface{}) {
        w.Header().Set("Content-Type", "application/json")
        w.WriteHeader(status)
        _ = json.NewEncoder(w).Encode(v)
}

func respondErr(w http.ResponseWriter, status int, msg string) {
        respond(w, status, map[string]string{"error": msg})
}

func decode(r *http.Request, v interface{}) error {
        return json.NewDecoder(r.Body).Decode(v)
}

// ── middleware ────────────────────────────────────────────────────────────────

type ctxKey string
const claimsKey ctxKey = "claims"

func (h *handler) requireAuth(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
                var tokenStr string
                if c, err := r.Cookie("op_session"); err == nil {
                        tokenStr = c.Value
                } else if auth := r.Header.Get("Authorization"); len(auth) > 7 {
                        tokenStr = auth[7:]
                }
                if tokenStr == "" {
                        respondErr(w, http.StatusUnauthorized, "unauthorized")
                        return
                }
                claims, err := h.auth.Validate(tokenStr)
                if err != nil {
                        respondErr(w, http.StatusUnauthorized, "invalid token")
                        return
                }
                if claims.MFAPending {
                        respondErr(w, http.StatusUnauthorized, "mfa required")
                        return
                }
                ctx := context.WithValue(r.Context(), claimsKey, claims)
                next.ServeHTTP(w, r.WithContext(ctx))
        })
}

func (h *handler) requireAdmin(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
                claims, _ := r.Context().Value(claimsKey).(*auth.Claims)
                if claims == nil || !claims.IsAdmin {
                        respondErr(w, http.StatusForbidden, "admin required")
                        return
                }
                next.ServeHTTP(w, r)
        })
}

// ── auth handlers ─────────────────────────────────────────────────────────────

func (h *handler) login(w http.ResponseWriter, r *http.Request) {
        var body struct {
                Email    string `json:"email"`
                Password string `json:"password"`
        }
        if err := decode(r, &body); err != nil {
                respondErr(w, http.StatusBadRequest, "invalid body")
                return
        }
        ip := auditlog.ClientIP(r)
        ua := r.UserAgent()

        token, user, err := h.auth.Login(r.Context(), body.Email, body.Password)
        if errors.Is(err, auth.ErrMFARequired) {
                auditlog.Log(r.Context(), h.pool, auditlog.Event{
                        ActorEmail: body.Email, Action: auditlog.ActionTOTPRequired,
                        IPAddress: ip, UserAgent: ua, Severity: auditlog.Info,
                })
                respond(w, http.StatusOK, map[string]interface{}{
                        "totp_required": true,
                        "pending_token": token,
                })
                return
        }
        if err != nil {
                sev := auditlog.Warn
                action := auditlog.ActionLoginFailed
                if err.Error() == "account suspended" {
                        sev = auditlog.Critical
                        action = auditlog.ActionLoginSuspended
                }
                auditlog.Log(r.Context(), h.pool, auditlog.Event{
                        ActorEmail: body.Email, Action: action,
                        Details: err.Error(), IPAddress: ip, UserAgent: ua, Severity: sev,
                })
		// Trigger auto-ban check after recording the failure
		go func() { _, _ = h.ban.CheckAndBan(context.Background(), ip) }()
                respondErr(w, http.StatusUnauthorized, err.Error())
                return
        }
        uid, _ := uuid.Parse(user.ID.String())
        auditlog.Log(r.Context(), h.pool, auditlog.Event{
                ActorID: &uid, ActorEmail: user.Email, Action: auditlog.ActionLoginSuccess,
                IPAddress: ip, UserAgent: ua, Severity: auditlog.Info,
        })
        h.setSessionCookie(w, token)
        respond(w, http.StatusOK, map[string]interface{}{
                "token":    token,
                "email":    user.Email,
                "name":     user.Name,
                "is_admin": user.IsAdmin,
        })
}

func (h *handler) verifyTOTPLogin(w http.ResponseWriter, r *http.Request) {
        var body struct {
                PendingToken string `json:"pending_token"`
                Code         string `json:"code"`
        }
        if err := decode(r, &body); err != nil {
                respondErr(w, http.StatusBadRequest, "invalid body")
                return
        }
        ip := auditlog.ClientIP(r)
        ua := r.UserAgent()

        token, user, err := h.auth.VerifyTOTPLogin(r.Context(), body.PendingToken, body.Code)
        if err != nil {
                auditlog.Log(r.Context(), h.pool, auditlog.Event{
                        Action: auditlog.ActionTOTPFailed, Details: err.Error(),
                        IPAddress: ip, UserAgent: ua, Severity: auditlog.Critical,
                })
                respondErr(w, http.StatusUnauthorized, err.Error())
                return
        }
        uid, _ := uuid.Parse(user.ID.String())
        auditlog.Log(r.Context(), h.pool, auditlog.Event{
                ActorID: &uid, ActorEmail: user.Email, Action: auditlog.ActionTOTPSuccess,
                IPAddress: ip, UserAgent: ua, Severity: auditlog.Info,
        })
        h.setSessionCookie(w, token)
        respond(w, http.StatusOK, map[string]interface{}{
                "token":    token,
                "email":    user.Email,
                "name":     user.Name,
                "is_admin": user.IsAdmin,
        })
}

// setSessionCookie writes the session cookie with secure defaults.
func (h *handler) setSessionCookie(w http.ResponseWriter, token string) {
        secureCookies := os.Getenv("SECURE_COOKIES") != "false"
        http.SetCookie(w, &http.Cookie{
                Name:     "op_session",
                Value:    token,
                Path:     "/",
                HttpOnly: true,
                Secure:   secureCookies,
                SameSite: http.SameSiteStrictMode,
                MaxAge:   h.cfg.JWTExpiryHours * 3600,
        })
}

func (h *handler) totpStatus(w http.ResponseWriter, r *http.Request) {
        claims, _ := r.Context().Value(claimsKey).(*auth.Claims)
        var enabled bool
        _ = h.pool.QueryRow(r.Context(), `SELECT mfa_enabled FROM users WHERE id = $1`, claims.UserID).Scan(&enabled)
        respond(w, http.StatusOK, map[string]bool{"enabled": enabled})
}

func (h *handler) totpSetup(w http.ResponseWriter, r *http.Request) {
        claims, _ := r.Context().Value(claimsKey).(*auth.Claims)
        uri, secret, err := h.auth.SetupTOTP(r.Context(), claims.UserID)
        if err != nil {
                respondErr(w, http.StatusInternalServerError, err.Error())
                return
        }
        respond(w, http.StatusOK, map[string]string{
                "provisioning_uri": uri,
                "secret":           secret,
        })
}

func (h *handler) totpEnable(w http.ResponseWriter, r *http.Request) {
        claims, _ := r.Context().Value(claimsKey).(*auth.Claims)
        var body struct {
                Code string `json:"code"`
        }
        if err := decode(r, &body); err != nil {
                respondErr(w, http.StatusBadRequest, "invalid body")
                return
        }
        if err := h.auth.EnableTOTP(r.Context(), claims.UserID, body.Code); err != nil {
                respondErr(w, http.StatusBadRequest, err.Error())
                return
        }
        uid, _ := uuid.Parse(claims.UserID)
        auditlog.Log(r.Context(), h.pool, auditlog.Event{
                ActorID: &uid, ActorEmail: claims.Email, Action: auditlog.ActionTOTPEnabled,
                ResourceType: "user", ResourceID: claims.UserID,
                IPAddress: auditlog.ClientIP(r), UserAgent: r.UserAgent(), Severity: auditlog.Info,
        })
        respond(w, http.StatusOK, map[string]string{"ok": "totp enabled"})
}

func (h *handler) totpDisable(w http.ResponseWriter, r *http.Request) {
        claims, _ := r.Context().Value(claimsKey).(*auth.Claims)
        if err := h.auth.DisableTOTP(r.Context(), claims.UserID); err != nil {
                respondErr(w, http.StatusInternalServerError, err.Error())
                return
        }
        uid, _ := uuid.Parse(claims.UserID)
        auditlog.Log(r.Context(), h.pool, auditlog.Event{
                ActorID: &uid, ActorEmail: claims.Email, Action: auditlog.ActionTOTPDisabled,
                ResourceType: "user", ResourceID: claims.UserID,
                IPAddress: auditlog.ClientIP(r), UserAgent: r.UserAgent(), Severity: auditlog.Warn,
        })
        respond(w, http.StatusOK, map[string]string{"ok": "totp disabled"})
}

func (h *handler) logout(w http.ResponseWriter, r *http.Request) {
        // Best-effort: read claims for the audit entry
        var tokenStr string
        if c, err := r.Cookie("op_session"); err == nil {
                tokenStr = c.Value
        } else if ah := r.Header.Get("Authorization"); len(ah) > 7 {
                tokenStr = ah[7:]
        }
        if claims, err := h.auth.Validate(tokenStr); err == nil {
                uid, _ := uuid.Parse(claims.UserID)
                auditlog.Log(r.Context(), h.pool, auditlog.Event{
                        ActorID: &uid, ActorEmail: claims.Email, Action: auditlog.ActionLogout,
                        IPAddress: auditlog.ClientIP(r), UserAgent: r.UserAgent(), Severity: auditlog.Info,
                })
        }
        http.SetCookie(w, &http.Cookie{Name: "op_session", Value: "", MaxAge: -1, Path: "/"})
        respond(w, http.StatusOK, map[string]string{"ok": "logged out"})
}

func (h *handler) getMe(w http.ResponseWriter, r *http.Request) {
        claims, _ := r.Context().Value(claimsKey).(*auth.Claims)
        respond(w, http.StatusOK, claims)
}

// ── tools (user-facing) ──────────────────────────────────────────────────────

func (h *handler) listTools(w http.ResponseWriter, r *http.Request) {
        claims, _ := r.Context().Value(claimsKey).(*auth.Claims)
        ctx := r.Context()

        var rows interface{}
        if claims.IsAdmin {
                // Admins see all tools
                r2, err := h.pool.Query(ctx, `SELECT id, name, url, category, auth_type, is_private, status, custom_icon FROM tools ORDER BY name`)
                if err != nil { respondErr(w, 500, err.Error()); return }
                defer r2.Close()
                tools := []map[string]interface{}{}
                for r2.Next() {
                        var id uuid.UUID; var name, url, cat, authType, status string; var isPrivate bool; var customIcon *string
                        r2.Scan(&id, &name, &url, &cat, &authType, &isPrivate, &status, &customIcon)
                        tools = append(tools, map[string]interface{}{"id": id, "name": name, "url": url, "category": cat, "auth_type": authType, "is_private": isPrivate, "status": status, "custom_icon": customIcon})
                }
                rows = tools
        } else if claims.RoleID != "" {
                roleID, _ := uuid.Parse(claims.RoleID)
                toolIDs, err := h.rbac.ToolsForRole(ctx, roleID)
                if err != nil { respondErr(w, 500, err.Error()); return }
                if len(toolIDs) == 0 { respond(w, 200, []interface{}{}); return }
                r2, err := h.pool.Query(ctx, `SELECT id, name, url, category, auth_type, is_private, status, custom_icon FROM tools WHERE id = ANY($1) ORDER BY name`, toolIDs)
                if err != nil { respondErr(w, 500, err.Error()); return }
                defer r2.Close()
                tools := []map[string]interface{}{}
                for r2.Next() {
                        var id uuid.UUID; var name, url, cat, authType, status string; var isPrivate bool; var customIcon *string
                        r2.Scan(&id, &name, &url, &cat, &authType, &isPrivate, &status, &customIcon)
                        tools = append(tools, map[string]interface{}{"id": id, "name": name, "url": url, "category": cat, "auth_type": authType, "is_private": isPrivate, "status": status, "custom_icon": customIcon})
                }
                rows = tools
        } else {
                rows = []interface{}{}
        }
        respond(w, 200, rows)
}

// ── proxy handler ────────────────────────────────────────────────────────────

func (h *handler) serveProxy(w http.ResponseWriter, r *http.Request) {
        toolIDStr := chi.URLParam(r, "toolID")
        toolID, err := uuid.Parse(toolIDStr)
        if err != nil {
                http.Error(w, "invalid tool ID", http.StatusBadRequest)
                return
        }
        h.proxy.ServeProxy(w, r, toolID)
}

// ── admin: tools ──────────────────────────────────────────────────────────────

func (h *handler) adminListTools(w http.ResponseWriter, r *http.Request) {
        rows, err := h.pool.Query(r.Context(), `
                SELECT t.id, t.name, t.url, t.category, t.auth_type, t.is_private, t.use_wg, t.status, t.custom_icon,
                       ARRAY_AGG(ro.name) FILTER (WHERE ro.name IS NOT NULL) as roles
                FROM tools t
                LEFT JOIN role_tool_grants g ON g.tool_id = t.id
                LEFT JOIN roles ro ON ro.id = g.role_id
                GROUP BY t.id ORDER BY t.name
        `)
        if err != nil { respondErr(w, 500, err.Error()); return }
        defer rows.Close()
        tools := []map[string]interface{}{}
        for rows.Next() {
                var id uuid.UUID; var name, url, cat, authType, status string; var isPrivate, useWG bool; var customIcon *string; var roles []string
                rows.Scan(&id, &name, &url, &cat, &authType, &isPrivate, &useWG, &status, &customIcon, &roles)
                tools = append(tools, map[string]interface{}{"id": id, "name": name, "url": url, "category": cat, "auth_type": authType, "is_private": isPrivate, "use_wg": useWG, "status": status, "custom_icon": customIcon, "roles": roles})
        }
        respond(w, 200, tools)
}

func (h *handler) createTool(w http.ResponseWriter, r *http.Request) {
        claims, _ := r.Context().Value(claimsKey).(*auth.Claims)
        var body struct {
                Name       string  `json:"name"`
                URL        string  `json:"url"`
                Category   string  `json:"category"`
                AuthType   string  `json:"auth_type"`
                IsPrivate  bool    `json:"is_private"`
                UseWG      bool    `json:"use_wg"`
                CustomIcon *string `json:"custom_icon"`
        }
        if err := decode(r, &body); err != nil { respondErr(w, 400, "invalid body"); return }
        if body.Name == "" || len(body.Name) > 200 { respondErr(w, 400, "name required (max 200 chars)"); return }
        if body.URL == "" { respondErr(w, 400, "url required"); return }
        if body.Category == "" { body.Category = "General" }
        if body.AuthType == "" { body.AuthType = "none" }
        var id uuid.UUID
        err := h.pool.QueryRow(r.Context(), `
                INSERT INTO tools (name, url, category, auth_type, is_private, use_wg, custom_icon)
                VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id
        `, body.Name, body.URL, body.Category, body.AuthType, body.IsPrivate, body.UseWG, body.CustomIcon).Scan(&id)
        if err != nil { respondErr(w, 500, err.Error()); return }
        uid, _ := uuid.Parse(claims.UserID)
        auditlog.Log(r.Context(), h.pool, auditlog.Event{
                ActorID: &uid, ActorEmail: claims.Email, Action: auditlog.ActionToolCreated,
                ResourceType: "tool", ResourceID: id.String(), Details: body.Name,
                IPAddress: auditlog.ClientIP(r), UserAgent: r.UserAgent(), Severity: auditlog.Info,
        })
        respond(w, 201, map[string]interface{}{"id": id})
}

func (h *handler) updateTool(w http.ResponseWriter, r *http.Request) {
        claims, _ := r.Context().Value(claimsKey).(*auth.Claims)
        id, err := uuid.Parse(chi.URLParam(r, "id"))
        if err != nil { respondErr(w, 400, "invalid id"); return }
        var body struct {
                Name       string  `json:"name"`
                URL        string  `json:"url"`
                Category   string  `json:"category"`
                AuthType   string  `json:"auth_type"`
                IsPrivate  bool    `json:"is_private"`
                UseWG      bool    `json:"use_wg"`
                Status     string  `json:"status"`
                CustomIcon *string `json:"custom_icon"`
        }
        if err := decode(r, &body); err != nil { respondErr(w, 400, "invalid body"); return }
        if body.Category == "" { body.Category = "General" }
        if body.AuthType == "" { body.AuthType = "none" }
        _, err = h.pool.Exec(r.Context(), `
                UPDATE tools SET name=$1, url=$2, category=$3, auth_type=$4, is_private=$5, use_wg=$6, status=$7, custom_icon=$8
                WHERE id=$9
        `, body.Name, body.URL, body.Category, body.AuthType, body.IsPrivate, body.UseWG, body.Status, body.CustomIcon, id)
        if err != nil { respondErr(w, 500, err.Error()); return }
        uid, _ := uuid.Parse(claims.UserID)
        auditlog.Log(r.Context(), h.pool, auditlog.Event{
                ActorID: &uid, ActorEmail: claims.Email, Action: auditlog.ActionToolUpdated,
                ResourceType: "tool", ResourceID: id.String(), Details: body.Name,
                IPAddress: auditlog.ClientIP(r), UserAgent: r.UserAgent(), Severity: auditlog.Info,
        })
        respond(w, 200, map[string]string{"ok": "updated"})
}

func (h *handler) deleteTool(w http.ResponseWriter, r *http.Request) {
        claims, _ := r.Context().Value(claimsKey).(*auth.Claims)
        id, _ := uuid.Parse(chi.URLParam(r, "id"))
        // Capture tool name for the audit record
        var toolName string
        h.pool.QueryRow(r.Context(), `SELECT name FROM tools WHERE id=$1`, id).Scan(&toolName)
        h.vault.DeleteCredentials(r.Context(), id)
        h.pool.Exec(r.Context(), `DELETE FROM tools WHERE id=$1`, id)
        uid, _ := uuid.Parse(claims.UserID)
        auditlog.Log(r.Context(), h.pool, auditlog.Event{
                ActorID: &uid, ActorEmail: claims.Email, Action: auditlog.ActionToolDeleted,
                ResourceType: "tool", ResourceID: id.String(), Details: toolName,
                IPAddress: auditlog.ClientIP(r), UserAgent: r.UserAgent(), Severity: auditlog.Warn,
        })
        respond(w, 200, map[string]string{"ok": "deleted"})
}

func (h *handler) setCredentials(w http.ResponseWriter, r *http.Request) {
        toolID, err := uuid.Parse(chi.URLParam(r, "id"))
        if err != nil { respondErr(w, 400, "invalid id"); return }
        var creds map[string]string
        if err := decode(r, &creds); err != nil { respondErr(w, 400, "invalid body"); return }
        for k, v := range creds {
                if err := h.vault.SetCredential(r.Context(), toolID, k, v); err != nil {
                        respondErr(w, 500, err.Error()); return
                }
        }
        respond(w, 200, map[string]string{"ok": "credentials stored"})
}

// ── admin: users ──────────────────────────────────────────────────────────────

func (h *handler) listUsers(w http.ResponseWriter, r *http.Request) {
        rows, err := h.pool.Query(r.Context(), `
                SELECT u.id, u.email, u.name, ro.name, u.is_admin, u.mfa_enabled, u.status,
                       TO_CHAR(u.last_seen_at, 'YYYY-MM-DD HH24:MI'), u.created_at
                FROM users u
                LEFT JOIN roles ro ON ro.id = u.role_id
                ORDER BY u.created_at
        `)
        if err != nil { respondErr(w, 500, err.Error()); return }
        defer rows.Close()
        users := []map[string]interface{}{}
        for rows.Next() {
                var id uuid.UUID; var email, name, status string; var role, lastSeen *string
                var isAdmin, mfaEnabled bool; var createdAt time.Time
                rows.Scan(&id, &email, &name, &role, &isAdmin, &mfaEnabled, &status, &lastSeen, &createdAt)
                users = append(users, map[string]interface{}{"id": id, "email": email, "name": name, "role": role, "is_admin": isAdmin, "mfa_enabled": mfaEnabled, "status": status, "last_seen": lastSeen, "created_at": createdAt})
        }
        respond(w, 200, users)
}

func (h *handler) createUser(w http.ResponseWriter, r *http.Request) {
        actor, _ := r.Context().Value(claimsKey).(*auth.Claims)
        var body struct {
                Email    string `json:"email"`
                Name     string `json:"name"`
                Password string `json:"password"`
                RoleID   string `json:"role_id"`
        }
        if err := decode(r, &body); err != nil { respondErr(w, 400, "invalid body"); return }
        if body.Email == "" || len(body.Email) > 254 { respondErr(w, 400, "valid email required"); return }
        if body.Password == "" || len(body.Password) < 8 { respondErr(w, 400, "password must be at least 8 characters"); return }
        hash, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
        if err != nil { respondErr(w, 500, err.Error()); return }
        var roleID *uuid.UUID
        if body.RoleID != "" {
                id, err := uuid.Parse(body.RoleID)
                if err == nil { roleID = &id }
        }
        var id uuid.UUID
        err = h.pool.QueryRow(r.Context(), `
                INSERT INTO users (email, name, password_hash, role_id) VALUES ($1,$2,$3,$4) RETURNING id
        `, body.Email, body.Name, string(hash), roleID).Scan(&id)
        if err != nil { respondErr(w, 500, err.Error()); return }
        auid, _ := uuid.Parse(actor.UserID)
        auditlog.Log(r.Context(), h.pool, auditlog.Event{
                ActorID: &auid, ActorEmail: actor.Email, Action: auditlog.ActionUserCreated,
                ResourceType: "user", ResourceID: id.String(), Details: body.Email,
                IPAddress: auditlog.ClientIP(r), UserAgent: r.UserAgent(), Severity: auditlog.Info,
        })
        respond(w, 201, map[string]interface{}{"id": id})
}

func (h *handler) updateUserStatus(w http.ResponseWriter, r *http.Request) {
        actor, _ := r.Context().Value(claimsKey).(*auth.Claims)
        id, _ := uuid.Parse(chi.URLParam(r, "id"))
        var body struct{ Status string `json:"status"` }
        decode(r, &body)
        h.pool.Exec(r.Context(), `UPDATE users SET status=$1 WHERE id=$2`, body.Status, id)
        action := auditlog.ActionUserActivated
        sev := auditlog.Info
        if body.Status == "suspended" {
                action = auditlog.ActionUserSuspended
                sev = auditlog.Warn
        }
        auid, _ := uuid.Parse(actor.UserID)
        auditlog.Log(r.Context(), h.pool, auditlog.Event{
                ActorID: &auid, ActorEmail: actor.Email, Action: action,
                ResourceType: "user", ResourceID: id.String(),
                IPAddress: auditlog.ClientIP(r), UserAgent: r.UserAgent(), Severity: sev,
        })
        respond(w, 200, map[string]string{"ok": "updated"})
}

func (h *handler) updateUserRole(w http.ResponseWriter, r *http.Request) {
        actor, _ := r.Context().Value(claimsKey).(*auth.Claims)
        id, _ := uuid.Parse(chi.URLParam(r, "id"))
        var body struct{ RoleID string `json:"role_id"` }
        decode(r, &body)
        roleID, _ := uuid.Parse(body.RoleID)
        h.pool.Exec(r.Context(), `UPDATE users SET role_id=$1 WHERE id=$2`, roleID, id)
        auid, _ := uuid.Parse(actor.UserID)
        auditlog.Log(r.Context(), h.pool, auditlog.Event{
                ActorID: &auid, ActorEmail: actor.Email, Action: auditlog.ActionUserRoleChanged,
                ResourceType: "user", ResourceID: id.String(), Details: body.RoleID,
                IPAddress: auditlog.ClientIP(r), UserAgent: r.UserAgent(), Severity: auditlog.Info,
        })
        respond(w, 200, map[string]string{"ok": "updated"})
}

func (h *handler) deleteUser(w http.ResponseWriter, r *http.Request) {
        actor, _ := r.Context().Value(claimsKey).(*auth.Claims)
        id, _ := uuid.Parse(chi.URLParam(r, "id"))
        var email string
        h.pool.QueryRow(r.Context(), `SELECT email FROM users WHERE id=$1`, id).Scan(&email)
        h.pool.Exec(r.Context(), `DELETE FROM users WHERE id=$1`, id)
        auid, _ := uuid.Parse(actor.UserID)
        auditlog.Log(r.Context(), h.pool, auditlog.Event{
                ActorID: &auid, ActorEmail: actor.Email, Action: auditlog.ActionUserDeleted,
                ResourceType: "user", ResourceID: id.String(), Details: email,
                IPAddress: auditlog.ClientIP(r), UserAgent: r.UserAgent(), Severity: auditlog.Critical,
        })
        respond(w, 200, map[string]string{"ok": "deleted"})
}

// ── admin: roles ──────────────────────────────────────────────────────────────

func (h *handler) listRoles(w http.ResponseWriter, r *http.Request) {
        rows, err := h.pool.Query(r.Context(), `
                SELECT r.id, r.name, r.color,
                       COUNT(DISTINCT u.id) as user_count,
                       ARRAY_AGG(t.name) FILTER (WHERE t.name IS NOT NULL) as tools
                FROM roles r
                LEFT JOIN users u ON u.role_id = r.id
                LEFT JOIN role_tool_grants g ON g.role_id = r.id
                LEFT JOIN tools t ON t.id = g.tool_id
                GROUP BY r.id ORDER BY r.name
        `)
        if err != nil { respondErr(w, 500, err.Error()); return }
        defer rows.Close()
        roles := []map[string]interface{}{}
        for rows.Next() {
                var id uuid.UUID; var name, color string; var userCount int; var tools []string
                rows.Scan(&id, &name, &color, &userCount, &tools)
                roles = append(roles, map[string]interface{}{"id": id, "name": name, "color": color, "user_count": userCount, "tools": tools})
        }
        respond(w, 200, roles)
}

func (h *handler) createRole(w http.ResponseWriter, r *http.Request) {
        actor, _ := r.Context().Value(claimsKey).(*auth.Claims)
        var body struct{ Name string `json:"name"`; Color string `json:"color"` }
        if err := decode(r, &body); err != nil { respondErr(w, 400, "invalid body"); return }
        if body.Color == "" { body.Color = "#6366f1" }
        var id uuid.UUID
        err := h.pool.QueryRow(r.Context(), `INSERT INTO roles (name, color) VALUES ($1,$2) RETURNING id`, body.Name, body.Color).Scan(&id)
        if err != nil { respondErr(w, 500, err.Error()); return }
        auid, _ := uuid.Parse(actor.UserID)
        auditlog.Log(r.Context(), h.pool, auditlog.Event{
                ActorID: &auid, ActorEmail: actor.Email, Action: auditlog.ActionRoleCreated,
                ResourceType: "role", ResourceID: id.String(), Details: body.Name,
                IPAddress: auditlog.ClientIP(r), UserAgent: r.UserAgent(), Severity: auditlog.Info,
        })
        respond(w, 201, map[string]interface{}{"id": id})
}

func (h *handler) deleteRole(w http.ResponseWriter, r *http.Request) {
        actor, _ := r.Context().Value(claimsKey).(*auth.Claims)
        id, _ := uuid.Parse(chi.URLParam(r, "id"))
        var roleName string
        h.pool.QueryRow(r.Context(), `SELECT name FROM roles WHERE id=$1`, id).Scan(&roleName)
        h.pool.Exec(r.Context(), `DELETE FROM roles WHERE id=$1`, id)
        auid, _ := uuid.Parse(actor.UserID)
        auditlog.Log(r.Context(), h.pool, auditlog.Event{
                ActorID: &auid, ActorEmail: actor.Email, Action: auditlog.ActionRoleDeleted,
                ResourceType: "role", ResourceID: id.String(), Details: roleName,
                IPAddress: auditlog.ClientIP(r), UserAgent: r.UserAgent(), Severity: auditlog.Warn,
        })
        respond(w, 200, map[string]string{"ok": "deleted"})
}

func (h *handler) setRoleTools(w http.ResponseWriter, r *http.Request) {
        actor, _ := r.Context().Value(claimsKey).(*auth.Claims)
        roleID, err := uuid.Parse(chi.URLParam(r, "id"))
        if err != nil { respondErr(w, 400, "invalid id"); return }
        var body struct{ ToolIDs []string `json:"tool_ids"` }
        if err := decode(r, &body); err != nil { respondErr(w, 400, "invalid body"); return }
        ids := make([]uuid.UUID, 0, len(body.ToolIDs))
        for _, s := range body.ToolIDs {
                if id, err := uuid.Parse(s); err == nil { ids = append(ids, id) }
        }
        if err := h.rbac.SetRoleTools(r.Context(), roleID, ids); err != nil {
                respondErr(w, 500, err.Error()); return
        }
        auid, _ := uuid.Parse(actor.UserID)
        auditlog.Log(r.Context(), h.pool, auditlog.Event{
                ActorID: &auid, ActorEmail: actor.Email, Action: auditlog.ActionRoleGrantsUpdated,
                ResourceType: "role", ResourceID: roleID.String(),
                IPAddress: auditlog.ClientIP(r), UserAgent: r.UserAgent(), Severity: auditlog.Info,
        })
        respond(w, 200, map[string]string{"ok": "updated"})
}

// ── admin: wireguard ──────────────────────────────────────────────────────────

func (h *handler) listPeers(w http.ResponseWriter, r *http.Request) {
        peers, err := h.wg.ListPeers(r.Context())
        if err != nil { respondErr(w, 500, err.Error()); return }
        respond(w, 200, peers)
}

func (h *handler) addPeer(w http.ResponseWriter, r *http.Request) {
        actor, _ := r.Context().Value(claimsKey).(*auth.Claims)
        var body struct{ Name string `json:"name"`; IP string `json:"ip"`; PublicKey string `json:"public_key"` }
        if err := decode(r, &body); err != nil { respondErr(w, 400, "invalid body"); return }
        peer, err := h.wg.AddPeer(r.Context(), body.Name, body.IP, body.PublicKey)
        if err != nil { respondErr(w, 500, err.Error()); return }
        // Best-effort: apply the new peer to the live WireGuard interface.
        _ = h.wg.SyncInterface(r.Context())
        auid, _ := uuid.Parse(actor.UserID)
        auditlog.Log(r.Context(), h.pool, auditlog.Event{
                ActorID: &auid, ActorEmail: actor.Email, Action: auditlog.ActionPeerAdded,
                ResourceType: "wg_peer", ResourceID: peer.ID.String(), Details: body.Name + " " + body.IP,
                IPAddress: auditlog.ClientIP(r), UserAgent: r.UserAgent(), Severity: auditlog.Info,
        })
        respond(w, 201, peer)
}

func (h *handler) deletePeer(w http.ResponseWriter, r *http.Request) {
        actor, _ := r.Context().Value(claimsKey).(*auth.Claims)
        id, _ := uuid.Parse(chi.URLParam(r, "id"))
        // Capture peer name before deletion
        var peerName string
        h.pool.QueryRow(r.Context(), `SELECT name FROM wg_peers WHERE id=$1`, id).Scan(&peerName)
        h.wg.DeletePeer(r.Context(), id)
        // Best-effort: remove the peer from the live WireGuard interface.
        _ = h.wg.SyncInterface(r.Context())
        auid, _ := uuid.Parse(actor.UserID)
        auditlog.Log(r.Context(), h.pool, auditlog.Event{
                ActorID: &auid, ActorEmail: actor.Email, Action: auditlog.ActionPeerDeleted,
                ResourceType: "wg_peer", ResourceID: id.String(), Details: peerName,
                IPAddress: auditlog.ClientIP(r), UserAgent: r.UserAgent(), Severity: auditlog.Warn,
        })
        respond(w, 200, map[string]string{"ok": "deleted"})
}

func (h *handler) getWGConfig(w http.ResponseWriter, r *http.Request) {
        conf, err := h.wg.GenerateServerConfig(r.Context())
        if err != nil { respondErr(w, 500, err.Error()); return }
        respond(w, 200, map[string]string{"config": conf})
}

func (h *handler) getWGServerInfo(w http.ResponseWriter, r *http.Request) {
        respond(w, 200, h.wg.ServerInfo())
}

// ── admin: settings ───────────────────────────────────────────────────────────

func (h *handler) getSettings(w http.ResponseWriter, r *http.Request) {
        respond(w, 200, map[string]interface{}{
                "proxy_base_domain": h.cfg.ProxyBaseDomain,
                "jwt_expiry_hours":  h.cfg.JWTExpiryHours,
                "wg_interface":      h.cfg.WGInterface,
                "wg_server_ip":      h.cfg.WGServerIP,
                "wg_subnet":         h.cfg.WGSubnet,
                "wg_listen_port":    h.cfg.WGListenPort,
        })
}

func (h *handler) updateSettings(w http.ResponseWriter, r *http.Request) {
        // In production, persist to DB or config file; for now echo back
        respond(w, 200, map[string]string{"ok": "settings updated (restart to apply)"})
}

// ── admin: update user ────────────────────────────────────────────────────────

func (h *handler) updateUser(w http.ResponseWriter, r *http.Request) {
        id, err := uuid.Parse(chi.URLParam(r, "id"))
        if err != nil { respondErr(w, 400, "invalid id"); return }
        var body struct {
                Name     string `json:"name"`
                Email    string `json:"email"`
                Password string `json:"password"`
                RoleID   string `json:"role_id"`
                Status   string `json:"status"`
        }
        if err := decode(r, &body); err != nil { respondErr(w, 400, "invalid body"); return }

        // Update basic fields
        _, err = h.pool.Exec(r.Context(), `
                UPDATE users SET name=$1, email=$2, status=$3 WHERE id=$4
        `, body.Name, body.Email, body.Status, id)
        if err != nil { respondErr(w, 500, err.Error()); return }

        // Update role if provided
        if body.RoleID != "" {
                roleID, err := uuid.Parse(body.RoleID)
                if err == nil {
                        h.pool.Exec(r.Context(), `UPDATE users SET role_id=$1 WHERE id=$2`, roleID, id)
                }
        } else {
                h.pool.Exec(r.Context(), `UPDATE users SET role_id=NULL WHERE id=$1`, id)
        }

        // Update password if provided
        if body.Password != "" {
                hash, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
                if err == nil {
                        h.pool.Exec(r.Context(), `UPDATE users SET password_hash=$1 WHERE id=$2`, string(hash), id)
                }
        }

        respond(w, 200, map[string]string{"ok": "updated"})
}

// ── admin: per-user tool credentials ─────────────────────────────────────────

func (h *handler) setUserCredentials(w http.ResponseWriter, r *http.Request) {
        userID, err := uuid.Parse(chi.URLParam(r, "userID"))
        if err != nil { respondErr(w, 400, "invalid user id"); return }
        toolID, err := uuid.Parse(chi.URLParam(r, "toolID"))
        if err != nil { respondErr(w, 400, "invalid tool id"); return }

        var creds map[string]string
        if err := decode(r, &creds); err != nil { respondErr(w, 400, "invalid body"); return }

        for k, v := range creds {
                if err := h.vault.SetUserCredential(r.Context(), userID, toolID, k, v); err != nil {
                        respondErr(w, 500, err.Error()); return
                }
        }
        respond(w, 200, map[string]string{"ok": "user credentials stored"})
}

func (h *handler) getUserCredentials(w http.ResponseWriter, r *http.Request) {
        userID, err := uuid.Parse(chi.URLParam(r, "userID"))
        if err != nil { respondErr(w, 400, "invalid user id"); return }
        toolID, err := uuid.Parse(chi.URLParam(r, "toolID"))
        if err != nil { respondErr(w, 400, "invalid tool id"); return }

        // Return only keys (not values) to the admin — values stay server-side
        rows, err := h.pool.Query(r.Context(), `
                SELECT key, updated_at FROM user_tool_credentials
                WHERE user_id=$1 AND tool_id=$2 ORDER BY key
        `, userID, toolID)
        if err != nil { respondErr(w, 500, err.Error()); return }
        defer rows.Close()

        type entry struct {
                Key       string    `json:"key"`
                UpdatedAt time.Time `json:"updated_at"`
        }
        result := []entry{}
        for rows.Next() {
                var e entry
                rows.Scan(&e.Key, &e.UpdatedAt)
                result = append(result, e)
        }
        respond(w, 200, result)
}

func (h *handler) deleteUserCredentials(w http.ResponseWriter, r *http.Request) {
        userID, _ := uuid.Parse(chi.URLParam(r, "userID"))
        toolID, _ := uuid.Parse(chi.URLParam(r, "toolID"))
        h.vault.DeleteUserCredentials(r.Context(), userID, toolID)
        respond(w, 200, map[string]string{"ok": "deleted"})
}

// ── admin: detect auth type from URL ─────────────────────────────────────────

func (h *handler) detectAuth(w http.ResponseWriter, r *http.Request) {
        var body struct {
                URL string `json:"url"`
        }
        if err := decode(r, &body); err != nil {
                respondErr(w, 400, "invalid body")
                return
        }
        if body.URL == "" {
                respondErr(w, 400, "url required")
                return
        }

        authType := probeAuthType(body.URL)
        respond(w, 200, map[string]string{"auth_type": authType})
}

// probeAuthType makes a GET request (following redirects) to the URL and infers
// the auth method from response headers and body content.
func probeAuthType(rawURL string) string {
        client := &http.Client{
                Timeout: 8 * time.Second,
                // Follow redirects (default behaviour) so we land on the actual login page.
                CheckRedirect: func(req *http.Request, via []*http.Request) error {
                        if len(via) >= 6 {
                                return http.ErrUseLastResponse
                        }
                        return nil
                },
        }

        resp, err := client.Get(rawURL)
        if err != nil {
                return "none"
        }
        defer resp.Body.Close()

        wwwAuth   := resp.Header.Get("WWW-Authenticate")
        setCookie := strings.ToLower(resp.Header.Get("Set-Cookie"))
        ct        := resp.Header.Get("Content-Type")
        finalURL  := strings.ToLower(resp.Request.URL.String())
        status    := resp.StatusCode

        // WWW-Authenticate is the most reliable signal — check immediately.
        if wwwAuth != "" {
                lower := strings.ToLower(wwwAuth)
                switch {
                case strings.HasPrefix(lower, "basic"):
                        return "basic"
                case strings.HasPrefix(lower, "bearer"), strings.Contains(lower, "token"):
                        return "token"
                case strings.Contains(lower, "oauth"):
                        return "oauth"
                }
        }

        // SAML via cookie name
        if strings.Contains(setCookie, "saml") {
                return "saml"
        }

        // 401 JSON API → likely token-protected
        if status == 401 && strings.Contains(ct, "application/json") {
                return "token"
        }
        // 401 non-JSON → HTTP Basic dialog
        if status == 401 {
                return "basic"
        }

        // Check final URL for SSO/OAuth patterns
        for _, kw := range []string{"saml", "/sso/", "sso."} {
                if strings.Contains(finalURL, kw) {
                        return "saml"
                }
        }
        for _, kw := range []string{"oauth", "/authorize", "auth0.", "okta.", "keycloak", "oidc", "openid"} {
                if strings.Contains(finalURL, kw) {
                        return "oauth"
                }
        }

        // Read body (cap at 16 KB) and look for a password input → form-based login
        if strings.Contains(ct, "text/html") {
                body, _ := io.ReadAll(io.LimitReader(resp.Body, 16*1024))
                lower := strings.ToLower(string(body))
                if strings.Contains(lower, `type="password"`) || strings.Contains(lower, `type='password'`) {
                        // Distinguish OAuth/SAML form vs plain form
                        if strings.Contains(lower, "oauth") || strings.Contains(lower, "saml") ||
                                strings.Contains(lower, "openid") {
                                return "oauth"
                        }
                        return "basic"
                }
                // JSON-heavy SPA on the login path → treat as token
                if strings.Contains(lower, `"token"`) || strings.Contains(lower, `"jwt"`) {
                        return "token"
                }
        }

        return "none"
}

// ── admin: audit logs ─────────────────────────────────────────────────────────

func (h *handler) listAuditLogs(w http.ResponseWriter, r *http.Request) {
        q := r.URL.Query()
        limit := 200
        severity := q.Get("severity")
        action := q.Get("action")
        search := q.Get("search")

        query := `
                SELECT id, ts, actor_id, actor_email, action, resource_type, resource_id,
                       details, ip_address, user_agent, severity
                FROM audit_logs
                WHERE ($1 = '' OR severity = $1)
                  AND ($2 = '' OR action = $2)
                  AND ($3 = '' OR actor_email ILIKE '%' || $3 || '%'
                               OR action ILIKE '%' || $3 || '%'
                               OR details ILIKE '%' || $3 || '%'
                               OR ip_address ILIKE '%' || $3 || '%')
                ORDER BY ts DESC
                LIMIT $4
        `
        rows, err := h.pool.Query(r.Context(), query, severity, action, search, limit)
        if err != nil { respondErr(w, 500, err.Error()); return }
        defer rows.Close()

        type entry struct {
                ID           string     `json:"id"`
                Ts           time.Time  `json:"ts"`
                ActorID      *string    `json:"actor_id,omitempty"`
                ActorEmail   *string    `json:"actor_email,omitempty"`
                Action       string     `json:"action"`
                ResourceType *string    `json:"resource_type,omitempty"`
                ResourceID   *string    `json:"resource_id,omitempty"`
                Details      *string    `json:"details,omitempty"`
                IPAddress    *string    `json:"ip_address,omitempty"`
                UserAgent    *string    `json:"user_agent,omitempty"`
                Severity     string     `json:"severity"`
        }
        var logs []entry
        for rows.Next() {
                var e entry
                var eid uuid.UUID
                rows.Scan(&eid, &e.Ts, &e.ActorID, &e.ActorEmail, &e.Action,
                        &e.ResourceType, &e.ResourceID, &e.Details, &e.IPAddress, &e.UserAgent, &e.Severity)
                s := eid.String()
                e.ID = s
                logs = append(logs, e)
        }
        if logs == nil { logs = []entry{} }
        respond(w, 200, logs)
}

// ── admin: firewall ───────────────────────────────────────────────────────────

func (h *handler) listFirewallRules(w http.ResponseWriter, r *http.Request) {
        rules, err := h.fw.ListRules(r.Context())
        if err != nil { respondErr(w, 500, err.Error()); return }
        if rules == nil { rules = []firewall.Rule{} }
        respond(w, 200, rules)
}

func (h *handler) addFirewallRule(w http.ResponseWriter, r *http.Request) {
        actor, _ := r.Context().Value(claimsKey).(*auth.Claims)
        var body struct {
                Action      string `json:"action"`
                CIDR        string `json:"cidr"`
                Description string `json:"description"`
                Priority    int    `json:"priority"`
        }
        if err := decode(r, &body); err != nil { respondErr(w, 400, "invalid body"); return }
        if body.CIDR == "" { respondErr(w, 400, "cidr required"); return }
        if body.Priority == 0 { body.Priority = 100 }

        auid, _ := uuid.Parse(actor.UserID)
        rule, err := h.fw.AddRule(r.Context(), body.Action, body.CIDR, body.Description, body.Priority, auid)
        if err != nil { respondErr(w, 400, err.Error()); return }

        auditlog.Log(r.Context(), h.pool, auditlog.Event{
                ActorID: &auid, ActorEmail: actor.Email, Action: auditlog.ActionFirewallRuleAdded,
                ResourceType: "firewall_rule", ResourceID: rule.ID.String(),
                Details:   fmt.Sprintf("%s %s (priority %d) — %s", body.Action, body.CIDR, body.Priority, body.Description),
                IPAddress: auditlog.ClientIP(r), UserAgent: r.UserAgent(), Severity: auditlog.Warn,
        })
        respond(w, 201, rule)
}

func (h *handler) deleteFirewallRule(w http.ResponseWriter, r *http.Request) {
        actor, _ := r.Context().Value(claimsKey).(*auth.Claims)
        id, err := uuid.Parse(chi.URLParam(r, "id"))
        if err != nil { respondErr(w, 400, "invalid id"); return }
        if err := h.fw.DeleteRule(r.Context(), id); err != nil { respondErr(w, 500, err.Error()); return }
        auid, _ := uuid.Parse(actor.UserID)
        auditlog.Log(r.Context(), h.pool, auditlog.Event{
                ActorID: &auid, ActorEmail: actor.Email, Action: auditlog.ActionFirewallRuleDeleted,
                ResourceType: "firewall_rule", ResourceID: id.String(),
                IPAddress: auditlog.ClientIP(r), UserAgent: r.UserAgent(), Severity: auditlog.Warn,
        })
        respond(w, 200, map[string]string{"ok": "deleted"})
}

func (h *handler) toggleFirewallRule(w http.ResponseWriter, r *http.Request) {
        id, err := uuid.Parse(chi.URLParam(r, "id"))
        if err != nil { respondErr(w, 400, "invalid id"); return }
        var body struct{ Active bool `json:"active"` }
        if err := decode(r, &body); err != nil { respondErr(w, 400, "invalid body"); return }
        if err := h.fw.ToggleRule(r.Context(), id, body.Active); err != nil { respondErr(w, 500, err.Error()); return }
        respond(w, 200, map[string]string{"ok": "updated"})
}
