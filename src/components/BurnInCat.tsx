"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

type CatLap = {
  topVh: number;
  durationSec: number;
  rtl: boolean;
  tiltDeg: number;
  dy0px: number;
  dy1px: number;
};

function randomCatLap(): CatLap {
  return {
    topVh: 4 + Math.random() * 84,
    durationSec: 14 + Math.random() * 26,
    rtl: Math.random() < 0.5,
    tiltDeg: -8 + Math.random() * 16,
    dy0px: Math.round(-45 + Math.random() * 90),
    dy1px: Math.round(-45 + Math.random() * 90),
  };
}

const LAP_DEFAULT: CatLap = {
  topVh: 42,
  durationSec: 20,
  rtl: false,
  tiltDeg: 0,
  dy0px: 0,
  dy1px: 0,
};

/**
 * Animated GIF crosses the viewport on varied paths (height, diagonal, speed, direction)
 * to spread motion across the screen and reduce static burn-in.
 */
export function BurnInCat({ enabled }: { enabled: boolean }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [lap, setLap] = useState<CatLap>(LAP_DEFAULT);

  const pickNextLap = useCallback(() => {
    setLap(randomCatLap());
  }, []);

  useEffect(() => {
    if (!enabled) return;
    queueMicrotask(() => {
      setLap(randomCatLap());
    });
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const el = trackRef.current;
    if (!el) return;
    const onLap = () => pickNextLap();
    el.addEventListener("animationiteration", onLap);
    return () => el.removeEventListener("animationiteration", onLap);
  }, [enabled, pickNextLap]);

  if (!enabled) return null;

  const trackStyle = {
    "--cat-dy0": `${lap.dy0px}px`,
    "--cat-dy1": `${lap.dy1px}px`,
    "--cat-tilt": `${lap.tiltDeg}deg`,
    animationDuration: `${lap.durationSec}s`,
  } as CSSProperties;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[38] overflow-hidden select-none"
      aria-hidden
    >
      <div
        className="absolute left-0 w-full"
        style={{
          top: `${lap.topVh}vh`,
          transform: "translateY(-50%)",
        }}
      >
        <div
          ref={trackRef}
          className="burnin-cat-track will-change-transform"
          style={trackStyle}
        >
          <div
            className="inline-block"
            style={lap.rtl ? { transform: "scaleX(-1)" } : undefined}
          >
            {/* GIF: plain img (next/image can break animated GIFs). */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/cat-run.gif"
              alt=""
              width={256}
              height={160}
              draggable={false}
              className="pointer-events-none h-20 w-auto drop-shadow-[0_3px_10px_rgba(0,0,0,0.5)] sm:h-24"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
