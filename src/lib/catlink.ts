export type CatlinkAction =
  | "refresh"
  | "clean_now"
  | "toggle_child_lock"
  | "toggle_odor_control"
  | "toggle_night_light";

export function getCatlinkConfig() {
  const baseUrl = process.env.CATLINK_API_BASE_URL?.trim();
  const token = process.env.CATLINK_API_TOKEN?.trim();
  if (!baseUrl || !token) return null;
  return { baseUrl, token };
}

export async function catlinkApiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; status: number; data?: T; text?: string }> {
  const cfg = getCatlinkConfig();
  if (!cfg) {
    throw new Error("catlink_not_configured");
  }
  const response = await fetch(`${cfg.baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  let data: T | undefined;
  let text: string | undefined;
  try {
    data = (await response.json()) as T;
  } catch {
    try {
      text = await response.text();
    } catch {
      text = "";
    }
  }
  return {
    ok: response.ok,
    status: response.status,
    data,
    text,
  };
}
