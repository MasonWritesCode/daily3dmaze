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
  submitRun,
  type AuthUser,
  type LeaderboardEntry,
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

type AsyncStatus = "idle" | "loading" | "success" | "error";
type SubmissionStatus = "idle" | "submitting" | "submitted" | "error";
type AuthMode = "login" | "register";
type AuthStatus = "loading" | "authenticated" | "unauthenticated";

interface MetadataItem {
  label: string;
  value: ReactNode;
}

interface MetadataListProps {
  items: MetadataItem[];
}

interface MazeDetailsProps {
  maze: DailyMaze;
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

const uiText = {
  play: {
    eyebrow: "Play",
    title: "Daily maze metadata",
    intro:
      "This page now fetches the first real piece of game data from the Go API. It includes a simple first-person raycast panel and keeps the top-down maze visible for debugging.",
    loadingMaze: "Loading daily maze...",
    loadingLeaderboard: "Loading leaderboard...",
    leaderboardError: "Unable to load the leaderboard right now.",
    mazeError:
      "Unable to load the daily maze metadata. Make sure the API is running on http://localhost:8080."
  },
  labels: {
    date: "Date",
    title: "Title",
    seed: "Seed",
    size: "Size",
    start: "Start",
    exit: "Exit",
    moves: "Moves",
    time: "Time",
    facing: "Facing",
    controls: "Controls"
  },
  actions: {
    resetRun: "Reset run",
    backHome: "Back home",
    logIn: "Log in",
    createAccount: "Create account",
    logOut: "Log out"
  },
  auth: {
    heading: "Identity",
    username: "Username",
    password: "Password",
    signedInAs: "Signed in as",
    signingIn: "Signing in...",
    creatingAccount: "Creating account...",
    loginSuccess: "Signed in successfully.",
    registerSuccess: "Account created and signed in."
  },
  leaderboard: {
    heading: "Leaderboard",
    empty: "No submitted runs for this day yet.",
    ariaLabel: "Daily leaderboard",
    rank: "Rank",
    player: "Player",
    elapsed: "Time",
    moves: "Moves"
  },
  gameplay: {
    controls: "Up/Down or W/S move, Left/Right or A/D turn",
    introStatus: "Navigate from S to E. The top-down player marker shows facing.",
    submittingRun: "Submitting run to the API...",
    submissionError: "The run finished locally, but submission to the API failed.",
    debugViewLabel: "Daily maze debug view",
    summaryHeading: "Maze summary"
  }
} as const;

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
  const previousDate = shiftArchiveDate(archiveDate, -1);
  const nextDate = shiftArchiveDate(archiveDate, 1);
  const todayDate = new Date().toISOString().slice(0, 10);
  const canAdvance = nextDate <= todayDate;
  const isToday = archiveDate === todayDate;

  return (
    <section className="maze-summary archive-nav" aria-labelledby="archive-nav-title">
      <h2 id="archive-nav-title" className="section-title">
        Archive navigator
      </h2>
      <p className="body-copy">
        Move through archived daily challenges without leaving the maze viewer.
      </p>
      <div className="actions">
        <Link href={`/play?date=${previousDate}`} className="secondary-link">
          Previous day
        </Link>
        {canAdvance ? (
          <Link href={`/play?date=${nextDate}`} className="secondary-link">
            Next day
          </Link>
        ) : (
          <span className="secondary-link is-disabled" aria-disabled="true">
            Next day
          </span>
        )}
        {!isToday && (
          <Link href="/play" className="primary-link">
            Jump to today
          </Link>
        )}
      </div>
    </section>
  );
}

function MazeDetails({ maze, onRunSubmitted }: MazeDetailsProps) {
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
  const animationRef = useRef<number | null>(null);
  const actionLockRef = useRef<boolean>(false);
  const submittedRunRef = useRef<string | null>(null);
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
    actionLockRef.current = false;
    submittedRunRef.current = null;
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
          elapsedTimeMs
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

    function animateMovement(nextPosition: MazePoint, startedAtForRun: number) {
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

    function animateTurn(nextDirectionIndex: number) {
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

    function handleKeyDown(event: KeyboardEvent) {
      if (isTypingTarget(event.target)) {
        return;
      }

      if (hasFinished || actionLockRef.current) {
        return;
      }

      if (event.key === "ArrowLeft" || event.key === "a") {
        event.preventDefault();
        beginRunIfNeeded();
        const nextDirectionIndex =
          (directionIndex + DIRECTION_ORDER.length - 1) % DIRECTION_ORDER.length;
        animateTurn(nextDirectionIndex);
        return;
      }

      if (event.key === "ArrowRight" || event.key === "d") {
        event.preventDefault();
        beginRunIfNeeded();
        const nextDirectionIndex = (directionIndex + 1) % DIRECTION_ORDER.length;
        animateTurn(nextDirectionIndex);
        return;
      }

      const movementDirection =
        event.key === "ArrowUp" || event.key === "w"
          ? DIRECTION_ORDER[directionIndex].vector
          : event.key === "ArrowDown" || event.key === "s"
            ? {
                x: -DIRECTION_ORDER[directionIndex].vector.x,
                y: -DIRECTION_ORDER[directionIndex].vector.y
              }
            : null;

      if (!movementDirection) {
        return;
      }

      event.preventDefault();

      const nextPosition = attemptMove(playerPosition, movementDirection, maze);

      if (
        nextPosition.x === playerPosition.x &&
        nextPosition.y === playerPosition.y
      ) {
        return;
      }

      const startedAt = beginRunIfNeeded();
      animateMovement(nextPosition, startedAt);
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [directionIndex, hasFinished, maze, playerPosition, renderAngle, runStartTime]);

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
    actionLockRef.current = false;
    submittedRunRef.current = null;
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
    },
    { label: uiText.labels.moves, value: moveCount },
    { label: uiText.labels.time, value: elapsedTime },
    {
      label: uiText.labels.facing,
      value: DIRECTION_ORDER[directionIndex].name
    },
    { label: uiText.labels.controls, value: uiText.gameplay.controls }
  ];

  return (
    <section className="maze-summary" aria-labelledby="maze-summary-title">
      <h2 id="maze-summary-title" className="section-title">
        {uiText.gameplay.summaryHeading}
      </h2>
      <FirstPersonView
        maze={maze}
        playerPosition={renderPosition}
        playerAngle={renderAngle}
        facingName={DIRECTION_ORDER[directionIndex].name}
      />
      <MetadataList items={metadataItems} />
      <p
        className={`body-copy status-copy ${hasFinished ? "success-copy" : ""}`}
        aria-live="polite"
      >
        {hasFinished
          ? `Maze complete in ${elapsedTime}.`
          : uiText.gameplay.introStatus}
      </p>
      {submissionStatus === "submitting" && (
        <p className="body-copy status-copy" aria-live="polite">
          {uiText.gameplay.submittingRun}
        </p>
      )}
      {submissionStatus === "submitted" && submissionSummary && (
        <p className="body-copy status-copy success-copy" aria-live="polite">
          Run accepted by the API at <code>{submissionSummary.acceptedAt}</code>.
        </p>
      )}
      {submissionStatus === "error" && (
        <p className="body-copy status-copy error-copy" aria-live="polite">
          {uiText.gameplay.submissionError}
        </p>
      )}
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
      <div className="actions">
        <button type="button" className="secondary-button" onClick={handleReset}>
          {uiText.actions.resetRun}
        </button>
      </div>
    </section>
  );
}

function Leaderboard({ entries }: LeaderboardProps) {
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
                  "Anonymous"
                )}
              </span>
              <span>{formatElapsedTime(entry.elapsedTimeMs)}</span>
              <span>{entry.moveCount} moves</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function AuthPanel({ user, onAuthChange }: AuthPanelProps) {
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
      setErrorMessage(error instanceof Error ? error.message : "Authentication failed");
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
      setErrorMessage(error instanceof Error ? error.message : "Logout failed");
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
          </p>
          <div className="actions">
            <button type="button" className="secondary-button" onClick={handleLogout}>
              {uiText.actions.logOut}
            </button>
          </div>
        </>
      ) : (
        <form className="auth-form" onSubmit={handleSubmit} aria-describedby={helperId}>
          <fieldset className="auth-toggle-group">
            <legend className="sr-only">Authentication mode</legend>
            <div className="auth-toggle" role="tablist" aria-label="Authentication mode">
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
            Usernames support letters, numbers, underscores, and hyphens. Passwords
            must be at least 10 characters long.
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
  const searchParams = useSearchParams();
  const archiveDate = searchParams.get("date") ?? "";
  const [maze, setMaze] = useState<DailyMaze | null>(null);
  const [status, setStatus] = useState<AsyncStatus>("loading");
  const [leaderboardEntries, setLeaderboardEntries] = useState<LeaderboardEntry[]>([]);
  const [leaderboardStatus, setLeaderboardStatus] = useState<AsyncStatus>("idle");
  const [leaderboardRefreshKey, setLeaderboardRefreshKey] = useState<number>(0);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus>("loading");

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
      <div className="content-card">
        <p className="eyebrow">{uiText.play.eyebrow}</p>
        <h1>{uiText.play.title}</h1>
        <p className="body-copy">{uiText.play.intro}</p>
        {archiveDate && (
          <p className="body-copy">
            Viewing archived challenge <code>{archiveDate}</code>.
          </p>
        )}
        {archiveDate && <ArchiveNavigator archiveDate={archiveDate} />}

        {status === "loading" && (
          <p className="body-copy status-copy" aria-live="polite">
            {uiText.play.loadingMaze}
          </p>
        )}

        {status === "success" && maze && (
          <MazeDetails
            maze={maze}
            onRunSubmitted={() =>
              setLeaderboardRefreshKey((currentKey) => currentKey + 1)
            }
          />
        )}

        {status === "success" && maze && leaderboardStatus === "loading" && (
          <p className="body-copy status-copy" aria-live="polite">
            {uiText.play.loadingLeaderboard}
          </p>
        )}

        {status === "success" && maze && leaderboardStatus !== "error" && (
          <Leaderboard entries={leaderboardEntries} />
        )}

        {authStatus !== "loading" && (
          <AuthPanel
            user={user}
            onAuthChange={(nextUser) => {
              setUser(nextUser);
              setAuthStatus(nextUser ? "authenticated" : "unauthenticated");
              setLeaderboardRefreshKey((currentKey) => currentKey + 1);
            }}
          />
        )}

        {status === "success" && maze && leaderboardStatus === "error" && (
          <p className="body-copy status-copy error-copy" aria-live="polite">
            {uiText.play.leaderboardError}
          </p>
        )}

        {status === "error" && (
          <p className="body-copy status-copy error-copy" aria-live="assertive">
            {uiText.play.mazeError}
          </p>
        )}

        <div className="actions">
          <Link href="/history" className="secondary-link">
            Browse history
          </Link>
          <Link href="/" className="secondary-link">
            {uiText.actions.backHome}
          </Link>
        </div>
      </div>
    </main>
  );
}

export default function PlayPage() {
  return (
    <Suspense
      fallback={
        <main className="page-shell">
          <div className="content-card">
            <p className="eyebrow">{uiText.play.eyebrow}</p>
            <h1>{uiText.play.title}</h1>
            <p className="body-copy status-copy" aria-live="polite">
              {uiText.play.loadingMaze}
            </p>
          </div>
        </main>
      }
    >
      <PlayPageContent />
    </Suspense>
  );
}
