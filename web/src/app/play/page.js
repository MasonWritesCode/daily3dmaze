"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import FirstPersonView from "../../components/game/FirstPersonView";
import {
  dailyMazeEndpoint,
  leaderboardEndpoint,
  runsEndpoint
} from "../../lib/config";
import {
  DIRECTION_ORDER,
  MOVE_DURATION_MS,
  TURN_DURATION_MS,
  attemptMove,
  formatElapsedTime,
  isExitReached,
  normalizeAngle,
  renderGridRows
} from "../../lib/game/maze";

function MazeDetails({ maze, onRunSubmitted }) {
  const [playerPosition, setPlayerPosition] = useState(maze.start);
  const [directionIndex, setDirectionIndex] = useState(0);
  const [renderPosition, setRenderPosition] = useState(maze.start);
  const [renderAngle, setRenderAngle] = useState(DIRECTION_ORDER[0].angle);
  const [moveCount, setMoveCount] = useState(0);
  const [hasFinished, setHasFinished] = useState(false);
  const [runStartTime, setRunStartTime] = useState(null);
  const [finishTime, setFinishTime] = useState(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [submissionStatus, setSubmissionStatus] = useState("idle");
  const [submissionSummary, setSubmissionSummary] = useState(null);
  const animationRef = useRef(null);
  const actionLockRef = useRef(false);
  const submittedRunRef = useRef(null);
  const gridRows = renderGridRows(maze, playerPosition, directionIndex);

  useEffect(() => {
    setPlayerPosition(maze.start);
    setDirectionIndex(0);
    setRenderPosition(maze.start);
    setRenderAngle(DIRECTION_ORDER[0].angle);
    setMoveCount(0);
    setHasFinished(false);
    setRunStartTime(null);
    setFinishTime(null);
    setElapsedMs(0);
    setSubmissionStatus("idle");
    setSubmissionSummary(null);
    actionLockRef.current = false;
    submittedRunRef.current = null;
  }, [maze]);

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

    async function submitRun() {
      try {
        const response = await fetch(runsEndpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            date: maze.date,
            seed: maze.seed,
            moveCount,
            elapsedTimeMs
          })
        });

        if (!response.ok) {
          throw new Error(`Run submission failed with status ${response.status}`);
        }

        const payload = await response.json();
        setSubmissionSummary(payload);
        setSubmissionStatus("submitted");
        onRunSubmitted();
      } catch (error) {
        console.error("Failed to submit completed run", error);
        setSubmissionStatus("error");
      }
    }

    submitRun();
  }, [finishTime, hasFinished, maze.date, maze.seed, moveCount, runStartTime]);

  useEffect(() => {
    return () => {
      if (animationRef.current) {
        window.cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  useEffect(() => {
    function beginRunIfNeeded() {
      if (runStartTime) {
        return runStartTime;
      }

      const startedAt = Date.now();
      setRunStartTime(startedAt);
      setElapsedMs(0);
      return startedAt;
    }

    function animateMovement(nextPosition, startedAtForRun) {
      const startPosition = playerPosition;
      const startedAt = performance.now();
      actionLockRef.current = true;

      function step(now) {
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

    function animateTurn(nextDirectionIndex) {
      const startAngle = renderAngle;
      const targetAngle = DIRECTION_ORDER[nextDirectionIndex].angle;
      const delta = normalizeAngle(targetAngle - startAngle);
      const startedAt = performance.now();
      actionLockRef.current = true;

      function step(now) {
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

    function handleKeyDown(event) {
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
    if (animationRef.current) {
      window.cancelAnimationFrame(animationRef.current);
    }

    setPlayerPosition(maze.start);
    setDirectionIndex(0);
    setRenderPosition(maze.start);
    setRenderAngle(DIRECTION_ORDER[0].angle);
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

  return (
    <div className="maze-summary">
      <FirstPersonView
        maze={maze}
        playerPosition={renderPosition}
        playerAngle={renderAngle}
        facingName={DIRECTION_ORDER[directionIndex].name}
      />
      <p className="body-copy">
        <strong>Date:</strong> {maze.date}
      </p>
      <p className="body-copy">
        <strong>Title:</strong> {maze.title}
      </p>
      <p className="body-copy">
        <strong>Seed:</strong> <code>{maze.seed}</code>
      </p>
      <p className="body-copy">
        <strong>Size:</strong> {maze.size.width} x {maze.size.height}
      </p>
      <p className="body-copy">
        <strong>Start:</strong> ({maze.start.x}, {maze.start.y})
      </p>
      <p className="body-copy">
        <strong>Exit:</strong> ({maze.exit.x}, {maze.exit.y})
      </p>
      <p className="body-copy">
        <strong>Moves:</strong> {moveCount}
      </p>
      <p className="body-copy">
        <strong>Time:</strong>{" "}
        {finishTime
          ? formatElapsedTime(finishTime - runStartTime)
          : formatElapsedTime(elapsedMs)}
      </p>
      <p className="body-copy">
        <strong>Facing:</strong> {DIRECTION_ORDER[directionIndex].name}
      </p>
      <p className="body-copy">
        <strong>Controls:</strong> Up/Down or W/S move, Left/Right or A/D turn
      </p>
      <p className={`body-copy status-copy ${hasFinished ? "success-copy" : ""}`}>
        {hasFinished
          ? `Maze complete in ${formatElapsedTime(finishTime - runStartTime)}.`
          : "Navigate from S to E. The top-down player marker shows facing."}
      </p>
      {submissionStatus === "submitting" && (
        <p className="body-copy status-copy">Submitting run to the API...</p>
      )}
      {submissionStatus === "submitted" && submissionSummary && (
        <p className="body-copy status-copy success-copy">
          Run accepted by the API at <code>{submissionSummary.acceptedAt}</code>.
        </p>
      )}
      {submissionStatus === "error" && (
        <p className="body-copy status-copy error-copy">
          The run finished locally, but submission to the API failed.
        </p>
      )}
      <div className="maze-grid-preview" aria-label="Daily maze debug view">
        {gridRows.map((row, index) => (
          <code key={`${index}-${row}`} className="maze-grid-row">
            {row}
          </code>
        ))}
      </div>
      <div className="actions">
        <button type="button" className="secondary-button" onClick={handleReset}>
          Reset run
        </button>
      </div>
    </div>
  );
}

function Leaderboard({ entries }) {
  return (
    <div className="maze-summary">
      <p className="body-copy">
        <strong>Leaderboard</strong>
      </p>
      {entries.length === 0 && (
        <p className="body-copy">No submitted runs for this day yet.</p>
      )}
      {entries.length > 0 && (
        <div className="leaderboard-list" aria-label="Daily leaderboard">
          {entries.map((entry) => (
            <div key={`${entry.rank}-${entry.acceptedAt}`} className="leaderboard-row">
              <span>#{entry.rank}</span>
              <span>{formatElapsedTime(entry.elapsedTimeMs)}</span>
              <span>{entry.moveCount} moves</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PlayPage() {
  const [maze, setMaze] = useState(null);
  const [status, setStatus] = useState("loading");
  const [leaderboardEntries, setLeaderboardEntries] = useState([]);
  const [leaderboardStatus, setLeaderboardStatus] = useState("idle");
  const [leaderboardRefreshKey, setLeaderboardRefreshKey] = useState(0);

  useEffect(() => {
    let isMounted = true;

    async function loadMaze() {
      try {
        const response = await fetch(dailyMazeEndpoint);

        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }

        const payload = await response.json();

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

    loadMaze();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!maze) {
      return;
    }

    let isMounted = true;
    setLeaderboardStatus("loading");

    async function loadLeaderboard() {
      try {
        const response = await fetch(
          `${leaderboardEndpoint}?date=${encodeURIComponent(maze.date)}`
        );

        if (!response.ok) {
          throw new Error(`Leaderboard request failed with status ${response.status}`);
        }

        const payload = await response.json();

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

    loadLeaderboard();

    return () => {
      isMounted = false;
    };
  }, [leaderboardRefreshKey, maze]);

  return (
    <main className="page-shell">
      <div className="content-card">
        <p className="eyebrow">Play</p>
        <h1>Daily maze metadata</h1>
        <p className="body-copy">
          This page now fetches the first real piece of game data from the Go
          API. It includes a simple first-person raycast panel and keeps the
          top-down maze visible for debugging.
        </p>

        {status === "loading" && (
          <p className="body-copy status-copy">Loading daily maze...</p>
        )}

        {status === "success" && maze && (
          <MazeDetails
            maze={maze}
            onRunSubmitted={() =>
              setLeaderboardRefreshKey((currentKey) => currentKey + 1)
            }
          />
        )}

        {status === "success" && maze && leaderboardStatus !== "error" && (
          <Leaderboard entries={leaderboardEntries} />
        )}

        {status === "success" && maze && leaderboardStatus === "error" && (
          <p className="body-copy status-copy error-copy">
            Unable to load the leaderboard right now.
          </p>
        )}

        {status === "error" && (
          <p className="body-copy status-copy error-copy">
            Unable to load the daily maze metadata. Make sure the API is
            running on <code>http://localhost:8080</code>.
          </p>
        )}

        <div className="actions">
          <Link href="/" className="secondary-link">
            Back home
          </Link>
        </div>
      </div>
    </main>
  );
}
