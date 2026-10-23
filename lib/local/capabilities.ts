/**
 * WebGPU capability check for the on-device nodes. Result is cached for the
 * page's lifetime (adapters don't change without a reload).
 */

export interface GpuCapabilities {
  supported: boolean;
  /** Why it isn't supported, in user-facing words. */
  reason?: string;
  vendor?: string;
  architecture?: string;
  description?: string;
  shaderF16: boolean;
  maxBufferSizeMB: number;
  /** Rough performance tier from the adapter: integrated GPUs are "low". */
  tier: "none" | "low" | "high";
}

let cached: Promise<GpuCapabilities> | null = null;

const INTEGRATED_HINT = /intel|integrated|uhd|iris|gen-\d|mali|adreno|apple/i;

export function getGpuCapabilities(): Promise<GpuCapabilities> {
  cached ??= detect();
  return cached;
}

async function detect(): Promise<GpuCapabilities> {
  const none = (reason: string): GpuCapabilities => ({ supported: false, reason, shaderF16: false, maxBufferSizeMB: 0, tier: "none" });
  const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
  if (!gpu) return none("This browser has no WebGPU. Use a recent Chrome, Edge or Safari 26+.");
  let adapter: GPUAdapter | null = null;
  try {
    adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
  } catch {
    /* handled below */
  }
  if (!adapter) return none("WebGPU is present but no GPU adapter is available (it may be disabled or blocklisted).");

  const info = adapter.info ?? ({} as GPUAdapterInfo);
  const label = `${info.vendor ?? ""} ${info.architecture ?? ""} ${info.description ?? ""}`;
  return {
    supported: true,
    vendor: info.vendor || undefined,
    architecture: info.architecture || undefined,
    description: info.description || undefined,
    shaderF16: adapter.features.has("shader-f16"),
    maxBufferSizeMB: Math.round(adapter.limits.maxBufferSize / (1024 * 1024)),
    tier: INTEGRATED_HINT.test(label) ? "low" : "high",
  };
}
