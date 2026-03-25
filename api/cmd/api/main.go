package main

import (
	"database/sql"
	"log"
	"net/http"
	"os"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

type app struct {
	db                  *sql.DB
	authLimiter         *authRateLimiter
	now                 func() time.Time
	oauthClient         *http.Client
	oauthProviders      map[string]oauthProvider
	passwordResetSender passwordResetSender
	apiBaseURL          string
	webBaseURL          string
	allowedOrigins      map[string]struct{}
	trustProxyHeaders   bool
	secureCookies       bool
}

const (
	maxJSONBodyBytes  = 64 * 1024
	maxReplayEvents   = 512
	maxMoveCount      = 100000
	maxElapsedTimeMs  = 24 * 60 * 60 * 1000
	dateLayoutISO     = "2006-01-02"
	authRateLimit     = 10
	authWindow        = 5 * time.Minute
	stalePendingAfter = 90 * time.Second
)

func main() {
	port := os.Getenv("API_PORT")
	if port == "" {
		port = "8080"
	}

	db, err := openDatabase()
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	application := app{
		db:                  db,
		authLimiter:         newAuthRateLimiter(authRateLimit, authWindow),
		now:                 time.Now,
		oauthClient:         http.DefaultClient,
		oauthProviders:      configuredOAuthProviders(),
		passwordResetSender: configuredPasswordResetSender(),
		apiBaseURL:          envOrDefault("API_BASE_URL", "http://localhost:8080"),
		webBaseURL:          envOrDefault("WEB_BASE_URL", "http://localhost:3000"),
		allowedOrigins:      configuredAllowedOrigins(),
		trustProxyHeaders:   configuredTrustProxyHeaders(),
		secureCookies:       os.Getenv("APP_ENV") == "production",
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/api/daily-maze", dailyMazeHandler)
	mux.HandleFunc("/api/auth/register", application.registerHandler)
	mux.HandleFunc("/api/auth/login", application.loginHandler)
	mux.HandleFunc("/api/auth/logout", application.logoutHandler)
	mux.HandleFunc("/api/auth/forgot-password", application.forgotPasswordHandler)
	mux.HandleFunc("/api/auth/reset-password", application.resetPasswordHandler)
	mux.HandleFunc("/api/auth/verify-email/request", application.requestEmailVerificationHandler)
	mux.HandleFunc("/api/auth/verify-email", application.verifyEmailHandler)
	mux.HandleFunc("/api/auth/oauth/", application.oauthHandler)
	mux.HandleFunc("/api/me", application.meHandler)
	mux.HandleFunc("/api/profile", application.profileHandler)
	mux.HandleFunc("/api/history", application.historyHandler)
	mux.HandleFunc("/api/history/day", application.historyDayHandler)
	mux.HandleFunc("/api/runs", application.runSubmissionHandler)
	mux.HandleFunc("/api/runs/", application.runStatusHandler)
	mux.HandleFunc("/api/admin/run-reviews", application.recentRunReviewsHandler)
	mux.HandleFunc("/api/admin/run-reviews/recompute", application.recomputeRunReviewsHandler)
	mux.HandleFunc("/api/admin/run-reviews/", application.runReviewDetailHandler)
	mux.HandleFunc("/api/admin/users", application.adminUsersHandler)
	mux.HandleFunc("/api/admin/users/", application.adminUserDetailHandler)
	mux.HandleFunc("/api/leaderboard", application.leaderboardHandler)

	addr := ":" + port
	log.Printf("api listening on %s", addr)

	handler := withSecurityHeaders(withCORS(mux, application.allowedOrigins))
	if err := http.ListenAndServe(addr, handler); err != nil {
		log.Fatal(err)
	}
}
