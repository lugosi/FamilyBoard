declare module "castv2-client" {
  export class Application {
    static APP_ID: string;
  }

  export class Client {
    connect(options: { host: string; port?: number }, callback: () => void): void;
    launch(receiver: typeof Application, callback: (err?: unknown) => void): void;
    close(): void;
    on(event: "error", callback: (err: unknown) => void): void;
  }
}

declare module "multicast-dns" {
  type Record = { name?: string; type?: string; data?: unknown };
  type Response = { answers?: Record[]; additionals?: Record[] };
  type Query = {
    questions: Array<{ name: string; type: string }>;
  };

  type Mdns = {
    query: (q: Query) => void;
    on: (event: "response", handler: (res: Response) => void) => void;
    removeListener: (event: "response", handler: (res: Response) => void) => void;
    destroy: () => void;
  };

  export default function mdns(): Mdns;
}
