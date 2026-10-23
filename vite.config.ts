import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

const r = (p: string) => path.resolve(import.meta.dirname, p);

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    // GitHub Pages serves project sites from /<repo>/; CI sets VITE_BASE.
    base: env.VITE_BASE || "/",
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: [
        { find: /^@\//, replacement: r(".") + "/" },
      ],
    },
    server: {
      port: 5173,
    },
    optimizeDeps: {
      // Pre-bundle the heavy local-model libraries up front so the dev server
      // doesn't discover them mid-session and force a reload.
      include: ["@mlc-ai/web-llm", "@huggingface/transformers"],
      // ffmpeg.wasm and onnxruntime-web load their own workers/wasm relative to
      // their module URL; pre-bundling breaks that.
      exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util", "onnxruntime-web"],
    },
    worker: {
      format: "es" as const,
    },
    build: {
      outDir: "dist",
      // Large chunks are the lazily loaded on-device model workers (WebLLM is
      // ~6 MB); they load only when a local node runs.
      chunkSizeWarningLimit: 8192,
    },
  };
});
