"use client";

import { useEffect, useRef, useState } from "react";

import type { DailyMaze, MazePoint } from "../../lib/game/maze";
import {
  getAccentWallCells,
  getAmbientRatPath,
  getStartingBillboardPoint,
  normalizeAngle
} from "../../lib/game/maze";

const FLOOR_TEXTURE_SCALE = 0.84;
const CEILING_TEXTURE_SCALE = 1.02;
const FIELD_OF_VIEW = Math.PI * 0.285;
const INTRO_RISE_DURATION_MS = 1250;
const RAT_STEP_DURATION_MS = 2200;
const TEXTURE_PATHS = {
  wall: "/assets/3d-maze/wall.png",
  accentWall: "/assets/3d-maze/openglwall.png",
  floor: "/assets/3d-maze/floor.png",
  ceiling: "/assets/3d-maze/ceiling.png",
  rat: "/assets/3d-maze/rat.png",
  start: "/assets/3d-maze/start.png",
  exit: "/assets/3d-maze/smiley.png"
} as const;

type TextureKey = keyof typeof TEXTURE_PATHS;
type TextureMap = Record<TextureKey, HTMLImageElement | null>;

interface TextureSurface {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

interface TextureSurfaceState {
  source: TextureMap | null;
  supportsSurfaceTextures: boolean;
  wall: TextureSurface | null;
  accentWall: TextureSurface | null;
  floor: TextureSurface | null;
  ceiling: TextureSurface | null;
}

interface SpriteDefinition {
  image: HTMLImageElement;
  worldX: number;
  worldY: number;
  scale: number;
  alpha: number;
  verticalAnchor: number;
}

interface SpriteProjection extends SpriteDefinition {
  angle: number;
  distance: number;
}

interface FirstPersonViewProps {
  maze: DailyMaze;
  playerPosition: MazePoint;
  playerAngle: number;
  introSequence: number;
  animationMode: "intro" | "outro";
  onSwipeAction?: (
    action: "turn_left" | "turn_right" | "move_forward" | "move_backward"
  ) => void;
}

function useMazeTextures(): TextureMap {
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

function getTextureColumn(image: TextureSurface, hitX: number, hitY: number): number {
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
    nearestEdge.edge === "left" || nearestEdge.edge === "right"
      ? fractionalY
      : fractionalX;

  return Math.max(0, Math.min(image.width - 1, Math.floor(offset * image.width)));
}

function createTextureSurface(image: HTMLImageElement | null): TextureSurface | null {
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

function hasStableCanvasReadback(image: HTMLImageElement | null): boolean {
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

function sampleTexture(texture: TextureSurface, x: number, y: number) {
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

export default function FirstPersonView({
  maze,
  playerPosition,
  playerAngle,
  introSequence,
  animationMode,
  onSwipeAction
}: FirstPersonViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const textures = useMazeTextures();
  const [introProgress, setIntroProgress] = useState<number>(0);
  const [ratTick, setRatTick] = useState<number>(0);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState<boolean>(false);
  const textureSurfaceRef = useRef<TextureSurfaceState>({
    source: null,
    supportsSurfaceTextures: false,
    wall: null,
    accentWall: null,
    floor: null,
    ceiling: null
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setPrefersReducedMotion(mediaQuery.matches);

    sync();
    mediaQuery.addEventListener("change", sync);

    return () => {
      mediaQuery.removeEventListener("change", sync);
    };
  }, []);

  useEffect(() => {
    let frameId = 0;
    if (prefersReducedMotion) {
      setIntroProgress(animationMode === "intro" ? 1 : 0);
      return undefined;
    }

    const startedAt = performance.now();
    setIntroProgress(animationMode === "intro" ? 0 : 1);

    function tick(now: number) {
      const progress = Math.min(1, (now - startedAt) / INTRO_RISE_DURATION_MS);
      const eased = 1 - Math.pow(1 - progress, 3);
      setIntroProgress(animationMode === "intro" ? eased : 1 - eased);

      if (progress < 1) {
        frameId = window.requestAnimationFrame(tick);
      }
    }

    frameId = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [animationMode, introSequence, maze.date, maze.seed, prefersReducedMotion]);

  useEffect(() => {
    if (prefersReducedMotion) {
      setRatTick(0);
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setRatTick((currentTick) => currentTick + 1);
    }, 120);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [prefersReducedMotion]);

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
    const accentWallCells = getAccentWallCells(maze);
    const ratPath = getAmbientRatPath(maze);
    const startingBillboardPoint = getStartingBillboardPoint(maze);
    const fieldOfView = FIELD_OF_VIEW;
    const maxDistance = 24;
    const horizon = height * 0.5;
    const depthBuffer = new Array<number>(width).fill(maxDistance);
    context.imageSmoothingEnabled = false;

    if (textureSurfaceRef.current.source !== textures) {
      const supportsSurfaceTextures =
        hasStableCanvasReadback(textures.floor) &&
        hasStableCanvasReadback(textures.ceiling);

      textureSurfaceRef.current = {
        source: textures,
        supportsSurfaceTextures,
        wall: createTextureSurface(textures.wall),
        accentWall: createTextureSurface(textures.accentWall),
        floor: supportsSurfaceTextures ? createTextureSurface(textures.floor) : null,
        ceiling: supportsSurfaceTextures
          ? createTextureSurface(textures.ceiling)
          : null
      };
    }

    const textureSurfaces = textureSurfaceRef.current;
    const imageBuffer = context.createImageData(width, height);
    const pixels = imageBuffer.data;
    const hasSurfaceTextures = Boolean(
      textureSurfaces.floor || textureSurfaces.ceiling
    );

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
      let hitCellX = Math.floor(originX);
      let hitCellY = Math.floor(originY);

      while (distance < maxDistance && !hitWall) {
        distance += 0.02;
        hitPointX = originX + rayDirectionX * distance;
        hitPointY = originY + rayDirectionY * distance;

        const sampleX = Math.floor(hitPointX);
        const sampleY = Math.floor(hitPointY);
        hitCellX = sampleX;
        hitCellY = sampleY;

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

        hitWall = maze.grid[sampleY]?.[sampleX] === "#";
      }

      const correctedDistance = Math.max(
        0.0001,
        distance * Math.cos(rayAngle - playerAngle)
      );
      depthBuffer[column] = correctedDistance;
      const wallHeight = Math.min(height, height / correctedDistance);
      const wallBottom = (height + wallHeight) / 2;
      const animatedWallHeight = Math.max(1, wallHeight * introProgress);
      const wallTop = wallBottom - animatedWallHeight;
      const shade = Math.max(50, Math.min(200, 215 - correctedDistance * 18));
      const useAccentWall = accentWallCells.has(`${hitCellX},${hitCellY}`);
      const wallSurface =
        useAccentWall && textureSurfaces.accentWall
          ? textureSurfaces.accentWall
          : textureSurfaces.wall;
      const wallImage =
        useAccentWall && textures.accentWall ? textures.accentWall : textures.wall;

      if (wallSurface && wallImage) {
        const textureColumn = getTextureColumn(wallSurface, hitPointX, hitPointY);
        context.save();
        context.globalAlpha = Math.max(0.55, Math.min(1, shade / 180));
        context.drawImage(
          wallImage,
          textureColumn,
          0,
          1,
          wallSurface.height,
          column,
          wallTop,
          1,
          animatedWallHeight
        );
        context.restore();
      } else {
        context.fillStyle = `rgb(${shade}, ${shade + 10}, ${shade + 24})`;
        context.fillRect(column, wallTop, 1, animatedWallHeight);
      }
    }

    const spriteDefinitions: SpriteProjection[] = [
      textures.rat && ratPath.length > 0
        ? (() => {
            const patrolPath =
              ratPath.length > 1
                ? [...ratPath, ...ratPath.slice(1, -1).reverse()]
                : ratPath;
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
              angle: 0,
              distance: 0
            };
          })()
        : null,
      textures.start
        ? {
            image: textures.start,
            worldX: startingBillboardPoint.x + 0.5,
            worldY: startingBillboardPoint.y + 0.5,
            scale: 0.52,
            alpha: 0.42,
            verticalAnchor: 0.5,
            angle: 0,
            distance: 0
          }
        : null,
      textures.exit
        ? {
            image: textures.exit,
            worldX: maze.exit.x + 0.5,
            worldY: maze.exit.y + 0.5,
            scale: 0.94,
            alpha: 0.78,
            verticalAnchor: 0.5,
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
      .filter(
        (sprite) =>
          sprite.distance > 0.2 && Math.abs(sprite.angle) < fieldOfView * 0.75
      )
      .sort((left, right) => right.distance - left.distance);

    for (const sprite of spriteDefinitions) {
      const correctedDistance = Math.max(
        0.0001,
        sprite.distance * Math.cos(sprite.angle)
      );
      const projectedCenter = (0.5 + sprite.angle / fieldOfView) * width;
      const projectedHeight = (height / correctedDistance) * sprite.scale;
      const projectedWidth =
        (projectedHeight * sprite.image.width) / sprite.image.height;
      const projectedBottom =
        height / 2 + projectedHeight * sprite.verticalAnchor;
      const animatedSpriteHeight = Math.max(1, projectedHeight * introProgress);
      const animatedSpriteWidth = Math.max(1, projectedWidth * introProgress);
      const hiddenBottom = height + projectedHeight * 0.2;
      const animatedBottom =
        hiddenBottom - (hiddenBottom - projectedBottom) * introProgress;
      const top = animatedBottom - animatedSpriteHeight;
      const left = projectedCenter - animatedSpriteWidth / 2;

      for (let stripe = 0; stripe < animatedSpriteWidth; stripe += 1) {
        const screenX = Math.floor(left + stripe);

        if (screenX < 0 || screenX >= width) {
          continue;
        }

        if (correctedDistance >= depthBuffer[screenX]) {
          continue;
        }

        const textureX = Math.floor((stripe / animatedSpriteWidth) * sprite.image.width);
        context.save();
        context.globalAlpha = sprite.alpha * Math.max(0.2, introProgress);
        context.drawImage(
          sprite.image,
          textureX,
          0,
          1,
          sprite.image.height,
          screenX,
          top,
          1,
          animatedSpriteHeight
        );
        context.restore();
      }
    }

    context.strokeStyle = "rgba(255, 255, 255, 0.18)";
    context.beginPath();
    context.moveTo(0, height / 2);
    context.lineTo(width, height / 2);
    context.stroke();
  }, [introProgress, maze, playerAngle, playerPosition, prefersReducedMotion, ratTick, textures]);

  function handleTouchStart(event: React.TouchEvent<HTMLDivElement>) {
    event.preventDefault();
    const touch = event.changedTouches[0];

    if (!touch) {
      return;
    }

    swipeStartRef.current = {
      x: touch.clientX,
      y: touch.clientY
    };
  }

  function handleTouchEnd(event: React.TouchEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!onSwipeAction || !swipeStartRef.current) {
      swipeStartRef.current = null;
      return;
    }

    const touch = event.changedTouches[0];

    if (!touch) {
      swipeStartRef.current = null;
      return;
    }

    const deltaX = touch.clientX - swipeStartRef.current.x;
    const deltaY = touch.clientY - swipeStartRef.current.y;
    swipeStartRef.current = null;

    const threshold = 28;
    if (Math.abs(deltaX) < threshold && Math.abs(deltaY) < threshold) {
      return;
    }

    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      onSwipeAction(deltaX < 0 ? "turn_left" : "turn_right");
      return;
    }

    onSwipeAction(deltaY < 0 ? "move_forward" : "move_backward");
  }

  return (
    <div
      className="raycast-panel"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <canvas
        ref={canvasRef}
        className="raycast-canvas"
        width={480}
        height={360}
        aria-label="First-person maze view"
      />
    </div>
  );
}
