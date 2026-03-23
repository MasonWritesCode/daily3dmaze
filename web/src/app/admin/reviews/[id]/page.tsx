"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  fetchCurrentUser,
  fetchDailyMaze,
  fetchRunReviewDetail,
  type AuthUser,
  type RunReviewDetailResponse
} from "../../../../lib/api";
import {
  DIRECTION_ORDER,
  buildReplayFrames,
  formatElapsedTime,
  renderGridRows,
  type DailyMaze,
  type ReplayFrame
} from "../../../../lib/game/maze";

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
  const [maze, setMaze] = useState<DailyMaze | null>(null);
  const [frames, setFrames] = useState<ReplayFrame[]>([]);
  const [selectedFrameIndex, setSelectedFrameIndex] = useState<number>(0);
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

        const mazePayload = await fetchDailyMaze(payload.entry.date);
        if (cancelled) {
          return;
        }

        setDetail(payload);
        setMaze(mazePayload);
        setFrames(buildReplayFrames(mazePayload, payload.replayTrace));
        setSelectedFrameIndex(0);
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

  const selectedFrame = frames[selectedFrameIndex] ?? null;
  const gridRows =
    maze && selectedFrame
      ? renderGridRows(maze, selectedFrame.playerPosition, selectedFrame.directionIndex)
      : [];

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

            {maze && selectedFrame && (
              <section className="maze-summary" aria-labelledby="review-visualizer-title">
                <div className="review-header">
                  <div>
                    <h2 id="review-visualizer-title" className="section-title">
                      Replay visualizer
                    </h2>
                    <p className="assistive-copy">
                      Step through the stored trace against the original maze layout.
                    </p>
                  </div>
                  <p className="assistive-copy">
                    Frame {selectedFrameIndex + 1} of {frames.length}
                  </p>
                </div>

                <dl className="metadata-list">
                  <div className="metadata-row">
                    <dt>Selected step</dt>
                    <dd>{selectedFrame.step}</dd>
                  </div>
                  <div className="metadata-row">
                    <dt>Action</dt>
                    <dd>{selectedFrame.action}</dd>
                  </div>
                  <div className="metadata-row">
                    <dt>Elapsed</dt>
                    <dd>{formatElapsedTime(selectedFrame.elapsedTimeMs)}</dd>
                  </div>
                  <div className="metadata-row">
                    <dt>Position</dt>
                    <dd>
                      ({selectedFrame.playerPosition.x}, {selectedFrame.playerPosition.y})
                    </dd>
                  </div>
                  <div className="metadata-row">
                    <dt>Facing</dt>
                    <dd>{DIRECTION_ORDER[selectedFrame.directionIndex]?.name ?? "Unknown"}</dd>
                  </div>
                  <div className="metadata-row">
                    <dt>Exit reached</dt>
                    <dd>{selectedFrame.reachedExit ? "Yes" : "No"}</dd>
                  </div>
                </dl>

                <div
                  className="maze-grid-preview"
                  role="img"
                  aria-label="Replay snapshot in the maze grid"
                >
                  {gridRows.map((row, index) => (
                    <code key={`${index}-${row}`} className="maze-grid-row">
                      {row}
                    </code>
                  ))}
                </div>

                <div className="actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setSelectedFrameIndex(0)}
                    disabled={selectedFrameIndex === 0}
                  >
                    First frame
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() =>
                      setSelectedFrameIndex((currentIndex) => Math.max(0, currentIndex - 1))
                    }
                    disabled={selectedFrameIndex === 0}
                  >
                    Previous frame
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() =>
                      setSelectedFrameIndex((currentIndex) =>
                        Math.min(frames.length - 1, currentIndex + 1)
                      )
                    }
                    disabled={selectedFrameIndex >= frames.length - 1}
                  >
                    Next frame
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setSelectedFrameIndex(frames.length - 1)}
                    disabled={selectedFrameIndex >= frames.length - 1}
                  >
                    Last frame
                  </button>
                </div>
              </section>
            )}

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
                      className={`trace-row ${
                        index + 1 === selectedFrameIndex ? "trace-row-active" : ""
                      }`}
                      role="listitem"
                      aria-current={index + 1 === selectedFrameIndex ? "step" : undefined}
                    >
                      <span>{index + 1}</span>
                      <span>{event.action}</span>
                      <button
                        type="button"
                        className="trace-step-button"
                        onClick={() => setSelectedFrameIndex(index + 1)}
                      >
                        {formatElapsedTime(event.elapsedTimeMs)}
                      </button>
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
