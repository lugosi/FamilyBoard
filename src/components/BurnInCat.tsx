"use client";

/**
 * Cute running cat (generated asset) crosses the viewport to vary static pixels.
 */
export function BurnInCat({ enabled }: { enabled: boolean }) {
  if (!enabled) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-[7vh] z-[38] overflow-hidden select-none"
      aria-hidden
    >
      <div className="burnin-cat-track will-change-transform">
        {/* GIF animation: plain img (next/image can drop frames on animated GIFs). */}
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
  );
}
