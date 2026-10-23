"use client";
// On-device text model (WebLLM). Rewrites a prompt or answers freely; its
// output feeds any prompt input, exactly like the cloud Assistant node.
import { useCallback, useRef } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { useWorkflowStore, type NodeData } from "@/lib/store";
import { resolveInputs } from "@/lib/executor";
import { LOCAL_LLMS, llmById } from "@/lib/local/catalog";
import { runLocalLLM, type LocalProgress } from "@/lib/local/runtime";
import { useReadOnly } from "@/lib/readOnlyContext";
import { useGeneratingBorderAnimation } from "@/lib/useGeneratingBorderAnimation";
import GenerateButton from "@/components/nodes/GenerateButton";
import CornerResizer from "@/components/nodes/CornerResizer";
import { ActionBar, LocalBadge, ProgressLine, SmallSelect, UnsupportedNotice, useGpu, useNodeActions, usePipelineTrigger } from "./LocalNodeParts";

type LocalLLMNodeType = Node<NodeData, "localLlmNode">;
type Mode = "enhance" | "freeform";

// Small models need a tight instruction plus an example to stay on task.
const ENHANCE_PROMPT = `You rewrite short ideas into detailed prompts for an AI image or video generator.
Reply with the prompt only: one paragraph of plain prose. No markdown, no quotes, no lists, no preamble.

Example input: a dog in the park
Example output: A golden retriever bounding across a sunlit park lawn, ears flying, autumn leaves swirling around it, shallow depth of field, warm late-afternoon light, 35mm photograph.`;

const FREEFORM_PROMPT = "You are a helpful, concise assistant. Answer in plain text.";

function cleanOutput(text: string, mode: Mode): string {
  if (mode !== "enhance") return text.trim();
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // markdown images small models like to emit
    .replace(/^\s*(example output|prompt)\s*:\s*/i, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
}

export default function LocalLLMNode({ id, data, selected }: NodeProps<LocalLLMNodeType>) {
  const readOnly = useReadOnly();
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const edges = useWorkflowStore((s) => s.edges);
  const caps = useGpu();
  const { handleDelete, handleDuplicate } = useNodeActions(id);
  const cardRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const status = (data.status as string) ?? "idle";
  const busy = status === "running";
  const localPrompt = (data.localPrompt as string) ?? "";
  const outputText = (data.outputText as string) ?? "";
  const mode = ((data.llmMode as Mode) ?? "enhance") as Mode;
  const modelId = (data.model as string) ?? (caps?.tier === "high" ? "qwen2.5-1.5b" : "qwen2.5-0.5b");
  const progress = data.progress as LocalProgress | undefined;
  const promptConnected = edges.some((e) => e.target === id && e.targetHandle === "prompt");
  const sourceConnected = edges.some((e) => e.source === id);

  useGeneratingBorderAnimation(cardRef, busy);

  const generate = useCallback(async () => {
    const { nodes, edges } = useWorkflowStore.getState();
    const upstream = resolveInputs(id, nodes, edges).prompt ?? "";
    const input = [localPrompt.trim(), upstream.trim()].filter(Boolean).join("\n\n");
    if (!input || busy) return;

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    updateNodeData(id, { status: "running", outputText: "", errorMsg: undefined, progress: { stage: "Starting" } });
    try {
      const text = await runLocalLLM({
        model: llmById(modelId),
        messages: [
          { role: "system", content: mode === "enhance" ? ENHANCE_PROMPT : FREEFORM_PROMPT },
          { role: "user", content: input },
        ],
        signal: ctrl.signal,
        onProgress: (p) => updateNodeData(id, { progress: p }),
        onToken: (t) => updateNodeData(id, { outputText: t, progress: { stage: "Generating" } }),
      });
      updateNodeData(id, { status: "done", outputText: cleanOutput(text, mode), progress: undefined, model: modelId });
    } catch (e) {
      updateNodeData(id, { status: "error", errorMsg: e instanceof Error ? e.message : String(e), progress: undefined });
    } finally {
      abortRef.current = null;
    }
  }, [id, localPrompt, busy, modelId, mode, updateNodeData]);

  usePipelineTrigger(id, data.pendingGenerate, () => void generate());

  const stop = () => {
    abortRef.current?.abort();
    updateNodeData(id, { status: outputText ? "done" : "idle", progress: undefined });
  };

  return (
    <div ref={cardRef} className={`node-card w-full h-full flex flex-col${busy ? " node-generating" : ""}`} style={{ minWidth: 260 }}>
      <CornerResizer minWidth={240} minHeight={200} />
      <span className="node-above-label">{data.label as string}</span>
      <ActionBar selected={!!selected} onDuplicate={handleDuplicate} onDelete={handleDelete} />

      <div className="flex items-center justify-between px-3 pt-2.5">
        <LocalBadge />
        <SmallSelect<Mode>
          value={mode}
          disabled={busy || readOnly}
          onChange={(v) => updateNodeData(id, { llmMode: v })}
          options={[
            { value: "enhance", label: "Enhance prompt" },
            { value: "freeform", label: "Free-form" },
          ]}
        />
      </div>

      <div className="flex-1 flex flex-col gap-2 p-2.5 min-h-0">
        {caps && !caps.supported ? (
          <UnsupportedNotice reason={caps.reason} />
        ) : (
          <>
            <textarea
              className="nodrag nowheel w-full min-h-[56px] flex-1 bg-white/[0.03] border border-white/[0.06] rounded-md px-2.5 py-2 text-[12px] text-white leading-[1.5] resize-none outline-none"
              placeholder={promptConnected ? "Optional extra instruction — the connected text is used as input" : "Describe an idea to expand into a prompt…"}
              value={localPrompt}
              readOnly={readOnly}
              onChange={(e) => updateNodeData(id, { localPrompt: e.target.value })}
              onMouseDown={(e) => e.stopPropagation()}
            />
            {(outputText || busy) && (
              <div
                className="nowheel nodrag flex-1 min-h-[56px] overflow-y-auto rounded-md bg-lime-400/[0.03] border border-lime-400/10 px-2.5 py-2 text-[12px] text-white/90 leading-[1.55] whitespace-pre-wrap select-text"
                onMouseDown={(e) => e.stopPropagation()}
              >
                {outputText || <span className="text-white/30">…</span>}
              </div>
            )}
            {busy && <ProgressLine progress={progress} />}
            {status === "error" && <div className="text-[10px] text-red-400 bg-red-900/20 rounded px-2 py-1">{(data.errorMsg as string) ?? "Failed"}</div>}
          </>
        )}
      </div>

      <div className="flex items-center justify-between px-2.5 pb-2" onMouseDown={(e) => e.stopPropagation()}>
        <SmallSelect
          value={modelId}
          disabled={busy || readOnly}
          onChange={(v) => updateNodeData(id, { model: v })}
          options={LOCAL_LLMS.map((m) => ({ value: m.id, label: `${m.label} · ${(m.sizeMB / 1000).toFixed(1)} GB` }))}
        />
        {!readOnly &&
          (busy ? (
            <button onClick={stop} className="px-2 py-0.5 rounded-md text-[10px] text-[#888] border border-[#333] bg-white/[0.04] hover:bg-white/5">
              Stop
            </button>
          ) : (
            <GenerateButton onClick={() => void generate()} disabled={!caps?.supported || (!localPrompt.trim() && !promptConnected)} />
          ))}
      </div>

      <Handle
        type="target"
        position={Position.Left}
        id="prompt"
        style={{ top: "50%" }}
        className={`node-handle-icon node-handle-icon-prompt${promptConnected ? " node-handle-connected" : ""}`}
        title="Text input"
      >
        <TextIcon />
      </Handle>
      <Handle
        type="source"
        position={Position.Right}
        id="textOut"
        style={{ top: "50%" }}
        className={`node-handle-icon node-handle-icon-out-text${sourceConnected ? " node-handle-connected" : ""}`}
        title="Text output"
      >
        <TextIcon />
      </Handle>
    </div>
  );
}

function TextIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.6" strokeLinecap="round">
      <path d="M4 7h16M4 12h16M4 17h10" />
    </svg>
  );
}
