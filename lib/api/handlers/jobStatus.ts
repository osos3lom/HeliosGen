// Port of app/api/job-status/route.ts and app/api/job-stream/route.ts.
import * as db from "@/lib/browser/db";
import { getJobResult, onJobSettled, resumeKieJob, setJobResult, type JobResult } from "../jobs";
import { SSE_HEADERS, json, type RouteModule } from "../http";

const STREAM_TIMEOUT_MS = 12 * 60 * 1000;

/** Rebuild a terminal result from the `generations` table when no job record exists. */
async function recoverFromGenerations(taskId: string): Promise<JobResult | "pending" | null> {
  const gen = await db.recoverJob(taskId);
  if (!gen) return null;
  if (gen.status === "done") {
    return gen.video_url
      ? { status: "done", videoUrl: gen.video_url }
      : { status: "done", imageUrl: gen.image_url ?? undefined, imageUrls: gen.image_urls ?? undefined };
  }
  if (gen.status === "error") return { status: "error", error: gen.error_msg ?? "Generation failed" };
  return "pending";
}

export const jobStatus: RouteModule = {
  GET: async (_req, { url }) => {
    const taskId = url.searchParams.get("taskId");
    if (!taskId) return json({ error: "taskId is required" }, 400);

    const result = await getJobResult(taskId);
    if (result) {
      // Restart polling if a reload dropped the in-page poller.
      if (result.status === "pending") void resumeKieJob(taskId, result.type === "video" ? "video" : "image");
      return json(result);
    }

    if (taskId.startsWith("azure-")) return json({ status: "not_found" });

    const recovered = await recoverFromGenerations(taskId);
    if (recovered === "pending") return json({ status: "pending" });
    if (recovered) {
      await setJobResult(taskId, recovered);
      return json(recovered);
    }
    return json({ status: "not_found" });
  },
};

function sseOnce(payload: JobResult): Response {
  return new Response(`data: ${JSON.stringify(payload)}\n\n`, { headers: SSE_HEADERS });
}

export const jobStream: RouteModule = {
  GET: async (req, { url }) => {
    const taskId = url.searchParams.get("taskId");
    if (!taskId) return new Response("taskId required", { status: 400 });

    const existing = await getJobResult(taskId);
    if (existing && existing.status !== "pending") return sseOnce(existing);
    if (!existing) {
      const recovered = await recoverFromGenerations(taskId);
      if (recovered && recovered !== "pending") return sseOnce(recovered);
      if (!recovered) return sseOnce({ status: "error", error: "Job not found" });
    }

    void resumeKieJob(taskId, existing?.status === "pending" && existing.type === "image" ? "image" : "video");

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        let closed = false;
        const close = () => {
          if (closed) return;
          closed = true;
          clearTimeout(timeout);
          unsubscribe();
          controller.close();
        };
        const send = (payload: JobResult) => {
          if (closed) return;
          controller.enqueue(enc.encode(`data: ${JSON.stringify(payload)}\n\n`));
          close();
        };
        const timeout = setTimeout(() => send({ status: "error", error: "Generation timed out" }), STREAM_TIMEOUT_MS);
        const unsubscribe = onJobSettled(taskId, send);
        req.signal.addEventListener("abort", close);
        // Close the gap between the check above and subscribing.
        void getJobResult(taskId).then((r) => {
          if (r && r.status !== "pending") send(r);
        });
      },
    });
    return new Response(stream, { headers: SSE_HEADERS });
  },
};
