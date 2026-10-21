/**
 * Make local media reachable by kie.ai (browser port of lib/kieUpload.ts).
 *
 * kie.ai can't fetch OPFS-backed `generated/...` paths or data: URLs, so they
 * are pushed to kie.ai's temporary file store (`file-base64-upload`, kept for
 * 3 days — long enough for a generation) and the returned downloadUrl is used.
 * The endpoint allows browser CORS (docs/web-provider-matrix.md).
 */
import { isLocalMediaPath, readMedia } from "@/lib/browser/media";

const UPLOAD_URL = "https://kieai.redpandaai.co/api/file-base64-upload";

function isRemotelyReachable(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  try {
    const { hostname } = new URL(url);
    return hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "0.0.0.0";
  } catch {
    return false;
  }
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
};

/** A local reference that kie.ai can't fetch and we must re-host. */
function isLocalMedia(url: string): boolean {
  return url.startsWith("data:") || isLocalMediaPath(url);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** Read a local media path or a data: URL into a base64 data URL. */
async function toDataUrl(input: string): Promise<string> {
  if (input.startsWith("data:")) return input;
  const file = await readMedia(input);
  if (!file) throw new Error(`Local media not found: ${input}`);
  const ext = input.split(/[?#]/)[0].split(".").pop()?.toLowerCase() ?? "";
  const mime = MIME_BY_EXT[ext] ?? (file.type || "application/octet-stream");
  return blobToDataUrl(file.type === mime ? file : new Blob([file], { type: mime }));
}

// Cache so the same reference used in several input fields uploads once.
const uploadCache = new Map<string, Promise<string>>();

async function doUpload(input: string, apiKey: string): Promise<string> {
  const base64Data = await toDataUrl(input);
  const res = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ base64Data, uploadPath: "heliosgen" }),
  });
  const body = await res.json().catch(() => null);
  const url = body?.data?.downloadUrl;
  if (!res.ok || !url) {
    throw new Error(`kie.ai file upload failed (${res.status}): ${body?.msg ?? "no downloadUrl"}`);
  }
  return url as string;
}

function uploadOne(input: string, apiKey: string): Promise<string> {
  let p = uploadCache.get(input);
  if (!p) {
    p = doUpload(input, apiKey);
    // Don't cache failures — a retry should re-attempt the upload.
    p.catch(() => uploadCache.delete(input));
    uploadCache.set(input, p);
  }
  return p;
}

/** Swap any locally hosted image for a kie.ai temporary URL; public URLs pass through. */
export async function ensureKieReachableImages(urls: string[], apiKey: string): Promise<string[]> {
  return Promise.all(urls.map((u) => (isRemotelyReachable(u) ? Promise.resolve(u) : uploadOne(u, apiKey))));
}

/**
 * Deep-walk a kie.ai `input` payload and replace every local media reference
 * (in strings, arrays and nested objects) with a kie.ai temporary URL.
 * Mutates in place. The `prompt` field is skipped — it is prose, never media.
 */
export async function rewriteLocalMediaForKie(node: unknown, apiKey: string): Promise<void> {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      if (typeof node[i] === "string" && isLocalMedia(node[i])) node[i] = await uploadOne(node[i], apiKey);
      else await rewriteLocalMediaForKie(node[i], apiKey);
    }
    return;
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === "prompt") continue;
      if (typeof value === "string" && isLocalMedia(value)) {
        (node as Record<string, unknown>)[key] = await uploadOne(value, apiKey);
      } else {
        await rewriteLocalMediaForKie(value, apiKey);
      }
    }
  }
}
