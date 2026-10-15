import { sha256Hex } from "@/lib/assetHash";
import { lookupAssetHash, storeAssetHash } from "./db";

/**
 * Browser media store, backed by the Origin Private File System (OPFS).
 * Replaces the desktop app's MEDIA_DIR on disk (lib/guest/localStorage.ts).
 *
 * Files live at OPFS `generated/<folder>/<uuid>.<ext>` and are addressed by the
 * base-relative path `generated/<folder>/<file>`. Being relative, that path
 * resolves under Vite's base (e.g. /HeliosGen/) in <img>/<video>/fetch, where
 * public/media-sw.js serves it from OPFS. Older root-absolute `/generated/...`
 * paths (desktop imports, the transitional Next API) are still accepted.
 */

export const MEDIA_ROOT = "generated";
export type MediaFolder = "images" | "videos" | "uploads" | "references" | (string & {});

const LOCAL_PREFIX_RE = /^(?:[a-z]+:\/\/[^/]+)?\/?(?:.*?\/)?generated\/(.+)$/i;

/** True for any form of local media path: `generated/…`, `/generated/…`, `<base>generated/…`. */
export function isLocalMediaPath(url: unknown): boolean {
  if (typeof url !== "string") return false;
  if (url.startsWith("generated/") || url.startsWith("/generated/")) return true;
  const base = import.meta.env.BASE_URL;
  return base !== "/" && url.startsWith(base + "generated/");
}

/** `/generated/images/a.png` → `images/a.png` (the key inside OPFS `generated/`). */
export function mediaKey(url: string): string {
  const m = url.split(/[?#]/)[0].match(LOCAL_PREFIX_RE);
  if (!m) throw new Error(`Not a local media path: ${url}`);
  const key = m[1];
  if (key.split("/").some((seg) => seg === ".." || seg === "")) throw new Error(`Bad media path: ${url}`);
  return key;
}

/** Canonical stored form for a key: base-relative `generated/<key>`. */
export function mediaPath(key: string): string {
  return `${MEDIA_ROOT}/${key}`;
}

export function extForType(contentType: string): string {
  if (contentType.includes("mp4")) return "mp4";
  if (contentType.includes("webm")) return "webm";
  if (contentType.includes("png")) return "png";
  if (contentType.includes("gif")) return "gif";
  if (contentType.includes("webp")) return "webp";
  if (contentType.startsWith("audio")) {
    if (contentType.includes("mpeg")) return "mp3";
    if (contentType.includes("wav")) return "wav";
    if (contentType.includes("ogg")) return "ogg";
    return "m4a";
  }
  return "jpg";
}

// ── OPFS primitives ──────────────────────────────────────────────────────────

async function dirFor(segments: string[], create: boolean): Promise<FileSystemDirectoryHandle> {
  let dir = await navigator.storage.getDirectory();
  for (const seg of [MEDIA_ROOT, ...segments]) {
    dir = await dir.getDirectoryHandle(seg, { create });
  }
  return dir;
}

function split(key: string): { dirs: string[]; name: string } {
  const parts = key.split("/");
  return { dirs: parts.slice(0, -1), name: parts[parts.length - 1] };
}

export async function writeMedia(key: string, data: Blob): Promise<void> {
  const { dirs, name } = split(key);
  const dir = await dirFor(dirs, true);
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(data);
  } finally {
    await writable.close();
  }
}

/** Read a stored file by any local path form; null when absent. */
export async function readMedia(url: string): Promise<File | null> {
  try {
    const { dirs, name } = split(mediaKey(url));
    const dir = await dirFor(dirs, false);
    return await (await dir.getFileHandle(name)).getFile();
  } catch {
    return null;
  }
}

export async function deleteMedia(url: string): Promise<void> {
  try {
    const { dirs, name } = split(mediaKey(url));
    await (await dirFor(dirs, false)).removeEntry(name);
  } catch {
    /* already gone */
  }
}

// ── Metadata stripping ───────────────────────────────────────────────────────

/**
 * Drop EXIF/IPTC/XMP from still images by re-encoding through a canvas (the
 * browser stand-in for `sharp(buf).toBuffer()`). EXIF orientation is applied
 * first so the pixels stay upright. GIFs (possibly animated) and anything that
 * fails to decode are kept as-is. Video stripping needs ffmpeg.wasm (Phase 3).
 */
export async function stripMetadata(blob: Blob, contentType: string): Promise<Blob> {
  if (!/^image\/(jpeg|jpg|png|webp)$/.test(contentType)) return blob;
  try {
    const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
    bitmap.close();
    const type = contentType === "image/jpg" ? "image/jpeg" : contentType;
    return await canvas.convertToBlob({ type, quality: 0.95 });
  } catch {
    return blob;
  }
}

// ── Public API (same shape as lib/guest/localStorage.ts) ─────────────────────

let persistRequested: Promise<boolean> | undefined;

export async function uploadBuffer(
  data: Blob | ArrayBuffer | Uint8Array,
  contentType: string,
  folder: MediaFolder,
): Promise<string> {
  // Ask for persistence on first write rather than at startup: Firefox shows a
  // prompt for it, which should be tied to the user actually storing media.
  void (persistRequested ??= requestPersistentStorage());
  let blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type: contentType });
  blob = await stripMetadata(blob, contentType);
  const hash = await sha256Hex(await blob.arrayBuffer());
  const cached = await lookupAssetHash(hash);
  if (cached && (!isLocalMediaPath(cached) || (await readMedia(cached)))) return cached;

  const key = `${folder}/${crypto.randomUUID()}.${extForType(contentType)}`;
  await writeMedia(key, blob);
  const path = mediaPath(key);
  await storeAssetHash(hash, path, contentType, blob.size);
  return path;
}

/** Download a remote URL into OPFS. Throws if the host blocks CORS. */
export async function mirrorToStorage(url: string, folder: MediaFolder): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const blob = await res.blob();
  return uploadBuffer(blob, res.headers.get("content-type") ?? blob.type ?? "image/jpeg", folder);
}

export async function uploadDataUrl(dataUrl: string, folder: MediaFolder): Promise<string> {
  const m = dataUrl.match(/^data:([^;]+);base64,([\s\S]+)$/);
  if (!m) throw new Error("Not a valid data URL");
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return uploadBuffer(bytes, m[1], folder);
}

/**
 * Resolve any URL to a locally stored `generated/...` path: data: URLs are
 * decoded, local paths pass through, remote URLs are mirrored when CORS allows
 * (otherwise the remote URL is kept — it still renders, it just isn't local).
 */
export async function ensureStorage(url: string, folder: MediaFolder): Promise<string> {
  if (url.startsWith("data:")) return uploadDataUrl(url, folder);
  if (isLocalMediaPath(url)) return url;
  try {
    return await mirrorToStorage(url, folder);
  } catch {
    return url;
  }
}

// ── Quota ────────────────────────────────────────────────────────────────────

/** Ask the browser not to evict our data under storage pressure. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number; persisted: boolean }> {
  const [{ usage = 0, quota = 0 }, persisted] = await Promise.all([
    navigator.storage.estimate(),
    navigator.storage.persisted().catch(() => false),
  ]);
  return { usage, quota, persisted };
}
