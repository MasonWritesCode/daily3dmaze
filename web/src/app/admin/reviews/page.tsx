"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  fetchCurrentUser,
  recomputeRunReviews,
  fetchRunReviews,
  roleAllows,
  ROLE_ADMIN,
  ROLE_MODERATOR,
  type AuthUser,
  type RunReviewEntry,
  type RunReviewSummary
} from "../../../lib/api";
import { formatElapsedTime } from "../../../lib/game/maze";

type PageStatus = "loading" | "ready" | "error";
type RecomputeStatus = "idle" | "submitting" | "success" | "error";
type VerificationFilter = "all" | "pending" | "verified" | "suspicious" | "invalid";
type ReviewStatusFilter =
  | "all"
  | "unreviewed"
  | "reviewed_clean"
  | "confirmed_suspicious";
type SortMode = "risk" | "newest" | "oldest-pending";

function formatAcceptedAt(value: string): string {
  const date = new Date(value);
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function formatOptionalTimestamp(value: string | null): string {
  if (!value) {
    return "Not recorded";
  }

  return formatAcceptedAt(value);
}

function getSuspicionTone(score: number): string {
  if (score >= 50) {
    return "high";
  }

  if (score >= 20) {
    return "medium";
  }

  return "low";
}

function getVerificationTone(status: string): string {
  if (status === "pending") {
    return "pending";
  }

  if (status === "invalid") {
    return "high";
  }

  if (status === "suspicious") {
    return "medium";
  }

  return "low";
}

function formatReviewStatus(status: string): string {
  if (status === "reviewed_clean") {
    return "Reviewed clean";
  }

  if (status === "confirmed_suspicious") {
    return "Confirmed suspicious";
  }

  return "Unreviewed";
}

function getReviewTone(status: string): string {
  if (status === "confirmed_suspicious") {
    return "high";
  }

  if (status === "reviewed_clean") {
    return "low";
  }

  return "pending";
}

export default function AdminReviewsPage() {
  const [status, setStatus] = useState<PageStatus>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [entries, setEntries] = useState<RunReviewEntry[]>([]);
  const [summary, setSummary] = useState<RunReviewSummary | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [recomputeStatus, setRecomputeStatus] = useState<RecomputeStatus>("idle");
  const [recomputeMessage, setRecomputeMessage] = useState<string>("");
  const [verificationFilter, setVerificationFilter] =
    useState<VerificationFilter>("all");
  const [reviewStatusFilter, setReviewStatusFilter] =
    useState<ReviewStatusFilter>("all");
  const [showOnlyStalePending, setShowOnlyStalePending] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sortMode, setSortMode] = useState<SortMode>("risk");

  useEffect(() => {
    let cancelled = false;

    async function loadPage() {
      setStatus("loading");
      setErrorMessage(null);

      try {
        const currentUser = await fetchCurrentUser();
        if (cancelled) {
          return;
        }

        setUser(currentUser);

        if (!currentUser) {
          setStatus("ready");
          return;
        }

        if (!roleAllows(currentUser.role, ROLE_MODERATOR)) {
          setStatus("ready");
          return;
        }

        const payload = await fetchRunReviews();
        if (cancelled) {
          return;
        }

        setSummary(payload.summary);
        setEntries(payload.entries);
        setStatus("ready");
      } catch (error) {
        if (cancelled) {
          return;
        }

        setStatus("error");
        setErrorMessage(
          error instanceof Error ? error.message : "Unable to load run reviews."
        );
      }
    }

    void loadPage();

    return () => {
      cancelled = true;
    };
  }, []);

  const filteredEntries = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return entries.filter((entry) => {
      if (verificationFilter !== "all" && entry.verificationStatus !== verificationFilter) {
        return false;
      }

      if (reviewStatusFilter !== "all" && entry.reviewStatus !== reviewStatusFilter) {
        return false;
      }

      if (showOnlyStalePending && !entry.isStalePending) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      const haystack = [
        entry.username || "anonymous",
        entry.date,
        entry.seed,
        entry.verificationStatus,
        entry.reviewStatus,
        entry.reviewNotes
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedQuery);
    });
  }, [entries, reviewStatusFilter, searchQuery, showOnlyStalePending, verificationFilter]);

  const sortedEntries = useMemo(() => {
    const statusWeight = (status: string) =>
      status === "pending"
        ? 4
        : status === "invalid"
          ? 3
          : status === "suspicious"
            ? 2
            : 1;

    return [...filteredEntries].sort((left, right) => {
      if (sortMode === "newest") {
        return right.acceptedAt.localeCompare(left.acceptedAt);
      }

      if (sortMode === "oldest-pending") {
        if (left.verificationStatus === "pending" && right.verificationStatus !== "pending") {
          return -1;
        }

        if (right.verificationStatus === "pending" && left.verificationStatus !== "pending") {
          return 1;
        }

        return left.acceptedAt.localeCompare(right.acceptedAt);
      }

      const leftStatusWeight = statusWeight(left.verificationStatus);
      const rightStatusWeight = statusWeight(right.verificationStatus);
      if (rightStatusWeight !== leftStatusWeight) {
        return rightStatusWeight - leftStatusWeight;
      }

      if (right.suspicionScore !== left.suspicionScore) {
        return right.suspicionScore - left.suspicionScore;
      }

      return right.acceptedAt.localeCompare(left.acceptedAt);
    });
  }, [filteredEntries, sortMode]);

  async function handleRecompute() {
    setRecomputeStatus("submitting");
    setRecomputeMessage("");

    try {
      const recomputeResult = await recomputeRunReviews();
      const payload = await fetchRunReviews();
      setSummary(payload.summary);
      setEntries(payload.entries);
      setRecomputeStatus("success");
      setRecomputeMessage(
        `Recomputed ${recomputeResult.updatedCount} runs and skipped ${recomputeResult.skippedCount}.`
      );
    } catch (error) {
      setRecomputeStatus("error");
      setRecomputeMessage(
        error instanceof Error ? error.message : "Unable to recompute run reviews."
      );
    }
  }

  return (
    <main className="page-shell">
      <div className="content-card content-card-wide">
        <p className="eyebrow">Internal tooling</p>
        <h1>Suspicious run reviews</h1>
        <p className="body-copy">
          Review recent submissions with their replay heuristic score and the exact
          rules that fired. This page is read-only on purpose so we can inspect the
          signal quality before adding moderation actions.
        </p>
        <div className="actions">
          <Link href="/play" className="primary-link">
            Back to play
          </Link>
          <Link href="/history" className="secondary-link">
            Browse archive
          </Link>
        </div>

        {status === "loading" && (
          <p className="status-copy" aria-live="polite">
            Loading recent run reviews...
          </p>
        )}

        {status === "error" && errorMessage && (
          <p className="status-copy error-copy" role="alert">
            {errorMessage}
          </p>
        )}

        {status === "ready" && !user && (
          <section className="maze-summary" aria-labelledby="reviews-auth-title">
            <h2 id="reviews-auth-title" className="section-title">
              Sign in required
            </h2>
            <p className="body-copy">
              Internal review pages require an authenticated session. Sign in from the
              play page, then come back here.
            </p>
            <div className="actions">
              <Link href="/play" className="primary-link">
                Go sign in
              </Link>
            </div>
          </section>
        )}

        {status === "ready" && user && !roleAllows(user.role, ROLE_MODERATOR) && (
          <section className="maze-summary" aria-labelledby="reviews-forbidden-title">
            <h2 id="reviews-forbidden-title" className="section-title">
              Moderator access required
            </h2>
            <p className="body-copy">
              Your current role is <code>{user.role}</code>. Only moderator and admin
              accounts can access internal run reviews.
            </p>
          </section>
        )}

        {status === "ready" && user && roleAllows(user.role, ROLE_MODERATOR) && (
          <section className="maze-summary" aria-labelledby="review-table-title">
            <div className="review-header">
              <div>
                <h2 id="review-table-title" className="section-title">
                  Recent submissions
                </h2>
                <p className="assistive-copy">
                  Signed in as <strong>{user.username}</strong>.
                </p>
              </div>
              <div className="review-actions">
                {roleAllows(user.role, ROLE_ADMIN) && (
                  <Link href="/admin/users" className="secondary-link">
                    Manage users
                  </Link>
                )}
                <p className="assistive-copy">
                  Highest verification risk and suspicion scores are shown first.
                </p>
                {roleAllows(user.role, ROLE_ADMIN) && (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={handleRecompute}
                    disabled={recomputeStatus === "submitting"}
                  >
                    {recomputeStatus === "submitting"
                      ? "Recomputing..."
                      : "Recompute verification"}
                  </button>
                )}
              </div>
            </div>
            {recomputeMessage && (
              <p
                className={`body-copy status-copy ${
                  recomputeStatus === "error" ? "error-copy" : "success-copy"
                }`}
                aria-live="polite"
              >
                {recomputeMessage}
              </p>
            )}

            {summary && (
              <div className="summary-grid" aria-label="Verification queue health">
                <article className="summary-card">
                  <span className="summary-label">Pending</span>
                  <strong className="summary-value">{summary.pendingCount}</strong>
                </article>
                <article className="summary-card">
                  <span className="summary-label">Verified</span>
                  <strong className="summary-value">{summary.verifiedCount}</strong>
                </article>
                <article className="summary-card">
                  <span className="summary-label">Suspicious</span>
                  <strong className="summary-value">{summary.suspiciousCount}</strong>
                </article>
                <article className="summary-card">
                  <span className="summary-label">Invalid</span>
                  <strong className="summary-value">{summary.invalidCount}</strong>
                </article>
                <article className="summary-card">
                  <span className="summary-label">Stale pending</span>
                  <strong className="summary-value">{summary.stalePendingCount}</strong>
                </article>
              </div>
            )}

            <section className="filter-panel" aria-labelledby="review-filter-title">
              <h3 id="review-filter-title" className="section-title">
                Filters and sorting
              </h3>
              <div className="filter-grid">
                <label className="auth-field" htmlFor="verification-filter">
                  <span>Verification state</span>
                  <select
                    id="verification-filter"
                    value={verificationFilter}
                    onChange={(event) =>
                      setVerificationFilter(event.target.value as VerificationFilter)
                    }
                  >
                    <option value="all">All states</option>
                    <option value="pending">Pending</option>
                    <option value="verified">Verified</option>
                    <option value="suspicious">Suspicious</option>
                    <option value="invalid">Invalid</option>
                  </select>
                </label>

                <label className="auth-field" htmlFor="review-search">
                  <span>Search</span>
                  <input
                    id="review-search"
                    type="search"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Username, date, or seed"
                  />
                </label>

                <label className="auth-field" htmlFor="review-status-filter">
                  <span>Moderator status</span>
                  <select
                    id="review-status-filter"
                    value={reviewStatusFilter}
                    onChange={(event) =>
                      setReviewStatusFilter(event.target.value as ReviewStatusFilter)
                    }
                  >
                    <option value="all">All review states</option>
                    <option value="unreviewed">Unreviewed</option>
                    <option value="reviewed_clean">Reviewed clean</option>
                    <option value="confirmed_suspicious">Confirmed suspicious</option>
                  </select>
                </label>

                <label className="auth-field" htmlFor="review-sort">
                  <span>Sort by</span>
                  <select
                    id="review-sort"
                    value={sortMode}
                    onChange={(event) => setSortMode(event.target.value as SortMode)}
                  >
                    <option value="risk">Highest risk</option>
                    <option value="newest">Newest first</option>
                    <option value="oldest-pending">Oldest pending first</option>
                  </select>
                </label>

                <label className="checkbox-field" htmlFor="stale-pending-only">
                  <input
                    id="stale-pending-only"
                    type="checkbox"
                    checked={showOnlyStalePending}
                    onChange={(event) => setShowOnlyStalePending(event.target.checked)}
                  />
                  <span>Show only stale pending runs</span>
                </label>
              </div>
            </section>

            {sortedEntries.length === 0 ? (
              <p className="body-copy">
                No run reviews match the current filters.
              </p>
            ) : (
              <div className="review-list" role="list" aria-label="Recent run reviews">
                <div className="review-row review-row-header" role="listitem" aria-hidden="true">
                  <span>Verification</span>
                  <span>Score</span>
                  <span>Player</span>
                  <span>Challenge</span>
                  <span>Time</span>
                  <span>Moves</span>
                  <span>Review</span>
                  <span>Reasons</span>
                  <span>Accepted</span>
                </div>
                {sortedEntries.map((entry) => {
                  const tone = getSuspicionTone(entry.suspicionScore);
                  const playerLabel = entry.username || "Anonymous";

                  return (
                    <article
                      key={`${entry.acceptedAt}:${entry.seed}:${playerLabel}`}
                      className="review-row"
                      role="listitem"
                    >
                      <div>
                        <span
                          className={`score-badge score-badge-${getVerificationTone(
                            entry.verificationStatus
                          )}`}
                        >
                          {entry.verificationStatus}
                        </span>
                        <div className="review-detail-stack">
                          <span className="assistive-copy">
                            Attempts: {entry.verificationAttempts}
                          </span>
                          {entry.isStalePending && (
                            <span className="reason-chip">stale pending</span>
                          )}
                          {entry.verificationError && (
                            <span className="review-error-copy">
                              {entry.verificationError}
                            </span>
                          )}
                        </div>
                      </div>
                      <div>
                        <span className="sr-only">Suspicion score </span>
                        <span className={`score-badge score-badge-${tone}`}>
                          {entry.suspicionScore}
                        </span>
                      </div>
                      <div>
                        {entry.username ? (
                          <Link href={`/profile/${entry.username}`} className="inline-link">
                            {entry.username}
                          </Link>
                        ) : (
                          playerLabel
                        )}
                      </div>
                      <div className="review-challenge">
                        <Link href={`/history/${entry.date}`} className="inline-link">
                          {entry.date}
                        </Link>
                        <span>{entry.seed}</span>
                      </div>
                      <div>{formatElapsedTime(entry.elapsedTimeMs)}</div>
                      <div>{entry.moveCount}</div>
                      <div className="review-challenge">
                        <span className={`score-badge score-badge-${getReviewTone(entry.reviewStatus)}`}>
                          {formatReviewStatus(entry.reviewStatus)}
                        </span>
                        <span>
                          Reviewed: {formatOptionalTimestamp(entry.reviewedAt)}
                        </span>
                        <span>
                          Reviewer: {entry.reviewedByUsername ?? "Not recorded"}
                        </span>
                      </div>
                      <div className="reason-list" aria-label="Suspicion reasons">
                        {entry.suspicionReasons.length > 0 ? (
                          entry.suspicionReasons.map((reason) => (
                            <span key={reason} className="reason-chip">
                              {reason}
                            </span>
                          ))
                        ) : (
                          <span className="assistive-copy">None</span>
                        )}
                      </div>
                      <div className="review-challenge">
                        <span>{formatAcceptedAt(entry.acceptedAt)}</span>
                        <span>
                          Started: {formatOptionalTimestamp(entry.verificationStartedAt)}
                        </span>
                        <span>Finished: {formatOptionalTimestamp(entry.verifiedAt)}</span>
                      <Link href={`/admin/reviews/${entry.publicId}`} className="inline-link">
                        Inspect run
                      </Link>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
