"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import FirstPersonView from "../../components/game/FirstPersonView";
import {
  authenticate,
  fetchCurrentUser,
  fetchDailyMaze,
  fetchLeaderboard,
  logout,
  ROLE_ADMIN,
  roleAllows,
  ROLE_MODERATOR,
  submitRun,
  type AuthUser,
  type LeaderboardEntry,
  type ReplayTraceEvent,
  type RunSubmissionResponse
} from "../../lib/api";
import { githubOAuthEnabled, oauthStartEndpoint } from "../../lib/config";
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

type AsyncStatus = "idle" | "loading" | "success" | "error";
type SubmissionStatus = "idle" | "submitting" | "submitted" | "error";
type AuthMode = "login" | "register";
type AuthStatus = "loading" | "authenticated" | "unauthenticated";
type SceneAnimationMode = "intro" | "outro";

const SCENE_ANIMATION_DURATION_MS = 1250;

interface MetadataItem {
  label: string;
  value: ReactNode;
}

interface MetadataListProps {
  items: MetadataItem[];
}

interface MazeDetailsProps {
  maze: DailyMaze;
  isAdmin: boolean;
  onRunSubmitted: () => void;
}

interface LeaderboardProps {
  entries: LeaderboardEntry[];
}

interface AuthPanelProps {
  user: AuthUser | null;
  onAuthChange: (nextUser: AuthUser | null) => void;
}

interface ArchiveNavigatorProps {
  archiveDate: string;
}

interface CollapsiblePanelProps {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

function getLocalizedDirectionLabel(
  directionName: string | undefined,
  directions: {
    north: string;
    east: string;
    south: string;
    west: string;
  }
): string {
  switch (directionName) {
    case "North":
      return directions.north;
    case "East":
      return directions.east;
    case "South":
      return directions.south;
    case "West":
      return directions.west;
    default:
      return directionName ?? "";
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

function getLocalizedVerificationLabel(
  status: string | undefined,
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
      return status ?? "";
  }
}

function CollapsiblePanel({ title, defaultOpen = false, children }: CollapsiblePanelProps) {
  return (
    <details className="play-secondary-details" open={defaultOpen}>
      <summary>{title}</summary>
      <div className="play-secondary-details-body">{children}</div>
    </details>
  );
}

function MetadataList({ items }: MetadataListProps) {
  return (
    <dl className="metadata-list">
      {items.map((item) => (
        <div key={item.label} className="metadata-row">
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function shiftArchiveDate(date: string, days: number): string {
  const parts = date.split("-").map(Number);
  const shiftedDate = new Date(Date.UTC(parts[0] ?? 0, (parts[1] ?? 1) - 1, parts[2] ?? 1));
  shiftedDate.setUTCDate(shiftedDate.getUTCDate() + days);
  return shiftedDate.toISOString().slice(0, 10);
}

function ArchiveNavigator({ archiveDate }: ArchiveNavigatorProps) {
  const { messages } = useLocale();
  const uiText = messages.play;
  const previousDate = shiftArchiveDate(archiveDate, -1);
  const nextDate = shiftArchiveDate(archiveDate, 1);
  const todayDate = new Date().toISOString().slice(0, 10);
  const canAdvance = nextDate <= todayDate;
  const isToday = archiveDate === todayDate;

  return (
    <section className="maze-summary archive-nav" aria-labelledby="archive-nav-title">
      <h2 id="archive-nav-title" className="section-title">
        {uiText.archiveTitle}
      </h2>
      <p className="body-copy">{uiText.archiveBody}</p>
      <div className="actions">
        <Link href={`/play?date=${previousDate}`} className="secondary-link">
          {uiText.archiveActions.previousDay}
        </Link>
        {canAdvance ? (
          <Link href={`/play?date=${nextDate}`} className="secondary-link">
            {uiText.archiveActions.nextDay}
          </Link>
        ) : (
          <span className="secondary-link is-disabled" aria-disabled="true">
            {uiText.archiveActions.nextDay}
          </span>
        )}
        {!isToday && (
          <Link href="/play" className="primary-link">
            {uiText.archiveActions.jumpToToday}
          </Link>
        )}
      </div>
    </section>
  );
}

function MazeDetails({ maze, isAdmin, onRunSubmitted }: MazeDetailsProps) {
  const { formatDateTime, messages } = useLocale();
  const uiText = messages.play;
  const startingDirectionIndex = getStartingDirectionIndex(maze);
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
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const [submissionStatus, setSubmissionStatus] = useState<SubmissionStatus>("idle");
  const [submissionSummary, setSubmissionSummary] =
    useState<RunSubmissionResponse | null>(null);
  const [introSequence, setIntroSequence] = useState<number>(0);
  const [sceneAnimationMode, setSceneAnimationMode] =
    useState<SceneAnimationMode>("intro");
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [supportsFullscreen, setSupportsFullscreen] = useState<boolean>(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState<boolean>(false);
  const animationRef = useRef<number | null>(null);
  const completionTimeoutRef = useRef<number | null>(null);
  const actionLockRef = useRef<boolean>(false);
  const submittedRunRef = useRef<string | null>(null);
  const replayTraceRef = useRef<ReplayTraceEvent[]>([]);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const gridRows = renderGridRows(maze, playerPosition, directionIndex);

  useEffect(() => {
    setPlayerPosition(maze.start);
    setDirectionIndex(startingDirectionIndex);
    setRenderPosition(maze.start);
    setRenderAngle(DIRECTION_ORDER[startingDirectionIndex].angle);
    setMoveCount(0);
    setHasFinished(false);
    setRunStartTime(null);
    setFinishTime(null);
    setElapsedMs(0);
    setSubmissionStatus("idle");
    setSubmissionSummary(null);
    setSceneAnimationMode("intro");
    setIntroSequence((current) => current + 1);
    actionLockRef.current = false;
    submittedRunRef.current = null;
    replayTraceRef.current = [];
  }, [maze, startingDirectionIndex]);

  useEffect(() => {
    if (!runStartTime || hasFinished) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setElapsedMs(Date.now() - runStartTime);
    }, 16);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [hasFinished, runStartTime]);

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
      typeof document.fullscreenEnabled === "boolean" &&
      document.fullscreenEnabled &&
      typeof viewportRef.current?.requestFullscreen === "function";

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
      setElapsedMs(0);
      return startedAt;
    }

    function recordReplayAction(
      action: ReplayTraceEvent["action"],
      startedAtForRun: number
    ) {
      replayTraceRef.current = [
        ...replayTraceRef.current,
        {
          action,
          elapsedTimeMs: Math.max(0, Date.now() - startedAtForRun)
        }
      ];
    }

    function animateMovement(nextPosition: MazePoint, startedAtForRun: number) {
      if (prefersReducedMotion) {
        setPlayerPosition(nextPosition);
        setRenderPosition(nextPosition);
        setMoveCount((currentCount) => currentCount + 1);

        if (isExitReached(nextPosition, maze)) {
          const completedAt = Date.now();
          setHasFinished(true);
          setFinishTime(completedAt);
          setElapsedMs(completedAt - startedAtForRun);
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
          setElapsedMs(completedAt - startedAtForRun);
        }
      }

      animationRef.current = window.requestAnimationFrame(step);
    }

    function triggerFinishSequence(startedAtForRun: number) {
      const completedAt = Date.now();
      actionLockRef.current = true;
      setMoveCount((currentCount) => currentCount + 1);
      setElapsedMs(completedAt - startedAtForRun);

      if (prefersReducedMotion) {
        setHasFinished(true);
        setFinishTime(completedAt);
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
        setFinishTime(completedAt);
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

    function performAction(
      action: "turn_left" | "turn_right" | "move_forward" | "move_backward"
    ) {
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
          : action === "move_backward"
            ? {
                x: -DIRECTION_ORDER[directionIndex].vector.x,
                y: -DIRECTION_ORDER[directionIndex].vector.y
              }
            : null;

      if (!movementDirection) {
        return;
      }

      const nextPosition = attemptMove(playerPosition, movementDirection, maze);

      if (
        nextPosition.x === playerPosition.x &&
        nextPosition.y === playerPosition.y
      ) {
        return;
      }

      const startedAt = beginRunIfNeeded();
      recordReplayAction(
        movementDirection.x === DIRECTION_ORDER[directionIndex].vector.x &&
          movementDirection.y === DIRECTION_ORDER[directionIndex].vector.y
          ? "move_forward"
          : "move_backward",
        startedAt
      );

      if (isExitReached(nextPosition, maze)) {
        triggerFinishSequence(startedAt);
        return;
      }

      animateMovement(nextPosition, startedAt);
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
  }, [
    directionIndex,
    hasFinished,
    maze,
    playerPosition,
    prefersReducedMotion,
    renderAngle,
    runStartTime
  ]);

  function handleReset() {
    if (animationRef.current !== null) {
      window.cancelAnimationFrame(animationRef.current);
    }

    setPlayerPosition(maze.start);
    setDirectionIndex(startingDirectionIndex);
    setRenderPosition(maze.start);
    setRenderAngle(DIRECTION_ORDER[startingDirectionIndex].angle);
    setMoveCount(0);
    setHasFinished(false);
    setRunStartTime(null);
    setFinishTime(null);
    setElapsedMs(0);
    setSubmissionStatus("idle");
    setSubmissionSummary(null);
    setSceneAnimationMode("intro");
    setIntroSequence((current) => current + 1);
    actionLockRef.current = false;
    submittedRunRef.current = null;
    replayTraceRef.current = [];
  }

  const elapsedTime = finishTime && runStartTime
    ? formatElapsedTime(finishTime - runStartTime)
    : formatElapsedTime(elapsedMs);
  const metadataItems: MetadataItem[] = [
    { label: uiText.labels.date, value: maze.date },
    { label: uiText.labels.title, value: maze.title },
    { label: uiText.labels.seed, value: <code>{maze.seed}</code> },
    {
      label: uiText.labels.size,
      value: `${maze.size.width} x ${maze.size.height}`
    },
    {
      label: uiText.labels.start,
      value: `(${maze.start.x}, ${maze.start.y})`
    },
    {
      label: uiText.labels.exit,
      value: `(${maze.exit.x}, ${maze.exit.y})`
    }
  ];

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
              <dd>{elapsedTime}</dd>
            </div>
            <div className="gameplay-hud-item">
              <dt>{uiText.labels.moves}</dt>
              <dd>{moveCount}</dd>
            </div>
            <div className="gameplay-hud-item">
              <dt>{uiText.labels.facing}</dt>
              <dd>
                {getLocalizedDirectionLabel(
                  DIRECTION_ORDER[directionIndex].name,
                  uiText.directions
                )}
              </dd>
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
                  {uiText.gameplay.completionMessage.replace("{elapsed}", elapsedTime)}
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
        <div className="play-focus-main" ref={viewportRef}>
          <FirstPersonView
            maze={maze}
            playerPosition={renderPosition}
            playerAngle={renderAngle}
            introSequence={introSequence}
            animationMode={sceneAnimationMode}
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
          <div
            className="maze-grid-preview"
            role="img"
            aria-label={uiText.gameplay.debugViewLabel}
          >
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

function Leaderboard({ entries }: LeaderboardProps) {
  const { formatCount, messages } = useLocale();
  const uiText = messages.play;
  return (
    <section className="maze-summary" aria-labelledby="leaderboard-title">
      <h2 id="leaderboard-title" className="section-title">
        {uiText.leaderboard.heading}
      </h2>
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
            <div key={`${entry.rank}-${entry.acceptedAt}`} className="leaderboard-row">
              <span>#{entry.rank}</span>
              <span>
                {entry.username ? (
                  <Link href={`/profile/${entry.username}`} className="inline-link">
                    {entry.username}
                  </Link>
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
  const [mode, setMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState<string>("");
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
      const authenticatedUser = await authenticate(mode, { username, password });
      onAuthChange(authenticatedUser);
      setStatus("success");
      setErrorMessage("");
      setPassword("");
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
            <Link href={`/profile/${user.username}`} className="inline-link">
              <code>{user.username}</code>
            </Link>
            {" "}(
            {uiText.auth.role}:{" "}
            <code>{getLocalizedRoleLabel(user.role, uiText.auth.roles)}</code>)
          </p>
          <div className="actions">
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
          <div className="actions">
            <button type="submit" className="primary-button" disabled={status === "submitting"}>
              {submitLabel}
            </button>
            {githubOAuthEnabled && (
              <a href={oauthStartEndpoint("github")} className="secondary-link">
                {uiText.auth.continueWithGitHub}
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

function PlayPageContent() {
  const { messages } = useLocale();
  const uiText = messages.play;
  const searchParams = useSearchParams();
  const archiveDate = searchParams.get("date") ?? "";
  const [maze, setMaze] = useState<DailyMaze | null>(null);
  const [status, setStatus] = useState<AsyncStatus>("loading");
  const [leaderboardEntries, setLeaderboardEntries] = useState<LeaderboardEntry[]>([]);
  const [leaderboardStatus, setLeaderboardStatus] = useState<AsyncStatus>("idle");
  const [leaderboardRefreshKey, setLeaderboardRefreshKey] = useState<number>(0);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus>("loading");
  const [isCompactLandscape, setIsCompactLandscape] = useState<boolean>(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 960px) and (orientation: landscape)");
    const sync = () => setIsCompactLandscape(mediaQuery.matches);

    sync();
    mediaQuery.addEventListener("change", sync);
    return () => {
      mediaQuery.removeEventListener("change", sync);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadMaze() {
      try {
        const payload = await fetchDailyMaze(archiveDate || undefined);

        if (!isMounted) {
          return;
        }

        setMaze(payload);
        setStatus("success");
      } catch (error) {
        console.error("Failed to load daily maze metadata", error);

        if (!isMounted) {
          return;
        }

        setStatus("error");
      }
    }

    void loadMaze();

    return () => {
      isMounted = false;
    };
  }, [archiveDate]);

  useEffect(() => {
    let isMounted = true;

    async function loadCurrentUser() {
      try {
        const currentUser = await fetchCurrentUser();

        if (!isMounted) {
          return;
        }

        setUser(currentUser);
        setAuthStatus(currentUser ? "authenticated" : "unauthenticated");
      } catch (error) {
        console.error("Failed to load current user", error);

        if (!isMounted) {
          return;
        }

        setUser(null);
        setAuthStatus("unauthenticated");
      }
    }

    void loadCurrentUser();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!maze) {
      return;
    }

    const mazeDate = maze.date;
    let isMounted = true;
    setLeaderboardStatus("loading");

    async function loadLeaderboard() {
      try {
        const payload = await fetchLeaderboard(mazeDate);

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
  }, [leaderboardRefreshKey, maze]);

  return (
    <main className="page-shell">
      <div className="content-card content-card-wide play-window">
        <p className="eyebrow">{uiText.eyebrow}</p>
        <h1 className="sr-only">{uiText.title}</h1>
        {archiveDate && (
          <p className="body-copy body-copy-strong">
            {uiText.archiveViewing} <code>{archiveDate}</code>.
          </p>
        )}
        {archiveDate &&
          (isCompactLandscape ? (
            <CollapsiblePanel title={uiText.archivePanelTitle}>
              <ArchiveNavigator archiveDate={archiveDate} />
            </CollapsiblePanel>
          ) : (
            <ArchiveNavigator archiveDate={archiveDate} />
          ))}

        {status === "loading" && (
          <p className="body-copy status-copy" aria-live="polite">
            {uiText.loadingMaze}
          </p>
        )}

        {status === "success" && maze && (
          <MazeDetails
            maze={maze}
            isAdmin={roleAllows(user?.role, ROLE_ADMIN)}
            onRunSubmitted={() =>
              setLeaderboardRefreshKey((currentKey) => currentKey + 1)
            }
          />
        )}

        {status === "success" && maze && (
          <div className="play-side-panels">
            <div className="play-side-panel">
              {isCompactLandscape ? (
                <CollapsiblePanel title={uiText.leaderboard.title}>
                  {leaderboardStatus === "loading" && (
                    <p className="body-copy status-copy" aria-live="polite">
                      {uiText.loadingLeaderboard}
                    </p>
                  )}
                  {leaderboardStatus !== "error" && (
                    <Leaderboard entries={leaderboardEntries} />
                  )}
                </CollapsiblePanel>
              ) : (
                <>
                  {leaderboardStatus === "loading" && (
                    <p className="body-copy status-copy" aria-live="polite">
                      {uiText.loadingLeaderboard}
                    </p>
                  )}
                  {leaderboardStatus !== "error" && (
                    <Leaderboard entries={leaderboardEntries} />
                  )}
                </>
              )}
            </div>

            <div className="play-side-panel">
              {authStatus !== "loading" &&
                (isCompactLandscape ? (
                  <CollapsiblePanel
                    title={user ? uiText.authLinks.playerPanel : uiText.authLinks.signInPanel}
                    defaultOpen={false}
                  >
                    <AuthPanel
                      user={user}
                      onAuthChange={(nextUser) => {
                        setUser(nextUser);
                        setAuthStatus(nextUser ? "authenticated" : "unauthenticated");
                        setLeaderboardRefreshKey((currentKey) => currentKey + 1);
                      }}
                    />
                  </CollapsiblePanel>
                ) : (
                  <AuthPanel
                    user={user}
                    onAuthChange={(nextUser) => {
                      setUser(nextUser);
                      setAuthStatus(nextUser ? "authenticated" : "unauthenticated");
                      setLeaderboardRefreshKey((currentKey) => currentKey + 1);
                    }}
                  />
                ))}
            </div>
          </div>
        )}

        {status === "success" && maze && leaderboardStatus === "error" && (
          <p className="body-copy status-copy error-copy" aria-live="polite">
            {uiText.leaderboardError}
          </p>
        )}

        {status === "error" && (
          <p className="body-copy status-copy error-copy" aria-live="assertive">
            {uiText.mazeError}
          </p>
        )}

        <div className="actions">
          <Link href="/history" className="secondary-link">
            {uiText.actions.challengeArchive}
          </Link>
          <Link href="/" className="secondary-link">
            {uiText.actions.backHome}
          </Link>
        </div>
        <div className="window-footer" aria-label={uiText.gameplay.statusBar}>
          <span>{uiText.systemBar}</span>
          <span>
            {archiveDate
              ? `${uiText.archiveStatusPrefix} ${archiveDate}`
              : uiText.archiveStatusToday}
          </span>
        </div>
      </div>
    </main>
  );
}

export default function PlayPage() {
  const { messages } = useLocale();
  const uiText = messages.play;
  return (
    <Suspense
      fallback={
        <main className="page-shell">
          <div className="content-card content-card-wide play-window">
            <p className="eyebrow">{uiText.eyebrow}</p>
            <h1>{uiText.title}</h1>
            <p className="body-copy status-copy" aria-live="polite">
              {uiText.loadingMaze}
            </p>
          </div>
        </main>
      }
    >
      <PlayPageContent />
    </Suspense>
  );
}
