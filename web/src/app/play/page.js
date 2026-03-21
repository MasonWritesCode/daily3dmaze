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
const FLOOR_TEXTURE_SCALE = 0.9;
const CEILING_TEXTURE_SCALE = 1.1;
const TEXTURE_PATHS = {
  wall: "/assets/3d-maze/wall.png",
  floor: "/assets/3d-maze/floor.png",
  ceiling: "/assets/3d-maze/ceiling.png",
  start: "/assets/3d-maze/start.png",
  exit: "/assets/3d-maze/smiley.png"
};

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

function useMazeTextures() {
  const [textures, setTextures] = useState({
    wall: null,
    floor: null,
    ceiling: null,
    start: null,
    exit: null
  });

  useEffect(() => {
    let isMounted = true;

    async function loadTextures() {
      const entries = await Promise.all(
        Object.entries(TEXTURE_PATHS).map(([key, src]) => {
          return new Promise((resolve) => {
            const image = new Image();
            image.onload = () => resolve([key, image]);
            image.onerror = () => resolve([key, null]);
            image.src = src;
          });
        })
      );

      if (!isMounted) {
        return;
      }

      setTextures(Object.fromEntries(entries));
    }

    loadTextures();

    return () => {
      isMounted = false;
    };
  }, []);

  return textures;
}

function getTextureColumn(image, hitX, hitY) {
  const fractionalX = hitX - Math.floor(hitX);
  const fractionalY = hitY - Math.floor(hitY);
  const edgeDistances = [
    { edge: "left", distance: fractionalX },
    { edge: "right", distance: 1 - fractionalX },
    { edge: "top", distance: fractionalY },
    { edge: "bottom", distance: 1 - fractionalY }
  ];
  const nearestEdge = edgeDistances.reduce((closest, candidate) =>
    candidate.distance < closest.distance ? candidate : closest
  );
  const offset =
    nearestEdge.edge === "left" || nearestEdge.edge === "right"
      ? fractionalY
      : fractionalX;

  return Math.max(0, Math.min(image.width - 1, Math.floor(offset * image.width)));
}

function createTextureSurface(image) {
  if (!image) {
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");

  if (!context) {
    return null;
  }

  context.drawImage(image, 0, 0);

  return {
    width: image.width,
    height: image.height,
    data: context.getImageData(0, 0, image.width, image.height).data
  };
}

function hasStableCanvasReadback(image) {
  if (!image) {
    return false;
  }

  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");

  if (!context) {
    return false;
  }

  const samplePoints = [
    [0, 0],
    [Math.max(0, image.width - 1), 0],
    [0, Math.max(0, image.height - 1)],
    [Math.max(0, image.width - 1), Math.max(0, image.height - 1)],
    [Math.floor(image.width / 2), Math.floor(image.height / 2)],
    [Math.floor(image.width / 3), Math.floor(image.height / 3)],
    [Math.floor((image.width * 2) / 3), Math.floor((image.height * 2) / 3)]
  ];

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0);
  const first = context.getImageData(0, 0, canvas.width, canvas.height).data;

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0);
  const second = context.getImageData(0, 0, canvas.width, canvas.height).data;

  return samplePoints.every(([x, y]) => {
    const index = (y * canvas.width + x) * 4;

    return (
      first[index] === second[index] &&
      first[index + 1] === second[index + 1] &&
      first[index + 2] === second[index + 2] &&
      first[index + 3] === second[index + 3]
    );
  });
}

function sampleTexture(texture, x, y) {
  const wrappedX = ((x % texture.width) + texture.width) % texture.width;
  const wrappedY = ((y % texture.height) + texture.height) % texture.height;
  const offset = (wrappedY * texture.width + wrappedX) * 4;

  return {
    r: texture.data[offset],
    g: texture.data[offset + 1],
    b: texture.data[offset + 2],
    a: texture.data[offset + 3]
  };
}

function FirstPersonView({ maze, playerPosition, playerAngle, facingName }) {
  const canvasRef = useRef(null);
  const textures = useMazeTextures();
  const textureSurfaceRef = useRef({
    source: null,
    supportsSurfaceTextures: false,
    wall: null,
    floor: null,
    ceiling: null
  });

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
    const horizon = height / 2;
    const depthBuffer = new Array(width).fill(maxDistance);
    context.imageSmoothingEnabled = false;

    if (textureSurfaceRef.current.source !== textures) {
      const supportsSurfaceTextures =
        hasStableCanvasReadback(textures.floor) &&
        hasStableCanvasReadback(textures.ceiling);

      textureSurfaceRef.current = {
        source: textures,
        supportsSurfaceTextures,
        wall: createTextureSurface(textures.wall),
        floor: supportsSurfaceTextures ? createTextureSurface(textures.floor) : null,
        ceiling: supportsSurfaceTextures
          ? createTextureSurface(textures.ceiling)
          : null
      };
    }

    const textureSurfaces = textureSurfaceRef.current;
    const imageBuffer = context.createImageData(width, height);
    const pixels = imageBuffer.data;
    const hasSurfaceTextures = textureSurfaces.floor || textureSurfaces.ceiling;

    if (hasSurfaceTextures) {
      const leftRayAngle = playerAngle - fieldOfView / 2;
      const rightRayAngle = playerAngle + fieldOfView / 2;
      const leftRayX = Math.cos(leftRayAngle);
      const leftRayY = Math.sin(leftRayAngle);
      const rightRayX = Math.cos(rightRayAngle);
      const rightRayY = Math.sin(rightRayAngle);

      for (let y = 0; y < height; y += 1) {
        const isFloor = y > horizon;
        const texture = isFloor ? textureSurfaces.floor : textureSurfaces.ceiling;

        if (!texture) {
          continue;
        }

        const rowOffset = isFloor ? y - horizon : horizon - y;

        if (rowOffset <= 0) {
          continue;
        }

        const rowDistance = (0.5 * height) / rowOffset;
        const stepX = (rowDistance * (rightRayX - leftRayX)) / width;
        const stepY = (rowDistance * (rightRayY - leftRayY)) / width;
        let worldX = originX + rowDistance * leftRayX;
        let worldY = originY + rowDistance * leftRayY;

        for (let x = 0; x < width; x += 1) {
          const textureScale = isFloor ? FLOOR_TEXTURE_SCALE : CEILING_TEXTURE_SCALE;
          const scaledWorldX = worldX * textureScale;
          const scaledWorldY = worldY * textureScale;
          const textureX = Math.floor(
            (scaledWorldX - Math.floor(scaledWorldX)) * texture.width
          );
          const textureY = Math.floor(
            (scaledWorldY - Math.floor(scaledWorldY)) * texture.height
          );
          const sampled = sampleTexture(texture, textureX, textureY);
          const distanceShade = Math.max(0.28, 1 - rowDistance / maxDistance);
          const index = (y * width + x) * 4;
          const shadeBoost = isFloor ? 0.82 : 0.68;

          pixels[index] = sampled.r * distanceShade * shadeBoost;
          pixels[index + 1] = sampled.g * distanceShade * shadeBoost;
          pixels[index + 2] = sampled.b * distanceShade * shadeBoost;
          pixels[index + 3] = sampled.a;

          worldX += stepX;
          worldY += stepY;
        }
      }
    } else {
      context.fillStyle = "#182031";
      context.fillRect(0, 0, width, horizon);
      context.fillStyle = "#0d1015";
      context.fillRect(0, horizon, width, height / 2);
    }

    if (hasSurfaceTextures) {
      context.putImageData(imageBuffer, 0, 0);
    }

    for (let column = 0; column < width; column += 1) {
      const cameraRatio = column / width;
      const rayAngle = playerAngle - fieldOfView / 2 + cameraRatio * fieldOfView;
      const rayDirectionX = Math.cos(rayAngle);
      const rayDirectionY = Math.sin(rayAngle);
      let distance = 0;
      let hitWall = false;
      let hitPointX = originX;
      let hitPointY = originY;

      while (distance < maxDistance && !hitWall) {
        distance += 0.02;
        hitPointX = originX + rayDirectionX * distance;
        hitPointY = originY + rayDirectionY * distance;

        const sampleX = Math.floor(hitPointX);
        const sampleY = Math.floor(hitPointY);

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
      depthBuffer[column] = correctedDistance;
      const wallHeight = Math.min(height, height / correctedDistance);
      const wallTop = (height - wallHeight) / 2;
      const shade = Math.max(50, Math.min(200, 215 - correctedDistance * 18));

      if (textureSurfaces.wall) {
        const textureColumn = getTextureColumn(textureSurfaces.wall, hitPointX, hitPointY);
        context.save();
        context.globalAlpha = Math.max(0.55, Math.min(1, shade / 180));
        context.drawImage(
          textures.wall,
          textureColumn,
          0,
          1,
          textureSurfaces.wall.height,
          column,
          wallTop,
          1,
          wallHeight
        );
        context.restore();
      } else {
        context.fillStyle = `rgb(${shade}, ${shade + 10}, ${shade + 24})`;
        context.fillRect(column, wallTop, 1, wallHeight);
      }
    }

    const spriteDefinitions = [
      {
        image: textures.start,
        worldX: maze.start.x + 0.5,
        worldY: maze.start.y + 0.5,
        scale: 0.42,
        alpha: 0.5
      },
      {
        image: textures.exit,
        worldX: maze.exit.x + 0.5,
        worldY: maze.exit.y + 0.5,
        scale: 1.1,
        alpha: 1
      }
    ]
      .filter((sprite) => sprite.image)
      .map((sprite) => {
        const deltaX = sprite.worldX - originX;
        const deltaY = sprite.worldY - originY;
        const spriteAngle = normalizeAngle(Math.atan2(deltaY, deltaX) - playerAngle);
        const distance = Math.hypot(deltaX, deltaY);

        return {
          ...sprite,
          angle: spriteAngle,
          distance
        };
      })
      .filter(
        (sprite) =>
          sprite.distance > 0.2 &&
          Math.abs(sprite.angle) < fieldOfView * 0.75
      )
      .sort((left, right) => right.distance - left.distance);

    for (const sprite of spriteDefinitions) {
      const correctedDistance = Math.max(
        0.0001,
        sprite.distance * Math.cos(sprite.angle)
      );
      const projectedCenter =
        (0.5 + sprite.angle / fieldOfView) * width;
      const projectedHeight = (height / correctedDistance) * sprite.scale;
      const projectedWidth =
        (projectedHeight * sprite.image.width) / sprite.image.height;
      const top = (height - projectedHeight) / 2;
      const left = projectedCenter - projectedWidth / 2;

      for (let stripe = 0; stripe < projectedWidth; stripe += 1) {
        const screenX = Math.floor(left + stripe);

        if (screenX < 0 || screenX >= width) {
          continue;
        }

        if (correctedDistance >= depthBuffer[screenX]) {
          continue;
        }

        const textureX = Math.floor((stripe / projectedWidth) * sprite.image.width);
        context.save();
        context.globalAlpha = sprite.alpha;

        context.drawImage(
          sprite.image,
          textureX,
          0,
          1,
          sprite.image.height,
          screenX,
          top,
          1,
          projectedHeight
        );
        context.restore();
      }
    }

    context.strokeStyle = "rgba(255, 255, 255, 0.18)";
    context.beginPath();
    context.moveTo(0, height / 2);
    context.lineTo(width, height / 2);
    context.stroke();
  }, [maze, playerAngle, playerPosition, textures]);

  return (
    <div className="raycast-panel">
      <div className="raycast-header">
        <p className="body-copy panel-title">First-person debug view</p>
        <p className="body-copy panel-subtitle">
          Facing {facingName}
          {textureSurfaceRef.current.supportsSurfaceTextures
            ? ""
            : " · privacy-safe fallback"}
        </p>
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
