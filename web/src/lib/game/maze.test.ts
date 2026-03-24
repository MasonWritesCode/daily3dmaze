import { describe, expect, it } from "vitest";

import {
  attemptMove,
  buildReplayFrames,
  formatElapsedTime,
  getAccentWallCells,
  getAmbientRatPath,
  getStartingBillboardPoint,
  getStartingDirectionIndex,
  isExitReached,
  normalizeAngle,
  renderGridRows,
  type DailyMaze
} from "./maze";

const testMaze: DailyMaze = {
  date: "2026-03-23",
  title: "Daily Maze",
  seed: "daily3dmaze:2026-03-23",
  size: {
    width: 7,
    height: 7
  },
  start: { x: 1, y: 1 },
  exit: { x: 5, y: 1 },
  grid: [
    "#######",
    "#.....#",
    "#.###.#",
    "#.....#",
    "#.###.#",
    "#.....#",
    "#######"
  ]
};

describe("maze helpers", () => {
  it("chooses a deterministic starting direction that prefers the exit", () => {
    expect(getStartingDirectionIndex(testMaze)).toBe(1);
  });

  it("places the start billboard farther down the opening corridor", () => {
    expect(getStartingBillboardPoint(testMaze)).toEqual({ x: 4, y: 1 });
  });

  it("prevents movement through walls", () => {
    expect(attemptMove({ x: 1, y: 1 }, { x: 0, y: -1 }, testMaze)).toEqual({ x: 1, y: 1 });
    expect(attemptMove({ x: 1, y: 1 }, { x: 1, y: 0 }, testMaze)).toEqual({ x: 2, y: 1 });
  });

  it("renders start exit and player markers in the debug grid", () => {
    const rows = renderGridRows(testMaze, { x: 2, y: 1 }, 1);

    expect(rows[1]).toBe("#S>..E#");
  });

  it("detects when the exit is reached", () => {
    expect(isExitReached({ x: 5, y: 1 }, testMaze)).toBe(true);
    expect(isExitReached({ x: 4, y: 1 }, testMaze)).toBe(false);
  });

  it("normalizes angles into the expected range", () => {
    expect(normalizeAngle(Math.PI * 3)).toBeCloseTo(Math.PI);
    expect(normalizeAngle(-Math.PI * 3)).toBeCloseTo(-Math.PI);
  });

  it("formats elapsed time as mm:ss.cc", () => {
    expect(formatElapsedTime(38321)).toBe("00:38.32");
    expect(formatElapsedTime(125678)).toBe("02:05.67");
  });

  it("builds replay frames from turn and move traces", () => {
    const frames = buildReplayFrames(testMaze, [
      { elapsedTimeMs: 0, action: "move_forward" },
      { elapsedTimeMs: 120, action: "turn_right" },
      { elapsedTimeMs: 260, action: "move_backward" }
    ]);

    expect(frames).toHaveLength(4);
    expect(frames[0]?.playerPosition).toEqual(testMaze.start);
    expect(frames[1]?.playerPosition).toEqual({ x: 2, y: 1 });
    expect(frames[2]?.directionIndex).toBe(2);
    expect(frames[3]?.playerPosition).toEqual({ x: 2, y: 1 });
  });

  it("keeps accent walls deterministic and non-touching", () => {
    const accentWalls = Array.from(getAccentWallCells(testMaze));
    const secondPass = Array.from(getAccentWallCells(testMaze));

    expect(accentWalls).toEqual(secondPass);

    for (const wall of accentWalls) {
      const [x, y] = wall.split(",").map(Number);
      const orthogonalNeighbors = [
        `${x - 1},${y}`,
        `${x + 1},${y}`,
        `${x},${y - 1}`,
        `${x},${y + 1}`
      ];

      expect(orthogonalNeighbors.some((neighbor) => accentWalls.includes(neighbor))).toBe(false);
    }
  });

  it("creates a deterministic ambient rat path through open cells", () => {
    const path = getAmbientRatPath(testMaze);
    const secondPath = getAmbientRatPath(testMaze);

    expect(path).toEqual(secondPath);
    expect(path.length).toBeGreaterThan(0);

    for (const point of path) {
      expect(testMaze.grid[point.y]?.[point.x]).not.toBe("#");
    }
  });
});
