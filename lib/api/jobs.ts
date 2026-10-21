/**
 * In-page job tracking — replaces lib/jobStore.ts (file-backed map),
 * lib/jobEvents.ts (server EventEmitter) and lib/kieJobPoller.ts (server-side
 * poll loop).
 *
 * Kie.ai jobs are polled from the page every 3 s. Every job is persisted in
 * the IndexedDB `jobs` table, so a reload or a reopened tab resumes polling
 * (resumePendingJobs, called at startup). Results are mirrored into OPFS and
 * written to the `generations` table exactly as the server poller did.
 */
import * as db from "@/lib/browser/db";
import { mirrorToStorage } from "@/lib/browser/media";

export type JobKind = "image" | "video";
/** kie.ai has two job APIs: the generic jobs API and Veo's own. */
export type KieApi = "jobs" | "veo";

export type JobResult =
  | { status: "pending"; type?: JobKind; userId?: string }
  | { status: "done"; imageUrl?: string; imageUrls?: string[]; videoUrl?: string }
  | { status: "error"; error: string };

type JobMeta = { provider: "kie" | "azure"; kind: JobKind; api?: KieApi };

const KIE = "https://api.kie.ai";
const POLL_INTERVAL_MS = 3_000;
const MAX_POLL_MS = 12 * 60 * 1000;

const bus = new EventTarget();
const active = new Set<string>();

// ── Store ─────────────────────────────────────────────────────────────────────

export async function getJobResult(taskId: string): Promise<JobResult | undefined> {
  const rec = await db.getJob(taskId);
  if (!rec) return undefined;
  if (rec.status === "pending") return { status: "pending", type: rec.kind as JobKind };
  return rec.result as JobResult;
}

export async function setJobResult(taskId: string, result: JobResult, meta?: JobMeta): Promise<void> {
  const prev = await db.getJob(taskId);
  await db.putJob({
    task_id: taskId,
    status: result.status,
    provider: meta?.provider ?? prev?.provider ?? "kie",
    kind: meta?.kind ?? prev?.kind,
    payload: meta?.api ? { api: meta.api } : prev?.payload,
    result: result.status === "pending" ? undefined : result,
    created_at: prev?.created_at,
  });
  if (result.status !== "pending") bus.dispatchEvent(new CustomEvent(`job:${taskId}`, { detail: result }));
}

/** Subscribe to a job's terminal result; returns an unsubscribe function. */
export function onJobSettled(taskId: string, cb: (r: JobResult) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<JobResult>).detail);
  bus.addEventListener(`job:${taskId}`, handler, { once: true });
  return () => bus.removeEventListener(`job:${taskId}`, handler);
}

// ── Kie.ai polling ────────────────────────────────────────────────────────────

/** Start polling a kie.ai job. Safe to call more than once. */
export function pollKieJob(taskId: string, apiKey: string, kind: JobKind, api: KieApi = "jobs"): void {
  if (!taskId || active.has(taskId)) return;
  active.add(taskId);
  void loop(taskId, apiKey, kind, api)
    .catch((e) => {
      console.error(`[kie-poller] ${taskId} crashed:`, e);
      return settle(taskId, kind, { status: "error", error: "Generation failed (poller error)" });
    })
    .finally(() => active.delete(taskId));
}

/** Resume polling a pending kie.ai job (after a reload). No-op if already polling or no key. */
export async function resumeKieJob(taskId: string, kind: JobKind): Promise<void> {
  if (active.has(taskId) || taskId.startsWith("azure-")) return;
  const key = await db.getKieApiToken();
  if (!key) return;
  const rec = await db.getJob(taskId);
  const api = ((rec?.payload as { api?: KieApi } | undefined)?.api ?? "jobs") as KieApi;
  pollKieJob(taskId, key, kind, api);
}

/** At startup: resume kie.ai jobs, and fail Azure jobs a reload interrupted. */
export async function resumePendingJobs(): Promise<void> {
  for (const job of await db.getPendingJobs()) {
    const kind = (job.kind as JobKind) ?? "image";
    if (job.provider === "azure") {
      await setJobResult(job.task_id, { status: "error", error: "Interrupted by a page reload — please retry." });
    } else {
      await resumeKieJob(job.task_id, kind);
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type PollOutcome = { state: "pending" } | { state: "done"; urls: string[] } | { state: "error"; error: string };

async function pollOnce(taskId: string, apiKey: string, api: KieApi): Promise<PollOutcome> {
  const path = api === "veo" ? "/api/v1/veo/record-info" : "/api/v1/jobs/recordInfo";
  const res = await fetch(`${KIE}${path}?taskId=${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const body = await res.json();
  if (body?.code !== undefined && body.code !== 200 && body.code !== 0) {
    return { state: "error", error: body.msg ?? `kie.ai error ${body.code}` };
  }
  const data = (body?.data ?? body) as Record<string, unknown>;
  return api === "veo" ? parseVeo(data) : parseJobs(data);
}

function parseJobs(data: Record<string, unknown>): PollOutcome {
  const state = String(data.state ?? data.status ?? "").toLowerCase();
  if (state === "success" || state === "succeeded") {
    const urls = extractUrls(data);
    return urls.length ? { state: "done", urls } : { state: "error", error: "Generation succeeded but returned no output" };
  }
  if (state === "fail" || state === "failed" || state === "error") {
    const msg = (data.failMsg as string) ?? (data.error as string) ?? (data.failReason as string) ?? "Generation failed";
    return { state: "error", error: msg };
  }
  return { state: "pending" }; // waiting / queuing / generating / running
}

/** Veo record-info: successFlag 0 = generating, 1 = success, 2/3 = failed. */
function parseVeo(data: Record<string, unknown>): PollOutcome {
  const flag = Number(data.successFlag ?? -1);
  if (flag === 1) {
    const response = (data.response ?? {}) as Record<string, unknown>;
    const raw = response.resultUrls ?? data.resultUrls ?? (data.info as Record<string, unknown> | undefined)?.resultUrls;
    const list = typeof raw === "string" ? safeJsonArray(raw) : Array.isArray(raw) ? raw : [];
    const urls = list.filter((u): u is string => typeof u === "string" && !!u);
    return urls.length ? { state: "done", urls } : { state: "error", error: "Generation succeeded but returned no output" };
  }
  if (flag === 2 || flag === 3) {
    return { state: "error", error: (data.errorMessage as string) || (data.msg as string) || "Generation failed" };
  }
  return { state: "pending" };
}

function safeJsonArray(s: string): unknown[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [v];
  } catch {
    return [s];
  }
}

function extractUrls(data: Record<string, unknown>): string[] {
  const out: string[] = [];
  const resultJson = data.resultJson as string | undefined;
  if (resultJson) {
    try {
      const parsed = JSON.parse(resultJson);
      const urls = parsed.resultUrls ?? parsed.resultUrl;
      if (Array.isArray(urls)) out.push(...urls.filter(Boolean));
      else if (urls) out.push(urls);
    } catch {
      /* fall through to the other shapes */
    }
  }
  if (out.length === 0 && typeof data.videoUrl === "string") out.push(data.videoUrl);
  if (out.length === 0) {
    const output = data.output as unknown;
    if (Array.isArray(output) && output[0]) out.push(String(output[0]));
    else if (typeof output === "string") out.push(output);
  }
  return out;
}

async function loop(taskId: string, apiKey: string, kind: JobKind, api: KieApi): Promise<void> {
  const deadline = Date.now() + MAX_POLL_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    let outcome: PollOutcome;
    try {
      outcome = await pollOnce(taskId, apiKey, api);
    } catch (e) {
      console.warn(`[kie-poller] ${taskId} transient poll error:`, (e as Error).message);
      continue;
    }
    if (outcome.state === "done") return settleSuccess(taskId, kind, outcome.urls);
    if (outcome.state === "error") return settle(taskId, kind, { status: "error", error: outcome.error });
  }
  // Leave the job pending: kie.ai keeps results for days, so the next reload
  // (or job-status call) resumes polling instead of losing a slow generation.
  console.warn(`[kie-poller] ${taskId} still running after ${MAX_POLL_MS / 60000} min; will resume later`);
}

async function settleSuccess(taskId: string, kind: JobKind, kieUrls: string[]): Promise<void> {
  const folder = kind === "video" ? "videos" : "images";
  const storedUrls = await Promise.all(
    kieUrls.map((u) =>
      mirrorToStorage(u, folder).catch((e) => {
        console.warn(`[kie-poller] ${taskId} mirror failed, keeping source URL:`, (e as Error).message);
        return u;
      }),
    ),
  );
  await settle(
    taskId,
    kind,
    kind === "video"
      ? { status: "done", videoUrl: storedUrls[0] }
      : { status: "done", imageUrl: storedUrls[0], imageUrls: storedUrls },
  );
}

/** Persist the result, notify listeners, and mirror into `generations`. */
async function settle(taskId: string, kind: JobKind, result: JobResult): Promise<void> {
  await setJobResult(taskId, result);
  if (result.status === "done") {
    await db.updateGeneration(
      taskId,
      kind === "video"
        ? { status: "done", video_url: result.videoUrl }
        : { status: "done", image_url: result.imageUrl, image_urls: result.imageUrls },
    );
  } else if (result.status === "error") {
    await db.updateGeneration(taskId, { status: "error", error_msg: result.error });
  }
}
