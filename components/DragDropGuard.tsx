"use client";

import { useEffect } from "react";

// Without this, a file dropped outside a handled drop zone makes the browser
// NAVIGATE to the file (the tab "becomes" the image). Component-level onDrop
// handlers still run first on their own targets; this only kills the default
// navigate-on-drop everywhere.
export function DragDropGuard() {
  useEffect(() => {
    const prevent = (e: DragEvent) => {
      e.preventDefault();
    };
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", prevent);
    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", prevent);
    };
  }, []);
  return null;
}
