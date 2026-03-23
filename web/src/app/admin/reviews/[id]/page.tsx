"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  fetchCurrentUser,
  fetchDailyMaze,
  fetchRunReviewDetail,
  requeueRunReview,
  ROLE_ADMIN,
  roleAllows,
  ROLE_MODERATOR,
  updateRunReview,
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
type RequeueStatus = "idle" | "submitting" | "success" | "error";
type ReviewUpdateStatus = "idle" | "submitting" | "success" | "error";

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

export default function ReviewDetailPage({ params }: ReviewDetailPageProps) {
  const [status, setStatus] = useState<PageStatus>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [detail, setDetail] = useState<RunReviewDetailResponse | null>(null);
  const [maze, setMaze] = useState<DailyMaze | null>(null);
  const [frames, setFrames] = useState<ReplayFrame[]>([]);
  const [selectedFrameIndex, setSelectedFrameIndex] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [requeueStatus, setRequeueStatus] = useState<RequeueStatus>("idle");
  const [requeueMessage, setRequeueMessage] = useState<string>("");
  const [reviewFormStatus, setReviewFormStatus] = useState<ReviewUpdateStatus>("idle");
  const [reviewFormMessage, setReviewFormMessage] = useState<string>("");
  const [reviewStatusValue, setReviewStatusValue] = useState<string>("unreviewed");
  const [reviewNotesValue, setReviewNotesValue] = useState<string>("");

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

        if (!roleAllows(currentUser.role, ROLE_MODERATOR)) {
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
        setReviewStatusValue(payload.entry.reviewStatus);
        setReviewNotesValue(payload.entry.reviewNotes);
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
  const reconstructedFinalFrame = frames[frames.length - 1] ?? null;
  const simulation = detail?.simulation;
  const hasSimulation =
    simulation !== undefined &&
    simulation.finalPosition !== undefined &&
    typeof simulation.finalPosition.x === "number" &&
    typeof simulation.finalPosition.y === "number";
  const gridRows =
    maze && selectedFrame
      ? renderGridRows(maze, selectedFrame.playerPosition, selectedFrame.directionIndex)
      : [];
  const comparisonItems =
    hasSimulation && reconstructedFinalFrame
      ? [
          {
            label: "Final position",
            frontend: `(${reconstructedFinalFrame.playerPosition.x}, ${reconstructedFinalFrame.playerPosition.y})`,
            backend: `(${simulation.finalPosition.x}, ${simulation.finalPosition.y})`,
            matches:
              reconstructedFinalFrame.playerPosition.x === simulation.finalPosition.x &&
              reconstructedFinalFrame.playerPosition.y === simulation.finalPosition.y
          },
          {
            label: "Final facing",
            frontend:
              DIRECTION_ORDER[reconstructedFinalFrame.directionIndex]?.name ?? "Unknown",
            backend: DIRECTION_ORDER[simulation.finalDirectionIndex]?.name ?? "Unknown",
            matches:
              reconstructedFinalFrame.directionIndex === simulation.finalDirectionIndex
          },
          {
            label: "Exit reached",
            frontend: reconstructedFinalFrame.reachedExit ? "Yes" : "No",
            backend: simulation.reachedExit ? "Yes" : "No",
            matches: reconstructedFinalFrame.reachedExit === simulation.reachedExit
          }
        ]
      : [];
  const allComparisonItemsMatch =
    comparisonItems.length > 0 &&
    comparisonItems.every((comparisonItem) => comparisonItem.matches);

  async function refreshDetail(runID: string) {
    const payload = await fetchRunReviewDetail(runID);
    const mazePayload = await fetchDailyMaze(payload.entry.date);

    setDetail(payload);
    setMaze(mazePayload);
    setFrames(buildReplayFrames(mazePayload, payload.replayTrace));
    setSelectedFrameIndex(0);
    setReviewStatusValue(payload.entry.reviewStatus);
    setReviewNotesValue(payload.entry.reviewNotes);
  }

  async function handleRequeue() {
    if (!detail) {
      return;
    }

    setRequeueStatus("submitting");
    setRequeueMessage("");

    try {
      const routeParams = await params;
      const result = await requeueRunReview(routeParams.id);
      await refreshDetail(routeParams.id);
      setRequeueStatus("success");
      setRequeueMessage(
        `Run ${result.runPublicId} requeued as ${result.verificationStatus}. Attempts remain at ${result.verificationAttempts}.`
      );
    } catch (error) {
      setRequeueStatus("error");
      setRequeueMessage(
        error instanceof Error ? error.message : "Unable to requeue this run."
      );
    }
  }

  async function handleReviewSave() {
    if (!detail) {
      return;
    }

    setReviewFormStatus("submitting");
    setReviewFormMessage("");

    try {
      const routeParams = await params;
      const result = await updateRunReview(routeParams.id, {
        reviewStatus: reviewStatusValue,
        reviewNotes: reviewNotesValue
      });
      await refreshDetail(routeParams.id);
      setReviewFormStatus("success");
      setReviewFormMessage(
        `Review saved as ${result.reviewStatus}${result.reviewedAt ? ` at ${formatAcceptedAt(result.reviewedAt)}` : ""}.`
      );
    } catch (error) {
      setReviewFormStatus("error");
      setReviewFormMessage(
        error instanceof Error ? error.message : "Unable to save this review."
      );
    }
  }

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
            Return to challenge
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

        {status === "ready" && user && !roleAllows(user.role, ROLE_MODERATOR) && (
          <section className="maze-summary" aria-labelledby="review-detail-forbidden-title">
            <h2 id="review-detail-forbidden-title" className="section-title">
              Moderator access required
            </h2>
            <p className="body-copy">
              Your current role is <code>{user.role}</code>. Only moderator and admin
              accounts can inspect individual run reviews.
            </p>
          </section>
        )}

        {status === "ready" && user && roleAllows(user.role, ROLE_MODERATOR) && detail && (
          <>
            <section className="maze-summary" aria-labelledby="review-detail-summary-title">
              <div className="review-header">
                <div>
                  <h2 id="review-detail-summary-title" className="section-title">
                    Submission overview
                  </h2>
                  <p className="assistive-copy">
                    Reviewing run <code>{detail.entry.publicId}</code> as{" "}
                    <strong>{user.username}</strong>.
                  </p>
                </div>
                <span
                  className={`score-badge score-badge-${getVerificationTone(
                    detail.entry.verificationStatus
                  )}`}
                >
                  {detail.entry.verificationStatus}
                </span>
              </div>
              {roleAllows(user.role, ROLE_ADMIN) && (
                <div className="actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={handleRequeue}
                    disabled={requeueStatus === "submitting"}
                  >
                    {requeueStatus === "submitting" ? "Requeueing..." : "Requeue verification"}
                  </button>
                </div>
              )}
              {requeueMessage && (
                <p
                  className={`body-copy status-copy ${
                    requeueStatus === "error" ? "error-copy" : "success-copy"
                  }`}
                  aria-live="polite"
                  role={requeueStatus === "error" ? "alert" : "status"}
                >
                  {requeueMessage}
                </p>
              )}

              <dl className="metadata-list">
                <div className="metadata-row">
                  <dt>Verification</dt>
                  <dd>{detail.entry.verificationStatus}</dd>
                </div>
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
                  <dt>Verification started</dt>
                  <dd>{formatOptionalTimestamp(detail.entry.verificationStartedAt)}</dd>
                </div>
                <div className="metadata-row">
                  <dt>Verified at</dt>
                  <dd>{formatOptionalTimestamp(detail.entry.verifiedAt)}</dd>
                </div>
                <div className="metadata-row">
                  <dt>Attempts</dt>
                  <dd>{detail.entry.verificationAttempts}</dd>
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
                <div className="metadata-row">
                  <dt>Verification notes</dt>
                  <dd className="reason-list">
                    {detail.entry.verificationNotes.length > 0 ? (
                      detail.entry.verificationNotes.map((note) => (
                        <span key={note} className="reason-chip">
                          {note}
                        </span>
                      ))
                    ) : (
                      <span className="assistive-copy">None</span>
                    )}
                  </dd>
                </div>
                <div className="metadata-row">
                  <dt>Worker error</dt>
                  <dd>{detail.entry.verificationError ?? "None"}</dd>
                </div>
                <div className="metadata-row">
                  <dt>Review status</dt>
                  <dd>{detail.entry.reviewStatus}</dd>
                </div>
                <div className="metadata-row">
                  <dt>Reviewed at</dt>
                  <dd>{formatOptionalTimestamp(detail.entry.reviewedAt)}</dd>
                </div>
                <div className="metadata-row">
                  <dt>Reviewed by</dt>
                  <dd>{detail.entry.reviewedByUsername ?? "Not recorded"}</dd>
                </div>
              </dl>
            </section>

            <section className="maze-summary" aria-labelledby="review-moderation-title">
              <div className="review-header">
                <div>
                  <h2 id="review-moderation-title" className="section-title">
                    Moderator review
                  </h2>
                  <p className="assistive-copy">
                    Record a human decision and any follow-up notes for this run.
                  </p>
                </div>
              </div>

              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleReviewSave();
                }}
              >
                <fieldset className="filter-fieldset">
                  <legend className="sr-only">Moderator review controls</legend>
                  <div className="filter-grid">
                    <label className="auth-field" htmlFor="review-status">
                      <span>Review status</span>
                      <select
                        id="review-status"
                        value={reviewStatusValue}
                        onChange={(event) => setReviewStatusValue(event.target.value)}
                      >
                        <option value="unreviewed">Unreviewed</option>
                        <option value="reviewed_clean">Reviewed clean</option>
                        <option value="confirmed_suspicious">Confirmed suspicious</option>
                      </select>
                    </label>

                    <label className="auth-field auth-field-full" htmlFor="review-notes">
                      <span>Review notes</span>
                      <textarea
                        id="review-notes"
                        value={reviewNotesValue}
                        onChange={(event) => setReviewNotesValue(event.target.value)}
                        rows={5}
                        placeholder="Add any human review notes or follow-up context."
                      />
                    </label>
                  </div>
                </fieldset>

                <div className="actions">
                  <button
                    type="submit"
                    className="secondary-button"
                    disabled={reviewFormStatus === "submitting"}
                  >
                    {reviewFormStatus === "submitting" ? "Saving..." : "Save review"}
                  </button>
                </div>
              </form>
              {reviewFormMessage && (
                <p
                  className={`body-copy status-copy ${
                    reviewFormStatus === "error" ? "error-copy" : "success-copy"
                  }`}
                  aria-live="polite"
                  role={reviewFormStatus === "error" ? "alert" : "status"}
                >
                  {reviewFormMessage}
                </p>
              )}
            </section>

            <section className="maze-summary" aria-labelledby="review-simulation-title">
              <div className="review-header">
                <div>
                  <h2 id="review-simulation-title" className="section-title">
                    Server-side simulation
                  </h2>
                  <p className="assistive-copy">
                    Deterministic backend replay of the submitted trace against the
                    canonical maze for this day.
                  </p>
                </div>
                {hasSimulation ? (
                  <span
                    className={`score-badge score-badge-${
                      simulation.reachedExit ? "low" : "high"
                    }`}
                  >
                    {simulation.reachedExit ? "Reached exit" : "Did not finish"}
                  </span>
                ) : (
                  <span className="score-badge score-badge-pending">
                    Simulation unavailable
                  </span>
                )}
              </div>

              {hasSimulation ? (
                <dl className="metadata-list">
                  <div className="metadata-row">
                    <dt>Final position</dt>
                    <dd>
                      ({simulation.finalPosition.x}, {simulation.finalPosition.y})
                    </dd>
                  </div>
                  <div className="metadata-row">
                    <dt>Final facing</dt>
                    <dd>{DIRECTION_ORDER[simulation.finalDirectionIndex]?.name ?? "Unknown"}</dd>
                  </div>
                  <div className="metadata-row">
                    <dt>First exit step</dt>
                    <dd>{simulation.firstExitStep >= 0 ? simulation.firstExitStep : "Never"}</dd>
                  </div>
                  <div className="metadata-row">
                    <dt>Blocked moves</dt>
                    <dd>{simulation.blockedMoveCount}</dd>
                  </div>
                  <div className="metadata-row">
                    <dt>Actions after exit</dt>
                    <dd>{simulation.actionsAfterExit}</dd>
                  </div>
                </dl>
              ) : (
                <p className="body-copy">
                  This run does not have a server-side simulation payload yet. That can
                  happen for older stored reviews or while local services are out of sync.
                </p>
              )}
            </section>

            {reconstructedFinalFrame && hasSimulation && (
              <section className="maze-summary" aria-labelledby="review-reconciliation-title">
                <div className="review-header">
                  <div>
                    <h2 id="review-reconciliation-title" className="section-title">
                      Reconstruction comparison
                    </h2>
                    <p className="assistive-copy">
                      Cross-check the frontend replay reconstruction against the backend
                      simulation result.
                    </p>
                  </div>
                  <span
                    className={`score-badge score-badge-${
                      allComparisonItemsMatch ? "low" : "high"
                    }`}
                  >
                    {allComparisonItemsMatch ? "Match" : "Mismatch"}
                  </span>
                </div>

                <div className="comparison-list" role="list" aria-label="Replay comparison">
                  <div
                    className="comparison-row comparison-row-header"
                    role="listitem"
                    aria-hidden="true"
                  >
                    <span>Check</span>
                    <span>Frontend reconstruction</span>
                    <span>Backend simulation</span>
                    <span>Status</span>
                  </div>
                  {comparisonItems.map((comparisonItem) => (
                    <div key={comparisonItem.label} className="comparison-row" role="listitem">
                      <span>{comparisonItem.label}</span>
                      <span>{comparisonItem.frontend}</span>
                      <span>{comparisonItem.backend}</span>
                      <span
                        className={`comparison-status comparison-status-${
                          comparisonItem.matches ? "match" : "mismatch"
                        }`}
                      >
                        {comparisonItem.matches ? "Match" : "Mismatch"}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

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
