# HeliosGen — notes for coding agents

HeliosGen is a **static single-page app** (Vite + React 19 + TypeScript) deployed
to GitHub Pages. There is **no server**: do not add Node/server code, API routes
or anything that needs secrets at build time.

## Layout

| Path | What lives there |
| --- | --- |
| `src/main.tsx`, `src/RootLayout.tsx`, `src/routes/` | Entry, shell and pages. Routing is `createHashRouter` (React Router 8): deep links live after `#`, because Pages has no SPA fallback. |
| `components/`, `components/nodes/` | UI and canvas nodes (React Flow). `components/nodes/local/` holds the on-device nodes. |
| `lib/api/client.ts` + `lib/api/handlers/` | `apiFetch("/api/…")` dispatches to in-browser handlers with a `Request → Response` contract (ports of the old Next route handlers). Add new "endpoints" here, lazily imported. |
| `lib/api/jobs.ts` | Polls kie.ai jobs from the page; pending jobs persist in IndexedDB and resume on load. |
| `lib/browser/db.ts` | IndexedDB (Dexie) — generations, uploads, folders, spaces (workflows), settings, jobs. |
| `lib/browser/media.ts`, `public/media-sw.js` | Media in OPFS, served at `<base>generated/*` by the service worker. |
| `lib/local/` | On-device models: catalog, WebGPU capability check, runtime, Web Workers (WebLLM, ONNX Runtime Web, Transformers.js). |
| `scripts/export-desktop-data.mjs` | Node script that exports the old desktop app's data; `lib/browser/importDesktop.ts` imports it. |

## Conventions

- **Media paths are base-relative**: store `generated/<folder>/<file>`, never `/generated/...`
  (the site is served from `/<repo>/`). Use `isLocalMediaPath()` / `readMedia()` from
  `lib/browser/media.ts` to handle both forms.
- **Root-absolute public assets** (`/HG.svg`) must go through `assetUrl()` (`src/lib/assetUrl.ts`)
  or the `Img` component (`components/ui/img.tsx`).
- **Calls to providers go straight from the browser**; only use endpoints that allow CORS
  (see `docs/web-provider-matrix.md`). API keys come from `lib/browser/db.ts` settings — never
  from `import.meta.env`, which is compiled into the public bundle.
- **Heavy work belongs in Web Workers** (`new Worker(new URL("./x.worker.ts", import.meta.url), { type: "module" })`),
  lazy-loaded so it stays out of the main bundle.
- **One ONNX Runtime**: `onnxruntime-web` is pinned to the exact version `@huggingface/transformers`
  depends on, so pnpm installs a single copy and Vite emits one ~27 MB `ort-wasm-*.wasm`. Workers
  set `wasmPaths` from `lib/local/workers/ortWasm.ts` (self-hosted, not the CDN). When upgrading
  transformers.js, re-pin `onnxruntime-web` to its new `onnxruntime-web` dependency.
- Generator nodes respond to `pendingGenerate` (see `lib/usePipelineRunner.ts`); register new node
  types in `lib/nodeTypes.tsx` (`GENERATOR_NODE_TYPES`, `isTextSource`), `components/WorkflowCanvas.tsx`
  and the node menus.

## Checks

```bash
pnpm typecheck && pnpm lint && pnpm build
```

CI (`.github/workflows/ci.yml`) runs the same; `deploy.yml` builds with `VITE_BASE` set to the
Pages base path. Lint must have 0 errors; a few React-Compiler `react-hooks` rules are warnings
for pre-existing code (see `eslint.config.mjs`).
