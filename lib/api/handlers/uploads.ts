// Port of app/api/{upload,upload-asset,upload-video,lookup-asset}/route.ts.
import { GUEST_USER_ID } from "@/lib/guestMode";
import * as db from "@/lib/browser/db";
import { mirrorToStorage, uploadBuffer, uploadDataUrl } from "@/lib/browser/media";
import { errorMessage, json, type RouteModule } from "../http";

const MAX_BYTES = 100 * 1024 * 1024; // 100 MB

async function storeRawBody(req: Request, mimeType: string, folder: string): Promise<Response> {
  const blob = await req.blob();
  if (blob.size > MAX_BYTES) return json({ error: "File exceeds 100 MB limit" }, 413);
  const cdnUrl = await uploadBuffer(blob, mimeType, folder);
  await db.insertUpload({ user_id: GUEST_USER_ID, r2_url: cdnUrl, mime_type: mimeType, source: "user_upload" });
  return json({ cdnUrl });
}

/** Raw-binary upload for images and videos; Content-Type is the file's MIME type. */
export const uploadAsset: RouteModule = {
  POST: async (req) => {
    const mimeType = req.headers.get("content-type") ?? "application/octet-stream";
    return storeRawBody(req, mimeType, mimeType.startsWith("video/") ? "references" : "uploads");
  },
};

export const uploadVideo: RouteModule = {
  POST: async (req) => {
    const mimeType = req.headers.get("content-type") || "video/mp4";
    if (!mimeType.startsWith("video/")) return json({ error: "Only video files are accepted" }, 400);
    return storeRawBody(req, mimeType, "references");
  },
};

/** POST { dataUrl, folder?, mimeType? } — store a data: URL or mirror a remote URL. */
export const upload: RouteModule = {
  POST: async (req) => {
    const { dataUrl, folder = "uploads", mimeType } = (await req.json()) as {
      dataUrl: string;
      folder?: string;
      mimeType?: string;
    };
    if (!dataUrl) return json({ error: "dataUrl is required" }, 400);

    let cdnUrl: string;
    if (dataUrl.startsWith("data:")) {
      cdnUrl = await uploadDataUrl(dataUrl, folder);
    } else if (dataUrl.startsWith("http")) {
      try {
        cdnUrl = await mirrorToStorage(dataUrl, folder);
      } catch (e) {
        return json({ error: `Couldn't download that URL in the browser (the host may block cross-origin requests): ${errorMessage(e)}` }, 502);
      }
    } else {
      return json({ error: "dataUrl must be a data: or http: URL" }, 400);
    }

    await db.insertUpload({ user_id: GUEST_USER_ID, r2_url: cdnUrl, mime_type: mimeType ?? null, source: "user_upload" });
    return json({ cdnUrl });
  },
};

/** GET ?hash=<sha256hex> → { cdnUrl } when those bytes are already stored. */
export const lookupAsset: RouteModule = {
  GET: async (_req, { url }) => {
    const hash = url.searchParams.get("hash");
    if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return json({ cdnUrl: null });
    return json({ cdnUrl: await db.lookupAssetHash(hash) });
  },
};
