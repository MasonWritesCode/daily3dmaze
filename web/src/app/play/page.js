"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { dailyMazeEndpoint } from "../../lib/config";

const DIRECTION_ORDER = [
  { name: "North", marker: "^", vector: { x: 0, y: -1 }, angle: -Math.PI / 2 },
  { name: "East", marker: ">", vector: { x: 1, y: 0 }, angle: 0 },
  { name: "South", marker: "v", vector: { x: 0, y: 1 }, angle: Math.PI / 2 },
  { name: "West", marker: "<", vector: { x: -1, y: 0 }, angle: Math.PI }
];
const MOVE_DURATION_MS = 180;
const TURN_DURATION_MS = 150;

function renderGridRows(maze, playerPosition, directionIndex) {
  const playerMarker = DIRECTION_ORDER[directionIndex].marker;

  return maze.grid.map((row, y) => {
    let decorated = "";

    for (let x = 0; x < row.length; x += 1) {
      if (x === playerPosition.x && y === playerPosition.y) {
        decorated += playerMarker;
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

function normalizeAngle(angle) {
  let value = angle;

  while (value > Math.PI) {
    value -= Math.PI * 2;
  }

  while (value < -Math.PI) {
    value += Math.PI * 2;
  }

  return value;
}

function formatElapsedTime(elapsedMs) {
  const totalMilliseconds = Math.max(0, elapsedMs);
  const minutes = Math.floor(totalMilliseconds / 60000);
  const seconds = Math.floor((totalMilliseconds % 60000) / 1000);
  const centiseconds = Math.floor((totalMilliseconds % 1000) / 10);

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(
    2,
    "0"
  )}.${String(centiseconds).padStart(2, "0")}`;
}

function FirstPersonView({ maze, playerPosition, playerAngle, facingName }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d");

    if (!context) {
      return;
    }

    const width = canvas.width;
    const height = canvas.height;
    const originX = playerPosition.x + 0.5;
    const originY = playerPosition.y + 0.5;
    const fieldOfView = Math.PI / 3;
    const maxDistance = 24;

    context.fillStyle = "#182031";
    context.fillRect(0, 0, width, height / 2);
    context.fillStyle = "#0d1015";
    context.fillRect(0, height / 2, width, height / 2);

    for (let column = 0; column < width; column += 1) {
      const cameraRatio = column / width;
      const rayAngle = playerAngle - fieldOfView / 2 + cameraRatio * fieldOfView;
      const rayDirectionX = Math.cos(rayAngle);
      const rayDirectionY = Math.sin(rayAngle);
      let distance = 0;
      let hitWall = false;

      while (distance < maxDistance && !hitWall) {
        distance += 0.02;

        const sampleX = Math.floor(originX + rayDirectionX * distance);
        const sampleY = Math.floor(originY + rayDirectionY * distance);

        if (
          sampleX < 0 ||
          sampleX >= maze.size.width ||
          sampleY < 0 ||
          sampleY >= maze.size.height
        ) {
          hitWall = true;
          distance = maxDistance;
          break;
        }

        hitWall = maze.grid[sampleY][sampleX] === "#";
      }

      const correctedDistance = Math.max(
        0.0001,
        distance * Math.cos(rayAngle - playerAngle)
      );
      const wallHeight = Math.min(height, height / correctedDistance);
      const wallTop = (height - wallHeight) / 2;
      const shade = Math.max(50, Math.min(200, 215 - correctedDistance * 18));

      context.fillStyle = `rgb(${shade}, ${shade + 10}, ${shade + 24})`;
      context.fillRect(column, wallTop, 1, wallHeight);
    }

    context.strokeStyle = "rgba(255, 255, 255, 0.18)";
    context.beginPath();
    context.moveTo(0, height / 2);
    context.lineTo(width, height / 2);
    context.stroke();
  }, [maze, playerAngle, playerPosition]);

  return (
    <div className="raycast-panel">
      <div className="raycast-header">
        <p className="body-copy panel-title">First-person debug view</p>
        <p className="body-copy panel-subtitle">Facing {facingName}</p>
      </div>
      <canvas
        ref={canvasRef}
        className="raycast-canvas"
        width={480}
        height={270}
        aria-label="First-person maze view"
      />
    </div>
  );
}

function MazeDetails({ maze }) {
  const [playerPosition, setPlayerPosition] = useState(maze.start);
  const [directionIndex, setDirectionIndex] = useState(0);
  const [renderPosition, setRenderPosition] = useState(maze.start);
  const [renderAngle, setRenderAngle] = useState(DIRECTION_ORDER[0].angle);
  const [moveCount, setMoveCount] = useState(0);
  const [hasFinished, setHasFinished] = useState(false);
  const [runStartTime, setRunStartTime] = useState(null);
  const [finishTime, setFinishTime] = useState(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const animationRef = useRef(null);
  const actionLockRef = useRef(false);
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
    actionLockRef.current = false;
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
    actionLockRef.current = false;
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
        {finishTime ? formatElapsedTime(finishTime - runStartTime) : formatElapsedTime(elapsedMs)}
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
          API. It includes a simple first-person raycast panel and keeps the
          top-down maze visible for debugging.
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
