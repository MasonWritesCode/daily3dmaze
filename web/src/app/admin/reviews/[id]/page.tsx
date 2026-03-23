"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  fetchCurrentUser,
  fetchRunReviewDetail,
  type AuthUser,
  type RunReviewDetailResponse
} from "../../../../lib/api";
import { formatElapsedTime } from "../../../../lib/game/maze";

type PageStatus = "loading" | "ready" | "error";

interface ReviewDetailPageProps {
  params: Promise<{
    id: string;
  }>;
}

function formatAcceptedAt(value: string): string {
  const date = new Date(value);
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
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

export default function ReviewDetailPage({ params }: ReviewDetailPageProps) {
  const [status, setStatus] = useState<PageStatus>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [detail, setDetail] = useState<RunReviewDetailResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadPage() {
      setStatus("loading");
      setErrorMessage(null);

      try {
        const routeParams = await params;
        const currentUser = await fetchCurrentUser();
        if (cancelled) {
          return;
        }

        setUser(currentUser);
        if (!currentUser) {
          setStatus("ready");
          return;
        }

        const payload = await fetchRunReviewDetail(routeParams.id);
        if (cancelled) {
          return;
        }

        setDetail(payload);
        setStatus("ready");
      } catch (error) {
        if (cancelled) {
          return;
        }

        setStatus("error");
        setErrorMessage(
          error instanceof Error ? error.message : "Unable to load this run review."
        );
      }
    }

    void loadPage();

    return () => {
      cancelled = true;
    };
  }, [params]);

  return (
    <main className="page-shell">
      <div className="content-card content-card-wide">
        <p className="eyebrow">Internal tooling</p>
        <h1>Run review detail</h1>
        <p className="body-copy">
          Inspect a single submission, including its replay trace, without mutating any
          review state.
        </p>
        <div className="actions">
          <Link href="/admin/reviews" className="primary-link">
            Back to reviews
          </Link>
          <Link href="/play" className="secondary-link">
            Back to play
          </Link>
        </div>

        {status === "loading" && (
          <p className="status-copy" aria-live="polite">
            Loading run review detail...
          </p>
        )}

        {status === "error" && errorMessage && (
          <p className="status-copy error-copy" role="alert">
            {errorMessage}
          </p>
        )}

        {status === "ready" && !user && (
          <section className="maze-summary" aria-labelledby="review-detail-auth-title">
            <h2 id="review-detail-auth-title" className="section-title">
              Sign in required
            </h2>
            <p className="body-copy">
              Internal review detail pages require an authenticated session.
            </p>
          </section>
        )}

        {status === "ready" && user && detail && (
          <>
            <section className="maze-summary" aria-labelledby="review-detail-summary-title">
              <div className="review-header">
                <div>
                  <h2 id="review-detail-summary-title" className="section-title">
                    Submission overview
                  </h2>
                  <p className="assistive-copy">
                    Reviewing run <code>{detail.entry.id}</code> as{" "}
                    <strong>{user.username}</strong>.
                  </p>
                </div>
                <span
                  className={`score-badge score-badge-${getSuspicionTone(
                    detail.entry.suspicionScore
                  )}`}
                >
                  Score {detail.entry.suspicionScore}
                </span>
              </div>

              <dl className="metadata-list">
                <div className="metadata-row">
                  <dt>Player</dt>
                  <dd>
                    {detail.entry.username ? (
                      <Link
                        href={`/profile/${detail.entry.username}`}
                        className="inline-link"
                      >
                        {detail.entry.username}
                      </Link>
                    ) : (
                      "Anonymous"
                    )}
                  </dd>
                </div>
                <div className="metadata-row">
                  <dt>Challenge</dt>
                  <dd>
                    <Link href={`/history/${detail.entry.date}`} className="inline-link">
                      {detail.entry.date}
                    </Link>
                  </dd>
                </div>
                <div className="metadata-row">
                  <dt>Seed</dt>
                  <dd>{detail.entry.seed}</dd>
                </div>
                <div className="metadata-row">
                  <dt>Time</dt>
                  <dd>{formatElapsedTime(detail.entry.elapsedTimeMs)}</dd>
                </div>
                <div className="metadata-row">
                  <dt>Moves</dt>
                  <dd>{detail.entry.moveCount}</dd>
                </div>
                <div className="metadata-row">
                  <dt>Accepted</dt>
                  <dd>{formatAcceptedAt(detail.entry.acceptedAt)}</dd>
                </div>
                <div className="metadata-row">
                  <dt>Reasons</dt>
                  <dd className="reason-list">
                    {detail.entry.suspicionReasons.length > 0 ? (
                      detail.entry.suspicionReasons.map((reason) => (
                        <span key={reason} className="reason-chip">
                          {reason}
                        </span>
                      ))
                    ) : (
                      <span className="assistive-copy">None</span>
                    )}
                  </dd>
                </div>
              </dl>
            </section>

            <section className="maze-summary" aria-labelledby="review-trace-title">
              <h2 id="review-trace-title" className="section-title">
                Replay trace
              </h2>
              {detail.replayTrace.length === 0 ? (
                <p className="body-copy">No replay trace is stored for this run.</p>
              ) : (
                <div className="trace-list" role="list" aria-label="Replay trace events">
                  <div className="trace-row trace-row-header" role="listitem" aria-hidden="true">
                    <span>Step</span>
                    <span>Action</span>
                    <span>Elapsed</span>
                  </div>
                  {detail.replayTrace.map((event, index) => (
                    <div
                      key={`${event.action}:${event.elapsedTimeMs}:${index}`}
                      className="trace-row"
                      role="listitem"
                    >
                      <span>{index + 1}</span>
                      <span>{event.action}</span>
                      <span>{formatElapsedTime(event.elapsedTimeMs)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
