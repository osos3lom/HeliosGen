import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

const r = (p: string) => path.resolve(__dirname, p);

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    // GitHub Pages serves project sites from /<repo>/; CI sets VITE_BASE.
    base: env.VITE_BASE || "/",
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: [
        // Transitional next/* shims — replaced with direct imports in Phase 7.
        { find: /^next\/navigation$/, replacement: r("src/shims/navigation.ts") },
        { find: /^next\/link$/, replacement: r("src/shims/link.tsx") },
        { find: /^next\/image$/, replacement: r("src/shims/image.tsx") },
        { find: /^next\/dynamic$/, replacement: r("src/shims/dynamic.tsx") },
        { find: /^@\//, replacement: r(".") + "/" },
      ],
    },
    define: {
      // SettingsModal reads this; keep it working without a Next env layer.
      "process.env.NEXT_PUBLIC_DEBUG": JSON.stringify(env.VITE_DEBUG ?? env.NEXT_PUBLIC_DEBUG ?? ""),
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
      chunkSizeWarningLimit: 4096,
    },
  };
});
