# Web provider matrix (Phase 0 spike)

These checks were run on 2026-10-15. Each endpoint got two tests:
- a `curl` preflight with `Origin: https://osos3lom.github.io`
- a real browser `fetch` from `spike/cors.html` (served at `http://localhost:5199`), using a dummy `Bearer test` token

"Readable" means the browser exposed the response to the page. A 401 still counts as readable. It means CORS passed and only the dummy token was rejected.

## Cloud endpoints

| Endpoint | Preflight | Browser fetch | Web-supported |
|---|---|---|---|
| `POST api.kie.ai/api/v1/jobs/createTask` | ✅ origin echoed, `authorization, content-type` | ✅ readable (401 body) | **Yes** |
| `GET api.kie.ai/api/v1/jobs/recordInfo` | ✅ | ✅ | **Yes** |
| `GET api.kie.ai/api/v1/chat/credit` | ✅ | ✅ | **Yes** |
| `POST api.kie.ai/api/v1/veo/generate` | ✅ | ✅ | **Yes** |
| `POST api.kie.ai/{model}/v1/chat/completions` | ✅ | ✅ | **Yes** |
| `POST api.kie.ai/claude/v1/messages` | ✅ (also allows `anthropic-version`) | ✅ | **Yes** |
| `POST kieai.redpandaai.co/api/file-base64-upload` | ✅ `*` | ✅ | **Yes** |
| `tempfile.aiquickdraw.com` (result CDN) | — | ✅ `ACAO: *`, exposes `Content-Length`/`Range` | **Yes** (results can be mirrored into OPFS) |
| `tempfile.redpandaai.co` (temp upload CDN) | — | ⚠️ no CORS header on the 404 root. Needs re-checking with a real file URL. | Probably. We only need kie to fetch these, not the browser. |
| `cdn.kie.ai` | — | ❌ no response (did not resolve or connect) | Treat as unknown. The download handler falls back to opening a new tab. |
| `api.github.com` | — | ✅ `*` | Yes (not needed) |
| Azure OpenAI (`*.openai.azure.com`, Foundry) | Not tested: needs your own resource endpoint | — | **Unverified.** Retest in-app with your endpoint. Gate it behind a runtime check. |

**Conclusion:** Kie.ai, the main provider, works directly from a static GitHub Pages origin. No proxy is needed. The dev-only Vite proxy from the plan is optional and stays off by default.

## Other findings
- The workflow-template bucket (`pub-73a59b956f1c4a7db2934522c13d8027.r2.dev`) returns **401 for every request**, with or without `Origin`. This is already broken upstream and is not caused by the migration. Template thumbnails and videos need a new home, e.g. `public/templates/` in the repo.

## WebGPU (Browser pane, Chromium)
- Adapter: Intel `gen-9` (integrated GPU). `shader-f16`: **yes**. `maxBufferSize` 2 GiB.
- transformers.js 3.5.1, `device: "webgpu"`, MiniLM-L6 (23 MB):
  - library load 1.2 s
  - model download + compile 29 s (first run; cached after that)
  - warm-up 2.3 s
  - 32-sentence batch 2.0 s
- **Takeaway:** the WebGPU execution path works. On an integrated GPU like this one, expect:
  - SD-Turbo 512px: tens of seconds per image
  - 1–3B LLMs: a few tokens per second

  Defaults should pick the smallest models (Qwen2.5-0.5B/1.5B), and the UI should show a performance hint based on the adapter. Heavy-model timings get measured in Phase 4 on the target machine's Chrome.
