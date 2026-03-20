"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { dailyMazeEndpoint } from "../../lib/config";

const MOVEMENT_BY_KEY = {
  ArrowUp: { x: 0, y: -1 },
  ArrowRight: { x: 1, y: 0 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  w: { x: 0, y: -1 },
  d: { x: 1, y: 0 },
  s: { x: 0, y: 1 },
  a: { x: -1, y: 0 }
};

function renderGridRows(maze, playerPosition) {
  return maze.grid.map((row, y) => {
    let decorated = "";

    for (let x = 0; x < row.length; x += 1) {
      if (x === playerPosition.x && y === playerPosition.y) {
        decorated += "@";
      } else if (x === maze.start.x && y === maze.start.y) {
        decorated += "S";
      } else if (x === maze.exit.x && y === maze.exit.y) {
        decorated += "E";
      } else {
        decorated += row[x];
      }
    }

    return decorated;
  });
}

function isExitReached(playerPosition, maze) {
  return playerPosition.x === maze.exit.x && playerPosition.y === maze.exit.y;
}

function attemptMove(playerPosition, direction, maze) {
  const nextPosition = {
    x: playerPosition.x + direction.x,
    y: playerPosition.y + direction.y
  };

  const targetRow = maze.grid[nextPosition.y];
  const targetCell = targetRow?.[nextPosition.x];

  if (!targetCell || targetCell === "#") {
    return playerPosition;
  }

  return nextPosition;
}

function MazeDetails({ maze }) {
  const [playerPosition, setPlayerPosition] = useState(maze.start);
  const [moveCount, setMoveCount] = useState(0);
  const [hasFinished, setHasFinished] = useState(false);
  const gridRows = renderGridRows(maze, playerPosition);

  useEffect(() => {
    setPlayerPosition(maze.start);
    setMoveCount(0);
    setHasFinished(false);
  }, [maze]);

  useEffect(() => {
    function handleKeyDown(event) {
      const direction = MOVEMENT_BY_KEY[event.key];

      if (!direction) {
        return;
      }

      event.preventDefault();

      if (hasFinished) {
        return;
      }

      const nextPosition = attemptMove(playerPosition, direction, maze);

      if (
        nextPosition.x === playerPosition.x &&
        nextPosition.y === playerPosition.y
      ) {
        return;
      }

      setPlayerPosition(nextPosition);
      setMoveCount((currentCount) => currentCount + 1);

      if (isExitReached(nextPosition, maze)) {
        setHasFinished(true);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [hasFinished, maze, playerPosition]);

  function handleReset() {
    setPlayerPosition(maze.start);
    setMoveCount(0);
    setHasFinished(false);
  }

  return (
    <div className="maze-summary">
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
        <strong>Controls:</strong> Arrow keys or WASD
      </p>
      <p className={`body-copy status-copy ${hasFinished ? "success-copy" : ""}`}>
        {hasFinished
          ? "Maze complete. You reached the exit."
          : "Navigate from S to E. The player marker is @."}
      </p>
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

export default function PlayPage() {
  const [maze, setMaze] = useState(null);
  const [status, setStatus] = useState("loading");

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

  return (
    <main className="page-shell">
      <div className="content-card">
        <p className="eyebrow">Play</p>
        <h1>Daily maze metadata</h1>
        <p className="body-copy">
          This page now fetches the first real piece of game data from the Go
          API. The grid below is now a simple playable top-down debug view of
          the daily maze layout.
        </p>

        {status === "loading" && (
          <p className="body-copy status-copy">Loading daily maze...</p>
        )}

        {status === "success" && maze && <MazeDetails maze={maze} />}

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
