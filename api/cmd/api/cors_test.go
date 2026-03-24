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
