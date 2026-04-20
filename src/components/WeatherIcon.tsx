import { wmoLabel } from "@/lib/wmo";

type IconKind =
  | "clear"
  | "partly"
  | "cloud"
  | "fog"
  | "drizzle"
  | "rain"
  | "snow"
  | "storm";

function iconKindFromWmo(code: number): IconKind {
  const c = Number.isFinite(code) ? code : 0;
  if (c === 0 || c === 1) return "clear";
  if (c === 2) return "partly";
  if (c === 3) return "cloud";
  if (c === 45 || c === 48) return "fog";
  if (c >= 51 && c <= 55) return "drizzle";
  if ((c >= 61 && c <= 65) || (c >= 80 && c <= 82)) return "rain";
  if (c >= 71 && c <= 75) return "snow";
  if (c >= 95) return "storm";
  return "partly";
}

function IconSvg({ kind }: { kind: IconKind }) {
  const stroke = "currentColor";
  const fillSky = "rgba(56, 189, 248, 0.35)";
  const fillCloud = "rgba(148, 163, 184, 0.45)";
  const fillSun = "rgba(251, 191, 36, 0.95)";

  switch (kind) {
    case "clear":
      return (
        <svg viewBox="0 0 64 64" className="h-full w-full" aria-hidden>
          {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
            <line
              key={deg}
              x1="32"
              y1="30"
              x2={32 + Math.cos((deg * Math.PI) / 180) * 22}
              y2={30 + Math.sin((deg * Math.PI) / 180) * 22}
              stroke={fillSun}
              strokeWidth="3"
              strokeLinecap="round"
            />
          ))}
          <circle cx="32" cy="30" r="14" fill={fillSun} />
        </svg>
      );
    case "partly":
      return (
        <svg viewBox="0 0 64 64" className="h-full w-full" aria-hidden>
          <circle cx="24" cy="26" r="10" fill={fillSun} />
          <path
            d="M18 44c-4 0-8-3-8-8 0-4 3-7 7-8 1-6 6-10 12-10 5 0 9 3 11 7 5 1 8 5 8 10 0 6-5 11-11 11H18z"
            fill={fillCloud}
            stroke={stroke}
            strokeWidth="1.2"
            opacity="0.9"
          />
        </svg>
      );
    case "cloud":
      return (
        <svg viewBox="0 0 64 64" className="h-full w-full" aria-hidden>
          <path
            d="M14 42c-5 0-9-4-9-9 0-5 4-9 9-9h2c2-7 8-12 16-12 8 0 14 5 16 12h2c5 0 9 4 9 9s-4 9-9 9H14z"
            fill={fillCloud}
            stroke={stroke}
            strokeWidth="1.2"
          />
        </svg>
      );
    case "fog":
      return (
        <svg viewBox="0 0 64 64" className="h-full w-full" aria-hidden>
          <path
            d="M12 28h40M10 36h44M14 44h36"
            stroke={stroke}
            strokeWidth="3"
            strokeLinecap="round"
            opacity="0.55"
          />
          <path
            d="M16 22c0-6 5-11 12-11 4 0 8 2 10 5 4-3 9-5 14-5 8 0 14 6 14 13H16z"
            fill={fillCloud}
            stroke={stroke}
            strokeWidth="1"
            opacity="0.7"
          />
        </svg>
      );
    case "drizzle":
      return (
        <svg viewBox="0 0 64 64" className="h-full w-full" aria-hidden>
          <path
            d="M12 34c-4 0-7-3-7-7 0-4 3-7 7-7h1c2-6 7-10 14-10s12 4 14 10h1c4 0 7 3 7 7s-3 7-7 7H12z"
            fill={fillCloud}
            stroke={stroke}
            strokeWidth="1.1"
          />
          <line x1="22" y1="40" x2="20" y2="52" stroke={fillSky} strokeWidth="2.5" strokeLinecap="round" />
          <line x1="32" y1="40" x2="30" y2="54" stroke={fillSky} strokeWidth="2.5" strokeLinecap="round" />
          <line x1="42" y1="40" x2="40" y2="52" stroke={fillSky} strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      );
    case "rain":
      return (
        <svg viewBox="0 0 64 64" className="h-full w-full" aria-hidden>
          <path
            d="M10 32c-4 0-7-3-7-7 0-4 3-7 7-7h2c2-6 8-10 15-10 6 0 11 3 13 9 5 0 9 4 9 9 0 5-4 9-9 9H10z"
            fill={fillCloud}
            stroke={stroke}
            strokeWidth="1.1"
          />
          {[18, 26, 34, 42].map((x, i) => (
            <line
              key={i}
              x1={x}
              y1="38"
              x2={x - 3}
              y2="54"
              stroke="rgb(56, 189, 248)"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          ))}
        </svg>
      );
    case "snow":
      return (
        <svg viewBox="0 0 64 64" className="h-full w-full" aria-hidden>
          <path
            d="M10 32c-4 0-7-3-7-7 0-4 3-7 7-7h2c2-6 8-10 15-10 6 0 11 3 13 9 5 0 9 4 9 9 0 5-4 9-9 9H10z"
            fill={fillCloud}
            stroke={stroke}
            strokeWidth="1.1"
          />
          {[
            [22, 44],
            [32, 48],
            [42, 44],
          ].map(([x, y], i) => (
            <g key={i} transform={`translate(${x},${y})`} stroke="rgb(224, 242, 254)" strokeWidth="1.8">
              <line x1="0" y1="-4" x2="0" y2="4" />
              <line x1="-4" y1="0" x2="4" y2="0" />
              <line x1="-3" y1="-3" x2="3" y2="3" />
              <line x1="3" y1="-3" x2="-3" y2="3" />
            </g>
          ))}
        </svg>
      );
    case "storm":
      return (
        <svg viewBox="0 0 64 64" className="h-full w-full" aria-hidden>
          <path
            d="M10 30c-4 0-7-3-7-7 0-4 3-7 7-7h2c2-6 8-10 15-10 6 0 11 3 13 9 5 0 9 4 9 9 0 5-4 9-9 9H10z"
            fill="rgba(71, 85, 105, 0.55)"
            stroke={stroke}
            strokeWidth="1.1"
          />
          <path
            d="M28 36 24 48h8l-4 12 14-16h-10l6-8H28z"
            fill="rgb(250, 204, 21)"
            stroke="rgb(202, 138, 4)"
            strokeWidth="0.8"
            strokeLinejoin="round"
          />
        </svg>
      );
  }
}

type Props = {
  code: number;
  /** Tailwind size classes, e.g. h-10 w-10 */
  className?: string;
};

export function WeatherIcon({ code, className = "h-10 w-10" }: Props) {
  const kind = iconKindFromWmo(code);
  const label = wmoLabel(code);
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center text-slate-200 ${className}`}
      role="img"
      aria-label={label}
    >
      <IconSvg kind={kind} />
    </span>
  );
}
