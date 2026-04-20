"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Classic Neko-style cat that follows the pointer (same spirit as Windows 3.x / X11 xneko).
 * Sprite + behavior adapted from oneko.js (MIT): https://github.com/adryd325/oneko.js
 * Asset: /public/oneko.gif
 */

const SPRITE = 32;
const NEKO_SPEED = 10;
/** No pointer movement for this long → treat as "not using mouse" for wander. */
const POINTER_QUIET_MS = 5_000;
const WANDER_INTERVAL_MS = 30_000;

const spriteSets = {
  idle: [[-3, -3]],
  alert: [[-7, -3]],
  scratchSelf: [
    [-5, 0],
    [-6, 0],
    [-7, 0],
  ],
  scratchWallN: [
    [0, 0],
    [0, -1],
  ],
  scratchWallS: [
    [-7, -1],
    [-6, -2],
  ],
  scratchWallE: [
    [-2, -2],
    [-2, -3],
  ],
  scratchWallW: [
    [-4, 0],
    [-4, -1],
  ],
  tired: [[-3, -2]],
  sleeping: [
    [-2, 0],
    [-2, -1],
  ],
  N: [
    [-1, -2],
    [-1, -3],
  ],
  NE: [
    [0, -2],
    [0, -3],
  ],
  E: [
    [-3, 0],
    [-3, -1],
  ],
  SE: [
    [-5, -1],
    [-5, -2],
  ],
  S: [
    [-6, -3],
    [-7, -2],
  ],
  SW: [
    [-5, -3],
    [-6, -1],
  ],
  W: [
    [-4, -2],
    [-4, -3],
  ],
  NW: [
    [-1, 0],
    [-1, -1],
  ],
} as const;

type IdleName =
  | "sleeping"
  | "scratchWallN"
  | "scratchWallS"
  | "scratchWallE"
  | "scratchWallW"
  | "scratchSelf";

type SpriteKey = keyof typeof spriteSets;

function setSprite(
  el: HTMLDivElement,
  name: SpriteKey,
  frame: number,
): void {
  const frames = spriteSets[name];
  const sprite = frames[frame % frames.length]!;
  el.style.backgroundPosition = `${sprite[0] * SPRITE}px ${sprite[1] * SPRITE}px`;
}

export function OnekoCat({ enabled }: { enabled: boolean }) {
  const elRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const [allowMotion, setAllowMotion] = useState(false);

  useEffect(() => {
    setAllowMotion(
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
  }, []);

  useEffect(() => {
    if (!enabled || !allowMotion) return;

    const node = elRef.current;
    if (!node) return;
    const nekoEl: HTMLDivElement = node;

    let nekoPosX = 32;
    let nekoPosY = 32;
    let mousePosX = 0;
    let mousePosY = 0;
    let frameCount = 0;
    let idleTime = 0;
    let idleAnimation: IdleName | null = null;
    let idleAnimationFrame = 0;
    let lastFrameTimestamp: number | undefined;
    let lastPointerMs = Date.now();

    function randomWanderTarget() {
      const m = 48;
      const iw = window.innerWidth;
      const ih = window.innerHeight;
      if (iw <= 2 * m || ih <= 2 * m) {
        mousePosX = iw / 2;
        mousePosY = ih / 2;
        return;
      }
      mousePosX = m + Math.random() * (iw - 2 * m);
      mousePosY = m + Math.random() * (ih - 2 * m);
    }

    function resetIdleAnimation() {
      idleAnimation = null;
      idleAnimationFrame = 0;
    }

    function idle() {
      idleTime += 1;

      if (
        idleTime > 10 &&
        Math.floor(Math.random() * 200) === 0 &&
        idleAnimation == null
      ) {
        const idleChoices: IdleName[] = ["sleeping", "scratchSelf"];
        if (nekoPosX < 32) idleChoices.push("scratchWallW");
        if (nekoPosY < 32) idleChoices.push("scratchWallN");
        if (nekoPosX > window.innerWidth - 32) idleChoices.push("scratchWallE");
        if (nekoPosY > window.innerHeight - 32) idleChoices.push("scratchWallS");
        idleAnimation =
          idleChoices[Math.floor(Math.random() * idleChoices.length)]!;
      }

      switch (idleAnimation) {
        case "sleeping":
          if (idleAnimationFrame < 8) {
            setSprite(nekoEl, "tired", 0);
            break;
          }
          setSprite(nekoEl, "sleeping", Math.floor(idleAnimationFrame / 4));
          if (idleAnimationFrame > 192) resetIdleAnimation();
          break;
        case "scratchWallN":
        case "scratchWallS":
        case "scratchWallE":
        case "scratchWallW":
        case "scratchSelf":
          setSprite(nekoEl, idleAnimation, idleAnimationFrame);
          if (idleAnimationFrame > 9) resetIdleAnimation();
          break;
        default:
          setSprite(nekoEl, "idle", 0);
          return;
      }
      idleAnimationFrame += 1;
    }

    function tick() {
      frameCount += 1;
      const diffX = nekoPosX - mousePosX;
      const diffY = nekoPosY - mousePosY;
      const distance = Math.sqrt(diffX ** 2 + diffY ** 2);

      if (distance < NEKO_SPEED || distance < 48) {
        idle();
        return;
      }

      idleAnimation = null;
      idleAnimationFrame = 0;

      if (idleTime > 1) {
        setSprite(nekoEl, "alert", 0);
        idleTime = Math.min(idleTime, 7);
        idleTime -= 1;
        return;
      }

      let direction = "";
      direction += diffY / distance > 0.5 ? "N" : "";
      direction += diffY / distance < -0.5 ? "S" : "";
      direction += diffX / distance > 0.5 ? "W" : "";
      direction += diffX / distance < -0.5 ? "E" : "";
      const facing = (direction || "E") as SpriteKey;
      setSprite(nekoEl, facing, frameCount);

      nekoPosX -= (diffX / distance) * NEKO_SPEED;
      nekoPosY -= (diffY / distance) * NEKO_SPEED;

      nekoPosX = Math.min(Math.max(16, nekoPosX), window.innerWidth - 16);
      nekoPosY = Math.min(Math.max(16, nekoPosY), window.innerHeight - 16);

      nekoEl.style.left = `${nekoPosX - 16}px`;
      nekoEl.style.top = `${nekoPosY - 16}px`;
    }

    function onAnimationFrame(timestamp: number) {
      if (!nekoEl.isConnected) return;
      if (lastFrameTimestamp === undefined) lastFrameTimestamp = timestamp;
      if (timestamp - lastFrameTimestamp > 100) {
        lastFrameTimestamp = timestamp;
        tick();
      }
      rafRef.current = window.requestAnimationFrame(onAnimationFrame);
    }

    function onPointerMove(e: PointerEvent) {
      lastPointerMs = Date.now();
      mousePosX = e.clientX;
      mousePosY = e.clientY;
    }

    nekoEl.style.left = `${nekoPosX - 16}px`;
    nekoEl.style.top = `${nekoPosY - 16}px`;
    setSprite(nekoEl, "idle", 0);

    const wanderTimer = window.setInterval(() => {
      if (Date.now() - lastPointerMs < POINTER_QUIET_MS) return;
      randomWanderTarget();
    }, WANDER_INTERVAL_MS);

    document.addEventListener("pointermove", onPointerMove);
    rafRef.current = window.requestAnimationFrame(onAnimationFrame);

    return () => {
      window.clearInterval(wanderTimer);
      document.removeEventListener("pointermove", onPointerMove);
      window.cancelAnimationFrame(rafRef.current);
    };
  }, [enabled, allowMotion]);

  if (!enabled || !allowMotion) return null;

  return (
    <div
      ref={elRef}
      className="pointer-events-none fixed select-none"
      style={{
        width: SPRITE,
        height: SPRITE,
        zIndex: 38,
        imageRendering: "pixelated",
        backgroundImage: "url(/oneko.gif)",
        backgroundRepeat: "no-repeat",
      }}
      aria-hidden
    />
  );
}
