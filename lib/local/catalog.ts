/**
 * Catalog of on-device models (WebGPU). Weights download on first use from
 * the model hosts below and are cached by the browser (Cache API), so later
 * runs work offline. Sizes are approximate download sizes.
 */

export type LocalModelKind = "llm" | "image" | "tool";
export type ToolMode = "remove-bg" | "upscale-2x" | "upscale-4x" | "caption";

export interface LocalModel {
  id: string;
  kind: LocalModelKind;
  label: string;
  /** Approximate download size in MB. */
  sizeMB: number;
  description: string;
  /** Needs WebGPU (LLM/image) or can fall back to WASM (tools). */
  requiresWebGPU: boolean;
}

export interface LocalLLM extends LocalModel {
  kind: "llm";
  /** WebLLM prebuilt model ids: f16 variant needs the shader-f16 feature. */
  webllmF16: string;
  webllmF32: string;
}

export interface LocalTool extends LocalModel {
  kind: "tool";
  mode: ToolMode;
  /** Hugging Face repo loaded by transformers.js. */
  repo: string;
  /**
   * Skip WebGPU for this model. Swin2SR's ONNX export names its output dims
   * after the input's, so ONNX Runtime's WebGPU backend reuses a wrong-sized
   * buffer on any GPU; it only runs correctly on the WASM backend.
   */
  cpuOnly?: boolean;
}

export const LOCAL_LLMS: LocalLLM[] = [
  {
    id: "qwen2.5-0.5b",
    kind: "llm",
    label: "Qwen2.5 0.5B",
    sizeMB: 400,
    description: "Smallest and fastest — fine for prompt rewriting on integrated GPUs.",
    requiresWebGPU: true,
    webllmF16: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
    webllmF32: "Qwen2.5-0.5B-Instruct-q4f32_1-MLC",
  },
  {
    id: "qwen2.5-1.5b",
    kind: "llm",
    label: "Qwen2.5 1.5B",
    sizeMB: 1100,
    description: "Better prompts; good default on a dedicated GPU.",
    requiresWebGPU: true,
    webllmF16: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    webllmF32: "Qwen2.5-1.5B-Instruct-q4f32_1-MLC",
  },
  {
    id: "llama-3.2-3b",
    kind: "llm",
    label: "Llama 3.2 3B",
    sizeMB: 2300,
    description: "Highest quality here; needs ~3 GB of GPU memory.",
    requiresWebGPU: true,
    webllmF16: "Llama-3.2-3B-Instruct-q4f16_1-MLC",
    webllmF32: "Llama-3.2-3B-Instruct-q4f32_1-MLC",
  },
];

export const SD_TURBO: LocalModel & { repo: string } = {
  id: "sd-turbo",
  kind: "image",
  label: "SD-Turbo",
  sizeMB: 2500,
  description: "Single-step 512×512 text-to-image (Stability AI SD-Turbo, ONNX fp16).",
  requiresWebGPU: true,
  repo: "schmuell/sd-turbo-ort-web",
};

export const LOCAL_TOOLS: LocalTool[] = [
  {
    id: "rmbg-1.4",
    kind: "tool",
    mode: "remove-bg",
    label: "Remove background",
    sizeMB: 88,
    description: "BRIA RMBG-1.4 — cut the subject out onto a transparent background.",
    requiresWebGPU: false,
    repo: "briaai/RMBG-1.4",
  },
  {
    id: "swin2sr-x2",
    kind: "tool",
    mode: "upscale-2x",
    label: "Upscale 2×",
    sizeMB: 54,
    description: "Swin2SR classical super-resolution, 2× (runs on CPU — best for small images).",
    requiresWebGPU: false,
    repo: "Xenova/swin2SR-classical-sr-x2-64",
    cpuOnly: true,
  },
  {
    id: "swin2sr-x4",
    kind: "tool",
    mode: "upscale-4x",
    label: "Upscale 4×",
    sizeMB: 55,
    description: "Swin2SR classical super-resolution, 4× (runs on CPU — best for small images).",
    requiresWebGPU: false,
    repo: "Xenova/swin2SR-classical-sr-x4-64",
    cpuOnly: true,
  },
  {
    id: "florence2-base",
    kind: "tool",
    mode: "caption",
    label: "Describe image",
    sizeMB: 300,
    description: "Florence-2 base — writes a detailed caption you can use as a prompt.",
    requiresWebGPU: false,
    repo: "onnx-community/Florence-2-base-ft",
  },
];

export const ALL_LOCAL_MODELS: LocalModel[] = [...LOCAL_LLMS, SD_TURBO, ...LOCAL_TOOLS];

export function toolForMode(mode: ToolMode): LocalTool {
  return LOCAL_TOOLS.find((t) => t.mode === mode) ?? LOCAL_TOOLS[0];
}

export function llmById(id: string | undefined): LocalLLM {
  return LOCAL_LLMS.find((m) => m.id === id) ?? LOCAL_LLMS[0];
}

/** Gallery model ids for local outputs: `local/<id>`. */
export const LOCAL_MODEL_PREFIX = "local/";
export const isLocalModelId = (model: string | undefined) => !!model?.startsWith(LOCAL_MODEL_PREFIX);
