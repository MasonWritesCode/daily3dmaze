"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import styles from "../admin.module.css";

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
import { useLocale } from "../../../lib/locale";
import {
  filterRunReviewEntries,
  getLocalizedReviewStatus,
  getLocalizedRoleLabel,
  getLocalizedSuspicionReason,
  getLocalizedVerificationStatus,
  getReviewTone,
  getSuspicionTone,
  getVerificationTone,
  sortRunReviewEntries,
  type ReviewStatusFilter,
  type SortMode,
  type VerificationFilter
} from "./helpers";

void styles;

type PageStatus = "loading" | "ready" | "error";
type RecomputeStatus = "idle" | "submitting" | "success" | "error";

export default function AdminReviewsPage() {
  const { formatCount, formatDateTime, messages } = useLocale();
  const uiText = messages.adminReviews;
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
  const resultsCountId = "review-filter-results";

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

  const filteredEntries = useMemo(
    () =>
      filterRunReviewEntries(entries, {
        verificationFilter,
        reviewStatusFilter,
        showOnlyStalePending,
        searchQuery
      }),
    [entries, reviewStatusFilter, searchQuery, showOnlyStalePending, verificationFilter]
  );

  const sortedEntries = useMemo(
    () => sortRunReviewEntries(filteredEntries, sortMode),
    [filteredEntries, sortMode]
  );

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
        uiText.recomputeMessage
          .replace("{updated}", formatCount(recomputeResult.updatedCount))
          .replace("{skipped}", formatCount(recomputeResult.skippedCount))
      );
    } catch (error) {
      setRecomputeStatus("error");
      setRecomputeMessage(
        error instanceof Error ? error.message : uiText.recomputeError
      );
    }
  }

  return (
    <main className="page-shell">
      <div className="content-card content-card-wide">
        <p className="eyebrow">{uiText.eyebrow}</p>
        <h1>{uiText.title}</h1>
        <p className="body-copy">{uiText.intro}</p>
        <div className="actions admin-page-toolbar">
          <Link href="/play" className="primary-link">
            {uiText.actions.returnToChallenge}
          </Link>
          <Link href="/history" className="secondary-link">
            {uiText.actions.challengeArchive}
          </Link>
        </div>

        {status === "loading" && (
          <p className="status-copy" aria-live="polite">
            {uiText.loading}
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
              {uiText.authRequiredTitle}
            </h2>
            <p className="body-copy">{uiText.authRequiredBody}</p>
            <div className="actions">
              <Link href="/play" className="primary-link">
                {uiText.actions.goToSignIn}
              </Link>
            </div>
          </section>
        )}

        {status === "ready" && user && !roleAllows(user.role, ROLE_MODERATOR) && (
          <section className="maze-summary" aria-labelledby="reviews-forbidden-title">
            <h2 id="reviews-forbidden-title" className="section-title">
              {uiText.forbiddenTitle}
            </h2>
            <p className="body-copy">
              {uiText.forbiddenBodyPrefix}{" "}
              <code>{getLocalizedRoleLabel(user.role, messages.adminReviewDetail.roleLabels)}</code>.{" "}
              {uiText.forbiddenBodySuffix}
            </p>
          </section>
        )}

        {status === "ready" && user && roleAllows(user.role, ROLE_MODERATOR) && (
          <section className="maze-summary admin-panel-section" aria-labelledby="review-table-title">
            <h2 id="review-table-title" className="section-title">
              {uiText.sections.recentSubmissions}
            </h2>
            <div className="admin-section-toolbar admin-reviews-toolbar">
              <p className="assistive-copy admin-toolbar-copy">
                {uiText.signedInAs} <strong>{user.username}</strong>.
              </p>
              <div className="actions admin-toolbar-actions">
                {roleAllows(user.role, ROLE_ADMIN) && (
                  <Link href="/admin/users" className="secondary-link">
                    {uiText.actions.manageUsers}
                  </Link>
                )}
                {roleAllows(user.role, ROLE_ADMIN) && (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={handleRecompute}
                    disabled={recomputeStatus === "submitting"}
                  >
                    {recomputeStatus === "submitting"
                      ? uiText.actions.recomputing
                      : uiText.actions.recomputeVerification}
                  </button>
                )}
              </div>
            </div>
            <p className="assistive-copy admin-sort-hint">{uiText.sortHint}</p>
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
              <div className="summary-grid" aria-label={uiText.summary.queueHealthLabel}>
                <article className="summary-card">
                  <span className="summary-label">{uiText.summary.pending}</span>
                  <strong className="summary-value">{formatCount(summary.pendingCount)}</strong>
                </article>
                <article className="summary-card">
                  <span className="summary-label">{uiText.summary.verified}</span>
                  <strong className="summary-value">{formatCount(summary.verifiedCount)}</strong>
                </article>
                <article className="summary-card">
                  <span className="summary-label">{uiText.summary.suspicious}</span>
                  <strong className="summary-value">{formatCount(summary.suspiciousCount)}</strong>
                </article>
                <article className="summary-card">
                  <span className="summary-label">{uiText.summary.invalid}</span>
                  <strong className="summary-value">{formatCount(summary.invalidCount)}</strong>
                </article>
                <article className="summary-card">
                  <span className="summary-label">{uiText.summary.stalePending}</span>
                  <strong className="summary-value">{formatCount(summary.stalePendingCount)}</strong>
                </article>
              </div>
            )}

            <section className="filter-panel admin-filter-panel" aria-labelledby="review-filter-title">
              <h3 id="review-filter-title" className="section-title">
                {uiText.sections.filters}
              </h3>
              <fieldset className="filter-fieldset">
                <legend className="sr-only">{uiText.filters.legend}</legend>
                <div className="filter-grid">
                  <label className="auth-field" htmlFor="verification-filter">
                    <span>{uiText.filters.verificationState}</span>
                    <select
                      id="verification-filter"
                      value={verificationFilter}
                      onChange={(event) =>
                        setVerificationFilter(event.target.value as VerificationFilter)
                      }
                      aria-describedby={resultsCountId}
                    >
                      <option value="all">{uiText.filters.allStates}</option>
                      <option value="pending">{uiText.filters.pending}</option>
                      <option value="verified">{uiText.filters.verified}</option>
                      <option value="suspicious">{uiText.filters.suspicious}</option>
                      <option value="invalid">{uiText.filters.invalid}</option>
                    </select>
                  </label>

                  <label className="auth-field" htmlFor="review-search">
                    <span>{uiText.filters.search}</span>
                    <input
                      id="review-search"
                      type="search"
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder={uiText.filters.searchPlaceholder}
                      aria-describedby={resultsCountId}
                    />
                  </label>

                  <label className="auth-field" htmlFor="review-status-filter">
                    <span>{uiText.filters.moderatorStatus}</span>
                    <select
                      id="review-status-filter"
                      value={reviewStatusFilter}
                      onChange={(event) =>
                        setReviewStatusFilter(event.target.value as ReviewStatusFilter)
                      }
                      aria-describedby={resultsCountId}
                    >
                      <option value="all">{uiText.filters.allReviewStates}</option>
                      <option value="unreviewed">{uiText.filters.unreviewed}</option>
                      <option value="reviewed_clean">{uiText.filters.reviewedClean}</option>
                      <option value="confirmed_suspicious">{uiText.filters.confirmedSuspicious}</option>
                    </select>
                  </label>

                  <label className="auth-field" htmlFor="review-sort">
                    <span>{uiText.filters.sortBy}</span>
                    <select
                      id="review-sort"
                      value={sortMode}
                      onChange={(event) => setSortMode(event.target.value as SortMode)}
                      aria-describedby={resultsCountId}
                    >
                      <option value="risk">{uiText.filters.highestRisk}</option>
                      <option value="newest">{uiText.filters.newestFirst}</option>
                      <option value="oldest-pending">{uiText.filters.oldestPendingFirst}</option>
                    </select>
                  </label>

                  <label className="checkbox-field" htmlFor="stale-pending-only">
                    <input
                      id="stale-pending-only"
                      type="checkbox"
                      checked={showOnlyStalePending}
                      onChange={(event) => setShowOnlyStalePending(event.target.checked)}
                    />
                    <span>{uiText.filters.staleOnly}</span>
                  </label>
                </div>
              </fieldset>
              <p id={resultsCountId} className="assistive-copy" aria-live="polite">
                {uiText.resultsShown
                  .replace("{count}", formatCount(sortedEntries.length))
                  .replace("{suffix}", sortedEntries.length === 1 ? "" : "es")}
              </p>
            </section>

            {sortedEntries.length === 0 ? (
              <p className="body-copy">{uiText.noMatches}</p>
            ) : (
              <div
                className="review-list admin-review-list"
                role="list"
                aria-label={uiText.sections.recentSubmissions}
              >
                {sortedEntries.map((entry) => {
                  const tone = getSuspicionTone(entry.suspicionScore);
                  const playerLabel = entry.username || uiText.anonymous;

                  return (
                    <article
                      key={`${entry.acceptedAt}:${entry.seed}:${playerLabel}`}
                      className="review-row admin-review-card"
                      role="listitem"
                    >
                      <div className="admin-review-block admin-review-status-block">
                        <span className="admin-review-label">{uiText.table.verification}</span>
                        <span
                          className={`score-badge score-badge-${getVerificationTone(
                            entry.verificationStatus
                          )}`}
                        >
                          {getLocalizedVerificationStatus(
                            entry.verificationStatus,
                            uiText.statuses.verification
                          )}
                        </span>
                        <div className="review-detail-stack">
                          <span className="admin-review-label">{uiText.table.score}</span>
                          <span className={`score-badge score-badge-${tone}`}>
                            {formatCount(entry.suspicionScore)}
                          </span>
                          <span className="assistive-copy">
                            {uiText.attemptsLabel}: {formatCount(entry.verificationAttempts)}
                          </span>
                          {entry.isStalePending && (
                            <span className="reason-chip">{uiText.stalePending}</span>
                          )}
                          {entry.verificationError && (
                            <span className="review-error-copy">
                              {entry.verificationError}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="admin-review-block admin-review-player-block">
                        <span className="admin-review-label">{uiText.table.player}</span>
                        {entry.username ? (
                          <Link href={`/profile/${entry.username}`} className="inline-link">
                            {entry.username}
                          </Link>
                        ) : (
                          playerLabel
                        )}
                      </div>
                      <div className="admin-review-block admin-review-challenge-block review-challenge">
                        <span className="admin-review-label">{uiText.table.challenge}</span>
                        <Link href={`/history/${entry.date}`} className="inline-link">
                          {entry.date}
                        </Link>
                        <span>{entry.seed}</span>
                      </div>
                      <div className="admin-review-block admin-review-stats-block">
                        <div className="review-detail-stack">
                          <span className="admin-review-label">{uiText.table.time}</span>
                          <span>{formatElapsedTime(entry.elapsedTimeMs)}</span>
                        </div>
                        <div className="review-detail-stack">
                          <span className="admin-review-label">{uiText.table.moves}</span>
                          <span>{formatCount(entry.moveCount)}</span>
                        </div>
                      </div>
                      <div className="admin-review-block admin-review-moderation-block review-challenge">
                        <span className="admin-review-label">{uiText.table.review}</span>
                        <span className={`score-badge score-badge-${getReviewTone(entry.reviewStatus)}`}>
                          {getLocalizedReviewStatus(entry.reviewStatus, uiText.statuses.review)}
                        </span>
                        <span>
                          {uiText.reviewed}: {entry.reviewedAt ? formatDateTime(entry.reviewedAt) : uiText.notRecorded}
                        </span>
                        <span>
                          {uiText.reviewer}: {entry.reviewedByUsername ?? uiText.notRecorded}
                        </span>
                      </div>
                      <div className="admin-review-block admin-review-reasons-block">
                        <span className="admin-review-label">{uiText.table.reasons}</span>
                        <div className="reason-list" aria-label={uiText.table.reasons}>
                          {entry.suspicionReasons.length > 0 ? (
                            entry.suspicionReasons.map((reason) => (
                              <span key={reason} className="reason-chip">
                                {getLocalizedSuspicionReason(reason, uiText.statuses.reasons)}
                              </span>
                            ))
                          ) : (
                            <span className="assistive-copy">{uiText.none}</span>
                          )}
                        </div>
                      </div>
                      <div className="admin-review-block admin-review-accepted-block review-challenge">
                        <span className="admin-review-label">{uiText.table.accepted}</span>
                        <span>{formatDateTime(entry.acceptedAt)}</span>
                        <span>
                          {uiText.started}:{" "}
                          {entry.verificationStartedAt
                            ? formatDateTime(entry.verificationStartedAt)
                            : uiText.notRecorded}
                        </span>
                        <span>
                          {uiText.finished}: {entry.verifiedAt ? formatDateTime(entry.verifiedAt) : uiText.notRecorded}
                        </span>
                        <Link href={`/admin/reviews/${entry.publicId}`} className="inline-link">
                          {uiText.actions.inspectRun}
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
