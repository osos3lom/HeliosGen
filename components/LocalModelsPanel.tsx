"use client";
// Settings → Local models: WebGPU status, storage use, and per-model
// download/delete for the on-device nodes.
import { useCallback, useEffect, useState } from "react";
import { ALL_LOCAL_MODELS, LOCAL_LLMS, LOCAL_TOOLS, type LocalModel } from "@/lib/local/catalog";
import { getGpuCapabilities, type GpuCapabilities } from "@/lib/local/capabilities";
import { deleteCachedModel, isModelCached } from "@/lib/local/modelCache";
import { preloadSdTurbo, runLocalLLM, runLocalTool, type LocalProgress } from "@/lib/local/runtime";
import { requestPersistentStorage, storageEstimate } from "@/lib/browser/media";

const fmtGB = (bytes: number) => `${(bytes / 1e9).toFixed(bytes > 1e10 ? 0 : 1)} GB`;
const fmtSize = (mb: number) => (mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${mb} MB`);

/** 1×1 transparent PNG — enough to make a tool download and compile its model. */
async function tinyImage(): Promise<Blob> {
  const c = new OffscreenCanvas(32, 32);
  c.getContext("2d")!.fillRect(0, 0, 32, 32);
  return c.convertToBlob({ type: "image/png" });
}

async function download(model: LocalModel, onProgress: (p: LocalProgress) => void): Promise<void> {
  if (model.kind === "llm") {
    const llm = LOCAL_LLMS.find((m) => m.id === model.id)!;
    await runLocalLLM({ model: llm, messages: [{ role: "user", content: "Hi" }], onProgress });
  } else if (model.kind === "image") {
    await preloadSdTurbo(onProgress);
  } else {
    const tool = LOCAL_TOOLS.find((t) => t.id === model.id)!;
    await runLocalTool({ tool, image: await tinyImage(), onProgress });
  }
}

export default function LocalModelsPanel() {
  const [caps, setCaps] = useState<GpuCapabilities | null>(null);
  const [cached, setCached] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<Record<string, LocalProgress | undefined>>({});
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [storage, setStorage] = useState<{ usage: number; quota: number; persisted: boolean } | null>(null);

  const refresh = useCallback(async () => {
    const entries = await Promise.all(ALL_LOCAL_MODELS.map(async (m) => [m.id, await isModelCached(m)] as const));
    setCached(Object.fromEntries(entries));
    setStorage(await storageEstimate().catch(() => null));
  }, []);

  useEffect(() => {
    void getGpuCapabilities().then(setCaps);
    void refresh();
  }, [refresh]);

  const onDownload = async (m: LocalModel) => {
    setErrors((e) => ({ ...e, [m.id]: undefined }));
    setBusy((b) => ({ ...b, [m.id]: { stage: "Starting" } }));
    void requestPersistentStorage();
    try {
      await download(m, (p) => setBusy((b) => ({ ...b, [m.id]: p })));
    } catch (e) {
      setErrors((x) => ({ ...x, [m.id]: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy((b) => ({ ...b, [m.id]: undefined }));
      void refresh();
    }
  };

  const onDelete = async (m: LocalModel) => {
    await deleteCachedModel(m);
    void refresh();
  };

  const groups: Array<{ title: string; kind: LocalModel["kind"] }> = [
    { title: "Text (Local LLM node)", kind: "llm" },
    { title: "Image (Local Image node)", kind: "image" },
    { title: "Tools (Local Tools node)", kind: "tool" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ padding: 14, borderRadius: 12, background: "rgba(163,230,53,0.04)", border: "1px solid rgba(163,230,53,0.14)" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.85)" }}>On-device models</div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 4, lineHeight: 1.5 }}>
          These run entirely in your browser on your GPU — prompts and images never leave this device. Weights download once from Hugging Face / MLC and are cached here.
        </div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", marginTop: 10, display: "flex", gap: 16, flexWrap: "wrap" }}>
          <span>
            WebGPU:{" "}
            {caps === null ? "checking…" : caps.supported ? (
              <span style={{ color: "#a3e635" }}>
                available · {[caps.vendor, caps.architecture].filter(Boolean).join(" ")}
                {caps.shaderF16 ? " · fp16" : ""}
                {caps.tier === "low" ? " · integrated GPU (smaller models recommended)" : ""}
              </span>
            ) : (
              <span style={{ color: "#fbbf24" }}>{caps.reason}</span>
            )}
          </span>
          {storage && (
            <span>
              Storage: {fmtGB(storage.usage)} used of {fmtGB(storage.quota)}
              {storage.persisted ? " · persistent" : ""}
            </span>
          )}
        </div>
      </div>

      {groups.map((g) => (
        <div key={g.kind} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", color: "rgba(255,255,255,0.35)" }}>{g.title.toUpperCase()}</div>
          {ALL_LOCAL_MODELS.filter((m) => m.kind === g.kind).map((m) => {
            const p = busy[m.id];
            const needsGpu = m.requiresWebGPU && caps !== null && !caps.supported;
            return (
              <div
                key={m.id}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 10, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.85)" }}>
                    {m.label} <span style={{ color: "rgba(255,255,255,0.3)" }}>· {fmtSize(m.sizeMB)}</span>
                  </div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>{m.description}</div>
                  {p && (
                    <div style={{ fontSize: 10, color: "#a3e635", marginTop: 4 }}>
                      {p.stage}
                      {p.fraction !== undefined ? ` · ${Math.round(p.fraction * 100)}%` : ""}
                    </div>
                  )}
                  {errors[m.id] && <div style={{ fontSize: 10, color: "rgba(239,68,68,0.8)", marginTop: 4 }}>{errors[m.id]}</div>}
                </div>
                {cached[m.id] ? (
                  <>
                    <span style={{ fontSize: 10, fontWeight: 600, color: "rgba(163,230,53,0.8)" }}>CACHED</span>
                    <button onClick={() => void onDelete(m)} disabled={!!p} style={btn("rgba(239,68,68,0.75)")}>
                      Delete
                    </button>
                  </>
                ) : (
                  <button onClick={() => void onDownload(m)} disabled={!!p || needsGpu} title={needsGpu ? "Needs WebGPU" : undefined} style={btn("rgba(163,230,53,0.9)")}>
                    {p ? "Downloading…" : "Download"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function btn(color: string): React.CSSProperties {
  return {
    padding: "6px 12px",
    borderRadius: 7,
    border: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(255,255,255,0.04)",
    color,
    cursor: "pointer",
    fontSize: 11,
    fontWeight: 500,
    whiteSpace: "nowrap",
  };
}
