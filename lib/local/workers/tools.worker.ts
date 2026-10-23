/// <reference lib="webworker" />
/**
 * On-device image tools via transformers.js: background removal (RMBG-1.4),
 * 2×/4× super-resolution (Swin2SR) and captioning (Florence-2). The runtime
 * runs one instance on WebGPU and, for models a GPU can't handle (or browsers
 * without WebGPU), a second instance on WASM.
 */
import {
  AutoModel,
  AutoProcessor,
  Florence2ForConditionalGeneration,
  RawImage,
  env,
  pipeline,
  type ProgressInfo,
} from "@huggingface/transformers";

env.allowLocalModels = false;

type Mode = "remove-bg" | "upscale-2x" | "upscale-4x" | "caption";
type InMsg = { id: number; mode: Mode; repo: string; image: Blob; webgpu: boolean };
type OutMsg =
  | { id: number; type: "progress"; stage: string; loaded: number; total: number }
  | { id: number; type: "done"; image?: Blob; text?: string; device: string }
  | { id: number; type: "error"; error: string; gpuFailed?: boolean };

const post = (m: OutMsg) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

// One loaded pipeline/model per repo, reused across runs.
const loaded = new Map<string, Promise<unknown>>();

function progressFor(id: number) {
  return (p: ProgressInfo) => {
    if (p.status === "progress_total") post({ id, type: "progress", stage: "Downloading model", loaded: p.loaded, total: p.total });
  };
}

function load<T>(key: string, factory: () => Promise<T>): Promise<T> {
  let p = loaded.get(key) as Promise<T> | undefined;
  if (!p) {
    p = factory();
    p.catch(() => loaded.delete(key));
    loaded.set(key, p);
  }
  return p;
}

async function run(msg: InMsg): Promise<OutMsg> {
  try {
    return await runOn(msg, msg.webgpu);
  } catch (err) {
    // transformers.js can't mix WebGPU and WASM sessions in one worker, so a
    // WebGPU failure is reported back and the runtime retries on its CPU worker.
    const error = err instanceof Error ? err.message : String(err);
    // Network/download problems aren't the GPU's fault; don't demote the model.
    const networkish = /fetch|network|download|HTTP \d|Failed to load/i.test(error);
    return { id: msg.id, type: "error", error, gpuFailed: msg.webgpu && !networkish };
  }
}

async function runOn(msg: InMsg, webgpu: boolean): Promise<OutMsg> {
  const device = webgpu ? "webgpu" : "wasm";
  const progress_callback = progressFor(msg.id);
  const image = await RawImage.fromBlob(msg.image);

  if (msg.mode === "remove-bg") {
    // RMBG-1.4 isn't a registered segmentation architecture, so it's loaded as
    // a plain model with its published preprocessing (the transformers.js recipe).
    const [model, processor] = (await load(`rmbg:${msg.repo}:${device}`, () =>
      Promise.all([
        AutoModel.from_pretrained(msg.repo, {
          config: { model_type: "custom" } as never,
          device,
          dtype: webgpu ? "fp16" : "q8",
          progress_callback,
        }),
        AutoProcessor.from_pretrained(msg.repo, {
          config: {
            do_normalize: true,
            do_pad: false,
            do_rescale: true,
            do_resize: true,
            image_mean: [0.5, 0.5, 0.5],
            feature_extractor_type: "ImageFeatureExtractor",
            image_std: [1, 1, 1],
            resample: 2,
            rescale_factor: 1 / 255,
            size: { width: 1024, height: 1024 },
          },
        } as never),
      ]),
    )) as [(i: Record<string, unknown>) => Promise<{ output: { [k: number]: { mul(n: number): { to(t: string): unknown } } } }>, (img: RawImage) => Promise<{ pixel_values: unknown }>];
    post({ id: msg.id, type: "progress", stage: "Processing", loaded: 0, total: 0 });
    const { pixel_values } = await processor(image);
    const { output } = await model({ input: pixel_values });
    const mask = await RawImage.fromTensor(output[0].mul(255).to("uint8") as never).resize(image.width, image.height);
    const cut = image.rgba().putAlpha(mask);
    return { id: msg.id, type: "done", image: (await cut.toBlob("image/png")) as Blob, device };
  }

  if (msg.mode === "upscale-2x" || msg.mode === "upscale-4x") {
    const task = "image-to-image";
    const pipe = (await load(`${task}:${msg.repo}:${device}`, () =>
      pipeline(task, msg.repo, { device, dtype: webgpu ? "fp16" : "fp32", progress_callback }),
    )) as (img: RawImage) => Promise<RawImage | RawImage[]>;
    post({ id: msg.id, type: "progress", stage: "Processing", loaded: 0, total: 0 });
    const out = await pipe(image);
    const result = Array.isArray(out) ? out[0] : out;
    return { id: msg.id, type: "done", image: (await result.toBlob("image/png")) as Blob, device };
  }

  // Captioning: Florence-2 with the detailed-caption task.
  const [model, processor] = (await load(`florence:${msg.repo}:${device}`, () =>
    Promise.all([
      Florence2ForConditionalGeneration.from_pretrained(msg.repo, {
        device,
        dtype: webgpu
          ? { embed_tokens: "fp16", vision_encoder: "fp16", encoder_model: "q4", decoder_model_merged: "q4" }
          : "q8",
        progress_callback,
      }),
      AutoProcessor.from_pretrained(msg.repo),
    ]),
  )) as [Florence2ForConditionalGeneration, Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>];

  post({ id: msg.id, type: "progress", stage: "Describing image", loaded: 0, total: 0 });
  const task = "<MORE_DETAILED_CAPTION>";
  const proc = processor as unknown as {
    construct_prompts(t: string): string[];
    (img: RawImage, prompts: string[]): Promise<Record<string, unknown>>;
    batch_decode(ids: unknown, opts: { skip_special_tokens: boolean }): string[];
    post_process_generation(text: string, task: string, size: [number, number]): Record<string, string>;
  };
  const inputs = await proc(image, proc.construct_prompts(task));
  const ids = await (model as unknown as { generate(o: Record<string, unknown>): Promise<unknown> }).generate({ ...inputs, max_new_tokens: 160 });
  const raw = proc.batch_decode(ids, { skip_special_tokens: false })[0];
  const text = proc.post_process_generation(raw, task, image.size as [number, number])[task] ?? raw;
  return { id: msg.id, type: "done", text: String(text).trim(), device };
}

self.onmessage = async (e: MessageEvent<InMsg>) => {
  try {
    post(await run(e.data));
  } catch (err) {
    post({ id: e.data.id, type: "error", error: err instanceof Error ? err.message : String(err) });
  }
};
