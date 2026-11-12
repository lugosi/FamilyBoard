"use client";

import { useMemo } from "react";
import type { ChatChartSpec } from "@/lib/chat-chart";
import { renderChatChartSvg } from "@/lib/chat-chart-svg";

export function ChatChart({ spec }: { spec: ChatChartSpec }) {
  const svg = useMemo(() => renderChatChartSvg(spec, { theme: "dark" }), [spec]);
  return (
    <figure className="my-3 overflow-visible rounded-lg border border-slate-800 bg-slate-950/70 p-2 sm:p-3">
      <div
        className="w-full overflow-visible [&_svg]:h-auto [&_svg]:w-full"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </figure>
  );
}
