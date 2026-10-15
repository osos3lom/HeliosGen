import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

const r = (p: string) => path.resolve(__dirname, p);

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // Transitional (Phases 1–2): while the API is still served by Next route
  // handlers, `pnpm dev:api` runs them on :3000 and Vite proxies to it.
  const legacyApi = env.HELIOS_LEGACY_API ?? "http://localhost:3000";

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
      proxy: {
        "/api": { target: legacyApi, changeOrigin: true },
        "/generated": { target: legacyApi, changeOrigin: true },
      },
    },
    build: {
      outDir: "dist",
      chunkSizeWarningLimit: 4096,
    },
  };
});
