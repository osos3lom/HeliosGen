<p align="center">
  <img
    src="https://raw.githubusercontent.com/SegFault42/HeliosGen/main/public/HG.svg"
    alt="HeliosGen"
    width="64"
  />
</p>

<p align="center">
  <strong>Build AI image & video pipelines visually — right in your browser.</strong><br/>
  Chain prompts, models, reference images, and automations on an infinite canvas.
</p>

---

# 🌐 Open the app

### 👉 **[osos3lom.github.io/HeliosGen](https://osos3lom.github.io/HeliosGen/)**

HeliosGen runs entirely in your browser — nothing to install, no account, no
server. It's a static site: your keys, library and workflows stay on your
device, and generation requests go straight from your browser to the provider.

| Browser | Cloud models (kie.ai / Azure) | On-device models (WebGPU) |
| --- | --- | --- |
| Chrome / Edge 113+ | ✅ | ✅ |
| Safari 26+ | ✅ | ✅ |
| Firefox | ✅ | ⚠️ Depends on version and OS — local nodes show a notice when WebGPU is unavailable |

---

## 🚀 First run

1. Open the app.
2. Go to **Settings → API Keys** and paste your **[kie.ai](https://kie.ai?ref=25abb3f2236cbff9780ab9c2f84479ec) API key**.
3. Start generating — or skip the key and use the **on-device** nodes, which need no account at all.

### Where your data lives

Everything is stored in your browser, for this site only:

- **IndexedDB** — generations, uploads, folders, workflows and settings (including API keys).
- **Origin Private File System** — generated and uploaded images/videos, plus on-device model weights.

API keys are only ever sent to their own provider. The app asks the browser to
keep this storage persistent; clearing the site's data in your browser resets
the app. Use the canvas toolbar's **Export workflow (.zip)** button to keep portable copies of workflows.

---

# 📸 Screenshots
## ✨ Simple Image & Video Generation

<p align="center">
  <img width="2912" height="2292" alt="Image generation example" src="https://github.com/user-attachments/assets/8263b83d-addb-4af8-99d1-d8406c52be2c" />
</p>

---

## 🔄 Workflow Generation

<p align="center">
  <img width="1459" height="1146" alt="Workflow generation example" src="https://github.com/user-attachments/assets/fc7f1109-76d1-4af0-b91d-0e915bcf5461" />
</p>

---

## 🧠 Native JSON Prompt Preview

<p align="center">
  <img width="886" alt="JSON prompt preview" src="https://github.com/user-attachments/assets/dedbdf4f-9d52-4e29-ad6e-a2e67e341a73" />
</p>

---

## 💬 AI Prompt Improvement Assistant

<p align="center">
  <img width="872" height="502" alt="Prompt assistant interface" src="https://github.com/user-attachments/assets/17ba972c-bd8a-49a7-b367-4ef906fe3e17" />
</p>

---

# ✨ HeliosGen

HeliosGen is a free & open source visual AI workflow builder for image and video generation.

Build reusable AI pipelines with:
- infinite node-based workflows,
- multi-model generation,
- reference images,
- automation chains,
- cloud models through your own kie.ai key, **and** models that run on your own GPU.

No subscriptions.  
No disappearing credits.  
No vendor lock-in.  
No backend, no accounts — a web page, your browser, and your own key.

---

# 💳 Credits

HeliosGen works with <a href="https://kie.ai?ref=25abb3f2236cbff9780ab9c2f84479ec" target="_blank">kie.ai</a>.

All credits are purchased directly on your own account and never expire.

That means:
- no monthly reset,
- no lost credits,
- no subscription lock-in,
- and full ownership of your usage.

You only pay for what you generate — and on-device generation is free.

---

# 🚀 Features

- Infinite node-based canvas
- AI image & video generation (cloud) and on-device generation (WebGPU)
- Drag-and-connect workflow system
- Multi-model pipelines, parallel & sequential execution
- Reference image, video and audio support
- Frame extraction and video trimming in the browser (ffmpeg.wasm)
- Real-time generation history and gallery with folders
- Local-first — your library never leaves your device
- Bring your own kie.ai key

---

# ⚡ Supported Models

## Images (cloud)
- GPT Image 2 / 2.5 (OpenAI) — via kie.ai, or your own Azure AI Foundry deployment
- Nano Banana / Nano Banana 2 / Nano Banana 2 Lite / Nano Banana Pro (Google)
- Seedream 5.0 Lite / Pro (Seedream)
- Z-Image (Z-AI)
- Grok Imagine (X)

## Videos (cloud)
- Veo 3.1 Lite / Fast / Quality, Gemini Omni Video (Google)
- Kling 3.0, Kling 3.0 Turbo, Motion Control 2.6 / 3.0 (Kling)
- Seedance 2.0 / Fast / Mini / 2.5 (Bytedance)
- MiniMax H3
- Grok Imagine, Grok Imagine 1.5 preview (X)
- HappyHorse (Alibaba)

## On-device (WebGPU) — free, private, works offline once downloaded

| Node | What it does | Models |
| --- | --- | --- |
| **Local LLM** | Expands an idea into a detailed prompt, or answers free-form | Qwen2.5 0.5B / 1.5B, Llama 3.2 3B (WebLLM) |
| **Local Image** | Text-to-image, 512×512, one step | SD-Turbo (ONNX Runtime Web) |
| **Local Tools** | Remove background · upscale 2×/4× · describe an image | RMBG-1.4, Swin2SR, Florence-2 (Transformers.js) |

Weights download the first time a model is used (from ~50 MB for a tool up to
~2.5 GB for SD-Turbo) and are cached by the browser. Manage them in
**Settings → Local Models**. On integrated GPUs, prefer the smaller LLMs; tools
fall back to the CPU when a GPU can't run them.

---

# 🖥️ Moving from the desktop app

Earlier versions were a desktop app (Tauri + a local Next.js server). To bring
that library into the browser:

1. Quit the desktop app.
2. In a checkout of this repo, run `pnpm install` once, then:
   ```bash
   pnpm export-desktop-data
   ```
   It finds the desktop data folder automatically (or pass `--data-dir`) and
   writes `heliosgen-export-<date>.zip`. API keys are left out unless you add
   `--include-keys`.
3. In the app, open **Settings → Data → Import desktop data** and choose the zip.

Importing only adds — anything already in the browser is kept, so it's safe to
run again. Chat history isn't part of the export.

---

# 🏗️ Tech Stack

| Layer | Technology |
|---|---|
| App | React 19 + TypeScript, built with Vite, hash routing (React Router) |
| Canvas | React Flow (`@xyflow/react`) + Zustand |
| "API" | In-browser handlers behind `apiFetch` (no server) |
| Database | IndexedDB (Dexie) |
| Media | Origin Private File System, served by a service worker |
| On-device AI | WebLLM, ONNX Runtime Web, Transformers.js — in Web Workers |
| Video tools | ffmpeg.wasm |
| Cloud AI | kie.ai (and optionally Azure AI Foundry) |
| Hosting | GitHub Pages via GitHub Actions |

---

# 🛠️ Develop

Requires Node 22+ and pnpm 9.

```bash
pnpm install
pnpm dev          # http://localhost:5173
```

| Script | Does |
| --- | --- |
| `pnpm dev` | Vite dev server |
| `pnpm build` | Static build into `dist/` (set `VITE_BASE=/<repo>/` for a project site) |
| `pnpm preview` | Serve the built `dist/` |
| `pnpm typecheck` / `pnpm lint` | The checks CI runs |
| `pnpm export-desktop-data` | Export a desktop-app library for import |

See [`AGENTS.md`](AGENTS.md) for how the code is organised.

## Deploy your own copy

1. Fork the repo.
2. In the fork: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Push to `main` (or run the **Deploy to GitHub Pages** workflow). The site
   appears at `https://<you>.github.io/<repo>/`.

`.github/workflows/deploy.yml` typechecks, lints and builds with the right base
path; `ci.yml` runs the same checks on pull requests.

---

# 🤝 Contributions

Contributions are welcome.

If you find a bug, have an idea, or want to improve HeliosGen:
- Open an issue
- Submit a pull request
- Share feedback or feature requests

All contributions are appreciated.

---

# 📄 License

MIT License

---

<p align="center">
  Built for creators building the future of AI workflows.
</p>
