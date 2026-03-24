"use client";

import { useEffect, useState } from "react";

import type { DailyMaze, MazePoint } from "../../lib/game/maze";
import {
  DIRECTION_ORDER,
  getAmbientRatPath,
  getStartingBillboardPoint,
  getStartingDirectionIndex,
  normalizeAngle
} from "../../lib/game/maze";

export const FLOOR_TEXTURE_SCALE = 0.84;
export const CEILING_TEXTURE_SCALE = 1.02;
export const FIELD_OF_VIEW = Math.PI * 0.285;
export const INTRO_RISE_DURATION_MS = 1250;
export const RAT_STEP_DURATION_MS = 2200;
export const CANVAS_WIDTH = 480;
export const CANVAS_HEIGHT = 360;
export const TEXTURE_PATHS = {
  wall: "/assets/3d-maze/wall.png",
  accentWall: "/assets/3d-maze/openglwall.png",
  floor: "/assets/3d-maze/floor.png",
  ceiling: "/assets/3d-maze/ceiling.png",
  rat: "/assets/3d-maze/rat.png",
  start: "/assets/3d-maze/start.png",
  exit: "/assets/3d-maze/smiley.png"
} as const;

export type TextureKey = keyof typeof TEXTURE_PATHS;
export type TextureMap = Record<TextureKey, HTMLImageElement | null>;

export interface TextureSurface {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface TextureSurfaceState {
  source: TextureMap | null;
  supportsSurfaceTextures: boolean;
  wall: TextureSurface | null;
  accentWall: TextureSurface | null;
  floor: TextureSurface | null;
  ceiling: TextureSurface | null;
}

export interface RenderBufferState {
  width: number;
  height: number;
  imageData: ImageData | null;
  depthBuffer: Float32Array | null;
  rowDistanceByY: Float32Array | null;
}

export interface SpriteDefinition {
  image: HTMLImageElement;
  worldX: number;
  worldY: number;
  scale: number;
  alpha: number;
  verticalAnchor: number;
  horizontalOffset: number;
}

export interface SpriteProjection extends SpriteDefinition {
  angle: number;
  distance: number;
}

export function useMazeTextures(): TextureMap {
  const [textures, setTextures] = useState<TextureMap>({
    wall: null,
    accentWall: null,
    floor: null,
    ceiling: null,
    rat: null,
    start: null,
    exit: null
  });

  useEffect(() => {
    let isMounted = true;

    async function loadTextures() {
      const entries = await Promise.all(
        (Object.entries(TEXTURE_PATHS) as Array<[TextureKey, string]>).map(
          ([key, src]) =>
            new Promise<[TextureKey, HTMLImageElement | null]>((resolve) => {
              const image = new Image();
              image.onload = () => resolve([key, image]);
              image.onerror = () => resolve([key, null]);
              image.src = src;
            })
        )
      );

      if (!isMounted) {
        return;
      }

      setTextures(Object.fromEntries(entries) as TextureMap);
    }

    void loadTextures();

    return () => {
      isMounted = false;
    };
  }, []);

  return textures;
}

export function getTextureColumn(image: TextureSurface, hitX: number, hitY: number): number {
  const fractionalX = hitX - Math.floor(hitX);
  const fractionalY = hitY - Math.floor(hitY);
  const edgeDistances = [
    { edge: "left", distance: fractionalX },
    { edge: "right", distance: 1 - fractionalX },
    { edge: "top", distance: fractionalY },
    { edge: "bottom", distance: 1 - fractionalY }
  ] as const;
  const nearestEdge = edgeDistances.reduce((closest, candidate) =>
    candidate.distance < closest.distance ? candidate : closest
  );
  const offset =
    nearestEdge.edge === "left" || nearestEdge.edge === "right" ? fractionalY : fractionalX;

  return Math.max(0, Math.min(image.width - 1, Math.floor(offset * image.width)));
}

export function createTextureSurface(image: HTMLImageElement | null): TextureSurface | null {
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

export function hasStableCanvasReadback(image: HTMLImageElement | null): boolean {
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

  const samplePoints: Array<[number, number]> = [
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

export function sampleTexture(texture: TextureSurface, x: number, y: number) {
  const wrappedX = ((x % texture.width) + texture.width) % texture.width;
  const wrappedY = ((y % texture.height) + texture.height) % texture.height;
  const offset = (wrappedY * texture.width + wrappedX) * 4;

  return {
    r: texture.data[offset] ?? 0,
    g: texture.data[offset + 1] ?? 0,
    b: texture.data[offset + 2] ?? 0,
    a: texture.data[offset + 3] ?? 255
  };
}

export function getQuantizedIntroProgress(progress: number): number {
  const stepCount = 24;
  return Math.round(progress * stepCount) / stepCount;
}

export function ensureRenderBuffers(
  context: CanvasRenderingContext2D,
  current: RenderBufferState,
  width: number,
  height: number
): RenderBufferState {
  if (
    current.width === width &&
    current.height === height &&
    current.imageData &&
    current.depthBuffer &&
    current.rowDistanceByY
  ) {
    return current;
  }

  const horizon = height * 0.5;
  const rowDistanceByY = new Float32Array(height);

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y > horizon ? y - horizon : horizon - y;
    rowDistanceByY[y] = rowOffset > 0 ? (0.5 * height) / rowOffset : 0;
  }

  return {
    width,
    height,
    imageData: context.createImageData(width, height),
    depthBuffer: new Float32Array(width),
    rowDistanceByY
  };
}

export function buildSpriteDefinitions(args: {
  textures: TextureMap;
  maze: DailyMaze;
  originX: number;
  originY: number;
  playerAngle: number;
  fieldOfView: number;
  introProgress: number;
  prefersReducedMotion: boolean;
}): SpriteProjection[] {
  const {
    textures,
    maze,
    originX,
    originY,
    playerAngle,
    fieldOfView,
    introProgress,
    prefersReducedMotion
  } = args;
  const ratPath = getAmbientRatPath(maze);
  const startingBillboardPoint = getStartingBillboardPoint(maze);
  const startingDirection = DIRECTION_ORDER[getStartingDirectionIndex(maze)];

  const spriteDefinitions: SpriteProjection[] = [
    textures.rat && ratPath.length > 0
      ? (() => {
          const patrolPath =
            ratPath.length > 1 ? [...ratPath, ...ratPath.slice(1, -1).reverse()] : ratPath;
          const totalSegments = Math.max(1, patrolPath.length);
          const now = prefersReducedMotion ? 0 : performance.now();
          const rawStep = Math.floor(now / RAT_STEP_DURATION_MS);
          const segmentIndex = rawStep % totalSegments;
          const nextSegmentIndex = (segmentIndex + 1) % totalSegments;
          const segmentProgress = (now % RAT_STEP_DURATION_MS) / RAT_STEP_DURATION_MS;
          const fromPoint = patrolPath[segmentIndex] ?? patrolPath[0] ?? maze.start;
          const toPoint = patrolPath[nextSegmentIndex] ?? fromPoint;
          const easedProgress = 1 - Math.pow(1 - segmentProgress, 2);

          return {
            image: textures.rat,
            worldX: fromPoint.x + (toPoint.x - fromPoint.x) * easedProgress + 0.5,
            worldY: fromPoint.y + (toPoint.y - fromPoint.y) * easedProgress + 0.5,
            scale: 0.42,
            alpha: 1,
            verticalAnchor: 1.08,
            horizontalOffset: 0,
            angle: 0,
            distance: 0
          };
        })()
      : null,
    textures.start
      ? {
          image: textures.start,
          worldX: startingBillboardPoint.x + 0.5 + startingDirection.vector.x * 0.12,
          worldY: startingBillboardPoint.y + 0.5 + startingDirection.vector.y * 0.12,
          scale: 0.45,
          alpha: 0.42,
          verticalAnchor: 0.5,
          horizontalOffset: 0.08,
          angle: 0,
          distance: 0
        }
      : null,
    textures.exit
      ? {
          image: textures.exit,
          worldX: maze.exit.x + 0.5,
          worldY: maze.exit.y + 0.5,
          scale: 0.75,
          alpha: 0.78,
          verticalAnchor: 0.5,
          horizontalOffset: 0,
          angle: 0,
          distance: 0
        }
      : null
  ]
    .filter((sprite): sprite is SpriteProjection => sprite !== null)
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
    .filter((sprite) => sprite.distance > 0.2 && Math.abs(sprite.angle) < fieldOfView * 0.75)
    .sort((left, right) => right.distance - left.distance);

  return spriteDefinitions.map((sprite) => ({
    ...sprite,
    alpha: sprite.alpha * Math.max(0.2, introProgress)
  }));
}

export function isTouchSwipeCandidate(
  start: MazePoint | { x: number; y: number } | null,
  end: MazePoint | { x: number; y: number } | null,
  threshold = 28
) {
  if (!start || !end) {
    return null;
  }

  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;

  if (Math.abs(deltaX) < threshold && Math.abs(deltaY) < threshold) {
    return null;
  }

  if (Math.abs(deltaX) > Math.abs(deltaY)) {
    return deltaX < 0 ? "turn_left" : "turn_right";
  }

  return deltaY < 0 ? "move_forward" : "move_backward";
}
