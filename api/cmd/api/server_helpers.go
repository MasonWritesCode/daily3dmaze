package main

import (
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

func (a app) currentTime() time.Time {
	if a.now != nil {
		return a.now().UTC()
	}

	return time.Now().UTC()
}

func configuredAllowedOrigins() map[string]struct{} {
	rawOrigins := envOrDefault(
		"WEB_ALLOWED_ORIGINS",
		"http://localhost:3000",
	)
	allowedOrigins := make(map[string]struct{})

	for _, origin := range strings.Split(rawOrigins, ",") {
		trimmedOrigin := strings.TrimSpace(origin)
		if trimmedOrigin == "" {
			continue
		}

		allowedOrigins[trimmedOrigin] = struct{}{}
	}

	return allowedOrigins
}

func withCORS(next http.Handler, allowedOrigins map[string]struct{}) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" {
			if _, allowed := allowedOrigins[origin]; allowed {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Vary", "Origin")
				w.Header().Set("Access-Control-Allow-Credentials", "true")
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			}
		}

		next.ServeHTTP(w, r)
	})
}

func withSecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		next.ServeHTTP(w, r)
	})
}

func configuredTrustProxyHeaders() bool {
	return strings.EqualFold(strings.TrimSpace(os.Getenv("TRUST_PROXY_HEADERS")), "true")
}

type authRateLimiter struct {
	limit         int
	window        time.Duration
	now           func() time.Time
	mu            sync.Mutex
	requestsByKey map[string][]time.Time
}

func newAuthRateLimiter(limit int, window time.Duration) *authRateLimiter {
	return &authRateLimiter{
		limit:         limit,
		window:        window,
		now:           time.Now,
		requestsByKey: make(map[string][]time.Time),
	}
}

func (l *authRateLimiter) allow(action, key string) bool {
	if l == nil || key == "" {
		return true
	}

	now := l.now().UTC()
	cutoff := now.Add(-l.window)
	bucketKey := action + ":" + key

	l.mu.Lock()
	defer l.mu.Unlock()

	existing := l.requestsByKey[bucketKey]
	kept := existing[:0]
	for _, timestamp := range existing {
		if !timestamp.Before(cutoff) {
			kept = append(kept, timestamp)
		}
	}

	if len(kept) >= l.limit {
		l.requestsByKey[bucketKey] = kept
		return false
	}

	l.requestsByKey[bucketKey] = append(kept, now)
	return true
}

func (a app) rateLimitKeyFromRequest(r *http.Request) string {
	if a.trustProxyHeaders {
		if forwardedFor := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); forwardedFor != "" {
			first := strings.TrimSpace(strings.Split(forwardedFor, ",")[0])
			if first != "" {
				return first
			}
		}

		if realIP := strings.TrimSpace(r.Header.Get("X-Real-IP")); realIP != "" {
			return realIP
		}
	}

	host, _, err := net.SplitHostPort(strings.TrimSpace(r.RemoteAddr))
	if err == nil && host != "" {
		return host
	}

	return strings.TrimSpace(r.RemoteAddr)
}
