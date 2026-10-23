"use client";
// Shared UI for the on-device (WebGPU) nodes: GPU badge, progress line,
// unsupported notice, action bar, and the hook that wires pipeline runs.
import { useCallback, useEffect, useState } from "react";
import { useWorkflowStore } from "@/lib/store";
import { getGpuCapabilities, type GpuCapabilities } from "@/lib/local/capabilities";
import type { LocalProgress } from "@/lib/local/runtime";
import { isLocalMediaPath, readMedia } from "@/lib/browser/media";

/** Live WebGPU capabilities (null while detecting). */
export function useGpu(): GpuCapabilities | null {
  const [caps, setCaps] = useState<GpuCapabilities | null>(null);
  useEffect(() => {
    let alive = true;
    void getGpuCapabilities().then((c) => alive && setCaps(c));
    return () => {
      alive = false;
    };
  }, []);
  return caps;
}

/** Fetch an image reference (local OPFS path, data: URL or CORS-enabled URL) as a Blob. */
export async function loadImageBlob(url: string): Promise<Blob> {
  if (isLocalMediaPath(url)) {
    const file = await readMedia(url);
    if (file) return file;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't load the input image (${res.status})`);
  return res.blob();
}

/** Run `generate` when the pipeline runner sets `pendingGenerate` on this node. */
export function usePipelineTrigger(id: string, pending: unknown, generate: () => void) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  useEffect(() => {
    if (!pending) return;
    updateNodeData(id, { pendingGenerate: false });
    generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);
}

export function useNodeActions(id: string) {
  const onNodesChange = useWorkflowStore((s) => s.onNodesChange);
  const addNode = useWorkflowStore((s) => s.addNode);
  const handleDelete = useCallback(() => onNodesChange([{ type: "remove", id }]), [id, onNodesChange]);
  const handleDuplicate = useCallback(() => {
    const src = useWorkflowStore.getState().nodes.find((n) => n.id === id);
    if (!src) return;
    onNodesChange([{ type: "select", id, selected: false }]);
    addNode({
      ...src,
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      position: { x: src.position.x + 20, y: src.position.y + 20 },
      selected: true,
      data: { ...src.data, status: "idle" as const, outputText: undefined, imageUrl: undefined, progress: undefined },
    });
  }, [id, addNode, onNodesChange]);
  return { handleDelete, handleDuplicate };
}

export function ActionBar({ selected, onDuplicate, onDelete }: { selected: boolean; onDuplicate: () => void; onDelete: () => void }) {
  return (
    <div
      className="absolute z-50 flex items-center gap-0.5 px-1.5 py-1"
      style={{
        bottom: "calc(100% + 28px)",
        left: "50%",
        borderRadius: 999,
        background: "rgba(16,16,16,0.96)",
        backdropFilter: "blur(12px)",
        border: "1px solid rgba(255,255,255,0.07)",
        boxShadow: "0 4px 24px rgba(0,0,0,0.65), 0 1px 4px rgba(0,0,0,0.4)",
        transform: `translateX(-50%) translateY(${selected ? "0px" : "6px"})`,
        opacity: selected ? 1 : 0,
        transition: "opacity 180ms ease, transform 180ms ease",
        pointerEvents: selected ? "auto" : "none",
        whiteSpace: "nowrap",
      }}
    >
      <button
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
        title="Duplicate node"
        className="w-7 h-7 flex items-center justify-center rounded-full text-[#777] hover:text-white hover:bg-white/10 transition-colors duration-150"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      </button>
      <span className="w-px h-4 bg-white/[0.08] mx-0.5 shrink-0" />
      <button
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        title="Delete node"
        className="w-7 h-7 flex items-center justify-center rounded-full text-[#777] hover:text-red-400 hover:bg-red-400/10 transition-colors duration-150"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4h6v2" />
        </svg>
      </button>
    </div>
  );
}

/** "Local · GPU" pill; shows "CPU" when the work runs on WASM. */
export function LocalBadge({ device }: { device?: string }) {
  const cpu = device === "wasm";
  return (
    <span
      className="text-[9px] font-semibold tracking-wider px-1.5 py-[1px] rounded"
      style={{
        color: cpu ? "#93c5fd" : "#a3e635",
        background: cpu ? "rgba(147,197,253,0.1)" : "rgba(163,230,53,0.1)",
        border: `1px solid ${cpu ? "rgba(147,197,253,0.25)" : "rgba(163,230,53,0.25)"}`,
      }}
      title={cpu ? "Runs on this device's CPU (WebAssembly)" : "Runs on this device's GPU (WebGPU) — nothing is sent to a server"}
    >
      LOCAL · {cpu ? "CPU" : "GPU"}
    </span>
  );
}

export function ProgressLine({ progress }: { progress?: LocalProgress }) {
  if (!progress) return null;
  const pct = progress.fraction !== undefined ? Math.round(progress.fraction * 100) : undefined;
  return (
    <div className="flex flex-col gap-1 w-full">
      <div className="text-[10px] text-[#9aa3b5] truncate" title={progress.stage}>
        {progress.stage}
        {pct !== undefined ? ` · ${pct}%` : ""}
      </div>
      <div className="h-[3px] w-full rounded bg-white/[0.06] overflow-hidden">
        <div
          className={`h-full bg-lime-400/70 ${pct === undefined ? "animate-pulse w-full" : ""}`}
          style={pct !== undefined ? { width: `${pct}%`, transition: "width 200ms" } : undefined}
        />
      </div>
    </div>
  );
}

export function UnsupportedNotice({ reason }: { reason?: string }) {
  return (
    <div className="text-[11px] leading-snug text-amber-300/80 bg-amber-500/[0.06] border border-amber-500/20 rounded-md px-2.5 py-2">
      {reason ?? "WebGPU isn't available in this browser."} This node needs WebGPU to run on your device.
    </div>
  );
}

export function SmallSelect<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onMouseDown={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value as T)}
      className="nodrag bg-[#111622] border border-[#1E2840] rounded-md text-[11px] text-[#c8cdd8] px-1.5 py-[3px] outline-none disabled:opacity-50"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
