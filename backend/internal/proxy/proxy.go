package proxy

import (
        "bytes"
        "context"
        "encoding/base64"
        "fmt"
        "io"
        "log"
        "net"
        "net/http"
        "net/http/httputil"
        "net/url"
        "regexp"
        "strings"
        "time"

        "github.com/google/uuid"
        "github.com/jackc/pgx/v5/pgxpool"
        "github.com/openproxy/openproxy/internal/auth"
        "github.com/openproxy/openproxy/internal/rbac"
        "github.com/openproxy/openproxy/internal/vault"
)

// reAttrAbsPath matches HTML attribute values that are absolute paths
// (starting with / but not // which is protocol-relative).
// Groups: (1) attr="  (2) /the/path...
var reAttrAbsPath = regexp.MustCompile(`(?i)((?:src|href|action|formaction|data-src|data-href)\s*=\s*["'])(/[^/"#][^"']*)`)

// reJSAbsPath matches common JS assignment patterns like location.href = '/path'
var reJSAbsPath = regexp.MustCompile(`((?:location\.href|window\.location|url)\s*=\s*["'])(/[^/"#][^"']*)`)

// reCSSUrl matches CSS url() absolute paths: url('/path') url("/path") url(/path)
// Groups: (1) opening quote  (2) /absolute/path  (3) closing quote
// Skips protocol-relative (//), data URIs, hash-only, and already-prefixed paths.
var reCSSUrl = regexp.MustCompile(`url\(\s*(["']?)(/[^/"'#()\s][^"')]*?)(["']?)\s*\)`)

type Tool struct {
        ID       uuid.UUID
        Name     string
        URL      string
        AuthType string
}

type Handler struct {
        pool     *pgxpool.Pool
        authSvc  *auth.Service
        rbacSvc  *rbac.Service
        vaultSvc *vault.Service
}

func NewHandler(pool *pgxpool.Pool, authSvc *auth.Service, rbacSvc *rbac.Service, vaultSvc *vault.Service) *Handler {
        return &Handler{pool: pool, authSvc: authSvc, rbacSvc: rbacSvc, vaultSvc: vaultSvc}
}

func (h *Handler) ServeProxy(w http.ResponseWriter, r *http.Request, toolID uuid.UUID) {
        ctx := r.Context()

        // 1. Validate session
        claims, err := h.extractClaims(r)
        if err != nil {
                http.Error(w, "unauthorized", http.StatusUnauthorized)
                return
        }

        // 2. RBAC
        if !claims.IsAdmin {
                if claims.RoleID == "" {
                        http.Error(w, "forbidden: no role assigned", http.StatusForbidden)
                        return
                }
                roleID, err := uuid.Parse(claims.RoleID)
                if err != nil {
                        http.Error(w, "forbidden", http.StatusForbidden)
                        return
                }
                allowed, err := h.rbacSvc.CanAccess(ctx, roleID, toolID)
                if err != nil || !allowed {
                        http.Error(w, "forbidden", http.StatusForbidden)
                        return
                }
        }

        // 3. Load tool
        tool, err := h.loadTool(ctx, toolID)
        if err != nil {
                http.Error(w, "tool not found", http.StatusNotFound)
                return
        }

        // 4. Parse target
        target, err := url.Parse(tool.URL)
        if err != nil {
                http.Error(w, "invalid tool URL", http.StatusInternalServerError)
                return
        }

        // 5. Resolve credentials — user-level overrides tool-level key-by-key
        userID, _ := uuid.Parse(claims.UserID)
        creds, credErr := h.vaultSvc.ResolveCredentials(ctx, userID, toolID)
        if credErr != nil {
                log.Printf("proxy: credential resolution failed for user=%s tool=%s: %v", claims.UserID, toolID, credErr)
                creds = map[string]string{}
        }
        credKeys := make([]string, 0, len(creds))
        for k := range creds { credKeys = append(credKeys, k) }
        log.Printf("proxy: tool=%s user=%s auth_type=%s cred_keys=%v", tool.Name, claims.Email, tool.AuthType, credKeys)

        // 6. Strip /proxy/<toolID> to get the sub-path
        prefix := "/proxy/" + toolID.String()
        subPath := strings.TrimPrefix(r.URL.Path, prefix)
        if subPath == "" {
                subPath = "/"
        }

        // 7. Build reverse proxy
        proxyPrefix := "/proxy/" + toolID.String()
        rp := &httputil.ReverseProxy{
                Director: func(req *http.Request) {
                        req.URL.Scheme   = target.Scheme
                        req.URL.Host     = target.Host
                        req.URL.Path     = subPath
                        req.URL.RawQuery = r.URL.RawQuery
                        req.Host         = target.Host

                        // Disable compression so we can modify response bodies
                        req.Header.Del("Accept-Encoding")

                        // Forward client IP
                        clientIP, _, ipErr := net.SplitHostPort(r.RemoteAddr)
                        if ipErr != nil {
                                clientIP = r.RemoteAddr
                        }
                        req.Header.Set("X-Real-IP", clientIP)
                        if prior := r.Header.Get("X-Forwarded-For"); prior != "" {
                                req.Header.Set("X-Forwarded-For", prior+", "+clientIP)
                        } else {
                                req.Header.Set("X-Forwarded-For", clientIP)
                        }
                        req.Header.Set("X-Forwarded-Proto", scheme(r))
                        req.Header.Set("X-OpenPortal-User", claims.Email)

                        // Strip our session cookie — never forward it upstream
                        req.Header.Del("Cookie")
                        if filtered := filterCookies(r.Cookies(), "op_session"); len(filtered) > 0 {
                                req.Header.Set("Cookie", cookieHeader(filtered))
                        }

                        // Rewrite Origin and Referer headers so the upstream server
                        // sees requests as same-origin.  Without this, CSRF middleware
                        // in Laravel, Django, Rails, etc. may reject the request.
                        toolOriginStr := target.Scheme + "://" + target.Host
                        if origin := req.Header.Get("Origin"); origin != "" && origin != toolOriginStr {
                                req.Header.Set("Origin", toolOriginStr)
                        }
                        if referer := req.Header.Get("Referer"); referer != "" {
                                if pu, pErr := url.Parse(referer); pErr == nil {
                                        pu.Scheme = target.Scheme
                                        pu.Host = target.Host
                                        if strings.HasPrefix(pu.Path, prefix+"/") {
                                                pu.Path = strings.TrimPrefix(pu.Path, prefix)
                                        } else if pu.Path == prefix {
                                                pu.Path = "/"
                                        }
                                        req.Header.Set("Referer", pu.String())
                                }
                        }

                        // Inject credentials only when the client app hasn't set
                        // its own Authorization header.  After a form-based login
                        // the app manages its own Bearer token — don't overwrite it.
                        if req.Header.Get("Authorization") == "" {
                                injectCredentials(req, creds, tool.AuthType)
                        }
                },

                ModifyResponse: func(resp *http.Response) error {
                        // Strip headers that break proxied rendering.
                        // CSP blocks injected scripts and cross-origin assets.
                        // X-Frame-Options / HSTS affect embedding and domain pinning.
                        resp.Header.Del("Content-Security-Policy")
                        resp.Header.Del("Content-Security-Policy-Report-Only")
                        resp.Header.Del("X-Frame-Options")
                        resp.Header.Del("X-XSS-Protection")
                        resp.Header.Del("Strict-Transport-Security")
                        resp.Header.Del("X-Powered-By")
                        resp.Header.Del("X-Content-Type-Options")

                        // ── Redirect rewriting ──────────────────────────────────────────
                        // Rewrite Location headers so the browser follows them through the proxy.
                        if resp.StatusCode >= 300 && resp.StatusCode < 400 {
                                if loc := resp.Header.Get("Location"); loc != "" {
                                        // Absolute path: /login → /proxy/{id}/login
                                        if strings.HasPrefix(loc, "/") && !strings.HasPrefix(loc, proxyPrefix) {
                                                resp.Header.Set("Location", proxyPrefix+loc)
                                        } else if strings.HasPrefix(loc, "http") {
                                                // Full URL pointing to the tool's own host → rewrite to proxy path
                                                if u, err := url.Parse(loc); err == nil && u.Host == target.Host {
                                                        resp.Header.Set("Location", proxyPrefix+u.RequestURI())
                                                }
                                        }
                                }
                        }

                        // ── Cookie rewriting ───────────────────────────────────────
                        // Rewrite Set-Cookie so cookies work cross-origin under /proxy/{id}/
                        if cookies := resp.Header["Set-Cookie"]; len(cookies) > 0 {
                                rewritten := make([]string, 0, len(cookies))
                                for _, c := range cookies {
                                        // Strip Domain and SameSite (proxy domain differs from tool domain)
                                        c = removeCookieAttr(c, "Domain")
                                        c = removeCookieAttr(c, "SameSite")
                                        // Rewrite or inject Path
                                        if strings.Contains(strings.ToLower(c), "path=") {
                                                c = replaceCookiePath(c, proxyPrefix+"/")
                                        } else {
                                                c += "; Path=" + proxyPrefix + "/"
                                        }
                                        rewritten = append(rewritten, c)
                                }
                                resp.Header["Set-Cookie"] = rewritten
                        }

                        // ── HTML base-tag injection + path rewriting + auto-fill ────────
                        ct := resp.Header.Get("Content-Type")
                        if strings.Contains(ct, "text/html") {
                                body, err := io.ReadAll(resp.Body)
                                resp.Body.Close()
                                if err != nil {
                                        return err
                                }

                                baseTag := `<base href="` + proxyPrefix + `/">`
                                // Inject fetch/XHR patch FIRST (in <head>) so it runs before app JS.
                                // This rewrites all runtime absolute-path fetch/XHR calls to route
                                // through the proxy, fixing React/Vue apps that call fetch('/api/...')
                                toolOrigin := target.Scheme + "://" + target.Host
                                fetchPatch := "<script>" + buildFetchPatchScript(proxyPrefix, toolOrigin) + "</script>\n"
                                patched := injectBaseTag(string(body), baseTag+"\n"+fetchPatch)
                                patched = rewriteAbsolutePaths(patched, proxyPrefix)
                                // Also rewrite full-URL action/href attributes pointing to the
                                // tool's own origin so forms POST through the proxy, preventing
                                // CSRF "Page Expired" errors from cross-origin form submissions.
                                patched = rewriteFullURLAttrs(patched, toolOrigin, proxyPrefix)

                                // Inject credential auto-fill script when form creds are present.
                                // This handles form-based logins where HTTP header injection doesn't apply.
                                if script := buildAutoFillScript(creds, proxyPrefix); script != "" {
                                        patched = injectBeforeBodyClose(patched, "<script>"+script+"</script>")
                                }

                                newBody := []byte(patched)
                                resp.Body = io.NopCloser(bytes.NewReader(newBody))
                                resp.ContentLength = int64(len(newBody))
                                resp.Header.Set("Content-Length", fmt.Sprint(len(newBody)))
                                resp.Header.Del("Content-Encoding")
                        }

                        // ── CSS url() absolute-path rewriting ──────────────────────────────
                        // Rewrite url('/path') in CSS so fonts, images, etc. load via the proxy.
                        if strings.Contains(ct, "text/css") {
                                body, err := io.ReadAll(resp.Body)
                                resp.Body.Close()
                                if err != nil {
                                        return err
                                }
                                patched := rewriteCSSUrls(string(body), proxyPrefix)
                                newBody := []byte(patched)
                                resp.Body = io.NopCloser(bytes.NewReader(newBody))
                                resp.ContentLength = int64(len(newBody))
                                resp.Header.Set("Content-Length", fmt.Sprint(len(newBody)))
                                resp.Header.Del("Content-Encoding")
                        }

                        return nil
                },

                ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
                        log.Printf("proxy: upstream error [%s]: %v", tool.Name, err)
                        http.Error(w, fmt.Sprintf("upstream unavailable: %v", err), http.StatusBadGateway)
                },

                Transport: &http.Transport{
                        DialContext: (&net.Dialer{
                                Timeout:   10 * time.Second,
                                KeepAlive: 30 * time.Second,
                        }).DialContext,
                        TLSHandshakeTimeout:   10 * time.Second,
                        ResponseHeaderTimeout: 60 * time.Second,
                        MaxIdleConns:          100,
                        IdleConnTimeout:       90 * time.Second,
                },
        }

        rp.ServeHTTP(w, r)
}

func injectCredentials(r *http.Request, creds map[string]string, authType string) {
        if len(creds) == 0 {
                return
        }

        // If authType is unset or "none", infer from the stored credential keys.
        // This handles cases where auto-detection returned "none" but credentials
        // were manually provided by the admin.
        effective := authType
        if effective == "" || effective == "none" {
                switch {
                case creds["username"] != "":
                        effective = "basic"
                case creds["token"] != "":
                        effective = "token"
                case creds["access_token"] != "":
                        effective = "oauth"
                case creds["session_cookie"] != "":
                        effective = "saml"
                }
        }

        switch effective {
        case "basic":
                user, pass := creds["username"], creds["password"]
                if user != "" {
                        r.Header.Set("Authorization", "Basic "+
                                base64.StdEncoding.EncodeToString([]byte(user+":"+pass)))
                }
        case "token":
                if t := creds["token"]; t != "" {
                        r.Header.Set("Authorization", "Bearer "+t)
                }
        case "oauth":
                if t := creds["access_token"]; t != "" {
                        r.Header.Set("Authorization", "Bearer "+t)
                } else if id := creds["client_id"]; id != "" {
                        r.Header.Set("Authorization", "Basic "+
                                base64.StdEncoding.EncodeToString([]byte(id+":"+creds["client_secret"])))
                }
        case "saml":
                if c := creds["session_cookie"]; c != "" {
                        if existing := r.Header.Get("Cookie"); existing != "" {
                                r.Header.Set("Cookie", existing+"; "+c)
                        } else {
                                r.Header.Set("Cookie", c)
                        }
                }
        }
}

func (h *Handler) extractClaims(r *http.Request) (*auth.Claims, error) {
        if c, err := r.Cookie("op_session"); err == nil && c.Value != "" {
                return h.authSvc.Validate(c.Value)
        }
        if hdr := r.Header.Get("Authorization"); strings.HasPrefix(hdr, "Bearer ") {
                return h.authSvc.Validate(hdr[7:])
        }
        return nil, fmt.Errorf("no session token")
}

func (h *Handler) loadTool(ctx context.Context, id uuid.UUID) (*Tool, error) {
        var t Tool
        err := h.pool.QueryRow(ctx,
                `SELECT id, name, url, auth_type FROM tools WHERE id = $1`, id,
        ).Scan(&t.ID, &t.Name, &t.URL, &t.AuthType)
        return &t, err
}

func scheme(r *http.Request) string {
        if r.TLS != nil {
                return "https"
        }
        if p := r.Header.Get("X-Forwarded-Proto"); p != "" {
                return p
        }
        return "http"
}

func filterCookies(cookies []*http.Cookie, exclude string) []*http.Cookie {
        out := make([]*http.Cookie, 0, len(cookies))
        for _, c := range cookies {
                if c.Name != exclude {
                        out = append(out, c)
                }
        }
        return out
}

func cookieHeader(cookies []*http.Cookie) string {
        parts := make([]string, len(cookies))
        for i, c := range cookies {
                parts[i] = c.Name + "=" + c.Value
        }
        return strings.Join(parts, "; ")
}

// buildFetchPatchScript returns a compact JS snippet that monkey-patches
// window.fetch and XMLHttpRequest.open so all absolute-path requests AND
// full-URL requests to the tool's own origin are transparently rerouted
// through the proxy prefix.  Must run before any app JS.
func buildFetchPatchScript(proxyPrefix, toolOrigin string) string {
        return fmt.Sprintf(`(function(){
  var PFX=%q,ORI=%q;
  function rw(u){
    if(typeof u!=='string')return u;
    if(u.startsWith(PFX))return u;
    // Rewrite full-URL calls to the tool's own origin
    if(ORI&&u.startsWith(ORI+'/'))return PFX+u.slice(ORI.length);
    // Rewrite absolute paths (e.g. /api/login)
    if(u.startsWith('/'))return PFX+u;
    return u;
  }
  var _f=window.fetch;
  window.fetch=function(u,o){return _f.call(this,rw(u),o);};
  var _o=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(){
    var a=Array.prototype.slice.call(arguments);
    if(a.length>1)a[1]=rw(a[1]);
    return _o.apply(this,a);
  };
})();`, proxyPrefix, toolOrigin)
}

// buildAutoFillScript generates a JS snippet that auto-fills and submits a
// login form using the stored credentials.  Returns "" when no usable creds.
// The script is idempotent per tab (sessionStorage guard) and React-compatible
// (uses the native input value setter to trigger synthetic event handlers).
func buildAutoFillScript(creds map[string]string, proxyPrefix string) string {
        username := creds["username"]
        password := creds["password"]
        if username == "" && password == "" {
                return ""
        }

        // Escape values for safe inline JS string literals
        jsEsc := func(s string) string {
                s = strings.ReplaceAll(s, `\`, `\\`)
                s = strings.ReplaceAll(s, `'`, `\'`)
                s = strings.ReplaceAll(s, "\n", `\n`)
                s = strings.ReplaceAll(s, "\r", `\r`)
                return s
        }

        // Derive a short stable key from the proxy prefix (strip slashes)
        key := "op_af_" + strings.NewReplacer("/", "_", "-", "_").Replace(strings.Trim(proxyPrefix, "/"))

        return fmt.Sprintf(`(function(){
  var KEY='%s',U='%s',P='%s';
  if(sessionStorage.getItem(KEY))return;
  function nset(el,v){
    var s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
    s.call(el,v);
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
  }
  function tryFill(){
    var pwd=document.querySelector('input[type=password]');
    if(!pwd)return false;
    var form=pwd.closest('form');
    if(U){
      var uf=form&&form.querySelector('input[type=text],input[type=email],input[name*=user],input[name*=login],input[name*=email]');
      if(!uf)uf=document.querySelector('input[type=text],input[type=email]');
      if(uf)nset(uf,U);
    }
    if(P)nset(pwd,P);
    sessionStorage.setItem(KEY,'1');
    setTimeout(function(){
      // Try submit button first (multiple selector strategies)
      var btn=form&&(
        form.querySelector('button[type=submit]')||
        form.querySelector('input[type=submit]')||
        form.querySelector('[type=submit]')||
        form.querySelector('button:not([type=button])')||
        form.querySelector('button')
      );
      if(btn){
        btn.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));
      }
      // Also fire Enter on the password field — most SPAs listen for this
      pwd.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true}));
      pwd.dispatchEvent(new KeyboardEvent('keypress',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true}));
      pwd.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true}));
      // Last-resort native submit (bypasses JS handlers but works for plain HTML forms)
      if(!btn&&form)setTimeout(function(){form.submit();},200);
    },600);
    return true;
  }
  var t=0;
  function poll(){if(tryFill()||++t>40)return;setTimeout(poll,200);}
  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',poll);}else{poll();}
})();`, key, jsEsc(username), jsEsc(password))
}

// rewriteCSSUrls rewrites absolute path url() references in CSS so fonts,
// background images, and other assets load via the proxy.
// url('/path') → url('/proxy/{id}/path')
// Skips data URIs, protocol-relative URLs, and already-prefixed paths.
func rewriteCSSUrls(css, prefix string) string {
        return reCSSUrl.ReplaceAllStringFunc(css, func(m string) string {
                sub := reCSSUrl.FindStringSubmatch(m)
                if len(sub) < 4 {
                        return m
                }
                openQ, path, closeQ := sub[1], sub[2], sub[3]
                if strings.HasPrefix(path, prefix) {
                        return m
                }
                return "url(" + openQ + prefix + path + closeQ + ")"
        })
}

// injectBeforeBodyClose inserts content just before </body> (or appends it).
func injectBeforeBodyClose(html, content string) string {
        idx := strings.LastIndex(strings.ToLower(html), "</body>")
        if idx != -1 {
                return html[:idx] + content + "\n" + html[idx:]
        }
        return html + "\n" + content
}

// rewriteAbsolutePaths rewrites absolute paths in HTML attribute values
// (src="/…", href="/…", action="/…") so they route through the proxy.
// Paths already containing the prefix are left unchanged.
// Protocol-relative URLs (//…) and anchors (#…) are skipped.
func rewriteAbsolutePaths(html, prefix string) string {
        rewrite := func(re *regexp.Regexp, s string) string {
                return re.ReplaceAllStringFunc(s, func(m string) string {
                        sub := re.FindStringSubmatch(m)
                        if len(sub) < 3 {
                                return m
                        }
                        path := sub[2]
                        if strings.HasPrefix(path, prefix) {
                                return m
                        }
                        return sub[1] + prefix + path
                })
        }
        html = rewrite(reAttrAbsPath, html)
        html = rewrite(reJSAbsPath, html)
        return html
}

// rewriteFullURLAttrs rewrites full-URL attribute values that point to the
// tool's own host so they go through the proxy instead of directly to the tool.
// Handles action="https://tool.com/path" → action="/proxy/{id}/path" in forms,
// links, and script/img/link tags.  Prevents broken CSRF, mixed-origin POSTs.
func rewriteFullURLAttrs(html, toolOrigin, prefix string) string {
        // Build a regex that targets only the specific tool's origin.
        // We escape the origin to avoid regex metacharacter issues.
        escaped := regexp.QuoteMeta(toolOrigin)
        re := regexp.MustCompile(`(?i)((?:src|href|action|formaction)\s*=\s*["'])` + escaped + `(/[^"']*)`)
        return re.ReplaceAllStringFunc(html, func(m string) string {
                sub := re.FindStringSubmatch(m)
                if len(sub) < 3 {
                        return m
                }
                path := sub[2]
                if strings.HasPrefix(path, prefix) {
                        return m
                }
                return sub[1] + prefix + path
        })
}

// injectBaseTag inserts <base href="..."> immediately after the opening <head>
// tag (or before <body> if there is no <head>, or at the very top as fallback).
func injectBaseTag(html, baseTag string) string {
        lower := strings.ToLower(html)

        // After <head> (with or without attributes)
        if idx := strings.Index(lower, "<head"); idx != -1 {
                end := strings.Index(html[idx:], ">")
                if end != -1 {
                        insertAt := idx + end + 1
                        return html[:insertAt] + "\n" + baseTag + html[insertAt:]
                }
        }
        // Before <body>
        if idx := strings.Index(lower, "<body"); idx != -1 {
                return html[:idx] + baseTag + "\n" + html[idx:]
        }
        // Fallback — prepend
        return baseTag + "\n" + html
}

// removeCookieAttr removes a specific attribute (case-insensitive) from a raw
// Set-Cookie header value (e.g. "Domain=example.com").
func removeCookieAttr(cookie, attr string) string {
        parts := strings.Split(cookie, ";")
        out := make([]string, 0, len(parts))
        prefix := strings.ToLower(strings.TrimSpace(attr)) + "="
        for _, p := range parts {
                trimmed := strings.ToLower(strings.TrimSpace(p))
                if trimmed == strings.ToLower(strings.TrimSpace(attr)) || strings.HasPrefix(trimmed, prefix) {
                        continue
                }
                out = append(out, p)
        }
        return strings.Join(out, ";")
}

// replaceCookiePath replaces the Path attribute value in a raw Set-Cookie string.
func replaceCookiePath(cookie, newPath string) string {
        parts := strings.Split(cookie, ";")
        out := make([]string, 0, len(parts))
        replaced := false
        for _, p := range parts {
                if strings.HasPrefix(strings.ToLower(strings.TrimSpace(p)), "path=") {
                        out = append(out, " Path="+newPath)
                        replaced = true
                } else {
                        out = append(out, p)
                }
        }
        if !replaced {
                out = append(out, " Path="+newPath)
        }
        return strings.Join(out, ";")
}
