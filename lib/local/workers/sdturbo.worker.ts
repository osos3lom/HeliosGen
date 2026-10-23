/// <reference lib="webworker" />
/**
 * SD-Turbo text-to-image on WebGPU (onnxruntime-web), single denoising step at
 * 512×512 — the pipeline from Microsoft's onnxruntime-web SD-Turbo sample:
 *   CLIP text encoder → UNet (one Euler step from σ_max) → VAE decoder.
 * Weights (~2.5 GB fp16) are downloaded once into OPFS.
 */
import * as ort from "onnxruntime-web/webgpu";
import { AutoTokenizer, env as hfEnv } from "@huggingface/transformers";

ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/";
hfEnv.allowLocalModels = false;

const REPO_URL = "https://huggingface.co/schmuell/sd-turbo-ort-web/resolve/main/";
// OPFS location of the weights: local-models/sd-turbo/<part>.onnx
const MODEL_DIR = ["local-models", "sd-turbo"] as const;
const SIGMA = 14.6146; // σ at t=999 for SD-Turbo's scheduler
const VAE_SCALE = 0.18215;
const LATENT = [1, 4, 64, 64];

const PARTS = {
  text_encoder: { file: "text_encoder/model.onnx", dims: { batch_size: 1 } },
  unet: { file: "unet/model.onnx", dims: { batch_size: 1, num_channels: 4, height: 64, width: 64, sequence_length: 77 } },
  vae_decoder: { file: "vae_decoder/model.onnx", dims: { batch_size: 1, num_channels_latent: 4, height_latent: 64, width_latent: 64 } },
} as const;
type Part = keyof typeof PARTS;

type InMsg = { id: number; type: "load" } | { id: number; type: "generate"; prompt: string; seed: number };
type OutMsg =
  | { id: number; type: "progress"; stage: string; loaded: number; total: number }
  | { id: number; type: "done"; png?: Blob; ms?: number }
  | { id: number; type: "error"; error: string };

const post = (m: OutMsg) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

// ── Download with progress, stored in OPFS ─────────────────────────────────────
// Weights stream straight to disk (OPFS) as they download: buffering a
// gigabyte-sized file in memory and putting it into the Cache API fails.
// Files are written as `<name>.part` and renamed when complete, so a partial
// download is never mistaken for a cached model.

async function modelDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  const models = await root.getDirectoryHandle(MODEL_DIR[0], { create: true });
  return models.getDirectoryHandle(MODEL_DIR[1], { create: true });
}

/** Hugging Face connections occasionally drop at the start; retry a few times. */
async function fetchWithRetry(url: string, attempts = 4): Promise<Response> {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500 || i >= attempts) return res;
    } catch (e) {
      if (i >= attempts) throw e;
    }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
  }
}

async function fetchCached(url: string, name: string, onBytes: (loaded: number, total: number) => void): Promise<ArrayBuffer> {
  const dir = await modelDir();
  try {
    const file = await (await dir.getFileHandle(name)).getFile();
    if (file.size > 0) {
      onBytes(file.size, file.size);
      return file.arrayBuffer();
    }
  } catch {
    /* not cached yet */
  }

  const res = await fetchWithRetry(url);
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for ${url}`);
  const total = Number(res.headers.get("content-length") ?? 0);
  const partHandle = await dir.getFileHandle(`${name}.part`, { create: true });
  const writable = await partHandle.createWritable();
  let loaded = 0;
  await res.body
    .pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, ctrl) {
          loaded += chunk.byteLength;
          onBytes(loaded, total || loaded);
          ctrl.enqueue(chunk);
        },
      }),
    )
    .pipeTo(writable);
  if (total && loaded !== total) throw new Error(`Incomplete download for ${name} (${loaded} of ${total} bytes)`);

  // Rename into place; fall back to a copy where move() isn't supported.
  const movable = partHandle as FileSystemFileHandle & { move?: (name: string) => Promise<void> };
  if (movable.move) {
    await movable.move(name);
  } else {
    const final = await (await dir.getFileHandle(name, { create: true })).createWritable();
    await final.write(await partHandle.getFile());
    await final.close();
    await dir.removeEntry(`${name}.part`);
  }
  return (await (await dir.getFileHandle(name)).getFile()).arrayBuffer();
}

// ── Model state ───────────────────────────────────────────────────────────────

let sessions: Promise<Record<Part, ort.InferenceSession>> | null = null;
let tokenizer: Promise<Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>> | null = null;

function loadAll(id: number): Promise<Record<Part, ort.InferenceSession>> {
  sessions ??= (async () => {
    const out = {} as Record<Part, ort.InferenceSession>;
    for (const part of Object.keys(PARTS) as Part[]) {
      const { file, dims } = PARTS[part];
      const bytes = await fetchCached(REPO_URL + file, `${part}.onnx`, (loaded, total) => post({ id, type: "progress", stage: `Downloading ${part}`, loaded, total }));
      post({ id, type: "progress", stage: `Compiling ${part}`, loaded: 0, total: 0 });
      out[part] = await ort.InferenceSession.create(new Uint8Array(bytes), {
        executionProviders: ["webgpu"],
        enableMemPattern: false,
        enableCpuMemArena: false,
        freeDimensionOverrides: dims,
        extra: { session: { disable_prepacking: "1", use_device_allocator_for_initializers: "1", use_ort_model_bytes_directly: "1", use_ort_model_bytes_for_initializers: "1" } },
      });
    }
    return out;
  })().catch((e) => {
    sessions = null;
    throw e;
  });
  return sessions;
}

function loadTokenizer() {
  tokenizer ??= AutoTokenizer.from_pretrained("Xenova/clip-vit-base-patch16").then((t) => {
    // SD 2.x (OpenCLIP) pads with id 0, not CLIP's end-of-text id.
    (t as unknown as { pad_token_id: number }).pad_token_id = 0;
    return t;
  });
  return tokenizer;
}

// ── fp16 helpers ──────────────────────────────────────────────────────────────

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

function toHalf(v: number): number {
  f32[0] = v;
  const x = u32[0];
  const sign = (x >> 16) & 0x8000;
  let exp = ((x >> 23) & 0xff) - 127 + 15;
  let mant = x & 0x7fffff;
  if (exp <= 0) {
    if (exp < -10) return sign;
    mant = (mant | 0x800000) >> (1 - exp);
    return sign | ((mant + 0x1000) >> 13);
  }
  if (exp >= 31) return sign | 0x7c00;
  const h = sign | (exp << 10) | ((mant + 0x1000) >> 13);
  return h;
}

function fromHalf(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const exp = (h >> 10) & 0x1f;
  const mant = h & 0x3ff;
  if (exp === 0) return sign * 2 ** -14 * (mant / 1024);
  if (exp === 31) return mant ? NaN : sign * Infinity;
  return sign * 2 ** (exp - 15) * (1 + mant / 1024);
}

function toTensor(type: string, data: Float32Array, dims: number[]): ort.Tensor {
  if (type === "float16") {
    const out = new Uint16Array(data.length);
    for (let i = 0; i < data.length; i++) out[i] = toHalf(data[i]);
    return new ort.Tensor("float16", out, dims);
  }
  return new ort.Tensor("float32", data, dims);
}

function toFloat32(t: ort.Tensor): Float32Array {
  if (t.type === "float16") {
    const src = t.data as Uint16Array;
    const out = new Float32Array(src.length);
    for (let i = 0; i < src.length; i++) out[i] = fromHalf(src[i]);
    return out;
  }
  return t.data as Float32Array;
}

/** Declared element type of a session input (defaults to float16, as exported). */
function inputType(s: ort.InferenceSession, name: string): string {
  const meta = s.inputMetadata?.find((m) => m.name === name);
  return meta && meta.isTensor ? meta.type : "float16";
}

// Seeded Gaussian noise (mulberry32 + Box–Muller) so a seed reproduces an image.
function randn(n: number, seed: number): Float32Array {
  let a = seed >>> 0 || 1;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 2) {
    const u = Math.max(rand(), 1e-12);
    const v = rand();
    const r = Math.sqrt(-2 * Math.log(u));
    out[i] = r * Math.cos(2 * Math.PI * v);
    if (i + 1 < n) out[i + 1] = r * Math.sin(2 * Math.PI * v);
  }
  return out;
}

// ── Generation ────────────────────────────────────────────────────────────────

async function generate(id: number, prompt: string, seed: number): Promise<Blob> {
  const [s, tok] = await Promise.all([loadAll(id), loadTokenizer()]);
  post({ id, type: "progress", stage: "Generating", loaded: 0, total: 0 });

  const encoded = await tok(prompt, { padding: "max_length", max_length: 77, truncation: true, return_tensor: false });
  const ids = (encoded as unknown as { input_ids: number[] }).input_ids;
  const idsType = inputType(s.text_encoder, s.text_encoder.inputNames[0]);
  const idsTensor =
    idsType === "int64"
      ? new ort.Tensor("int64", BigInt64Array.from(ids.map((v) => BigInt(v))), [1, ids.length])
      : new ort.Tensor("int32", Int32Array.from(ids), [1, ids.length]);
  const textOut = await s.text_encoder.run({ [s.text_encoder.inputNames[0]]: idsTensor });
  let hidden = textOut[s.text_encoder.outputNames[0]];

  // Initial latent: N(0, σ²), then scaled for the model input (÷ √(σ²+1)).
  const n = LATENT.reduce((a, b) => a * b, 1);
  const noise = randn(n, seed);
  const latent = new Float32Array(n);
  const modelIn = new Float32Array(n);
  const inScale = 1 / Math.sqrt(SIGMA * SIGMA + 1);
  for (let i = 0; i < n; i++) {
    latent[i] = noise[i] * SIGMA;
    modelIn[i] = latent[i] * inScale;
  }

  const sampleType = inputType(s.unet, "sample");
  const hiddenType = inputType(s.unet, "encoder_hidden_states");
  if (hidden.type !== hiddenType) hidden = toTensor(hiddenType, toFloat32(hidden), [...hidden.dims]);
  const tType = inputType(s.unet, "timestep");
  const timestep =
    tType === "int64" ? new ort.Tensor("int64", BigInt64Array.from([999n]), [1])
    : tType === "float32" ? new ort.Tensor("float32", Float32Array.from([999]), [1])
    : new ort.Tensor("float16", Uint16Array.from([toHalf(999)]), [1]);

  const unetOut = await s.unet.run({ sample: toTensor(sampleType, modelIn, LATENT), timestep, encoder_hidden_states: hidden });
  const eps = toFloat32(unetOut[s.unet.outputNames[0]]);

  // One Euler step from σ to 0 lands on the predicted clean latent: x₀ = x − σ·ε.
  const vaeIn = new Float32Array(n);
  for (let i = 0; i < n; i++) vaeIn[i] = (latent[i] - SIGMA * eps[i]) / VAE_SCALE;

  const vaeName = s.vae_decoder.inputNames[0];
  const vaeOut = await s.vae_decoder.run({ [vaeName]: toTensor(inputType(s.vae_decoder, vaeName), vaeIn, LATENT) });
  const pixels = toFloat32(vaeOut[s.vae_decoder.outputNames[0]]); // [1,3,512,512] in [-1, 1]

  const W = 512, H = 512, plane = W * H;
  const rgba = new Uint8ClampedArray(plane * 4);
  for (let p = 0; p < plane; p++) {
    for (let c = 0; c < 3; c++) rgba[p * 4 + c] = Math.round((pixels[c * plane + p] / 2 + 0.5) * 255);
    rgba[p * 4 + 3] = 255;
  }
  const canvas = new OffscreenCanvas(W, H);
  canvas.getContext("2d")!.putImageData(new ImageData(rgba, W, H), 0, 0);
  return canvas.convertToBlob({ type: "image/png" });
}

self.onmessage = async (e: MessageEvent<InMsg>) => {
  const msg = e.data;
  try {
    if (msg.type === "load") {
      await Promise.all([loadAll(msg.id), loadTokenizer()]);
      post({ id: msg.id, type: "done" });
    } else {
      const t0 = performance.now();
      const png = await generate(msg.id, msg.prompt, msg.seed);
      post({ id: msg.id, type: "done", png, ms: Math.round(performance.now() - t0) });
    }
  } catch (err) {
    post({ id: msg.id, type: "error", error: err instanceof Error ? err.message : String(err) });
  }
};
