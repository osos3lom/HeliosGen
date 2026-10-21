// Port of app/api/extract-frame/route.ts and app/api/trim-video/route.ts,
// which shelled out to ffmpeg/ffprobe on the server.
import { isLocalMediaPath, readMedia, uploadBuffer } from "@/lib/browser/media";
import { errorMessage, json, type RouteModule } from "../http";

async function loadVideo(videoUrl: string): Promise<Blob> {
  if (isLocalMediaPath(videoUrl)) {
    const file = await readMedia(videoUrl);
    if (file) return file;
  }
  const res = await fetch(videoUrl);
  if (!res.ok) throw new Error(`Failed to fetch video: ${res.status}`);
  return res.blob();
}

function once<T extends Event>(el: EventTarget, ok: string, timeoutMs = 20_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timed out waiting for ${ok}`)), timeoutMs);
    el.addEventListener(ok, (e) => { clearTimeout(t); resolve(e as T); }, { once: true });
    el.addEventListener("error", () => { clearTimeout(t); reject(new Error("Video failed to load")); }, { once: true });
  });
}

/** Fast path: decode with a <video> element and grab the frame via canvas. */
async function frameViaVideo(video: Blob, timeSeconds: number, lastFrame: boolean): Promise<Blob> {
  const src = URL.createObjectURL(video);
  const v = document.createElement("video");
  try {
    v.muted = true;
    v.preload = "auto";
    v.src = src;
    await once(v, "loadedmetadata");
    const dur = Number.isFinite(v.duration) ? v.duration : undefined;
    // Clamp to 0.1 s before the end so there is always a frame to decode.
    const t = lastFrame
      ? Math.max(0, (dur ?? 0) - 0.1)
      : dur !== undefined ? Math.min(Math.max(0, timeSeconds), Math.max(0, dur - 0.1)) : Math.max(0, timeSeconds);
    v.currentTime = t;
    await once(v, "seeked");
    if (!v.videoWidth) throw new Error("Video has no decodable frames");
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext("2d")!.drawImage(v, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Frame encode failed"))), "image/jpeg", 0.92),
    );
  } finally {
    v.removeAttribute("src");
    v.load();
    URL.revokeObjectURL(src);
  }
}

/** Fallback for codecs the browser can't decode. */
async function frameViaFFmpeg(video: Blob, timeSeconds: number, lastFrame: boolean): Promise<Blob> {
  const { runFFmpeg } = await import("@/lib/browser/ffmpeg");
  const seek = lastFrame ? ["-sseof", "-0.1"] : ["-ss", String(Math.max(0, timeSeconds))];
  const out = await runFFmpeg({ "input.mp4": video }, [...seek, "-i", "input.mp4", "-frames:v", "1", "-q:v", "2", "-y", "frame.jpg"], "frame.jpg");
  return new Blob([out as BlobPart], { type: "image/jpeg" });
}

export const extractFrame: RouteModule = {
  POST: async (req) => {
    const { videoUrl, timeSeconds = 0, lastFrame = false } = (await req.json()) as {
      videoUrl?: string;
      timeSeconds?: number;
      lastFrame?: boolean;
    };
    if (!videoUrl) return json({ error: "videoUrl is required" }, 400);

    let video: Blob;
    try {
      video = await loadVideo(videoUrl);
    } catch (e) {
      return json({ error: errorMessage(e) }, 400);
    }

    let frame: Blob;
    try {
      frame = await frameViaVideo(video, timeSeconds, lastFrame);
    } catch (e) {
      console.warn("[extract-frame] <video> path failed, falling back to ffmpeg.wasm:", errorMessage(e));
      frame = await frameViaFFmpeg(video, timeSeconds, lastFrame);
    }
    return json({ cdnUrl: await uploadBuffer(frame, "image/jpeg", "references") });
  },
};

export const trimVideo: RouteModule = {
  POST: async (req) => {
    const { videoUrl, startTime, endTime } = (await req.json()) as { videoUrl?: string; startTime?: number; endTime?: number };
    if (!videoUrl || startTime === undefined || endTime === undefined) {
      return json({ error: "videoUrl, startTime and endTime are required" }, 400);
    }
    if (endTime <= startTime) return json({ error: "endTime must be greater than startTime" }, 400);

    let video: Blob;
    try {
      video = await loadVideo(videoUrl);
    } catch (e) {
      return json({ error: errorMessage(e) }, 400);
    }
    const contentType = video.type.startsWith("video/") ? video.type : "video/mp4";

    const { runFFmpeg } = await import("@/lib/browser/ffmpeg");
    // -ss before -i = fast seek; -t = duration; -c copy = no re-encode
    const out = await runFFmpeg(
      { "input.mp4": video },
      ["-ss", String(startTime), "-i", "input.mp4", "-t", String(endTime - startTime), "-c", "copy", "-avoid_negative_ts", "1", "-y", "output.mp4"],
      "output.mp4",
    );
    return json({ cdnUrl: await uploadBuffer(out, contentType, "references") });
  },
};
