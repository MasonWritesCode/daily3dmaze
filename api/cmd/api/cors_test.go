package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestConfiguredAllowedOriginsParsesCommaSeparatedValues(t *testing.T) {
	t.Setenv("WEB_ALLOWED_ORIGINS", "http://localhost:3000, http://192.168.0.10:3000")

	allowed := configuredAllowedOrigins()
	if _, ok := allowed["http://localhost:3000"]; !ok {
		t.Fatal("expected localhost origin to be allowed")
	}
	if _, ok := allowed["http://192.168.0.10:3000"]; !ok {
		t.Fatal("expected lan origin to be allowed")
	}
}

func TestWithCORSAllowsConfiguredOrigin(t *testing.T) {
	t.Parallel()

	handler := withCORS(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}), map[string]struct{}{
		"http://localhost:3000": {},
	})

	request := httptest.NewRequest(http.MethodGet, "/health", nil)
	request.Header.Set("Origin", "http://localhost:3000")
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	response := recorder.Result()
	defer response.Body.Close()

	if got := response.Header.Get("Access-Control-Allow-Origin"); got != "http://localhost:3000" {
		t.Fatalf("expected allowed origin header, got %q", got)
	}
	if got := response.Header.Get("Access-Control-Allow-Credentials"); got != "true" {
		t.Fatalf("expected credentials header, got %q", got)
	}
}

func TestWithCORSIgnoresUnconfiguredOrigin(t *testing.T) {
	t.Parallel()

	handler := withCORS(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}), map[string]struct{}{
		"http://localhost:3000": {},
	})

	request := httptest.NewRequest(http.MethodGet, "/health", nil)
	request.Header.Set("Origin", "http://evil.example")
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	response := recorder.Result()
	defer response.Body.Close()

	if got := response.Header.Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("expected no allow-origin header, got %q", got)
	}
}

func TestWithSecurityHeadersSetsBaselineHeaders(t *testing.T) {
	t.Parallel()

	handler := withSecurityHeaders(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	request := httptest.NewRequest(http.MethodGet, "/health", nil)
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	response := recorder.Result()
	defer response.Body.Close()

	if got := response.Header.Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("expected nosniff header, got %q", got)
	}
	if got := response.Header.Get("X-Frame-Options"); got != "DENY" {
		t.Fatalf("expected DENY frame header, got %q", got)
	}
	if got := response.Header.Get("Referrer-Policy"); got != "strict-origin-when-cross-origin" {
		t.Fatalf("unexpected referrer policy %q", got)
	}
}

func TestRateLimitKeyFromRequestIgnoresForwardedHeadersByDefault(t *testing.T) {
	application := app{}

	request := httptest.NewRequest(http.MethodPost, "/api/auth/login", nil)
	request.RemoteAddr = "127.0.0.1:1234"
	request.Header.Set("X-Forwarded-For", "203.0.113.20")
	request.Header.Set("X-Real-IP", "203.0.113.21")

	if got := application.rateLimitKeyFromRequest(request); got != "127.0.0.1" {
		t.Fatalf("expected remote addr key, got %q", got)
	}
}

func TestRateLimitKeyFromRequestUsesForwardedHeadersWhenTrusted(t *testing.T) {
	application := app{trustProxyHeaders: true}

	request := httptest.NewRequest(http.MethodPost, "/api/auth/login", nil)
	request.RemoteAddr = "127.0.0.1:1234"
	request.Header.Set("X-Forwarded-For", "203.0.113.20, 127.0.0.1")

	if got := application.rateLimitKeyFromRequest(request); got != "203.0.113.20" {
		t.Fatalf("expected forwarded key, got %q", got)
	}
}
