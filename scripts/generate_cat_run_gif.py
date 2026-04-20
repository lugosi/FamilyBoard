#!/usr/bin/env python3
"""Generate a small transparent cute cat running GIF (side view, multi-frame)."""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

W, H = 256, 160
N_FRAMES = 14
FRAME_MS = 75

# Palette
OUTLINE = (45, 42, 40, 255)
FUR = (255, 168, 92, 255)
FUR_LIGHT = (255, 212, 168, 255)
MUZZLE = (255, 248, 240, 255)
EAR_INNER = (255, 182, 193, 255)
EYE_WHITE = (255, 255, 255, 255)
EYE = (35, 35, 40, 255)
NOSE = (255, 130, 150, 255)
TAIL = (255, 150, 90, 255)


def leg(draw: ImageDraw.ImageDraw, x0: float, y0: float, length: float, ang: float, w: int = 5) -> None:
    x1 = x0 + length * math.sin(ang)
    y1 = y0 + length * math.cos(ang)
    draw.line((x0, y0, x1, y1), fill=OUTLINE, width=w + 2)
    draw.line((x0, y0, x1, y1), fill=FUR, width=w)


def frame(phase: float) -> Image.Image:
    """phase in [0,1) one full run cycle."""
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)

    t = phase * 2 * math.pi
    bob = 3 * abs(math.sin(t * 2))
    sway = 2 * math.sin(t)

    cx, cy = W // 2 + sway, H // 2 + 8 - bob

    # --- Tail (behind body) ---
    tail_sw = 0.35 * math.sin(t * 1.5)
    tail_pts = []
    for i in range(5):
        u = i / 4
        tx = cx - 48 - u * 28 + 8 * math.sin(u * 2 + tail_sw)
        ty = cy - 8 + u * 22 + 6 * math.sin(u * 3 + t)
        tail_pts.append((tx, ty))
    for i in range(len(tail_pts) - 1):
        d.line([tail_pts[i], tail_pts[i + 1]], fill=OUTLINE, width=7)
        d.line([tail_pts[i], tail_pts[i + 1]], fill=TAIL, width=4)

    # --- Hind legs ---
    ha = 0.55 * math.sin(t + math.pi * 0.15)
    leg(d, cx - 22, cy + 14, 36, ha + 0.15)
    leg(d, cx - 10, cy + 16, 32, ha * 0.6 + 0.5)

    # --- Body ---
    d.ellipse(
        (cx - 42, cy - 18, cx + 28, cy + 22),
        fill=FUR,
        outline=OUTLINE,
        width=3,
    )
    d.ellipse(
        (cx - 30, cy - 8, cx + 10, cy + 12),
        fill=FUR_LIGHT,
        outline=None,
    )

    # --- Front legs ---
    fa = 0.55 * math.sin(t + math.pi)
    leg(d, cx + 8, cy + 16, 34, fa + 0.2)
    leg(d, cx + 20, cy + 18, 30, fa * 0.55 + 0.45)

    # --- Head (big cute) ---
    hx, hy = cx + 36, cy - 14
    d.ellipse((hx - 26, hy - 22, hx + 26, hy + 20), fill=FUR, outline=OUTLINE, width=3)

    # Ears
    d.polygon(
        [(hx - 18, hy - 18), (hx - 8, hy - 36), (hx + 2, hy - 20)],
        fill=FUR,
        outline=OUTLINE,
        width=2,
    )
    d.polygon(
        [(hx - 12, hy - 22), (hx - 6, hy - 32), (hx + 0, hy - 22)],
        fill=EAR_INNER,
    )
    d.polygon(
        [(hx + 4, hy - 20), (hx + 14, hy - 34), (hx + 22, hy - 16)],
        fill=FUR,
        outline=OUTLINE,
        width=2,
    )
    d.polygon(
        [(hx + 8, hy - 22), (hx + 14, hy - 30), (hx + 18, hy - 18)],
        fill=EAR_INNER,
    )

    # Muzzle patch
    d.ellipse((hx - 8, hy + 2, hx + 22, hy + 18), fill=MUZZLE, outline=OUTLINE, width=2)

    # Eyes (big)
    eye_y = hy - 4
    d.ellipse((hx - 14, eye_y - 10, hx + 2, eye_y + 6), fill=EYE_WHITE, outline=OUTLINE, width=2)
    d.ellipse((hx + 6, eye_y - 10, hx + 22, eye_y + 6), fill=EYE_WHITE, outline=OUTLINE, width=2)
    off = 2 * math.sin(t * 3)
    d.ellipse((hx - 10 + off, eye_y - 4, hx - 4 + off, eye_y + 2), fill=EYE)
    d.ellipse((hx + 10 + off, eye_y - 4, hx + 16 + off, eye_y + 2), fill=EYE)
    # shine
    d.ellipse((hx - 8 + off, eye_y - 6, hx - 6 + off, eye_y - 4), fill=(250, 250, 255, 255))
    d.ellipse((hx + 12 + off, eye_y - 6, hx + 14 + off, eye_y - 4), fill=(250, 250, 255, 255))

    # Nose
    d.polygon([(hx + 6, hy + 8), (hx + 2, hy + 14), (hx + 10, hy + 14)], fill=NOSE, outline=OUTLINE, width=1)

    # Whiskers
    d.line((hx - 4, hy + 10, hx - 22, hy + 8), fill=OUTLINE, width=2)
    d.line((hx - 4, hy + 12, hx - 24, hy + 14), fill=OUTLINE, width=2)
    d.line((hx + 12, hy + 10, hx + 28, hy + 6), fill=OUTLINE, width=2)
    d.line((hx + 12, hy + 12, hx + 30, hy + 14), fill=OUTLINE, width=2)

    return im


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    out = root / "public" / "cat-run.gif"
    out.parent.mkdir(parents=True, exist_ok=True)

    frames = [frame(i / N_FRAMES) for i in range(N_FRAMES)]
    frames[0].save(
        out,
        save_all=True,
        append_images=frames[1:],
        duration=FRAME_MS,
        loop=0,
        disposal=2,
        optimize=False,
    )
    print(f"Wrote {out} ({N_FRAMES} frames, {FRAME_MS}ms)")


if __name__ == "__main__":
    main()
