import dns from "node:dns";
import mdns from "multicast-dns";

export type CastDevice = {
  id: string;
  name: string;
  host: string;
  port: number;
};

type MdnsAnswer = {
  name?: string;
  type?: string;
  data?: unknown;
};

export async function discoverCastDevices(timeoutMs = 2500): Promise<CastDevice[]> {
  console.info("[cast] discoverCastDevices:start", { timeoutMs });
  const mdnsClient = mdns();
  const hostsByService = new Map<string, { host?: string; port?: number; name?: string; id?: string }>();
  const ipsByHost = new Map<string, string>();

  const normalizeTxt = (data: unknown): string[] => {
    if (!Array.isArray(data)) return [];
    return data.map((x) => (Buffer.isBuffer(x) ? x.toString("utf-8") : String(x)));
  };

  const onResponse = (res: { answers?: MdnsAnswer[]; additionals?: MdnsAnswer[] }) => {
    const records = [...(res.answers ?? []), ...(res.additionals ?? [])];
    for (const rec of records) {
      if (!rec?.name || !rec?.type) continue;
      if (rec.type === "PTR" && typeof rec.data === "string") {
        hostsByService.set(rec.data, hostsByService.get(rec.data) ?? {});
      }
      if (rec.type === "SRV" && rec.data && typeof rec.data === "object") {
        const d = rec.data as { target?: string; port?: number };
        const entry = hostsByService.get(rec.name) ?? {};
        if (typeof d.target === "string") entry.host = d.target.replace(/\.$/, "");
        if (typeof d.port === "number") entry.port = d.port;
        hostsByService.set(rec.name, entry);
      }
      if (rec.type === "TXT") {
        const entry = hostsByService.get(rec.name) ?? {};
        const txt = normalizeTxt(rec.data);
        for (const item of txt) {
          if (item.startsWith("fn=")) entry.name = item.slice(3);
          if (item.startsWith("id=")) entry.id = item.slice(3);
        }
        hostsByService.set(rec.name, entry);
      }
      if ((rec.type === "A" || rec.type === "AAAA") && typeof rec.data === "string") {
        ipsByHost.set(rec.name.replace(/\.$/, ""), rec.data);
      }
    }
  };

  mdnsClient.on("response", onResponse);
  mdnsClient.query({
    questions: [{ name: "_googlecast._tcp.local", type: "PTR" }],
  });

  await new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
  mdnsClient.removeListener("response", onResponse);
  mdnsClient.destroy();

  const out: CastDevice[] = [];
  for (const [, value] of hostsByService) {
    const hostName = value.host?.replace(/\.$/, "");
    if (!hostName || !value.port) continue;
    const ip = ipsByHost.get(hostName);
    const host = ip ?? hostName;
    out.push({
      id: value.id ?? `${host}:${value.port}`,
      name: value.name ?? hostName,
      host,
      port: value.port,
    });
  }
  const sorted = out.sort((a, b) => a.name.localeCompare(b.name));
  console.info("[cast] discoverCastDevices:done", {
    count: sorted.length,
    names: sorted.map((d) => d.name),
  });
  return sorted;
}

export async function launchSpotifyReceiverOnCastHost(
  host: string,
  timeoutMs = 7000,
): Promise<void> {
  console.info("[cast] launchSpotifyReceiverOnCastHost:start", { host, timeoutMs });
  const { Client, Application } = await import("castv2-client");
  class SpotifyReceiver extends Application {
    static APP_ID = "CC32E753";
  }

  const ip = await new Promise<string>((resolve, reject) => {
    dns.lookup(host, { family: 4 }, (err, address) => {
      if (err) reject(err);
      else resolve(address);
    });
  });
  console.info("[cast] launchSpotifyReceiverOnCastHost:resolved", { host, ip });

  await new Promise<void>((resolve, reject) => {
    const client = new Client();
    const timer = setTimeout(() => {
      try {
        client.close();
      } catch {
        // ignore
      }
      reject(new Error("cast_connect_timeout"));
    }, timeoutMs);

    client.connect(ip, () => {
      client.launch(SpotifyReceiver, () => {
        console.info("[cast] launchSpotifyReceiverOnCastHost:launched", { host, ip });
        clearTimeout(timer);
        try {
          client.close();
        } catch {
          // ignore
        }
        resolve();
      });
    });
    client.on("error", (err) => {
      console.error("[cast] launchSpotifyReceiverOnCastHost:error", {
        host,
        ip,
        error: err instanceof Error ? err.message : String(err),
      });
      clearTimeout(timer);
      try {
        client.close();
      } catch {
        // ignore
      }
      reject(err);
    });
  });
}
