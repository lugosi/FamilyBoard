/**
 * Server-only chart PNG encoding (Slack uploads). Do not import from client components.
 *
 * Alpine Docker images ship with no fonts — resvg then draws bars/lines but drops every
 * `<text>` glyph. Always load the bundled DejaVu files from `public/fonts/`.
 */
import path from "node:path";
import type { ChatChartSpec } from "./chat-chart";
import { renderChatChartSvg, type ChartTheme } from "./chat-chart-svg";

function bundledFontFiles(): string[] {
  const dir = path.join(process.cwd(), "public", "fonts");
  return [
    path.join(dir, "DejaVuSans.ttf"),
    path.join(dir, "DejaVuSans-Bold.ttf"),
  ];
}

export async function renderChatChartPng(
  spec: ChatChartSpec,
  opts: { theme?: ChartTheme; width?: number } = {},
): Promise<Buffer> {
  const svg = renderChatChartSvg(spec, { theme: opts.theme ?? "light" });
  const { Resvg } = await import("@resvg/resvg-js");
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: opts.width ?? 640 },
    font: {
      // Bundle is authoritative; system fonts are a bonus when present.
      fontFiles: bundledFontFiles(),
      loadSystemFonts: true,
      defaultFontFamily: "DejaVu Sans",
    },
  });
  return Buffer.from(resvg.render().asPng());
}
