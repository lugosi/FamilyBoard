"use client";

import { useMemo } from "react";
import type { ChatChartSpec } from "@/lib/chat-chart";
import { renderChatChartSvg } from "@/lib/chat-chart-svg";

export function ChatChart({ spec }: { spec: ChatChartSpec }) {
  const svg = useMemo(() => renderChatChartSvg(spec, { theme: "dark" }), [spec]);
  return (
    // Isolate from chat `text-slate-50` so SVG labels keep their own fills.
    <figure
      className="my-3 overflow-visible rounded-lg border border-slate-700 bg-slate-950 p-2 text-slate-100 sm:p-3"
      style={{ color: "#f8fafc" }}
    >
      <div
        className="w-full overflow-visible [&_svg]:h-auto [&_svg]:w-full"
        style={{ color: "#f8fafc" }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </figure>
  );
}
