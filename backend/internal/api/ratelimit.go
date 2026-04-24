package api

import (
	"net/http"
	"strings"
	"sync"
	"time"
)

// loginRateLimiter enforces per-IP rate limits on authentication endpoints
// using a token-bucket algorithm. This prevents brute-force and credential
// stuffing attacks without requiring external dependencies.
type loginRateLimiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket
}

type bucket struct {
	tokens   float64
	lastFill time.Time
}

const (
	loginBurstLimit  = 5                // max burst attempts
	loginRefillRate  = 1.0 / 60.0      // 1 token per minute (steady state)
	loginCleanupAge  = 10 * time.Minute // evict idle buckets
)

var loginLimiter = &loginRateLimiter{buckets: make(map[string]*bucket)}

func init() {
	// Periodically clean up idle buckets to prevent unbounded memory growth.
	go func() {
		for range time.Tick(5 * time.Minute) {
			loginLimiter.cleanup()
		}
	}()
}

func (l *loginRateLimiter) allow(ip string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := time.Now()
	b, ok := l.buckets[ip]
	if !ok {
		b = &bucket{tokens: loginBurstLimit, lastFill: now}
		l.buckets[ip] = b
	}

	// Refill based on elapsed time.
	elapsed := now.Sub(b.lastFill).Seconds()
	b.tokens += elapsed * loginRefillRate
	if b.tokens > loginBurstLimit {
		b.tokens = loginBurstLimit
	}
	b.lastFill = now

	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

func (l *loginRateLimiter) cleanup() {
	l.mu.Lock()
	defer l.mu.Unlock()
	cutoff := time.Now().Add(-loginCleanupAge)
	for ip, b := range l.buckets {
		if b.lastFill.Before(cutoff) {
			delete(l.buckets, ip)
		}
	}
}

// rateLimitLogin is middleware that applies the login rate limiter.
func rateLimitLogin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := extractIP(r)
		if !loginLimiter.allow(ip) {
			w.Header().Set("Retry-After", "60")
			respondErr(w, http.StatusTooManyRequests, "too many login attempts — try again in 60 seconds")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// securityHeaders sets hardened HTTP response headers on every response.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("X-XSS-Protection", "1; mode=block")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		h.Set("Content-Security-Policy",
			"default-src 'self'; "+
				"script-src 'self' 'unsafe-inline'; "+ // needed for Vite inline scripts
				"style-src 'self' 'unsafe-inline'; "+
				"img-src 'self' data:; "+
				"connect-src 'self'; "+
				"frame-ancestors 'none';")
		next.ServeHTTP(w, r)
	})
}

func extractIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.SplitN(xff, ",", 2)
		if ip := strings.TrimSpace(parts[0]); ip != "" {
			return ip
		}
	}
	if xri := r.Header.Get("X-Real-IP"); xri != "" {
		return strings.TrimSpace(xri)
	}
	if host, _, err := splitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return r.RemoteAddr
}

func splitHostPort(addr string) (string, string, error) {
	// Thin wrapper — avoids importing net just for this
	for i := len(addr) - 1; i >= 0; i-- {
		if addr[i] == ':' {
			return addr[:i], addr[i+1:], nil
		}
	}
	return "", "", http.ErrNoCookie // sentinel error
}
