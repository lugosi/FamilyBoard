/**
 * Server-only chart PNG encoding (Slack uploads). Do not import from client components.
 */
import type { ChatChartSpec } from "./chat-chart";
import { renderChatChartSvg, type ChartTheme } from "./chat-chart-svg";

export async function renderChatChartPng(
  spec: ChatChartSpec,
  opts: { theme?: ChartTheme; width?: number } = {},
): Promise<Buffer> {
  const svg = renderChatChartSvg(spec, { theme: opts.theme ?? "light" });
  const { Resvg } = await import("@resvg/resvg-js");
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: opts.width ?? 640 },
    font: { loadSystemFonts: true },
  });
  return Buffer.from(resvg.render().asPng());
}
