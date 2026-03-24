"use client";

import { memo, useEffect, useRef, useState, type RefObject } from "react";

import type { DailyMaze, MazePoint } from "../../lib/game/maze";
import { getAccentWallCells } from "../../lib/game/maze";
import {
  buildSpriteDefinitions,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  CEILING_TEXTURE_SCALE,
  createTextureSurface,
  ensureRenderBuffers,
  FIELD_OF_VIEW,
  FLOOR_TEXTURE_SCALE,
  getQuantizedIntroProgress,
  getTextureColumn,
  hasStableCanvasReadback,
  INTRO_RISE_DURATION_MS,
  isTouchSwipeCandidate,
  sampleTexture,
  type RenderBufferState,
  type TextureSurfaceState,
  useMazeTextures
} from "./firstPersonViewShared";

interface FirstPersonViewProps {
  maze: DailyMaze;
  playerPosition: MazePoint;
  playerAngle: number;
  introSequence: number;
  animationMode: "intro" | "outro";
  viewportRef?: RefObject<HTMLDivElement | null>;
  isFullscreen?: boolean;
  onExitFullscreen?: () => void;
  exitFullscreenLabel?: string;
  onSwipeAction?: (
    action: "turn_left" | "turn_right" | "move_forward" | "move_backward"
  ) => void;
}

function FirstPersonView({
  maze,
  playerPosition,
  playerAngle,
  introSequence,
  animationMode,
  viewportRef,
  isFullscreen,
  onExitFullscreen,
  exitFullscreenLabel,
  onSwipeAction
}: FirstPersonViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const textures = useMazeTextures();
  const [introProgress, setIntroProgress] = useState<number>(0);
  const [ratTick, setRatTick] = useState<number>(0);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState<boolean>(false);
  const introProgressRef = useRef<number>(0);
  const textureSurfaceRef = useRef<TextureSurfaceState>({
    source: null,
    supportsSurfaceTextures: false,
    wall: null,
    accentWall: null,
    floor: null,
    ceiling: null
  });
  const renderBufferRef = useRef<RenderBufferState>({
    width: 0,
    height: 0,
    imageData: null,
    depthBuffer: null,
    rowDistanceByY: null
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
      introProgressRef.current = animationMode === "intro" ? 1 : 0;
      setIntroProgress(animationMode === "intro" ? 1 : 0);
      return undefined;
    }

    const startedAt = performance.now();
    introProgressRef.current = animationMode === "intro" ? 0 : 1;
    setIntroProgress(animationMode === "intro" ? 0 : 1);

    function tick(now: number) {
      const progress = Math.min(1, (now - startedAt) / INTRO_RISE_DURATION_MS);
      const eased = 1 - Math.pow(1 - progress, 3);
      const nextProgress = animationMode === "intro" ? eased : 1 - eased;
      const quantizedProgress = getQuantizedIntroProgress(nextProgress);

      if (quantizedProgress !== introProgressRef.current) {
        introProgressRef.current = quantizedProgress;
        setIntroProgress(quantizedProgress);
      }

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
    if (prefersReducedMotion || introProgress < 1) {
      setRatTick(0);
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setRatTick((currentTick) => currentTick + 1);
    }, 120);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [introProgress, prefersReducedMotion]);

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
    const fieldOfView = FIELD_OF_VIEW;
    const maxDistance = 24;
    const horizon = height * 0.5;
    context.imageSmoothingEnabled = false;

    if (textureSurfaceRef.current.source !== textures) {
      const supportsSurfaceTextures =
        hasStableCanvasReadback(textures.floor) && hasStableCanvasReadback(textures.ceiling);

      textureSurfaceRef.current = {
        source: textures,
        supportsSurfaceTextures,
        wall: createTextureSurface(textures.wall),
        accentWall: createTextureSurface(textures.accentWall),
        floor: supportsSurfaceTextures ? createTextureSurface(textures.floor) : null,
        ceiling: supportsSurfaceTextures ? createTextureSurface(textures.ceiling) : null
      };
    }

    const textureSurfaces = textureSurfaceRef.current;
    const renderBuffers = ensureRenderBuffers(context, renderBufferRef.current, width, height);
    renderBufferRef.current = renderBuffers;
    const imageBuffer = renderBuffers.imageData;
    const pixels = imageBuffer?.data;
    const depthBuffer = renderBuffers.depthBuffer;
    const rowDistanceByY = renderBuffers.rowDistanceByY;
    const hasSurfaceTextures = Boolean(
      textureSurfaces.floor &&
        textureSurfaces.ceiling &&
        imageBuffer &&
        pixels &&
        rowDistanceByY
    );

    if (!depthBuffer) {
      return;
    }

    depthBuffer.fill(maxDistance);

    if (hasSurfaceTextures && pixels && rowDistanceByY) {
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

        const rowDistance = rowDistanceByY[y];

        if (rowDistance <= 0) {
          continue;
        }
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

    if (hasSurfaceTextures && imageBuffer) {
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

      const correctedDistance = Math.max(0.0001, distance * Math.cos(rayAngle - playerAngle));
      depthBuffer[column] = correctedDistance;
      const wallHeight = Math.min(height, height / correctedDistance);
      const wallBottom = (height + wallHeight) / 2;
      const animatedWallHeight = Math.max(1, wallHeight * introProgress);
      if (animationMode === "outro" && introProgress < 0.08) {
        continue;
      }
      const wallTop = wallBottom - animatedWallHeight;
      const shade = Math.max(50, Math.min(200, 215 - correctedDistance * 18));
      const useAccentWall = accentWallCells.has(`${hitCellX},${hitCellY}`);
      const wallSurface =
        useAccentWall && textureSurfaces.accentWall
          ? textureSurfaces.accentWall
          : textureSurfaces.wall;
      const wallImage = useAccentWall && textures.accentWall ? textures.accentWall : textures.wall;

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

    const spriteDefinitions = buildSpriteDefinitions({
      textures,
      maze,
      originX,
      originY,
      playerAngle,
      fieldOfView,
      introProgress,
      prefersReducedMotion
    });

    for (const sprite of spriteDefinitions) {
      const correctedDistance = Math.max(0.0001, sprite.distance * Math.cos(sprite.angle));
      const projectedCenter = (0.5 + sprite.angle / fieldOfView) * width;
      const projectedHeight = (height / correctedDistance) * sprite.scale;
      const projectedWidth = (projectedHeight * sprite.image.width) / sprite.image.height;
      const projectedBottom = height / 2 + projectedHeight * sprite.verticalAnchor;
      const animatedSpriteHeight = Math.max(1, projectedHeight * introProgress);
      const animatedSpriteWidth = Math.max(1, projectedWidth * introProgress);
      const hiddenBottom = height + projectedHeight * 0.2;
      const animatedBottom = hiddenBottom - (hiddenBottom - projectedBottom) * introProgress;
      const top = animatedBottom - animatedSpriteHeight;
      const left =
        projectedCenter -
        animatedSpriteWidth / 2 +
        animatedSpriteWidth * sprite.horizontalOffset;

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
  }, [
    animationMode,
    introProgress,
    maze,
    playerAngle,
    playerPosition,
    prefersReducedMotion,
    ratTick,
    textures
  ]);

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

    const nextAction = isTouchSwipeCandidate(swipeStartRef.current, {
      x: touch.clientX,
      y: touch.clientY
    });
    swipeStartRef.current = null;

    if (!nextAction) {
      return;
    }

    onSwipeAction(nextAction);
  }

  return (
    <div
      ref={viewportRef}
      className="raycast-panel"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {isFullscreen && onExitFullscreen && (
        <button
          type="button"
          className="secondary-button raycast-fullscreen-exit"
          onClick={onExitFullscreen}
        >
          {exitFullscreenLabel ?? "Exit fullscreen"}
        </button>
      )}
      <canvas
        ref={canvasRef}
        className="raycast-canvas"
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        aria-label="First-person maze view"
      />
    </div>
  );
}

function areEqualProps(previous: FirstPersonViewProps, next: FirstPersonViewProps): boolean {
  return (
    previous.maze === next.maze &&
    previous.playerPosition.x === next.playerPosition.x &&
    previous.playerPosition.y === next.playerPosition.y &&
    previous.playerAngle === next.playerAngle &&
    previous.introSequence === next.introSequence &&
    previous.animationMode === next.animationMode &&
    previous.viewportRef === next.viewportRef &&
    previous.isFullscreen === next.isFullscreen &&
    previous.onExitFullscreen === next.onExitFullscreen &&
    previous.exitFullscreenLabel === next.exitFullscreenLabel
  );
}

export default memo(FirstPersonView, areEqualProps);
