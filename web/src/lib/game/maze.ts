export interface MazePoint {
  x: number;
  y: number;
}

export interface MazeSize {
  width: number;
  height: number;
}

export interface DailyMaze {
  date: string;
  title: string;
  seed: string;
  size: MazeSize;
  start: MazePoint;
  exit: MazePoint;
  grid: string[];
}

export interface ReplayTraceEvent {
  elapsedTimeMs: number;
  action: "move_forward" | "move_backward" | "turn_left" | "turn_right";
}

export interface ReplayFrame {
  step: number;
  action: ReplayTraceEvent["action"] | "start";
  elapsedTimeMs: number;
  playerPosition: MazePoint;
  directionIndex: number;
  reachedExit: boolean;
}

export interface Direction {
  name: "North" | "East" | "South" | "West";
  marker: "^" | ">" | "v" | "<";
  vector: MazePoint;
  angle: number;
}

export const DIRECTION_ORDER: Direction[] = [
  { name: "North", marker: "^", vector: { x: 0, y: -1 }, angle: -Math.PI / 2 },
  { name: "East", marker: ">", vector: { x: 1, y: 0 }, angle: 0 },
  { name: "South", marker: "v", vector: { x: 0, y: 1 }, angle: Math.PI / 2 },
  { name: "West", marker: "<", vector: { x: -1, y: 0 }, angle: Math.PI }
];

export const MOVE_DURATION_MS = 180;
export const TURN_DURATION_MS = 150;

function hashString(value: string): number {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

export function getStartingDirectionIndex(maze: DailyMaze): number {
  const exitDelta = {
    x: maze.exit.x - maze.start.x,
    y: maze.exit.y - maze.start.y
  };

  const openDirections = DIRECTION_ORDER.map((direction, index) => ({
    direction,
    index,
    nextPosition: {
      x: maze.start.x + direction.vector.x,
      y: maze.start.y + direction.vector.y
    }
  })).filter(({ nextPosition }) => {
    const row = maze.grid[nextPosition.y];
    const cell = row?.[nextPosition.x];
    return Boolean(cell && cell !== "#");
  });

  if (openDirections.length === 0) {
    return 0;
  }

  openDirections.sort((left, right) => {
    const leftScore =
      left.direction.vector.x * exitDelta.x + left.direction.vector.y * exitDelta.y;
    const rightScore =
      right.direction.vector.x * exitDelta.x + right.direction.vector.y * exitDelta.y;

    if (leftScore !== rightScore) {
      return rightScore - leftScore;
    }

    return left.index - right.index;
  });

  return openDirections[0]?.index ?? 0;
}

export function getStartingBillboardPoint(maze: DailyMaze): MazePoint {
  const startingDirection = DIRECTION_ORDER[getStartingDirectionIndex(maze)];
  let fallbackPoint = maze.start;

  for (let step = 1; step <= 3; step += 1) {
    const candidatePoint = {
      x: maze.start.x + startingDirection.vector.x * step,
      y: maze.start.y + startingDirection.vector.y * step
    };

    const row = maze.grid[candidatePoint.y];
    const cell = row?.[candidatePoint.x];
    if (!cell || cell === "#") {
      break;
    }

    fallbackPoint = candidatePoint;
  }

  return fallbackPoint;
}

export function getAccentWallCells(maze: DailyMaze): Set<string> {
  const accentWalls = new Set<string>();

  for (let y = 1; y < maze.size.height - 1; y += 1) {
    const row = maze.grid[y];

    for (let x = 1; x < maze.size.width - 1; x += 1) {
      if (row?.[x] !== "#") {
        continue;
      }

      const key = `${x},${y}`;
      const score = hashString(`${maze.seed}:accent:${key}`);

      if (score % 23 !== 0) {
        continue;
      }

      const touchingAccent = [
        `${x - 1},${y}`,
        `${x + 1},${y}`,
        `${x},${y - 1}`,
        `${x},${y + 1}`
      ].some((neighborKey) => accentWalls.has(neighborKey));

      if (!touchingAccent) {
        accentWalls.add(key);
      }
    }
  }

  return accentWalls;
}

export function getAmbientRatPath(maze: DailyMaze): MazePoint[] {
  const openCells: MazePoint[] = [];

  for (let y = 1; y < maze.size.height - 1; y += 1) {
    const row = maze.grid[y];

    for (let x = 1; x < maze.size.width - 1; x += 1) {
      if (row?.[x] !== "#") {
        openCells.push({ x, y });
      }
    }
  }

  const candidateCells = openCells.filter((cell) => {
    const startDistance = Math.abs(cell.x - maze.start.x) + Math.abs(cell.y - maze.start.y);
    const exitDistance = Math.abs(cell.x - maze.exit.x) + Math.abs(cell.y - maze.exit.y);
    return startDistance >= 4 && exitDistance >= 3;
  });

  const pool = candidateCells.length > 0 ? candidateCells : openCells;
  if (pool.length === 0) {
    return [maze.start];
  }

  const startIndex = hashString(`${maze.seed}:rat:start`) % pool.length;
  const path: MazePoint[] = [pool[startIndex] ?? maze.start];
  let previousPoint: MazePoint | null = null;

  for (let step = 1; step < 12; step += 1) {
    const currentPoint = path[path.length - 1] ?? maze.start;
    const neighbors = DIRECTION_ORDER.map((direction) => ({
      x: currentPoint.x + direction.vector.x,
      y: currentPoint.y + direction.vector.y
    })).filter((neighbor) => {
      const cell = maze.grid[neighbor.y]?.[neighbor.x];
      return cell && cell !== "#";
    });

    const forwardOptions = neighbors.filter(
      (neighbor) =>
        !previousPoint ||
        neighbor.x !== previousPoint.x ||
        neighbor.y !== previousPoint.y
    );
    const options = forwardOptions.length > 0 ? forwardOptions : neighbors;

    if (options.length === 0) {
      break;
    }

    const nextIndex = hashString(`${maze.seed}:rat:${step}:${currentPoint.x},${currentPoint.y}`) %
      options.length;
    const nextPoint = options[nextIndex] ?? currentPoint;
    path.push(nextPoint);
    previousPoint = currentPoint;
  }

  return path;
}

export function renderGridRows(
  maze: DailyMaze,
  playerPosition: MazePoint,
  directionIndex: number
): string[] {
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

export function isExitReached(playerPosition: MazePoint, maze: DailyMaze): boolean {
  return playerPosition.x === maze.exit.x && playerPosition.y === maze.exit.y;
}

export function attemptMove(
  playerPosition: MazePoint,
  direction: MazePoint,
  maze: DailyMaze
): MazePoint {
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

export function normalizeAngle(angle: number): number {
  let value = angle;

  while (value > Math.PI) {
    value -= Math.PI * 2;
  }

  while (value < -Math.PI) {
    value += Math.PI * 2;
  }

  return value;
}

export function formatElapsedTime(elapsedMs: number): string {
  const totalMilliseconds = Math.max(0, elapsedMs);
  const minutes = Math.floor(totalMilliseconds / 60000);
  const seconds = Math.floor((totalMilliseconds % 60000) / 1000);
  const centiseconds = Math.floor((totalMilliseconds % 1000) / 10);

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(
    2,
    "0"
  )}.${String(centiseconds).padStart(2, "0")}`;
}

export function buildReplayFrames(
  maze: DailyMaze,
  replayTrace: ReplayTraceEvent[]
): ReplayFrame[] {
  const startingDirectionIndex = getStartingDirectionIndex(maze);
  const frames: ReplayFrame[] = [
    {
      step: 0,
      action: "start",
      elapsedTimeMs: 0,
      playerPosition: maze.start,
      directionIndex: startingDirectionIndex,
      reachedExit: isExitReached(maze.start, maze)
    }
  ];

  let playerPosition = maze.start;
  let directionIndex = startingDirectionIndex;

  for (const event of replayTrace) {
    if (event.action === "turn_left") {
      directionIndex =
        (directionIndex + DIRECTION_ORDER.length - 1) % DIRECTION_ORDER.length;
    } else if (event.action === "turn_right") {
      directionIndex = (directionIndex + 1) % DIRECTION_ORDER.length;
    } else if (event.action === "move_forward") {
      playerPosition = attemptMove(
        playerPosition,
        DIRECTION_ORDER[directionIndex].vector,
        maze
      );
    } else if (event.action === "move_backward") {
      playerPosition = attemptMove(
        playerPosition,
        {
          x: -DIRECTION_ORDER[directionIndex].vector.x,
          y: -DIRECTION_ORDER[directionIndex].vector.y
        },
        maze
      );
    }

    frames.push({
      step: frames.length,
      action: event.action,
      elapsedTimeMs: event.elapsedTimeMs,
      playerPosition,
      directionIndex,
      reachedExit: isExitReached(playerPosition, maze)
    });
  }

  return frames;
}
