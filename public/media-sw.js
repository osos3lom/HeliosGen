/* HeliosGen media service worker.
 *
 * Serves `<base>generated/<folder>/<file>` from the Origin Private File System,
 * where lib/browser/media.ts stores generated and uploaded media. This is the
 * browser replacement for the desktop app's app/generated/[...path]/route.ts.
 *
 * Range requests are honoured so <video> can seek. Anything not found in OPFS
 * falls through to the network (during the transition, the Vite dev server
 * proxies /generated to the legacy Next API).
 */

const CONTENT_TYPES = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
};

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

function scopePath() {
  return new URL(self.registration.scope).pathname; // always ends with "/"
}

async function readFromOpfs(key) {
  const parts = key.split("/");
  if (parts.some((p) => p === "" || p === "..")) return null;
  try {
    let dir = await navigator.storage.getDirectory();
    dir = await dir.getDirectoryHandle("generated");
    for (const seg of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(seg);
    return await (await dir.getFileHandle(parts[parts.length - 1])).getFile();
  } catch {
    return null;
  }
}

function fileResponse(file, key, rangeHeader) {
  const ext = key.split(".").pop().toLowerCase();
  const type = CONTENT_TYPES[ext] || file.type || "application/octet-stream";
  const size = file.size;
  const common = {
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-cache",
  };

  const m = rangeHeader && /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (m && (m[1] || m[2])) {
    let start, end;
    if (m[1] === "") {
      // Suffix range: last N bytes.
      start = Math.max(0, size - Number(m[2]));
      end = size - 1;
    } else {
      start = Number(m[1]);
      end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
    }
    if (start >= size || start > end) {
      return new Response(null, { status: 416, headers: { ...common, "Content-Range": `bytes */${size}` } });
    }
    return new Response(file.slice(start, end + 1), {
      status: 206,
      headers: {
        ...common,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${size}`,
      },
    });
  }

  return new Response(file, { status: 200, headers: { ...common, "Content-Length": String(size) } });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" && req.method !== "HEAD") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const prefix = scopePath() + "generated/";
  if (!url.pathname.startsWith(prefix)) return;

  const key = decodeURIComponent(url.pathname.slice(prefix.length));
  event.respondWith(
    (async () => {
      const file = await readFromOpfs(key);
      if (!file) return fetch(req);
      const res = fileResponse(file, key, req.headers.get("range"));
      return req.method === "HEAD" ? new Response(null, { status: res.status, headers: res.headers }) : res;
    })(),
  );
});
