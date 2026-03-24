"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "../../admin.module.css";

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
import { useLocale } from "../../../../lib/locale";

void styles;

type PageStatus = "loading" | "ready" | "error";
type RequeueStatus = "idle" | "submitting" | "success" | "error";
type ReviewUpdateStatus = "idle" | "submitting" | "success" | "error";

interface ReviewDetailPageProps {
  params: Promise<{
    id: string;
  }>;
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

function getLocalizedDirectionLabel(
  directionName: string | undefined,
  labels: {
    north: string;
    east: string;
    south: string;
    west: string;
  },
  fallback: string
): string {
  switch (directionName) {
    case "North":
      return labels.north;
    case "East":
      return labels.east;
    case "South":
      return labels.south;
    case "West":
      return labels.west;
    default:
      return directionName ?? fallback;
  }
}

function getLocalizedReplayActionLabel(
  action: string,
  labels: {
    moveForward: string;
    moveBackward: string;
    turnLeft: string;
    turnRight: string;
  }
): string {
  switch (action) {
    case "move_forward":
      return labels.moveForward;
    case "move_backward":
      return labels.moveBackward;
    case "turn_left":
      return labels.turnLeft;
    case "turn_right":
      return labels.turnRight;
    default:
      return action;
  }
}

function getLocalizedRoleLabel(
  role: string | undefined,
  labels: {
    user: string;
    moderator: string;
    admin: string;
  }
): string {
  switch (role) {
    case "user":
      return labels.user;
    case "moderator":
      return labels.moderator;
    case "admin":
      return labels.admin;
    default:
      return role ?? "";
  }
}

function getLocalizedVerificationStatus(
  status: string,
  labels: {
    pending: string;
    verified: string;
    suspicious: string;
    invalid: string;
  }
): string {
  switch (status) {
    case "pending":
      return labels.pending;
    case "verified":
      return labels.verified;
    case "suspicious":
      return labels.suspicious;
    case "invalid":
      return labels.invalid;
    default:
      return status;
  }
}

function getLocalizedReviewStatus(
  status: string,
  labels: {
    unreviewed: string;
    reviewedClean: string;
    confirmedSuspicious: string;
  }
): string {
  if (status === "reviewed_clean") {
    return labels.reviewedClean;
  }

  if (status === "confirmed_suspicious") {
    return labels.confirmedSuspicious;
  }

  return labels.unreviewed;
}

function getLocalizedSuspicionReason(
  reason: string,
  labels: {
    replayLengthMismatch: string;
    timestampDrift: string;
    highActionDensity: string;
    rapidRepeatedTurns: string;
    blockedMoveAttempts: string;
    replayDoesNotReachExit: string;
    actionsAfterExit: string;
  }
): string {
  switch (reason) {
    case "replay_length_mismatch":
      return labels.replayLengthMismatch;
    case "timestamp_drift":
      return labels.timestampDrift;
    case "high_action_density":
      return labels.highActionDensity;
    case "rapid_repeated_turns":
      return labels.rapidRepeatedTurns;
    case "blocked_move_attempts":
      return labels.blockedMoveAttempts;
    case "replay_does_not_reach_exit":
      return labels.replayDoesNotReachExit;
    case "actions_after_exit":
      return labels.actionsAfterExit;
    default:
      return reason;
  }
}

function getLocalizedVerificationNote(
  note: string,
  labels: {
    simulationNeverReachedExit: string;
    simulationDetectedBlockedMoves: string;
    simulationDetectedActionsAfterExit: string;
    simulationMatchesExpectedOutcome: string;
  }
): string {
  switch (note) {
    case "simulation_never_reached_exit":
      return labels.simulationNeverReachedExit;
    case "simulation_detected_blocked_moves":
      return labels.simulationDetectedBlockedMoves;
    case "simulation_detected_actions_after_exit":
      return labels.simulationDetectedActionsAfterExit;
    case "simulation_matches_expected_outcome":
      return labels.simulationMatchesExpectedOutcome;
    default:
      return note;
  }
}

export default function ReviewDetailPage({ params }: ReviewDetailPageProps) {
  const { formatCount, formatDateTime, messages } = useLocale();
  const uiText = messages.adminReviewDetail;
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
          error instanceof Error ? error.message : uiText.error
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
            label: uiText.comparison.finalPosition,
            frontend: `(${reconstructedFinalFrame.playerPosition.x}, ${reconstructedFinalFrame.playerPosition.y})`,
            backend: `(${simulation.finalPosition.x}, ${simulation.finalPosition.y})`,
            matches:
              reconstructedFinalFrame.playerPosition.x === simulation.finalPosition.x &&
              reconstructedFinalFrame.playerPosition.y === simulation.finalPosition.y
          },
          {
            label: uiText.comparison.finalFacing,
            frontend: getLocalizedDirectionLabel(
              DIRECTION_ORDER[reconstructedFinalFrame.directionIndex]?.name,
              messages.play.directions,
              uiText.simulation.unknown
            ),
            backend: getLocalizedDirectionLabel(
              DIRECTION_ORDER[simulation.finalDirectionIndex]?.name,
              messages.play.directions,
              uiText.simulation.unknown
            ),
            matches:
              reconstructedFinalFrame.directionIndex === simulation.finalDirectionIndex
          },
          {
            label: uiText.comparison.exitReached,
            frontend: reconstructedFinalFrame.reachedExit ? uiText.comparison.yes : uiText.comparison.no,
            backend: simulation.reachedExit ? uiText.comparison.yes : uiText.comparison.no,
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
        uiText.replay.requeueMessage
          .replace("{id}", result.runPublicId)
          .replace(
            "{status}",
            getLocalizedVerificationStatus(
              result.verificationStatus,
              uiText.statuses.verification
            )
          )
          .replace("{attempts}", String(result.verificationAttempts))
      );
    } catch (error) {
      setRequeueStatus("error");
      setRequeueMessage(
        error instanceof Error ? error.message : uiText.replay.requeueError
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
        uiText.replay.reviewSaved
          .replace(
            "{status}",
            getLocalizedReviewStatus(result.reviewStatus, uiText.statuses.review)
          )
          .replace(
            "{reviewedAt}",
            result.reviewedAt
              ? uiText.replay.reviewSavedAt.replace("{value}", formatDateTime(result.reviewedAt))
              : ""
          )
      );
    } catch (error) {
      setReviewFormStatus("error");
      setReviewFormMessage(
        error instanceof Error ? error.message : uiText.replay.reviewSaveError
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
          <Link href="/admin/reviews" className="primary-link">
            {uiText.actions.backToReviews}
          </Link>
          <Link href="/play" className="secondary-link">
            {uiText.actions.returnToChallenge}
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
          <section className="maze-summary" aria-labelledby="review-detail-auth-title">
            <h2 id="review-detail-auth-title" className="section-title">
              {uiText.authRequiredTitle}
            </h2>
            <p className="body-copy">{uiText.authRequiredBody}</p>
          </section>
        )}

        {status === "ready" && user && !roleAllows(user.role, ROLE_MODERATOR) && (
          <section className="maze-summary" aria-labelledby="review-detail-forbidden-title">
            <h2 id="review-detail-forbidden-title" className="section-title">
              {uiText.forbiddenTitle}
            </h2>
            <p className="body-copy">
              {uiText.forbiddenBodyPrefix}{" "}
              <code>{getLocalizedRoleLabel(user.role, uiText.roleLabels)}</code>.{" "}
              {uiText.forbiddenBodySuffix}
            </p>
          </section>
        )}

        {status === "ready" && user && roleAllows(user.role, ROLE_MODERATOR) && detail && (
          <>
            <section className="maze-summary admin-panel-section" aria-labelledby="review-detail-summary-title">
              <h2 id="review-detail-summary-title" className="section-title">
                {uiText.sections.submissionOverview}
              </h2>
              <div className="admin-section-toolbar admin-detail-toolbar">
                <p className="assistive-copy admin-toolbar-copy">
                  {uiText.replay.viewingRunAs} <code>{detail.entry.publicId}</code> {uiText.replay.asUser}{" "}
                  <strong>{user.username}</strong>.
                </p>
                <span
                  className={`score-badge score-badge-${getVerificationTone(
                    detail.entry.verificationStatus
                  )}`}
                >
                  {getLocalizedVerificationStatus(
                    detail.entry.verificationStatus,
                    uiText.statuses.verification
                  )}
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
                    {requeueStatus === "submitting"
                      ? uiText.actions.requeueing
                      : uiText.actions.requeueVerification}
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
                  <dt>{uiText.metadata.verification}</dt>
                  <dd>
                    {getLocalizedVerificationStatus(
                      detail.entry.verificationStatus,
                      uiText.statuses.verification
                    )}
                  </dd>
                </div>
                <div className="metadata-row">
                  <dt>{uiText.metadata.player}</dt>
                  <dd>
                    {detail.entry.username ? (
                      <Link
                        href={`/profile/${detail.entry.username}`}
                        className="inline-link"
                      >
                        {detail.entry.username}
                      </Link>
                    ) : (
                      uiText.replay.anonymous
                    )}
                  </dd>
                </div>
                <div className="metadata-row">
                  <dt>{uiText.metadata.challenge}</dt>
                  <dd>
                    <Link href={`/history/${detail.entry.date}`} className="inline-link">
                      {detail.entry.date}
                    </Link>
                  </dd>
                </div>
                <div className="metadata-row">
                  <dt>{uiText.metadata.seed}</dt>
                  <dd>{detail.entry.seed}</dd>
                </div>
                <div className="metadata-row">
                  <dt>{uiText.metadata.time}</dt>
                  <dd>{formatElapsedTime(detail.entry.elapsedTimeMs)}</dd>
                </div>
                <div className="metadata-row">
                  <dt>{uiText.metadata.moves}</dt>
                  <dd>{formatCount(detail.entry.moveCount)}</dd>
                </div>
                <div className="metadata-row">
                  <dt>{uiText.metadata.accepted}</dt>
                  <dd>{formatDateTime(detail.entry.acceptedAt)}</dd>
                </div>
                <div className="metadata-row">
                  <dt>{uiText.metadata.verificationStarted}</dt>
                  <dd>
                    {detail.entry.verificationStartedAt
                      ? formatDateTime(detail.entry.verificationStartedAt)
                      : uiText.replay.notRecorded}
                  </dd>
                </div>
                <div className="metadata-row">
                  <dt>{uiText.metadata.verifiedAt}</dt>
                  <dd>
                    {detail.entry.verifiedAt
                      ? formatDateTime(detail.entry.verifiedAt)
                      : uiText.replay.notRecorded}
                  </dd>
                </div>
                <div className="metadata-row">
                  <dt>{uiText.metadata.attempts}</dt>
                  <dd>{formatCount(detail.entry.verificationAttempts)}</dd>
                </div>
                <div className="metadata-row">
                  <dt>{uiText.metadata.reasons}</dt>
                  <dd className="reason-list">
                    {detail.entry.suspicionReasons.length > 0 ? (
                      detail.entry.suspicionReasons.map((reason) => (
                        <span key={reason} className="reason-chip">
                          {getLocalizedSuspicionReason(reason, uiText.statuses.reasons)}
                        </span>
                      ))
                    ) : (
                      <span className="assistive-copy">{uiText.replay.none}</span>
                    )}
                  </dd>
                </div>
                <div className="metadata-row">
                  <dt>{uiText.metadata.verificationNotes}</dt>
                  <dd className="reason-list">
                    {detail.entry.verificationNotes.length > 0 ? (
                      detail.entry.verificationNotes.map((note) => (
                        <span key={note} className="reason-chip">
                          {getLocalizedVerificationNote(note, uiText.statuses.notes)}
                        </span>
                      ))
                    ) : (
                      <span className="assistive-copy">{uiText.replay.none}</span>
                    )}
                  </dd>
                </div>
                <div className="metadata-row">
                  <dt>{uiText.metadata.workerError}</dt>
                  <dd>{detail.entry.verificationError ?? uiText.replay.none}</dd>
                </div>
                <div className="metadata-row">
                  <dt>{uiText.metadata.reviewStatus}</dt>
                  <dd>{getLocalizedReviewStatus(detail.entry.reviewStatus, uiText.statuses.review)}</dd>
                </div>
                <div className="metadata-row">
                  <dt>{uiText.metadata.reviewedAt}</dt>
                  <dd>
                    {detail.entry.reviewedAt
                      ? formatDateTime(detail.entry.reviewedAt)
                      : uiText.replay.notRecorded}
                  </dd>
                </div>
                <div className="metadata-row">
                  <dt>{uiText.metadata.reviewedBy}</dt>
                  <dd>{detail.entry.reviewedByUsername ?? uiText.replay.notRecorded}</dd>
                </div>
              </dl>
            </section>

            <section className="maze-summary admin-panel-section" aria-labelledby="review-moderation-title">
              <h2 id="review-moderation-title" className="section-title">
                {uiText.sections.moderatorReview}
              </h2>
              <p className="assistive-copy admin-section-copy">{uiText.moderation.intro}</p>

              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleReviewSave();
                }}
              >
                <fieldset className="filter-fieldset">
                  <legend className="sr-only">{uiText.moderation.fieldsetLegend}</legend>
                  <div className="filter-grid">
                    <label className="auth-field" htmlFor="review-status">
                      <span>{uiText.moderation.statusLabel}</span>
                      <select
                        id="review-status"
                        value={reviewStatusValue}
                        onChange={(event) => setReviewStatusValue(event.target.value)}
                      >
                        <option value="unreviewed">{uiText.moderation.unreviewed}</option>
                        <option value="reviewed_clean">{uiText.moderation.reviewedClean}</option>
                        <option value="confirmed_suspicious">{uiText.moderation.confirmedSuspicious}</option>
                      </select>
                    </label>

                    <label className="auth-field auth-field-full" htmlFor="review-notes">
                      <span>{uiText.moderation.notesLabel}</span>
                      <textarea
                        id="review-notes"
                        value={reviewNotesValue}
                        onChange={(event) => setReviewNotesValue(event.target.value)}
                        rows={5}
                        placeholder={uiText.moderation.notesPlaceholder}
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
                    {reviewFormStatus === "submitting" ? uiText.actions.saving : uiText.actions.saveReview}
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

            <section className="maze-summary admin-panel-section" aria-labelledby="review-simulation-title">
              <h2 id="review-simulation-title" className="section-title">
                {uiText.sections.simulation}
              </h2>
              <div className="admin-section-toolbar admin-detail-toolbar">
                <p className="assistive-copy admin-toolbar-copy">
                  {uiText.simulation.intro}
                </p>
                {hasSimulation ? (
                  <span
                    className={`score-badge score-badge-${
                      simulation.reachedExit ? "low" : "high"
                    }`}
                  >
                    {simulation.reachedExit
                      ? uiText.simulation.reachedExit
                      : uiText.simulation.didNotFinish}
                  </span>
                ) : (
                  <span className="score-badge score-badge-pending">
                    {uiText.simulation.unavailable}
                  </span>
                )}
              </div>

              {hasSimulation ? (
                <dl className="metadata-list">
                  <div className="metadata-row">
                    <dt>{uiText.simulation.finalPosition}</dt>
                    <dd>
                      ({simulation.finalPosition.x}, {simulation.finalPosition.y})
                    </dd>
                  </div>
                  <div className="metadata-row">
                    <dt>{uiText.simulation.finalFacing}</dt>
                    <dd>
                      {getLocalizedDirectionLabel(
                        DIRECTION_ORDER[simulation.finalDirectionIndex]?.name,
                        messages.play.directions,
                        uiText.simulation.unknown
                      )}
                    </dd>
                  </div>
                  <div className="metadata-row">
                    <dt>{uiText.simulation.firstExitStep}</dt>
                    <dd>
                      {simulation.firstExitStep >= 0
                        ? simulation.firstExitStep
                        : uiText.simulation.never}
                    </dd>
                  </div>
                  <div className="metadata-row">
                    <dt>{uiText.simulation.blockedMoves}</dt>
                    <dd>{simulation.blockedMoveCount}</dd>
                  </div>
                  <div className="metadata-row">
                    <dt>{uiText.simulation.actionsAfterExit}</dt>
                    <dd>{simulation.actionsAfterExit}</dd>
                  </div>
                </dl>
              ) : (
                <p className="body-copy">{uiText.simulation.unavailableBody}</p>
              )}
            </section>

            {reconstructedFinalFrame && hasSimulation && (
              <section className="maze-summary admin-panel-section" aria-labelledby="review-reconciliation-title">
                <h2 id="review-reconciliation-title" className="section-title">
                  {uiText.sections.replayComparison}
                </h2>
                <div className="admin-section-toolbar admin-detail-toolbar">
                  <p className="assistive-copy admin-toolbar-copy">
                    {uiText.comparison.intro}
                  </p>
                  <span
                    className={`score-badge score-badge-${
                      allComparisonItemsMatch ? "low" : "high"
                    }`}
                  >
                    {allComparisonItemsMatch
                      ? uiText.comparison.match
                      : uiText.comparison.mismatch}
                  </span>
                </div>

                <div
                  className="comparison-list"
                  role="list"
                  aria-label={uiText.comparison.ariaLabel}
                >
                  <div
                    className="comparison-row comparison-row-header"
                    role="listitem"
                    aria-hidden="true"
                  >
                    <span>{uiText.comparison.check}</span>
                    <span>{uiText.comparison.frontendReconstruction}</span>
                    <span>{uiText.comparison.backendSimulation}</span>
                    <span>{uiText.comparison.status}</span>
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
                        {comparisonItem.matches
                          ? uiText.comparison.match
                          : uiText.comparison.mismatch}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {maze && selectedFrame && (
              <section className="maze-summary admin-panel-section" aria-labelledby="review-visualizer-title">
                <h2 id="review-visualizer-title" className="section-title">
                  {uiText.sections.replayViewer}
                </h2>
                <div className="admin-section-toolbar admin-detail-toolbar">
                  <p className="assistive-copy admin-toolbar-copy">{uiText.replay.visualizerIntro}</p>
                  <p className="assistive-copy admin-toolbar-copy">
                    {uiText.replay.frameProgress
                      .replace("{current}", String(selectedFrameIndex + 1))
                      .replace("{total}", String(frames.length))}
                  </p>
                </div>

                <dl className="metadata-list">
                  <div className="metadata-row">
                    <dt>{uiText.replay.selectedStep}</dt>
                    <dd>{selectedFrame.step}</dd>
                  </div>
                  <div className="metadata-row">
                    <dt>{uiText.replay.action}</dt>
                    <dd>
                      {getLocalizedReplayActionLabel(
                        selectedFrame.action,
                        uiText.replay.actions
                      )}
                    </dd>
                  </div>
                  <div className="metadata-row">
                    <dt>{uiText.replay.elapsedLabel}</dt>
                    <dd>{formatElapsedTime(selectedFrame.elapsedTimeMs)}</dd>
                  </div>
                  <div className="metadata-row">
                    <dt>{uiText.replay.position}</dt>
                    <dd>
                      ({selectedFrame.playerPosition.x}, {selectedFrame.playerPosition.y})
                    </dd>
                  </div>
                  <div className="metadata-row">
                    <dt>{uiText.replay.facing}</dt>
                    <dd>
                      {getLocalizedDirectionLabel(
                        DIRECTION_ORDER[selectedFrame.directionIndex]?.name,
                        messages.play.directions,
                        uiText.simulation.unknown
                      )}
                    </dd>
                  </div>
                  <div className="metadata-row">
                    <dt>{uiText.replay.exitReached}</dt>
                    <dd>
                      {selectedFrame.reachedExit
                        ? uiText.comparison.yes
                        : uiText.comparison.no}
                    </dd>
                  </div>
                </dl>

                <div
                  className="maze-grid-preview"
                  role="img"
                  aria-label={uiText.replay.snapshotAriaLabel}
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
                    {uiText.actions.first}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() =>
                      setSelectedFrameIndex((currentIndex) => Math.max(0, currentIndex - 1))
                    }
                    disabled={selectedFrameIndex === 0}
                  >
                    {uiText.actions.previous}
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
                    {uiText.actions.next}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setSelectedFrameIndex(frames.length - 1)}
                    disabled={selectedFrameIndex >= frames.length - 1}
                  >
                    {uiText.actions.last}
                  </button>
                </div>
              </section>
            )}

            <section className="maze-summary admin-panel-section" aria-labelledby="review-trace-title">
              <h2 id="review-trace-title" className="section-title">
                {uiText.sections.replayTimeline}
              </h2>
              {detail.replayTrace.length === 0 ? (
                <p className="body-copy">{uiText.replay.traceEmpty}</p>
              ) : (
                <div className="trace-list" role="list" aria-label={uiText.replay.traceAriaLabel}>
                  <div className="trace-row trace-row-header" role="listitem" aria-hidden="true">
                    <span>{uiText.replay.stepLabel}</span>
                    <span>{uiText.replay.action}</span>
                    <span>{uiText.replay.elapsedLabel}</span>
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
                      <span>{getLocalizedReplayActionLabel(event.action, uiText.replay.actions)}</span>
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
