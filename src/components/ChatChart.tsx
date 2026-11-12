"use client";

import {
  formatChartValue,
  type ChatChartPoint,
  type ChatChartSpec,
} from "@/lib/chat-chart";

const VB_W = 420;
const VB_H = 200;
const PAD = { top: 28, right: 12, bottom: 36, left: 44 };

function niceDomain(values: number[]): { min: number; max: number } {
  if (!values.length) return { min: 0, max: 1 };
  const dataMin = Math.min(0, ...values);
  let max = Math.max(...values);
  if (max === dataMin) {
    max = dataMin + 1;
  }
  const span = max - dataMin;
  const pad = span * 0.08;
  return { min: dataMin < 0 ? dataMin - pad : 0, max: max + pad };
}

function ticks(min: number, max: number, count = 4): number[] {
  if (count < 2) return [min, max];
  return Array.from({ length: count }, (_, i) => min + ((max - min) * i) / (count - 1));
}

function allLabels(spec: ChatChartSpec): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of spec.series) {
    for (const p of s.data) {
      if (!seen.has(p.label)) {
        seen.add(p.label);
        out.push(p.label);
      }
    }
  }
  return out;
}

function valueFor(seriesData: ChatChartPoint[], label: string): number | null {
  const hit = seriesData.find((p) => p.label === label);
  return hit ? hit.value : null;
}

export function ChatChart({ spec }: { spec: ChatChartSpec }) {
  const labels = allLabels(spec);
  const values = spec.series.flatMap((s) => s.data.map((d) => d.value));
  const { min, max } = niceDomain(values);
  const yTicks = ticks(min, max);
  const plotW = VB_W - PAD.left - PAD.right;
  const plotH = VB_H - PAD.top - PAD.bottom;
  const n = Math.max(labels.length, 1);
  const band = plotW / n;

  const yScale = (v: number) => PAD.top + plotH - ((v - min) / Math.max(max - min, 1e-6)) * plotH;

  return (
    <figure className="my-3 overflow-hidden rounded-lg border border-slate-800 bg-slate-950/70 p-3">
      {spec.title ? (
        <figcaption className="mb-2 text-sm font-medium text-slate-200">{spec.title}</figcaption>
      ) : null}
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        className="h-auto w-full max-w-full"
        role="img"
        aria-label={spec.title || "Chart"}
      >
        {yTicks.map((t) => {
          const y = yScale(t);
          return (
            <g key={`yt-${t}`}>
              <line
                x1={PAD.left}
                x2={VB_W - PAD.right}
                y1={y}
                y2={y}
                stroke="#1e293b"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 6}
                y={y + 3}
                textAnchor="end"
                className="fill-slate-500"
                fontSize={10}
              >
                {formatChartValue(t, spec.unit)}
              </text>
            </g>
          );
        })}

        {spec.type === "bar"
          ? spec.series.map((series, si) => {
              const seriesCount = spec.series.length;
              const barW = Math.max(4, (band * 0.7) / seriesCount);
              return series.data.map((p) => {
                const li = labels.indexOf(p.label);
                if (li < 0) return null;
                const x =
                  PAD.left +
                  li * band +
                  band * 0.15 +
                  si * barW;
                const y0 = yScale(0);
                const y1 = yScale(p.value);
                const top = Math.min(y0, y1);
                const h = Math.max(1, Math.abs(y0 - y1));
                return (
                  <rect
                    key={`${si}-${p.label}`}
                    x={x}
                    y={top}
                    width={barW}
                    height={h}
                    rx={2}
                    fill={series.color}
                    opacity={0.9}
                  >
                    <title>
                      {series.name ? `${series.name}: ` : ""}
                      {p.label} — {formatChartValue(p.value, spec.unit)}
                    </title>
                  </rect>
                );
              });
            })
          : spec.series.map((series, si) => {
              const pts = labels
                .map((label, i) => {
                  const v = valueFor(series.data, label);
                  if (v == null) return null;
                  const x = PAD.left + i * band + band / 2;
                  const y = yScale(v);
                  return { x, y, label, v };
                })
                .filter((p): p is { x: number; y: number; label: string; v: number } => Boolean(p));
              if (!pts.length) return null;
              const d = pts
                .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
                .join(" ");
              return (
                <g key={`line-${si}`}>
                  <path d={d} fill="none" stroke={series.color} strokeWidth={2.5} strokeLinejoin="round" />
                  {pts.map((p) => (
                    <circle key={p.label} cx={p.x} cy={p.y} r={3.2} fill={series.color}>
                      <title>
                        {series.name ? `${series.name}: ` : ""}
                        {p.label} — {formatChartValue(p.v, spec.unit)}
                      </title>
                    </circle>
                  ))}
                </g>
              );
            })}

        {labels.map((label, i) => {
          const x = PAD.left + i * band + band / 2;
          const short =
            label.length > 8 && labels.length > 6 ? `${label.slice(0, 6)}…` : label;
          return (
            <text
              key={`xl-${label}`}
              x={x}
              y={VB_H - 10}
              textAnchor="middle"
              className="fill-slate-400"
              fontSize={10}
            >
              {short}
            </text>
          );
        })}
      </svg>
      {spec.series.some((s) => s.name) ? (
        <ul className="mt-2 flex flex-wrap gap-3 text-xs text-slate-400">
          {spec.series.map((s, i) =>
            s.name ? (
              <li key={`${s.name}-${i}`} className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ background: s.color }}
                  aria-hidden
                />
                {s.name}
              </li>
            ) : null,
          )}
        </ul>
      ) : null}
    </figure>
  );
}
