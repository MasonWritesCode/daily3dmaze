"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import RoleBadge from "../../components/RoleBadge";
import {
  authenticate,
  fetchLeaderboard,
  logout,
  roleAllows,
  ROLE_ADMIN,
  ROLE_MODERATOR,
  type AuthUser,
  type LeaderboardEntry
} from "../../lib/api";
import {
  githubOAuthEnabled,
  googleOAuthEnabled,
  oauthStartEndpoint
} from "../../lib/config";
import { formatElapsedTime } from "../../lib/game/maze";
import { useLocale } from "../../lib/locale";
import {
  getLeaderboardRankTone,
  getLocalizedDirectionLabel
} from "./helpers";

type SubmissionStatus = "idle" | "submitting" | "submitted" | "error";
type AuthMode = "login" | "register";
type AuthStatus = "loading" | "authenticated" | "unauthenticated";

interface LeaderboardProps {
  entries: LeaderboardEntry[];
  scope: "all" | "first";
  onScopeChange: (scope: "all" | "first") => void;
}

interface AuthPanelProps {
  user: AuthUser | null;
  onAuthChange: (nextUser: AuthUser | null) => void;
}

function Leaderboard({ entries, scope, onScopeChange }: LeaderboardProps) {
  const { formatCount, messages } = useLocale();
  const uiText = messages.play;
  return (
    <section className="maze-summary" aria-labelledby="leaderboard-title">
      <h2 id="leaderboard-title" className="section-title">
        {uiText.leaderboard.heading}
      </h2>
      <fieldset className="auth-toggle-group leaderboard-scope-toggle">
        <legend className="sr-only">{uiText.leaderboard.scopeLegend}</legend>
        <div className="auth-toggle" role="tablist" aria-label={uiText.leaderboard.scopeLegend}>
          <button
            type="button"
            className={scope === "all" ? "secondary-button is-active" : "secondary-button"}
            aria-pressed={scope === "all"}
            onClick={() => onScopeChange("all")}
          >
            {uiText.leaderboard.allRuns}
          </button>
          <button
            type="button"
            className={scope === "first" ? "secondary-button is-active" : "secondary-button"}
            aria-pressed={scope === "first"}
            onClick={() => onScopeChange("first")}
          >
            {uiText.leaderboard.firstRuns}
          </button>
        </div>
      </fieldset>
      {entries.length === 0 && <p className="body-copy">{uiText.leaderboard.empty}</p>}
      {entries.length > 0 && (
        <div className="leaderboard-list" aria-label={uiText.leaderboard.ariaLabel}>
          <div className="leaderboard-row leaderboard-row-header" aria-hidden="true">
            <span>{uiText.leaderboard.rank}</span>
            <span>{uiText.leaderboard.player}</span>
            <span>{uiText.leaderboard.elapsed}</span>
            <span>{uiText.leaderboard.moves}</span>
          </div>
          {entries.map((entry) => (
            <div
              key={`${entry.rank}-${entry.acceptedAt}`}
              className={`leaderboard-row leaderboard-row-${getLeaderboardRankTone(entry.rank)}`}
            >
              <span
                className={`leaderboard-rank leaderboard-rank-${getLeaderboardRankTone(
                  entry.rank
                )}`}
              >
                #{entry.rank}
              </span>
              <span>
                {entry.username ? (
                  <span className="player-link-with-badge">
                    <Link href={`/profile/${entry.username}`} className="inline-link">
                      {entry.username}
                    </Link>
                    <RoleBadge role={entry.role} labels={uiText.auth.roles} />
                  </span>
                ) : (
                  uiText.leaderboard.anonymous
                )}
              </span>
              <span>{formatElapsedTime(entry.elapsedTimeMs)}</span>
              <span>
                {formatCount(entry.moveCount)} {uiText.leaderboard.moveSuffix}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function AuthPanel({ user, onAuthChange }: AuthPanelProps) {
  const { messages } = useLocale();
  const uiText = messages.play;
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [status, setStatus] = useState<SubmissionStatus | "success">("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const errorId = "auth-panel-error";
  const helperId = "auth-panel-helper";
  const submitLabel =
    mode === "register" ? uiText.actions.createAccount : uiText.actions.logIn;
  const statusMessage =
    status === "submitting"
      ? mode === "register"
        ? uiText.auth.creatingAccount
        : uiText.auth.signingIn
      : status === "success"
        ? mode === "register"
          ? uiText.auth.registerSuccess
          : uiText.auth.loginSuccess
        : "";

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    setErrorMessage("");

    try {
      const authenticatedUser = await authenticate(mode, {
        username,
        email: mode === "register" ? email : undefined,
        password
      });
      onAuthChange(authenticatedUser);
      setStatus("success");
      setErrorMessage("");
      setPassword("");
      if (mode === "register") {
        setEmail("");
      }
    } catch (error) {
      setStatus("error");
      setErrorMessage(
        error instanceof Error ? error.message : uiText.authErrors.authenticationFailed
      );
    }
  }

  async function handleLogout() {
    setStatus("submitting");
    setErrorMessage("");

    try {
      await logout();
      onAuthChange(null);
      setStatus("idle");
      setPassword("");
    } catch (error) {
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : uiText.authErrors.logoutFailed);
    }
  }

  return (
    <section className="maze-summary" aria-labelledby="identity-title">
      <h2 id="identity-title" className="section-title">
        {uiText.auth.heading}
      </h2>
      {user ? (
        <>
          <p className="body-copy">
            {uiText.auth.signedInAs}{" "}
            <span className="player-link-with-badge">
              <Link href={`/profile/${user.username}`} className="inline-link">
                <code>{user.username}</code>
              </Link>
              <RoleBadge role={user.role} labels={uiText.auth.roles} />
            </span>
          </p>
          <div className="actions auth-panel-actions auth-panel-actions-authenticated">
            {roleAllows(user.role, ROLE_MODERATOR) && (
              <Link href="/admin/reviews" className="secondary-link">
                {uiText.authLinks.internalReviews}
              </Link>
            )}
            {roleAllows(user.role, ROLE_ADMIN) && (
              <Link href="/admin/users" className="secondary-link">
                {uiText.authLinks.manageUsers}
              </Link>
            )}
            <button type="button" className="secondary-button" onClick={handleLogout}>
              {uiText.actions.logOut}
            </button>
          </div>
        </>
      ) : (
        <form className="auth-form" onSubmit={handleSubmit} aria-describedby={helperId}>
          <fieldset className="auth-toggle-group">
            <legend className="sr-only">{uiText.auth.modeLegend}</legend>
            <div className="auth-toggle" role="tablist" aria-label={uiText.auth.modeLegend}>
              <button
                type="button"
                className={mode === "login" ? "secondary-button is-active" : "secondary-button"}
                aria-pressed={mode === "login"}
                onClick={() => {
                  setMode("login");
                  setStatus("idle");
                  setErrorMessage("");
                  setEmail("");
                }}
              >
                {uiText.actions.logIn}
              </button>
              <button
                type="button"
                className={
                  mode === "register" ? "secondary-button is-active" : "secondary-button"
                }
                aria-pressed={mode === "register"}
                onClick={() => {
                  setMode("register");
                  setStatus("idle");
                  setErrorMessage("");
                }}
              >
                {uiText.actions.createAccount}
              </button>
            </div>
          </fieldset>
          <p id={helperId} className="assistive-copy">
            {uiText.authHelper}
          </p>
          <label className="auth-field">
            <span>{uiText.auth.username}</span>
            <input
              type="text"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
              minLength={3}
              maxLength={32}
              aria-invalid={status === "error"}
              aria-describedby={status === "error" ? `${helperId} ${errorId}` : helperId}
            />
          </label>
          {mode === "register" && (
            <label className="auth-field">
              <span>{uiText.auth.email}</span>
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                aria-describedby={helperId}
              />
            </label>
          )}
          {mode === "register" && (
            <p className="assistive-copy">{uiText.registerEmailHelper}</p>
          )}
          <label className="auth-field">
            <span>{uiText.auth.password}</span>
            <input
              type="password"
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={10}
              aria-invalid={status === "error"}
              aria-describedby={status === "error" ? `${helperId} ${errorId}` : helperId}
            />
          </label>
          <div className="actions auth-panel-actions">
            <button type="submit" className="primary-button" disabled={status === "submitting"}>
              {submitLabel}
            </button>
            {mode === "login" && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => router.push("/reset-password")}
              >
                {uiText.actions.forgotPassword}
              </button>
            )}
            {mode === "register" && <span className="auth-panel-action-spacer" aria-hidden="true" />}
            {githubOAuthEnabled && (
              <a href={oauthStartEndpoint("github")} className="secondary-link">
                {uiText.auth.continueWithGitHub}
              </a>
            )}
            {googleOAuthEnabled && (
              <a href={oauthStartEndpoint("google")} className="secondary-link">
                {uiText.auth.continueWithGoogle}
              </a>
            )}
          </div>
          {(status === "submitting" || status === "success") && (
            <p className="body-copy status-copy success-copy" aria-live="polite">
              {statusMessage}
            </p>
          )}
          {status === "error" && errorMessage && (
            <p
              id={errorId}
              className="body-copy status-copy error-copy"
              aria-live="assertive"
            >
              {errorMessage}
            </p>
          )}
        </form>
      )}
    </section>
  );
}

interface PlaySidebarPanelsProps {
  mazeDate: string;
  user: AuthUser | null;
  authStatus: AuthStatus;
  leaderboardRefreshKey: number;
  isCompactLandscape: boolean;
  onAuthChange: (nextUser: AuthUser | null) => void;
}

export default function PlaySidebarPanels({
  mazeDate,
  user,
  authStatus,
  leaderboardRefreshKey,
  isCompactLandscape,
  onAuthChange
}: PlaySidebarPanelsProps) {
  const { messages } = useLocale();
  const uiText = messages.play;
  const [leaderboardEntries, setLeaderboardEntries] = useState<LeaderboardEntry[]>([]);
  const [leaderboardStatus, setLeaderboardStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [leaderboardScope, setLeaderboardScope] = useState<"all" | "first">("all");

  useEffect(() => {
    let isMounted = true;
    setLeaderboardStatus("loading");

    async function loadLeaderboard() {
      try {
        const payload = await fetchLeaderboard(mazeDate, leaderboardScope);

        if (!isMounted) {
          return;
        }

        setLeaderboardEntries(payload.entries || []);
        setLeaderboardStatus("success");
      } catch (error) {
        console.error("Failed to load leaderboard", error);

        if (!isMounted) {
          return;
        }

        setLeaderboardStatus("error");
      }
    }

    void loadLeaderboard();

    return () => {
      isMounted = false;
    };
  }, [leaderboardRefreshKey, leaderboardScope, mazeDate]);

  return (
    <>
      <div className="play-side-panels">
        <div className="play-side-panel">
          {isCompactLandscape ? (
            <details className="play-secondary-details">
              <summary>{uiText.leaderboard.title}</summary>
              <div className="play-secondary-details-body">
                {leaderboardStatus === "loading" && (
                  <p className="body-copy status-copy" aria-live="polite">
                    {uiText.loadingLeaderboard}
                  </p>
                )}
                {leaderboardStatus !== "error" && (
                  <Leaderboard
                    entries={leaderboardEntries}
                    scope={leaderboardScope}
                    onScopeChange={setLeaderboardScope}
                  />
                )}
              </div>
            </details>
          ) : (
            <>
              {leaderboardStatus === "loading" && (
                <p className="body-copy status-copy" aria-live="polite">
                  {uiText.loadingLeaderboard}
                </p>
              )}
              {leaderboardStatus !== "error" && (
                <Leaderboard
                  entries={leaderboardEntries}
                  scope={leaderboardScope}
                  onScopeChange={setLeaderboardScope}
                />
              )}
            </>
          )}
        </div>

        <div className="play-side-panel">
          {authStatus !== "loading" &&
            (isCompactLandscape ? (
              <details className="play-secondary-details">
                <summary>
                  {user ? uiText.authLinks.playerPanel : uiText.authLinks.signInPanel}
                </summary>
                <div className="play-secondary-details-body">
                  <AuthPanel user={user} onAuthChange={onAuthChange} />
                </div>
              </details>
            ) : (
              <AuthPanel user={user} onAuthChange={onAuthChange} />
            ))}
        </div>
      </div>

      {leaderboardStatus === "error" && (
        <p className="body-copy status-copy error-copy" aria-live="polite">
          {uiText.leaderboardError}
        </p>
      )}
    </>
  );
}
