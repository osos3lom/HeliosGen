import { ALL_LOCAL_MODELS, LOCAL_MODEL_PREFIX } from "./catalog";

/**
 * Human-readable model name for gallery items. On-device results are stored
 * as `local/<id>` and shown as e.g. "SD-Turbo · Local GPU"; anything else is
 * returned unchanged.
 */
export function displayModelName(model: string | undefined): string | undefined {
  if (!model?.startsWith(LOCAL_MODEL_PREFIX)) return model;
  const id = model.slice(LOCAL_MODEL_PREFIX.length);
  const label = ALL_LOCAL_MODELS.find((m) => m.id === id)?.label ?? id;
  return `${label} · Local GPU`;
}
