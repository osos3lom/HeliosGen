/**
 * Cached-state checks and deletion for on-device models. Each runtime keeps
 * weights in its own Cache API bucket:
 *  - WebLLM:          "webllm/*" (queried through its own helpers)
 *  - transformers.js: "transformers-cache", keyed by Hugging Face URL
 *  - SD-Turbo:        OPFS local-models/sd-turbo (streamed by our own worker,
 *                     since gigabyte files don't fit the Cache API reliably)
 */
import { LOCAL_LLMS, LOCAL_TOOLS, type LocalModel } from "./catalog";

const TRANSFORMERS_CACHE = "transformers-cache";
const HF = "https://huggingface.co/";

/** Repos fetched by transformers.js on behalf of a model (SD-Turbo's tokenizer too). */
const SD_TOKENIZER_REPO = "Xenova/clip-vit-base-patch16";

async function sdDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return (await root.getDirectoryHandle("local-models")).getDirectoryHandle("sd-turbo");
}

async function cacheHasRepo(cacheName: string, repo: string): Promise<boolean> {
  try {
    if (!(await caches.has(cacheName))) return false;
    const keys = await (await caches.open(cacheName)).keys();
    return keys.some((r) => r.url.startsWith(`${HF}${repo}/`) && /\.onnx(_data)?$/.test(new URL(r.url).pathname));
  } catch {
    return false;
  }
}

async function cacheDeleteRepo(cacheName: string, repo: string): Promise<void> {
  try {
    if (!(await caches.has(cacheName))) return;
    const cache = await caches.open(cacheName);
    for (const req of await cache.keys()) if (req.url.startsWith(`${HF}${repo}/`)) await cache.delete(req);
  } catch {
    /* nothing cached */
  }
}

export async function isModelCached(model: LocalModel): Promise<boolean> {
  if (model.kind === "llm") {
    const llm = LOCAL_LLMS.find((m) => m.id === model.id);
    if (!llm) return false;
    const { hasModelInCache } = await import("@mlc-ai/web-llm");
    const [f16, f32] = await Promise.all([
      hasModelInCache(llm.webllmF16).catch(() => false),
      hasModelInCache(llm.webllmF32).catch(() => false),
    ]);
    return f16 || f32;
  }
  if (model.kind === "image") {
    // All three ONNX graphs must be fully downloaded for SD-Turbo to run.
    try {
      const dir = await sdDir();
      for (const part of ["text_encoder", "unet", "vae_decoder"]) {
        const file = await (await dir.getFileHandle(`${part}.onnx`)).getFile();
        if (!file.size) return false;
      }
      return true;
    } catch {
      return false;
    }
  }
  const tool = LOCAL_TOOLS.find((t) => t.id === model.id);
  return tool ? cacheHasRepo(TRANSFORMERS_CACHE, tool.repo) : false;
}

export async function deleteCachedModel(model: LocalModel): Promise<void> {
  if (model.kind === "llm") {
    const llm = LOCAL_LLMS.find((m) => m.id === model.id);
    if (!llm) return;
    const { deleteModelAllInfoInCache } = await import("@mlc-ai/web-llm");
    await Promise.all([
      deleteModelAllInfoInCache(llm.webllmF16).catch(() => {}),
      deleteModelAllInfoInCache(llm.webllmF32).catch(() => {}),
    ]);
    return;
  }
  if (model.kind === "image") {
    try {
      const models = await (await navigator.storage.getDirectory()).getDirectoryHandle("local-models");
      await models.removeEntry("sd-turbo", { recursive: true });
    } catch {
      /* nothing downloaded */
    }
    await cacheDeleteRepo(TRANSFORMERS_CACHE, SD_TOKENIZER_REPO);
    return;
  }
  const tool = LOCAL_TOOLS.find((t) => t.id === model.id);
  if (tool) await cacheDeleteRepo(TRANSFORMERS_CACHE, tool.repo);
}
