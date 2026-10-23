"use client";
// Settings → Data: bring a desktop-app library into this browser.
import { useRef, useState } from "react";
import { importDesktopExport, type ImportProgress, type ImportSummary } from "@/lib/browser/importDesktop";
import { requestPersistentStorage } from "@/lib/browser/media";
import { galleryCache } from "@/lib/galleryUtils";
import { useFolderStore } from "@/lib/folderStore";
import { useWorkflowStore, type Space } from "@/lib/store";

const card: React.CSSProperties = {
  padding: 16,
  borderRadius: 12,
  background: "rgba(255,255,255,0.02)",
  border: "1px solid rgba(255,255,255,0.07)",
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

export default function DataImportPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = progress !== null;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setSummary(null);
    setProgress({ stage: "Starting" });
    void requestPersistentStorage();
    try {
      const result = await importDesktopExport(file, setProgress);
      // Refresh in-memory stores so the import shows up without a reload.
      if (result.addedSpaces.length) useWorkflowStore.getState().loadSpacesFromDB(result.addedSpaces as unknown as Space[]);
      await useFolderStore.getState().loadFromServer();
      if (result.keys) useWorkflowStore.getState().setKieKeySet(true);
      galleryCache.clear();
      setSummary(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const pct = progress?.fraction !== undefined ? Math.round(progress.fraction * 100) : undefined;
  const row = (label: string, r: { added: number; skipped: number }) => (
    <div style={{ display: "flex", justifyContent: "space-between" }}>
      <span>{label}</span>
      <span style={{ color: "rgba(255,255,255,0.5)" }}>
        {r.added} added{r.skipped ? ` · ${r.skipped} already here` : ""}
      </span>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.85)" }}>Import desktop data</div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", lineHeight: 1.6 }}>
          Move your gallery, uploads, folders and workflows from the HeliosGen desktop app into this browser.
          <ol style={{ margin: "8px 0 0 16px", padding: 0 }}>
            <li>Quit the desktop app.</li>
            <li>
              In a HeliosGen checkout, run{" "}
              <code style={{ fontFamily: "var(--font-geist-mono), monospace", color: "rgba(255,255,255,0.75)" }}>node scripts/export-desktop-data.mjs</code>{" "}
              — it finds the desktop library and writes <code style={{ fontFamily: "var(--font-geist-mono), monospace" }}>heliosgen-export-&lt;date&gt;.zip</code>.
            </li>
            <li>Choose that zip below.</li>
          </ol>
        </div>
        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", lineHeight: 1.5 }}>
          Importing only adds: anything already in this browser is kept. API keys are left out of exports unless you pass{" "}
          <code style={{ fontFamily: "var(--font-geist-mono), monospace" }}>--include-keys</code>. Everything stays on this device.
        </div>

        <input ref={inputRef} type="file" accept=".zip,application/zip" style={{ display: "none" }} onChange={(e) => void onFile(e.target.files?.[0])} />
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            id="data-import-choose"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            style={{
              padding: "7px 14px",
              borderRadius: 7,
              border: "1px solid rgba(45,212,191,0.35)",
              background: "rgba(45,212,191,0.1)",
              color: "rgba(45,212,191,0.95)",
              cursor: busy ? "default" : "pointer",
              fontSize: 12,
              fontWeight: 500,
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? "Importing…" : "Choose export zip…"}
          </button>
          {progress && (
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.55)" }}>
                {progress.stage}
                {pct !== undefined ? ` · ${pct}%` : ""}
              </div>
              <div style={{ height: 3, marginTop: 4, borderRadius: 2, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${pct ?? 100}%`, background: "rgba(45,212,191,0.7)", transition: "width 150ms" }} />
              </div>
            </div>
          )}
        </div>

        {error && <div style={{ fontSize: 11, color: "rgba(239,68,68,0.85)" }}>{error}</div>}

        {summary && (
          <div id="data-import-summary" style={{ fontSize: 11, color: "rgba(255,255,255,0.75)", display: "flex", flexDirection: "column", gap: 4, paddingTop: 4 }}>
            <div style={{ color: "rgba(74,222,128,0.9)", fontWeight: 600 }}>Import complete</div>
            {row("Generations", summary.generations)}
            {row("Uploads", summary.uploads)}
            {row("Media files", summary.media)}
            {row("Workflows", summary.workflows)}
            {row("Folders", summary.folders)}
            {summary.keys > 0 && <div>API keys: {summary.keys} imported</div>}
          </div>
        )}
      </div>
    </div>
  );
}
