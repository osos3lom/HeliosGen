// Port of app/api/fetch-url/route.ts. The browser can only read hosts that
// allow CORS; anything else gets a clear "save it and drop it in" error.
import { GUEST_USER_ID } from "@/lib/guestMode";
import * as db from "@/lib/browser/db";
import { uploadBuffer } from "@/lib/browser/media";
import { json } from "../http";

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB

export async function POST(req: Request) {
  const { url } = (await req.json()) as { url?: string };
  if (!url || typeof url !== "string") return json({ error: "Missing url" }, 400);

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return json({ error: "Invalid URL" }, 400);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return json({ error: "Only http/https URLs are supported" }, 400);
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, { redirect: "follow" });
  } catch {
    return json(
      { error: "That site doesn't allow the browser to download its files. Save the file to your computer and drag it in instead." },
      400,
    );
  }
  if (!upstream.ok) return json({ error: `Failed to fetch URL: ${upstream.status} ${upstream.statusText}` }, 400);

  const mimeType = (upstream.headers.get("content-type") ?? "application/octet-stream").split(";")[0].trim();
  const isImage = mimeType.startsWith("image/");
  const isVideo = mimeType.startsWith("video/");
  if (!isImage && !isVideo) return json({ error: "URL does not point to an image or video" }, 400);

  const blob = await upstream.blob();
  if (blob.size > MAX_BYTES) return json({ error: "File exceeds 50 MB limit" }, 413);

  const cdnUrl = await uploadBuffer(blob, mimeType, isVideo ? "references" : "uploads");
  await db.insertUpload({ user_id: GUEST_USER_ID, r2_url: cdnUrl, mime_type: mimeType, source: "user_upload" });
  return json({ cdnUrl, mediaType: isImage ? "image" : "video" });
}
