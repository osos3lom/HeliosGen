import { lazy, Suspense, useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import { useWorkflowStore } from "@/lib/store";
import { useSpaceSync } from "@/lib/useSpaceSync";
import { QuickAssist } from "@/components/QuickAssist";

// The canvas (React Flow + node components) is the heaviest chunk; load it on demand.
const WorkflowCanvas = lazy(() => import("@/components/WorkflowCanvas"));

export default function WorkflowPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const switchSpace = useWorkflowStore((s) => s.switchSpace);

  useSpaceSync();

  // Guard: if this ID doesn't exist in the store, redirect home.
  // Also ensures the correct space is active on direct URL access.
  useEffect(() => {
    const spaces = useWorkflowStore.getState().spaces;
    if (!spaces.some((sp) => sp.id === id)) {
      navigate("/", { replace: true });
      return;
    }
    switchSpace(id);
  }, [id, switchSpace, navigate]);

  return (
    <div className="flex-1 flex overflow-hidden min-h-0">
      <Suspense fallback={null}>
        <WorkflowCanvas />
      </Suspense>
      <QuickAssist />
    </div>
  );
}
