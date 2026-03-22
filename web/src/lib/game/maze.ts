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
  const candidatePoint = {
    x: maze.start.x + startingDirection.vector.x,
    y: maze.start.y + startingDirection.vector.y
  };

  const row = maze.grid[candidatePoint.y];
  const cell = row?.[candidatePoint.x];
  if (cell && cell !== "#") {
    return candidatePoint;
  }

  return maze.start;
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
