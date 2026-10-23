"use client";
// On-device text-to-image (SD-Turbo on WebGPU). Output is saved to the
// gallery and can feed any image input, like the cloud Image node.
import { useCallback, useRef } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { useWorkflowStore, type NodeData } from "@/lib/store";
import { resolveInputs } from "@/lib/executor";
import { SD_TURBO } from "@/lib/local/catalog";
import { runSdTurbo, saveLocalImage, type LocalProgress } from "@/lib/local/runtime";
import { useReadOnly } from "@/lib/readOnlyContext";
import { useGeneratingBorderAnimation } from "@/lib/useGeneratingBorderAnimation";
import { assetUrl } from "@/src/lib/assetUrl";
import GenerateButton from "@/components/nodes/GenerateButton";
import CornerResizer from "@/components/nodes/CornerResizer";
import { ActionBar, LocalBadge, ProgressLine, UnsupportedNotice, useGpu, useNodeActions, usePipelineTrigger } from "./LocalNodeParts";

type LocalImageNodeType = Node<NodeData, "localImageNode">;

const randomSeed = () => Math.floor(Math.random() * 2 ** 31);

export default function LocalImageNode({ id, data, selected }: NodeProps<LocalImageNodeType>) {
  const readOnly = useReadOnly();
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const edges = useWorkflowStore((s) => s.edges);
  const caps = useGpu();
  const { handleDelete, handleDuplicate } = useNodeActions(id);
  const cardRef = useRef<HTMLDivElement>(null);

  const status = (data.status as string) ?? "idle";
  const busy = status === "running";
  const localPrompt = (data.localPrompt as string) ?? "";
  const imageUrl = data.imageUrl as string | undefined;
  const seed = (data.seed as number | undefined) ?? 0;
  const lockSeed = !!data.lockSeed;
  const progress = data.progress as LocalProgress | undefined;
  const promptConnected = edges.some((e) => e.target === id && e.targetHandle === "prompt");
  const sourceConnected = edges.some((e) => e.source === id);

  useGeneratingBorderAnimation(cardRef, busy);

  const generate = useCallback(async () => {
    const { nodes, edges } = useWorkflowStore.getState();
    const prompt = (resolveInputs(id, nodes, edges).prompt ?? localPrompt).trim();
    if (!prompt || busy) return;
    const runSeed = lockSeed && seed ? seed : randomSeed();
    updateNodeData(id, { status: "running", errorMsg: undefined, seed: runSeed, progress: { stage: "Starting" } });
    try {
      const { png, ms } = await runSdTurbo({ prompt, seed: runSeed, onProgress: (p) => updateNodeData(id, { progress: p }) });
      const url = await saveLocalImage(png, { modelId: SD_TURBO.id, prompt });
      updateNodeData(id, { status: "done", imageUrl: url, prompt, durationMs: ms, progress: undefined });
    } catch (e) {
      updateNodeData(id, { status: "error", errorMsg: e instanceof Error ? e.message : String(e), progress: undefined });
    }
  }, [id, localPrompt, busy, lockSeed, seed, updateNodeData]);

  usePipelineTrigger(id, data.pendingGenerate, () => void generate());

  return (
    <div ref={cardRef} className={`node-card w-full h-full flex flex-col${busy ? " node-generating" : ""}`} style={{ minWidth: 260 }}>
      <CornerResizer minWidth={240} minHeight={280} />
      <span className="node-above-label">{data.label as string}</span>
      <ActionBar selected={!!selected} onDuplicate={handleDuplicate} onDelete={handleDelete} />

      <div className="flex items-center justify-between px-3 pt-2.5">
        <LocalBadge />
        <span className="text-[10px] text-[#7d8597]">SD-Turbo · 512×512</span>
      </div>

      <div className="flex-1 flex flex-col gap-2 p-2.5 min-h-0">
        {caps && !caps.supported ? (
          <UnsupportedNotice reason={caps.reason} />
        ) : (
          <>
            <div className="relative flex-1 min-h-[120px] rounded-md overflow-hidden bg-white/[0.02] border border-white/[0.05] flex items-center justify-center">
              {imageUrl ? (
                <img src={assetUrl(imageUrl)} alt="" draggable={false} className="absolute inset-0 w-full h-full object-contain" />
              ) : (
                <span className="text-[11px] text-white/25 px-4 text-center">
                  {busy ? "" : `Runs on your GPU. First use downloads ~${(SD_TURBO.sizeMB / 1000).toFixed(1)} GB of weights.`}
                </span>
              )}
              {busy && (
                <div className="absolute inset-x-2 bottom-2 bg-black/60 rounded-md px-2 py-1.5">
                  <ProgressLine progress={progress} />
                </div>
              )}
            </div>
            <textarea
              className="nodrag nowheel w-full h-[54px] bg-white/[0.03] border border-white/[0.06] rounded-md px-2.5 py-1.5 text-[12px] text-white leading-[1.45] resize-none outline-none disabled:opacity-50"
              placeholder={promptConnected ? "Using the connected prompt" : "Describe the image…"}
              value={localPrompt}
              disabled={promptConnected}
              readOnly={readOnly}
              onChange={(e) => updateNodeData(id, { localPrompt: e.target.value })}
              onMouseDown={(e) => e.stopPropagation()}
            />
            {status === "error" && <div className="text-[10px] text-red-400 bg-red-900/20 rounded px-2 py-1">{(data.errorMsg as string) ?? "Failed"}</div>}
          </>
        )}
      </div>

      <div className="flex items-center justify-between px-2.5 pb-2 gap-2" onMouseDown={(e) => e.stopPropagation()}>
        <label className="flex items-center gap-1.5 text-[10px] text-[#9aa3b5]" title="Keep the same seed to reproduce an image">
          <input type="checkbox" className="nodrag" checked={lockSeed} disabled={readOnly} onChange={(e) => updateNodeData(id, { lockSeed: e.target.checked })} />
          Seed
          <input
            type="number"
            className="nodrag w-[86px] bg-[#111622] border border-[#1E2840] rounded px-1 py-[1px] text-[10px] text-[#c8cdd8] outline-none disabled:opacity-50"
            value={seed || ""}
            placeholder="random"
            disabled={!lockSeed || readOnly}
            onChange={(e) => updateNodeData(id, { seed: Number(e.target.value) || 0 })}
          />
        </label>
        {!readOnly && <GenerateButton onClick={() => void generate()} disabled={busy || !caps?.supported || (!localPrompt.trim() && !promptConnected)} />}
      </div>

      <Handle
        type="target"
        position={Position.Left}
        id="prompt"
        style={{ top: "50%" }}
        className={`node-handle-icon node-handle-icon-prompt${promptConnected ? " node-handle-connected" : ""}`}
        title="Prompt input"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.6" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h10" /></svg>
      </Handle>
      <Handle
        type="source"
        position={Position.Right}
        style={{ top: "50%" }}
        className={`node-handle-icon node-handle-icon-out-image${sourceConnected ? " node-handle-connected" : ""}`}
        title="Image output"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.6"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3-3-9 9" /></svg>
      </Handle>
    </div>
  );
}
