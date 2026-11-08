export type HouseQuickAction = {
  id: string;
  label: string;
  prompt: string;
};

export type HousePanel = {
  id: string;
  title: string;
  status: string;
  detail?: string;
  attention?: boolean;
};

export type HouseDashboardView = {
  asOf: string;
  panels: HousePanel[];
  quickActions: HouseQuickAction[];
};

/** Compact Slack/board text the model can mirror; UI also uses structured panels. */
export function formatHouseDashboardText(
  dash: HouseDashboardView,
  channel: "board" | "slack",
): string {
  const lines: string[] = [];
  if (channel === "slack") {
    lines.push(`*House · ${dash.asOf}*`);
    for (const p of dash.panels) {
      const mark = p.attention ? " 🔴" : "";
      lines.push(`• *${p.title}:* ${p.status}${mark}${p.detail ? `\n    ${p.detail}` : ""}`);
    }
    if (dash.quickActions.length) {
      lines.push("");
      lines.push("*Actions — reply with one:*");
      for (const a of dash.quickActions) lines.push(`• ${a.label}`);
    }
  } else {
    lines.push(`House · ${dash.asOf}`);
    for (const p of dash.panels) {
      lines.push(
        `${p.attention ? "⚠ " : ""}**${p.title}:** ${p.status}${p.detail ? ` — ${p.detail}` : ""}`,
      );
    }
  }
  return lines.join("\n");
}
