"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";

import {
  fetchRunStatus,
  ROLE_ADMIN,
  roleAllows,
  submitRun,
  type ReplayTraceEvent,
  type RunSubmissionResponse
} from "../../lib/api";
import type { DailyMaze, MazePoint } from "../../lib/game/maze";
import {
  DIRECTION_ORDER,
  MOVE_DURATION_MS,
  TURN_DURATION_MS,
  attemptMove,
  formatElapsedTime,
  getStartingDirectionIndex,
  isExitReached,
  normalizeAngle,
  renderGridRows
} from "../../lib/game/maze";
import { useLocale } from "../../lib/locale";
import {
  getLocalizedDirectionLabel,
  getLocalizedVerificationLabel,
  mergeRunStatusIntoSubmissionSummary,
  shouldPollRunVerification
} from "./helpers";
import { MetadataList, RunTimerValue, type MetadataItem } from "./PlayChrome";

type SubmissionStatus = "idle" | "submitting" | "submitted" | "error";
type SceneAnimationMode = "intro" | "outro";

const SCENE_ANIMATION_DURATION_MS = 1250;

const FirstPersonView = dynamic(() => import("../../components/game/FirstPersonView"), {
  ssr: false,
  loading: () => (
    <div className="raycast-panel raycast-panel-loading" aria-hidden="true">
      <div className="raycast-canvas raycast-canvas-loading" />
    </div>
  )
});

interface MazeSessionViewProps {
  maze: DailyMaze;
  userRole?: string;
  onRunSubmitted: () => void;
}

export default function MazeSessionView({
  maze,
  userRole,
  onRunSubmitted
}: MazeSessionViewProps) {
  const { formatDateTime, messages } = useLocale();
  const uiText = messages.play;
  const startingDirectionIndex = getStartingDirectionIndex(maze);
  const isAdmin = roleAllows(userRole, ROLE_ADMIN);
  const [playerPosition, setPlayerPosition] = useState<MazePoint>(maze.start);
  const [directionIndex, setDirectionIndex] = useState<number>(startingDirectionIndex);
  const [renderPosition, setRenderPosition] = useState<MazePoint>(maze.start);
  const [renderAngle, setRenderAngle] = useState<number>(
    DIRECTION_ORDER[startingDirectionIndex].angle
  );
  const [moveCount, setMoveCount] = useState<number>(0);
  const [hasFinished, setHasFinished] = useState<boolean>(false);
  const [runStartTime, setRunStartTime] = useState<number | null>(null);
  const [finishTime, setFinishTime] = useState<number | null>(null);
  const [submissionStatus, setSubmissionStatus] = useState<SubmissionStatus>("idle");
  const [submissionSummary, setSubmissionSummary] =
    useState<RunSubmissionResponse | null>(null);
  const [introSequence, setIntroSequence] = useState<number>(0);
  const [sceneAnimationMode, setSceneAnimationMode] = useState<SceneAnimationMode>("intro");
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [supportsFullscreen, setSupportsFullscreen] = useState<boolean>(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState<boolean>(false);
  const animationRef = useRef<number | null>(null);
  const completionTimeoutRef = useRef<number | null>(null);
  const actionLockRef = useRef<boolean>(false);
  const submittedRunRef = useRef<string | null>(null);
  const replayTraceRef = useRef<ReplayTraceEvent[]>([]);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const gridRows = useMemo(
    () => renderGridRows(maze, playerPosition, directionIndex),
    [maze, playerPosition, directionIndex]
  );

  useEffect(() => {
    setPlayerPosition(maze.start);
    setDirectionIndex(startingDirectionIndex);
    setRenderPosition(maze.start);
    setRenderAngle(DIRECTION_ORDER[startingDirectionIndex].angle);
    setMoveCount(0);
    setHasFinished(false);
    setRunStartTime(null);
    setFinishTime(null);
    setSubmissionStatus("idle");
    setSubmissionSummary(null);
    setSceneAnimationMode("intro");
    setIntroSequence((current) => current + 1);
    actionLockRef.current = false;
    submittedRunRef.current = null;
    replayTraceRef.current = [];
  }, [maze, startingDirectionIndex]);

  useEffect(() => {
    if (!hasFinished || !finishTime || !runStartTime) {
      return;
    }

    const elapsedTimeMs = finishTime - runStartTime;
    const runFingerprint = `${maze.seed}:${moveCount}:${elapsedTimeMs}`;

    if (submittedRunRef.current === runFingerprint) {
      return;
    }

    submittedRunRef.current = runFingerprint;
    setSubmissionStatus("submitting");

    async function submitCompletedRun() {
      try {
        const payload = await submitRun({
          date: maze.date,
          seed: maze.seed,
          moveCount,
          elapsedTimeMs,
          replayTrace: replayTraceRef.current
        });
        setSubmissionSummary(payload);
        setSubmissionStatus("submitted");
        onRunSubmitted();
      } catch (error) {
        console.error("Failed to submit completed run", error);
        setSubmissionStatus("error");
      }
    }

    void submitCompletedRun();
  }, [finishTime, hasFinished, maze.date, maze.seed, moveCount, onRunSubmitted, runStartTime]);

  useEffect(() => {
    if (!shouldPollRunVerification(submissionStatus, submissionSummary)) {
      return undefined;
    }

    const submittedPublicId = submissionSummary.publicId;
    let isCancelled = false;
    let pollTimeoutId: number | null = null;

    async function pollStatus() {
      try {
        const latestStatus = await fetchRunStatus(submittedPublicId);
        if (isCancelled) {
          return;
        }

        setSubmissionSummary((currentSummary) =>
          currentSummary
            ? mergeRunStatusIntoSubmissionSummary(currentSummary, latestStatus)
            : currentSummary
        );

        if (latestStatus.verificationStatus === "pending") {
          pollTimeoutId = window.setTimeout(pollStatus, 2000);
          return;
        }

        onRunSubmitted();
      } catch (error) {
        console.error("Failed to poll run status", error);
      }
    }

    pollTimeoutId = window.setTimeout(pollStatus, 2000);

    return () => {
      isCancelled = true;
      if (pollTimeoutId !== null) {
        window.clearTimeout(pollTimeoutId);
      }
    };
  }, [onRunSubmitted, submissionStatus, submissionSummary]);

  useEffect(() => {
    return () => {
      if (animationRef.current !== null) {
        window.cancelAnimationFrame(animationRef.current);
      }

      if (completionTimeoutRef.current !== null) {
        window.clearTimeout(completionTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setPrefersReducedMotion(mediaQuery.matches);

    sync();
    mediaQuery.addEventListener("change", sync);
    return () => {
      mediaQuery.removeEventListener("change", sync);
    };
  }, []);

  useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(document.fullscreenElement === viewportRef.current);
    }

    const requestFullscreenSupported =
      typeof document !== "undefined" &&
      typeof document.fullscreenEnabled !== "undefined" &&
      document.fullscreenEnabled !== false &&
      typeof document.documentElement?.requestFullscreen === "function";

    setSupportsFullscreen(requestFullscreenSupported);

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    function isTypingTarget(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) {
        return false;
      }

      const tagName = target.tagName;
      return (
        target.isContentEditable ||
        tagName === "INPUT" ||
        tagName === "TEXTAREA" ||
        tagName === "SELECT" ||
        tagName === "BUTTON"
      );
    }

    function beginRunIfNeeded(): number {
      if (runStartTime) {
        return runStartTime;
      }

      const startedAt = Date.now();
      setRunStartTime(startedAt);
      return startedAt;
    }

    function recordReplayAction(action: ReplayTraceEvent["action"], startedAtForRun: number) {
      replayTraceRef.current = [
        ...replayTraceRef.current,
        {
          action,
          elapsedTimeMs: Math.max(0, Date.now() - startedAtForRun)
        }
      ];
    }

    function animateMovement(nextPosition: MazePoint) {
      if (prefersReducedMotion) {
        setPlayerPosition(nextPosition);
        setRenderPosition(nextPosition);
        setMoveCount((currentCount) => currentCount + 1);

        if (isExitReached(nextPosition, maze)) {
          const completedAt = Date.now();
          setHasFinished(true);
          setFinishTime(completedAt);
        }

        return;
      }

      const startPosition = playerPosition;
      const startedAt = performance.now();
      actionLockRef.current = true;

      function step(now: number) {
        const progress = Math.min(1, (now - startedAt) / MOVE_DURATION_MS);
        const easedProgress = 1 - Math.pow(1 - progress, 3);

        setRenderPosition({
          x: startPosition.x + (nextPosition.x - startPosition.x) * easedProgress,
          y: startPosition.y + (nextPosition.y - startPosition.y) * easedProgress
        });

        if (progress < 1) {
          animationRef.current = window.requestAnimationFrame(step);
          return;
        }

        setPlayerPosition(nextPosition);
        setRenderPosition(nextPosition);
        setMoveCount((currentCount) => currentCount + 1);
        actionLockRef.current = false;

        if (isExitReached(nextPosition, maze)) {
          const completedAt = Date.now();
          setHasFinished(true);
          setFinishTime(completedAt);
        }
      }

      animationRef.current = window.requestAnimationFrame(step);
    }

    function triggerFinishSequence() {
      const completedAt = Date.now();
      actionLockRef.current = true;
      setMoveCount((currentCount) => currentCount + 1);
      setFinishTime(completedAt);

      if (prefersReducedMotion) {
        setHasFinished(true);
        actionLockRef.current = false;
        return;
      }

      setSceneAnimationMode("outro");
      setIntroSequence((current) => current + 1);

      if (completionTimeoutRef.current !== null) {
        window.clearTimeout(completionTimeoutRef.current);
      }

      completionTimeoutRef.current = window.setTimeout(() => {
        setHasFinished(true);
        actionLockRef.current = false;
      }, SCENE_ANIMATION_DURATION_MS);
    }

    function animateTurn(nextDirectionIndex: number) {
      if (prefersReducedMotion) {
        setDirectionIndex(nextDirectionIndex);
        setRenderAngle(DIRECTION_ORDER[nextDirectionIndex].angle);
        return;
      }

      const startAngle = renderAngle;
      const targetAngle = DIRECTION_ORDER[nextDirectionIndex].angle;
      const delta = normalizeAngle(targetAngle - startAngle);
      const startedAt = performance.now();
      actionLockRef.current = true;

      function step(now: number) {
        const progress = Math.min(1, (now - startedAt) / TURN_DURATION_MS);
        const easedProgress = 1 - Math.pow(1 - progress, 3);

        setRenderAngle(startAngle + delta * easedProgress);

        if (progress < 1) {
          animationRef.current = window.requestAnimationFrame(step);
          return;
        }

        setDirectionIndex(nextDirectionIndex);
        setRenderAngle(DIRECTION_ORDER[nextDirectionIndex].angle);
        actionLockRef.current = false;
      }

      animationRef.current = window.requestAnimationFrame(step);
    }

    function performAction(action: "turn_left" | "turn_right" | "move_forward" | "move_backward") {
      if (hasFinished || actionLockRef.current) {
        return;
      }

      if (action === "turn_left") {
        const startedAt = beginRunIfNeeded();
        recordReplayAction("turn_left", startedAt);
        const nextDirectionIndex =
          (directionIndex + DIRECTION_ORDER.length - 1) % DIRECTION_ORDER.length;
        animateTurn(nextDirectionIndex);
        return;
      }

      if (action === "turn_right") {
        const startedAt = beginRunIfNeeded();
        recordReplayAction("turn_right", startedAt);
        const nextDirectionIndex = (directionIndex + 1) % DIRECTION_ORDER.length;
        animateTurn(nextDirectionIndex);
        return;
      }

      const movementDirection =
        action === "move_forward"
          ? DIRECTION_ORDER[directionIndex].vector
          : {
              x: -DIRECTION_ORDER[directionIndex].vector.x,
              y: -DIRECTION_ORDER[directionIndex].vector.y
            };

      const nextPosition = attemptMove(playerPosition, movementDirection, maze);

      if (nextPosition.x === playerPosition.x && nextPosition.y === playerPosition.y) {
        return;
      }

      const startedAt = beginRunIfNeeded();
      recordReplayAction(action, startedAt);

      if (isExitReached(nextPosition, maze)) {
        triggerFinishSequence();
        return;
      }

      animateMovement(nextPosition);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (isTypingTarget(event.target)) {
        return;
      }

      const action =
        event.key === "ArrowLeft" || event.key === "a"
          ? "turn_left"
          : event.key === "ArrowRight" || event.key === "d"
            ? "turn_right"
            : event.key === "ArrowUp" || event.key === "w"
              ? "move_forward"
              : event.key === "ArrowDown" || event.key === "s"
                ? "move_backward"
                : null;

      if (!action) {
        return;
      }

      event.preventDefault();
      performAction(action);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [directionIndex, hasFinished, maze, playerPosition, prefersReducedMotion, renderAngle, runStartTime]);

  function handleReset() {
    if (animationRef.current !== null) {
      window.cancelAnimationFrame(animationRef.current);
    }

    if (completionTimeoutRef.current !== null) {
      window.clearTimeout(completionTimeoutRef.current);
    }

    setPlayerPosition(maze.start);
    setDirectionIndex(startingDirectionIndex);
    setRenderPosition(maze.start);
    setRenderAngle(DIRECTION_ORDER[startingDirectionIndex].angle);
    setMoveCount(0);
    setHasFinished(false);
    setRunStartTime(null);
    setFinishTime(null);
    setSubmissionStatus("idle");
    setSubmissionSummary(null);
    setSceneAnimationMode("intro");
    setIntroSequence((current) => current + 1);
    actionLockRef.current = false;
    submittedRunRef.current = null;
    replayTraceRef.current = [];
  }

  async function handleFullscreenToggle() {
    try {
      if (document.fullscreenElement === viewportRef.current) {
        await document.exitFullscreen();
        return;
      }

      await viewportRef.current?.requestFullscreen?.();
    } catch (error) {
      console.error("Failed to toggle fullscreen", error);
    }
  }

  const completedElapsedTime =
    finishTime && runStartTime ? formatElapsedTime(finishTime - runStartTime) : null;
  const metadataItems: MetadataItem[] = useMemo(
    () => [
      { label: uiText.labels.date, value: maze.date },
      { label: uiText.labels.title, value: maze.title },
      { label: uiText.labels.seed, value: <code>{maze.seed}</code> },
      { label: uiText.labels.size, value: `${maze.size.width} x ${maze.size.height}` },
      { label: uiText.labels.start, value: `(${maze.start.x}, ${maze.start.y})` },
      { label: uiText.labels.exit, value: `(${maze.exit.x}, ${maze.exit.y})` }
    ],
    [maze, uiText.labels]
  );

  return (
    <section className="maze-summary play-summary" aria-labelledby="maze-summary-title">
      <h2 id="maze-summary-title" className="sr-only">
        {uiText.gameplay.summaryHeading}
      </h2>
      <div className="play-focus-layout">
        <div className="play-focus-sidebar">
          <dl className="gameplay-hud" aria-label={uiText.gameplay.currentRunStatus}>
            <div className="gameplay-hud-item gameplay-hud-item-primary">
              <dt>{hasFinished ? uiText.gameplay.winTitle : uiText.labels.time}</dt>
              <dd>
                <RunTimerValue runStartTime={runStartTime} finishTime={finishTime} />
              </dd>
            </div>
            <div className="gameplay-hud-item">
              <dt>{uiText.labels.moves}</dt>
              <dd>{moveCount}</dd>
            </div>
            <div className="gameplay-hud-item">
              <dt>{uiText.labels.facing}</dt>
              <dd>{getLocalizedDirectionLabel(DIRECTION_ORDER[directionIndex].name, uiText.directions)}</dd>
            </div>
          </dl>
          <p className="gameplay-controls" aria-label={uiText.labels.controls}>
            {uiText.gameplay.controls}
          </p>
          <div className="actions play-focus-actions">
            <button type="button" className="secondary-button" onClick={handleReset}>
              {uiText.actions.resetRun}
            </button>
            {supportsFullscreen && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => void handleFullscreenToggle()}
              >
                {isFullscreen ? uiText.actions.exitFullscreen : uiText.actions.fullscreen}
              </button>
            )}
          </div>
          <div className="play-status-stack" aria-live="polite">
            {hasFinished ? (
              <section className="play-win-state" aria-label={uiText.gameplay.winTitle}>
                <p className="body-copy status-copy success-copy">
                  {uiText.gameplay.completionMessage.replace(
                    "{elapsed}",
                    completedElapsedTime ?? formatElapsedTime(0)
                  )}
                </p>
                {submissionStatus === "submitting" && (
                  <p className="body-copy status-copy">{uiText.gameplay.submittingRun}</p>
                )}
                {submissionStatus === "submitted" && submissionSummary && (
                  <div className="play-win-verification">
                    <p className="body-copy status-copy success-copy">
                      {uiText.gameplay.submissionAccepted
                        .replace("{acceptedAt}", formatDateTime(submissionSummary.acceptedAt))
                        .replace(
                          "{status}",
                          getLocalizedVerificationLabel(
                            submissionSummary.verificationStatus,
                            uiText.verification
                          )
                        )}
                    </p>
                  </div>
                )}
                {submissionStatus === "error" && (
                  <p className="body-copy status-copy error-copy">
                    {uiText.gameplay.submissionError}
                  </p>
                )}
              </section>
            ) : (
              <p className="body-copy status-copy">{uiText.gameplay.introStatus}</p>
            )}
          </div>
        </div>
        <div className="play-focus-main">
          <FirstPersonView
            maze={maze}
            playerPosition={renderPosition}
            playerAngle={renderAngle}
            introSequence={introSequence}
            animationMode={sceneAnimationMode}
            viewportRef={viewportRef}
            isFullscreen={isFullscreen}
            onExitFullscreen={() => {
              void handleFullscreenToggle();
            }}
            exitFullscreenLabel={uiText.actions.exitFullscreen}
            onSwipeAction={(action) => {
              const key =
                action === "turn_left"
                  ? "ArrowLeft"
                  : action === "turn_right"
                    ? "ArrowRight"
                    : action === "move_forward"
                      ? "ArrowUp"
                      : "ArrowDown";

              window.dispatchEvent(new KeyboardEvent("keydown", { key }));
            }}
          />
        </div>
      </div>
      {isAdmin && (
        <>
          <MetadataList items={metadataItems} />
          <div className="maze-grid-preview" role="img" aria-label={uiText.gameplay.debugViewLabel}>
            {gridRows.map((row, index) => (
              <code key={`${index}-${row}`} className="maze-grid-row">
                {row}
              </code>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
