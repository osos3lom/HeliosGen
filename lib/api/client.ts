import { errorMessage, json, type RouteModule } from "./http";

/**
 * In-browser replacement for the Next.js `/api/*` route handlers.
 *
 * `apiFetch("/api/…", init)` has the same contract as `fetch` against the old
 * server: it builds a real `Request`, dispatches it to the matching handler in
 * lib/api/handlers/ (each a port of an app/api/<route>/route.ts) and returns a
 * real `Response`. Call sites only swap `fetch` for `apiFetch`.
 *
 * Handlers are lazy-loaded so heavy dependencies (ffmpeg.wasm) stay out of the
 * main bundle. Non-`/api/` URLs fall through to the network.
 */

type Loader = () => Promise<RouteModule>;

const ROUTES: Array<[pattern: string, load: Loader]> = [
  ["/api/assets", () => import("./handlers/assets")],
  ["/api/assistant", () => import("./handlers/assistant")],
  ["/api/credit", () => import("./handlers/credit")],
  ["/api/download", () => import("./handlers/download")],
  ["/api/extract-frame", () => import("./handlers/mediaTools").then((m) => m.extractFrame)],
  ["/api/trim-video", () => import("./handlers/mediaTools").then((m) => m.trimVideo)],
  ["/api/fetch-url", () => import("./handlers/fetchUrl")],
  ["/api/folder-items", () => import("./handlers/folders").then((m) => m.folderItems)],
  ["/api/folders/:id", () => import("./handlers/folders").then((m) => m.folderById)],
  ["/api/folders", () => import("./handlers/folders").then((m) => m.folders)],
  ["/api/gallery", () => import("./handlers/gallery")],
  ["/api/generate-video", () => import("./handlers/generateVideo")],
  ["/api/generate", () => import("./handlers/generate")],
  ["/api/job-status", () => import("./handlers/jobStatus").then((m) => m.jobStatus)],
  ["/api/job-stream", () => import("./handlers/jobStatus").then((m) => m.jobStream)],
  ["/api/lookup-asset", () => import("./handlers/uploads").then((m) => m.lookupAsset)],
  ["/api/settings/azure-key", () => import("./handlers/settings").then((m) => m.azureKey)],
  ["/api/settings/kie-key", () => import("./handlers/settings").then((m) => m.kieKey)],
  ["/api/upload-asset", () => import("./handlers/uploads").then((m) => m.uploadAsset)],
  ["/api/upload-video", () => import("./handlers/uploads").then((m) => m.uploadVideo)],
  ["/api/upload", () => import("./handlers/uploads").then((m) => m.upload)],
];

function match(pathname: string): { load: Loader; params: Record<string, string> } | null {
  const segs = pathname.replace(/\/+$/, "").split("/");
  for (const [pattern, load] of ROUTES) {
    const pSegs = pattern.split("/");
    if (pSegs.length !== segs.length) continue;
    const params: Record<string, string> = {};
    const ok = pSegs.every((p, i) => {
      if (p.startsWith(":")) {
        params[p.slice(1)] = decodeURIComponent(segs[i]);
        return true;
      }
      return p === segs[i];
    });
    if (ok) return { load, params };
  }
  return null;
}

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  if (!input.startsWith("/api/")) return fetch(input, init);

  const url = new URL(input, window.location.origin);
  const route = match(url.pathname);
  if (!route) return json({ error: `No handler for ${url.pathname}` }, 404);

  const method = (init.method ?? "GET").toUpperCase() as keyof RouteModule;
  const mod = await route.load();
  const handler = mod[method];
  if (!handler) return json({ error: `${method} not allowed on ${url.pathname}` }, 405);

  try {
    // keepalive is a network-only hint; a Request rejects it with a Blob body.
    const { keepalive: _keepalive, ...rest } = init;
    return await handler(new Request(url, rest), { params: route.params, url });
  } catch (e) {
    console.error(`[api] ${method} ${url.pathname} failed:`, e);
    return json({ error: errorMessage(e) }, 500);
  }
}

/**
 * Minimal `EventSource` stand-in over `apiFetch`: reads a `text/event-stream`
 * Response and dispatches `message` events. Only what the app uses is
 * implemented (onmessage / onerror / close).
 */
export class ApiEventSource {
  onmessage: ((ev: MessageEvent<string>) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  private ctrl = new AbortController();
  private closed = false;

  constructor(path: string) {
    void this.run(path);
  }

  close(): void {
    this.closed = true;
    this.ctrl.abort();
  }

  private async run(path: string): Promise<void> {
    try {
      const res = await apiFetch(path, { signal: this.ctrl.signal });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      while (!this.closed) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const data = frame
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).replace(/^ /, ""))
            .join("\n");
          if (data && !this.closed) this.onmessage?.(new MessageEvent("message", { data }));
        }
      }
    } catch (e) {
      if (!this.closed) {
        console.warn("[api] event stream failed:", e);
        this.onerror?.(new Event("error"));
      }
    }
  }
}
