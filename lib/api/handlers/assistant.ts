// Port of app/api/assistant/route.ts: streams the provider's SSE body back
// unchanged, so lib/chatStreamingStore.ts and other consumers parse it as before.
import * as db from "@/lib/browser/db";
import { NO_KIE_KEY, json } from "../http";

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

// Models that use the OpenAI-compatible chat/completions endpoint
const OPENAI_COMPAT_ENDPOINTS: Record<string, string> = {
  "gemini-3-flash": "https://api.kie.ai/gemini-3-flash/v1/chat/completions",
  "gemini-3.1-pro": "https://api.kie.ai/gemini-3.1-pro/v1/chat/completions",
  "gpt-5-2": "https://api.kie.ai/gpt-5-2/v1/chat/completions",
};

const AZURE_API_VERSION = "2024-04-01-preview";

const STREAM_HEADERS = { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" };

export async function POST(req: Request) {
  const body = (await req.json()) as {
    messages?: Message[];
    prompt?: string;
    systemPrompt?: string;
    model?: string;
    azureEndpoint?: string;
    azureDeployment?: string;
    azureModelName?: string;
  };

  const model = body.model ?? "claude-sonnet-4-6";

  let messages: Message[];
  if (body.messages && body.messages.length > 0) {
    messages = body.messages;
  } else if (body.prompt?.trim()) {
    messages = [];
    if (body.systemPrompt?.trim()) {
      messages.push({ role: "user", content: body.systemPrompt.trim() });
      messages.push({ role: "assistant", content: "Understood." });
    }
    messages.push({ role: "user", content: body.prompt.trim() });
  } else {
    return json({ error: "messages or prompt is required" }, 400);
  }

  // ── Azure Auto (model-router) ──────────────────────────────────────────────
  if (model === "azure-auto") {
    const azureKey = await db.getAzureApiKey();
    if (!azureKey) return json({ error: "No Azure API key configured. Add one in Settings." }, 401);

    // Normalise: strip trailing slashes and any /openai suffix users may have pasted
    const endpoint = (body.azureEndpoint ?? "").trim().replace(/\/+$/, "").replace(/\/openai$/i, "");
    const deployment = (body.azureDeployment || "auto-model").trim();
    const modelName = (body.azureModelName || "model-router").trim();
    if (!endpoint) return json({ error: "Azure base URL not configured. Add it in Settings → API Keys." }, 400);

    const upstream = await fetch(`${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${AZURE_API_VERSION}`, {
      method: "POST",
      signal: req.signal,
      headers: { "api-key": azureKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelName,
        messages,
        stream: true,
        max_tokens: 8192,
        temperature: 0.7,
        top_p: 0.95,
        frequency_penalty: 0,
        presence_penalty: 0,
      }),
    });
    if (!upstream.ok) {
      const errText = await upstream.text();
      let errorMsg = errText;
      try {
        const parsed = JSON.parse(errText);
        errorMsg = parsed?.error?.message ?? parsed?.message ?? errText;
      } catch {
        /* use raw text */
      }
      return json({ error: `Azure ${upstream.status}: ${errorMsg}` }, upstream.status);
    }
    return new Response(upstream.body, { headers: STREAM_HEADERS });
  }

  // ── Kie.ai models ─────────────────────────────────────────────────────────
  const apiKey = await db.getKieApiToken();
  if (!apiKey) return json({ error: NO_KIE_KEY }, 401);

  const openaiEndpoint = OPENAI_COMPAT_ENDPOINTS[model];
  const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };

  const upstream = openaiEndpoint
    ? await fetch(openaiEndpoint, {
        method: "POST",
        signal: req.signal,
        headers,
        body: JSON.stringify({
          messages: messages.map((m) => ({ role: m.role, content: [{ type: "text", text: m.content }] })),
          stream: true,
        }),
      })
    : await fetch("https://api.kie.ai/claude/v1/messages", {
        method: "POST",
        signal: req.signal,
        headers,
        body: JSON.stringify({ model, messages, stream: true, thinkingFlag: true, max_tokens: 4096 }),
      });

  if (!upstream.ok) return json({ error: await upstream.text() }, upstream.status);
  return new Response(upstream.body, { headers: STREAM_HEADERS });
}
