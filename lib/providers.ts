// ─────────────────────────────────────────────────────────────────────────────
// PROVIDERS — single source of truth for per-model backend selection
// (Kie.ai / Azure Foundry), shared by the Settings modal, the
// workflow GenerateNode, and the gallery generation composer.
// ─────────────────────────────────────────────────────────────────────────────
import { IMAGE_MODELS } from "@/lib/modelConfig";

export const PROVIDERS = [
  { id: "kie",   label: "Kie.ai" },
  { id: "azure", label: "Azure Foundry" },
] as const;

// "codex" (the desktop-only Codex CLI backend) is no longer selectable in the
// browser build; it stays in the type so older call sites still compile, and
// stored choices are migrated back to Kie.ai on load.
export type ProviderId = (typeof PROVIDERS)[number]["id"] | "codex";

const STORAGE_KEY = "aiui-model-providers";

export function loadModelProviders(): Record<string, ProviderId> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const map: Record<string, ProviderId> = raw ? JSON.parse(raw) : {};
    const legacy = Object.keys(map).filter((k) => map[k] === "codex");
    if (legacy.length) {
      for (const k of legacy) delete map[k];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    }
    return map;
  } catch {
    return {};
  }
}

export function saveModelProviders(map: Record<string, ProviderId>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    window.dispatchEvent(new CustomEvent("aiui-providers-changed"));
  } catch { /* noop */ }
}

export function getModelProvider(modelId: string): ProviderId {
  return loadModelProviders()[modelId] ?? "kie";
}

/** Persists the backend for a single model, leaving the others untouched. */
export function setModelProvider(modelId: string, provider: ProviderId) {
  const map = loadModelProviders();
  saveModelProviders({ ...map, [modelId]: provider });
}

/**
 * Models with more than one backend to choose from. Azure is image-only and
 * needs a per-model deployment configured.
 */
const MULTI_PROVIDER_MODEL_IDS = new Set(
  IMAGE_MODELS.filter((m) => !!m.azureSizeMap).map((m) => m.id),
);

export function modelHasProviderChoice(modelId: string): boolean {
  return MULTI_PROVIDER_MODEL_IDS.has(modelId);
}
