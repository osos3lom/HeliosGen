/**
 * Main-thread API for the on-device models. Each model family runs in its own
 * Web Worker (lib/local/workers/*) so the canvas stays responsive; calls are
 * queued per family because each worker holds one GPU context.
 */
import type { MLCEngineInterface, ChatCompletionMessageParam } from "@mlc-ai/web-llm";
import * as db from "@/lib/browser/db";
import { uploadBuffer } from "@/lib/browser/media";
import { GUEST_USER_ID } from "@/lib/guestMode";
import { getGpuCapabilities } from "./capabilities";
import { LOCAL_MODEL_PREFIX, type LocalLLM, type LocalTool } from "./catalog";

/** `fraction` is 0–1 when the stage has measurable progress. */
export type LocalProgress = { stage: string; fraction?: number };
type OnProgress = (p: LocalProgress) => void;

// ── Per-family serial queue ────────────────────────────────────────────────────

function serialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(job: () => Promise<T>): Promise<T> => {
    const next = tail.then(job, job);
    tail = next.catch(() => {});
    return next;
  };
}
const llmQueue = serialQueue();
const sdQueue = serialQueue();
const toolQueue = serialQueue();

// ── Generic worker RPC ────────────────────────────────────────────────────────

type WorkerReply =
  | { id: number; type: "progress"; stage: string; loaded: number; total: number }
  | { id: number; type: "done"; [k: string]: unknown }
  | { id: number; type: "error"; error: string; gpuFailed?: boolean };

/** Rejection from a worker; `gpuFailed` means the same job may succeed on WASM. */
export class LocalWorkerError extends Error {
  constructor(message: string, readonly gpuFailed = false) {
    super(message);
  }
}

function rpcWorker(create: () => Worker) {
  let worker: Worker | null = null;
  let seq = 0;
  const pending = new Map<number, { resolve: (v: WorkerReply) => void; reject: (e: Error) => void; onProgress?: OnProgress }>();
  const get = () => {
    if (worker) return worker;
    worker = create();
    worker.onmessage = (e: MessageEvent<WorkerReply>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      if (e.data.type === "progress") {
        const { stage, loaded, total } = e.data;
        p.onProgress?.({ stage, fraction: total > 0 ? loaded / total : undefined });
      } else {
        pending.delete(e.data.id);
        if (e.data.type === "error") p.reject(new LocalWorkerError(e.data.error, e.data.gpuFailed));
        else p.resolve(e.data);
      }
    };
    worker.onerror = (e) => {
      for (const p of pending.values()) p.reject(new Error(e.message || "Local model worker crashed"));
      pending.clear();
      worker?.terminate();
      worker = null; // recreate on next call
    };
    return worker;
  };
  const call = (msg: Record<string, unknown>, onProgress?: OnProgress): Promise<WorkerReply> =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject, onProgress });
      get().postMessage({ ...msg, id });
    });
  /** Drop the worker (and its GPU state); the next call starts a fresh one. */
  call.reset = () => {
    worker?.terminate();
    worker = null;
    for (const p of pending.values()) p.reject(new Error("Local model worker was restarted"));
    pending.clear();
  };
  return call;
}

const sdCall = rpcWorker(() => new Worker(new URL("./workers/sdturbo.worker.ts", import.meta.url), { type: "module" }));
const newToolWorker = () => new Worker(new URL("./workers/tools.worker.ts", import.meta.url), { type: "module" });
const toolCallGpu = rpcWorker(newToolWorker);
const toolCallCpu = rpcWorker(newToolWorker);

// Tool repos that failed on this device's GPU; remembered so later runs go
// straight to the CPU worker.
const CPU_ONLY_KEY = "heliosgen-local-cpu-only";
function cpuOnlyRepos(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(CPU_ONLY_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}
function markCpuOnly(repo: string): void {
  try {
    localStorage.setItem(CPU_ONLY_KEY, JSON.stringify([...cpuOnlyRepos().add(repo)]));
  } catch {
    /* storage unavailable: the fallback just reruns next time */
  }
}

async function requireWebGPU(): Promise<void> {
  const caps = await getGpuCapabilities();
  if (!caps.supported) throw new Error(caps.reason ?? "WebGPU is not available");
}

// ── Local LLM (WebLLM) ────────────────────────────────────────────────────────

let engine: Promise<MLCEngineInterface> | null = null;
let engineModel: string | null = null;
let llmProgress: OnProgress | undefined;

async function getEngine(webllmId: string): Promise<MLCEngineInterface> {
  const initProgressCallback = (r: { progress: number; text: string }) =>
    llmProgress?.({ stage: r.text.replace(/\s*\[.*?\]\s*/g, " ").trim() || "Loading model", fraction: r.progress });
  if (!engine) {
    engineModel = webllmId;
    engine = import("@mlc-ai/web-llm")
      .then(({ CreateWebWorkerMLCEngine }) =>
        CreateWebWorkerMLCEngine(new Worker(new URL("./workers/llm.worker.ts", import.meta.url), { type: "module" }), webllmId, {
          initProgressCallback,
        }),
      )
      .catch((e) => {
        engine = null;
        engineModel = null;
        throw e;
      });
    return engine;
  }
  const e = await engine;
  if (engineModel !== webllmId) {
    engineModel = webllmId;
    await e.reload(webllmId);
  }
  return e;
}

export function runLocalLLM(opts: {
  model: LocalLLM;
  messages: ChatCompletionMessageParam[];
  onToken?: (textSoFar: string) => void;
  onProgress?: OnProgress;
  signal?: AbortSignal;
}): Promise<string> {
  return llmQueue(async () => {
    await requireWebGPU();
    const { shaderF16 } = await getGpuCapabilities();
    llmProgress = opts.onProgress;
    try {
      const e = await getEngine(shaderF16 ? opts.model.webllmF16 : opts.model.webllmF32);
      opts.onProgress?.({ stage: "Generating" });
      const onAbort = () => e.interruptGenerate();
      opts.signal?.addEventListener("abort", onAbort);
      try {
        const stream = await e.chat.completions.create({ messages: opts.messages, stream: true, temperature: 0.7, max_tokens: 1024 });
        let text = "";
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content ?? "";
          if (delta) {
            text += delta;
            opts.onToken?.(text);
          }
        }
        return text;
      } finally {
        opts.signal?.removeEventListener("abort", onAbort);
      }
    } finally {
      llmProgress = undefined;
    }
  });
}

// ── Local text-to-image (SD-Turbo) ────────────────────────────────────────────

export function runSdTurbo(opts: { prompt: string; seed: number; onProgress?: OnProgress }): Promise<{ png: Blob; ms: number }> {
  return sdQueue(async () => {
    await requireWebGPU();
    const r = (await sdCall({ type: "generate", prompt: opts.prompt, seed: opts.seed }, opts.onProgress)) as unknown as { png: Blob; ms: number };
    return { png: r.png, ms: r.ms };
  });
}

/** Download + compile SD-Turbo without generating (Settings → Local models). */
export function preloadSdTurbo(onProgress?: OnProgress): Promise<void> {
  return sdQueue(async () => {
    await requireWebGPU();
    await sdCall({ type: "load" }, onProgress);
  });
}

// ── Local image tools (transformers.js) ───────────────────────────────────────

export function runLocalTool(opts: { tool: LocalTool; image: Blob; onProgress?: OnProgress }): Promise<{ image?: Blob; text?: string; device: string }> {
  type ToolResult = { image?: Blob; text?: string; device: string };
  return toolQueue(async () => {
    const { supported } = await getGpuCapabilities();
    const msg = { mode: opts.tool.mode, repo: opts.tool.repo, image: opts.image };
    if (supported && !opts.tool.cpuOnly && !cpuOnlyRepos().has(opts.tool.repo)) {
      try {
        return (await toolCallGpu({ ...msg, webgpu: true }, opts.onProgress)) as unknown as ToolResult;
      } catch (e) {
        if (!(e instanceof LocalWorkerError && e.gpuFailed)) throw e;
        console.warn(`[local] ${opts.tool.repo} failed on WebGPU, using CPU from now on:`, e.message);
        markCpuOnly(opts.tool.repo);
        // A failed WebGPU run can leave ONNX Runtime's device state broken for
        // every later model in that worker, so start the GPU worker over.
        toolCallGpu.reset();
        opts.onProgress?.({ stage: "This GPU can't run this model — switching to CPU" });
      }
    }
    return (await toolCallCpu({ ...msg, webgpu: false }, opts.onProgress)) as unknown as ToolResult;
  });
}

// ── Results ───────────────────────────────────────────────────────────────────

/** Store a locally generated image in OPFS and the gallery (`local/<model>`). */
export async function saveLocalImage(png: Blob, opts: { modelId: string; prompt?: string; referenceUrls?: string[] }): Promise<string> {
  const imageUrl = await uploadBuffer(png, "image/png", "images");
  await db.insertGeneration({
    task_id: `local-${crypto.randomUUID()}`,
    user_id: GUEST_USER_ID,
    generation_type: "image",
    status: "done",
    image_url: imageUrl,
    image_urls: [imageUrl],
    prompt: opts.prompt?.slice(0, 2000),
    model: `${LOCAL_MODEL_PREFIX}${opts.modelId}`,
    aspect_ratio: "1:1",
    reference_image_urls: opts.referenceUrls,
  });
  return imageUrl;
}
