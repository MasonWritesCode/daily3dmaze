export const DIRECTION_ORDER = [
  { name: "North", marker: "^", vector: { x: 0, y: -1 }, angle: -Math.PI / 2 },
  { name: "East", marker: ">", vector: { x: 1, y: 0 }, angle: 0 },
  { name: "South", marker: "v", vector: { x: 0, y: 1 }, angle: Math.PI / 2 },
  { name: "West", marker: "<", vector: { x: -1, y: 0 }, angle: Math.PI }
];

export const MOVE_DURATION_MS = 180;
export const TURN_DURATION_MS = 150;

export function renderGridRows(maze, playerPosition, directionIndex) {
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

export function isExitReached(playerPosition, maze) {
  return playerPosition.x === maze.exit.x && playerPosition.y === maze.exit.y;
}

export function attemptMove(playerPosition, direction, maze) {
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

export function normalizeAngle(angle) {
  let value = angle;

  while (value > Math.PI) {
    value -= Math.PI * 2;
  }

  while (value < -Math.PI) {
    value += Math.PI * 2;
  }

  return value;
}

export function formatElapsedTime(elapsedMs) {
  const totalMilliseconds = Math.max(0, elapsedMs);
  const minutes = Math.floor(totalMilliseconds / 60000);
  const seconds = Math.floor((totalMilliseconds % 60000) / 1000);
  const centiseconds = Math.floor((totalMilliseconds % 1000) / 10);

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(
    2,
    "0"
  )}.${String(centiseconds).padStart(2, "0")}`;
}
