"use client";
// On-device image tools: remove background, upscale 2×/4×, describe image.
// Image modes output an image (and save it to the gallery); "describe"
// outputs text that can feed a prompt input.
import { useCallback, useRef } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { useWorkflowStore, type NodeData } from "@/lib/store";
import { resolveInputs } from "@/lib/executor";
import { LOCAL_TOOLS, toolForMode, type ToolMode } from "@/lib/local/catalog";
import { runLocalTool, saveLocalImage, type LocalProgress } from "@/lib/local/runtime";
import { useReadOnly } from "@/lib/readOnlyContext";
import { useGeneratingBorderAnimation } from "@/lib/useGeneratingBorderAnimation";
import { assetUrl } from "@/src/lib/assetUrl";
import GenerateButton from "@/components/nodes/GenerateButton";
import CornerResizer from "@/components/nodes/CornerResizer";
import { ActionBar, LocalBadge, ProgressLine, SmallSelect, loadImageBlob, useNodeActions, usePipelineTrigger } from "./LocalNodeParts";

type LocalToolNodeType = Node<NodeData, "localToolNode">;

export default function LocalToolNode({ id, data, selected }: NodeProps<LocalToolNodeType>) {
  const readOnly = useReadOnly();
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const edges = useWorkflowStore((s) => s.edges);
  const nodes = useWorkflowStore((s) => s.nodes);
  const { handleDelete, handleDuplicate } = useNodeActions(id);
  const cardRef = useRef<HTMLDivElement>(null);

  const status = (data.status as string) ?? "idle";
  const busy = status === "running";
  const mode = ((data.toolMode as ToolMode) ?? "remove-bg") as ToolMode;
  const tool = toolForMode(mode);
  const textMode = mode === "caption";
  const outputImage = data.imageUrl as string | undefined;
  const outputText = (data.outputText as string) ?? "";
  const progress = data.progress as LocalProgress | undefined;
  const inputUrl = resolveInputs(id, nodes, edges).imageUrls[0];
  const imageConnected = edges.some((e) => e.target === id && e.targetHandle === "image");
  const sourceConnected = edges.some((e) => e.source === id);

  useGeneratingBorderAnimation(cardRef, busy);

  const setMode = (next: ToolMode) => {
    // Switching between text and image output invalidates outgoing wires.
    if ((next === "caption") !== textMode) {
      const { edges: all, onEdgesChange } = useWorkflowStore.getState();
      onEdgesChange(all.filter((e) => e.source === id).map((e) => ({ type: "remove" as const, id: e.id })));
    }
    updateNodeData(id, { toolMode: next, imageUrl: undefined, outputText: undefined, status: "idle" });
  };

  const generate = useCallback(async () => {
    const { nodes, edges } = useWorkflowStore.getState();
    const src = resolveInputs(id, nodes, edges).imageUrls[0];
    if (!src || busy) return;
    updateNodeData(id, { status: "running", errorMsg: undefined, progress: { stage: "Starting" } });
    try {
      const image = await loadImageBlob(src);
      const r = await runLocalTool({ tool, image, onProgress: (p) => updateNodeData(id, { progress: p }) });
      if (r.text !== undefined) {
        updateNodeData(id, { status: "done", outputText: r.text, device: r.device, progress: undefined });
      } else if (r.image) {
        const url = await saveLocalImage(r.image, { modelId: tool.id, prompt: tool.label, referenceUrls: [src] });
        updateNodeData(id, { status: "done", imageUrl: url, device: r.device, progress: undefined });
      }
    } catch (e) {
      updateNodeData(id, { status: "error", errorMsg: e instanceof Error ? e.message : String(e), progress: undefined });
    }
  }, [id, busy, tool, updateNodeData]);

  usePipelineTrigger(id, data.pendingGenerate, () => void generate());

  const preview = !textMode && outputImage ? outputImage : inputUrl;

  return (
    <div ref={cardRef} className={`node-card w-full h-full flex flex-col${busy ? " node-generating" : ""}`} style={{ minWidth: 240 }}>
      <CornerResizer minWidth={220} minHeight={240} />
      <span className="node-above-label">{data.label as string}</span>
      <ActionBar selected={!!selected} onDuplicate={handleDuplicate} onDelete={handleDelete} />

      <div className="flex items-center justify-between px-3 pt-2.5 gap-2">
        <LocalBadge device={data.device as string | undefined} />
        <SmallSelect<ToolMode>
          value={mode}
          disabled={busy || readOnly}
          onChange={setMode}
          options={LOCAL_TOOLS.map((t) => ({ value: t.mode, label: t.label }))}
        />
      </div>

      <div className="flex-1 flex flex-col gap-2 p-2.5 min-h-0">
        <div
          className="relative flex-1 min-h-[110px] rounded-md overflow-hidden border border-white/[0.05] flex items-center justify-center"
          style={{
            // Checkerboard so transparent cut-outs read as transparent.
            backgroundColor: "#0d1017",
            backgroundImage: outputImage && mode === "remove-bg"
              ? "linear-gradient(45deg,#1a1f2b 25%,transparent 25%),linear-gradient(-45deg,#1a1f2b 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#1a1f2b 75%),linear-gradient(-45deg,transparent 75%,#1a1f2b 75%)"
              : undefined,
            backgroundSize: "16px 16px",
            backgroundPosition: "0 0,0 8px,8px -8px,-8px 0",
          }}
        >
          {preview ? (
            <img src={assetUrl(preview)} alt="" draggable={false} className="absolute inset-0 w-full h-full object-contain" style={{ opacity: !textMode && !outputImage ? 0.45 : 1 }} />
          ) : (
            <span className="text-[11px] text-white/25 px-4 text-center">Connect an image</span>
          )}
          {busy && (
            <div className="absolute inset-x-2 bottom-2 bg-black/60 rounded-md px-2 py-1.5">
              <ProgressLine progress={progress} />
            </div>
          )}
        </div>
        {textMode && outputText && (
          <div
            className="nowheel nodrag max-h-[96px] overflow-y-auto rounded-md bg-lime-400/[0.03] border border-lime-400/10 px-2.5 py-1.5 text-[11px] text-white/90 leading-[1.5] select-text"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {outputText}
          </div>
        )}
        {status === "error" && <div className="text-[10px] text-red-400 bg-red-900/20 rounded px-2 py-1">{(data.errorMsg as string) ?? "Failed"}</div>}
      </div>

      <div className="flex items-center justify-between px-2.5 pb-2" onMouseDown={(e) => e.stopPropagation()}>
        <span className="text-[10px] text-[#7d8597] truncate" title={tool.description}>
          {tool.description.split(" — ")[0]}
        </span>
        {!readOnly && <GenerateButton onClick={() => void generate()} disabled={busy || !inputUrl} />}
      </div>

      <Handle
        type="target"
        position={Position.Left}
        id="image"
        style={{ top: "50%" }}
        className={`node-handle-icon node-handle-icon-resource${imageConnected ? " node-handle-connected" : ""}`}
        title="Image input"
      >
        <ImageIcon />
      </Handle>
      {textMode ? (
        <Handle
          type="source"
          position={Position.Right}
          id="textOut"
          style={{ top: "50%" }}
          className={`node-handle-icon node-handle-icon-out-text${sourceConnected ? " node-handle-connected" : ""}`}
          title="Description (text)"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.6" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h10" /></svg>
        </Handle>
      ) : (
        <Handle
          type="source"
          position={Position.Right}
          style={{ top: "50%" }}
          className={`node-handle-icon node-handle-icon-out-image${sourceConnected ? " node-handle-connected" : ""}`}
          title="Image output"
        >
          <ImageIcon />
        </Handle>
      )}
    </div>
  );
}

function ImageIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.6">
      <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3-3-9 9" />
    </svg>
  );
}
