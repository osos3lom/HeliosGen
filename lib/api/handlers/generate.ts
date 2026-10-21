// Port of app/api/generate/route.ts (image generation): Kie.ai and Azure
// Foundry branches. The Codex CLI branch needs a local binary and is gone.
import { IMAGE_MODELS, validateAzureCustomSize } from "@/lib/modelConfig";
import { GUEST_USER_ID } from "@/lib/guestMode";
import * as db from "@/lib/browser/db";
import { ensureStorage, isLocalMediaPath, readMedia, uploadBuffer } from "@/lib/browser/media";
import { ensureKieReachableImages } from "../kieUpload";
import { pollKieJob, setJobResult } from "../jobs";
import { NO_KIE_KEY, errorMessage, json } from "../http";

const CREATE = "https://api.kie.ai/api/v1/jobs/createTask";

/** Resolve every reference to local storage (data: decoded, remote mirrored when CORS allows). */
async function resolveImages(imageUrls: string[]): Promise<string[]> {
  const resolved = await Promise.all(imageUrls.slice(0, 14).map((u) => ensureStorage(u, "references").catch(() => null)));
  return resolved.filter((u): u is string => u !== null);
}

async function fetchBlob(url: string): Promise<Blob> {
  if (isLocalMediaPath(url)) {
    const file = await readMedia(url);
    if (!file) throw new Error(`Local media not found: ${url}`);
    return file;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching image`);
  return res.blob();
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

type Body = {
  model?: string;
  prompt?: string;
  imageUrls?: string[];
  aspectRatio?: string;
  quality?: string;
  azureQuality?: string;
  azureResolution?: string;
  azureBaseUrl?: string;
  azureDeployment?: string;
  azureCustomWidth?: number;
  azureCustomHeight?: number;
  codexProvider?: boolean;
  debugOnly?: boolean;
};

export async function POST(req: Request) {
  const {
    model = "nano-banana-2",
    prompt,
    imageUrls = [],
    aspectRatio = "1:1",
    quality = "1k",
    azureQuality,
    azureResolution,
    azureBaseUrl,
    azureDeployment,
    azureCustomWidth,
    azureCustomHeight,
    codexProvider,
    debugOnly,
  } = (await req.json()) as Body;

  if (debugOnly) {
    console.log("[DEBUG] generate payload:", { model, prompt, imageUrls, aspectRatio, quality, azureQuality, azureResolution, azureCustomWidth, azureCustomHeight });
    return json({ ok: true });
  }
  if (codexProvider) {
    return json({ error: "The Codex CLI provider needs the desktop app; pick Kie.ai or Azure for this model in Settings." }, 400);
  }
  if (!prompt?.trim()) return json({ error: "Prompt is required" }, 400);

  const cfg = IMAGE_MODELS.find((m) => m.id === model);
  if (!cfg) return json({ error: `Unknown model: ${model}` }, 400);

  let localImageUrls: string[] = [];
  try {
    localImageUrls = await resolveImages(imageUrls);
  } catch {
    // mirroring failures are non-fatal — proceed without reference images
  }

  // ── Azure Foundry ───────────────────────────────────────────────────────────
  if (azureBaseUrl && azureDeployment) {
    const azureKey = await db.getAzureApiKey();
    if (!azureKey) return json({ error: "Azure API key is not configured. Add it in Settings." }, 500);

    const resSizeMaps = cfg.azureResolutionSizeMaps ?? {};
    const sizeMap = azureResolution && resSizeMaps[azureResolution] ? resSizeMaps[azureResolution] : (cfg.azureSizeMap ?? {});
    const customSizeError =
      aspectRatio === "custom" && azureCustomWidth && azureCustomHeight ? validateAzureCustomSize(azureCustomWidth, azureCustomHeight) : null;
    const size =
      aspectRatio === "custom" && azureCustomWidth && azureCustomHeight && !customSizeError
        ? `${azureCustomWidth}x${azureCustomHeight}`
        : (sizeMap[aspectRatio] ?? "1024x1024");
    const azQuality = azureQuality || "medium";
    const base = azureBaseUrl.replace(/\/$/, "");
    const apiVersion = cfg.azureApiVersion ?? "2025-04-01-preview";
    const truncatedPrompt = prompt.slice(0, cfg.apiInput.promptMaxLength ?? 32000);
    const hasRefImages = localImageUrls.length > 0;

    const taskId = `azure-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await setJobResult(taskId, { status: "pending", type: "image" }, { provider: "azure", kind: "image" });

    // Runs in the background like the server version; the page polls job-status.
    void (async () => {
      try {
        let res: Response;
        if (hasRefImages) {
          const form = new FormData();
          const blobs = await Promise.all(localImageUrls.slice(0, cfg.maxImages).map(fetchBlob));
          blobs.forEach((b, i) => {
            const type = b.type === "image/jpeg" ? "image/jpeg" : "image/png";
            form.append("image[]", new File([b], `image-${i}.${type === "image/jpeg" ? "jpeg" : "png"}`, { type }));
          });
          form.append("prompt", truncatedPrompt);
          form.append("quality", azQuality);
          form.append("output_format", "png");
          form.append("n", "1");
          if (size && size !== "auto") form.append("size", size);
          res = await fetch(`${base}/openai/deployments/${azureDeployment}/images/edits?api-version=${apiVersion}`, {
            method: "POST",
            headers: { Authorization: `Bearer ${azureKey}` },
            body: form,
          });
        } else {
          const body: Record<string, unknown> = {
            prompt: truncatedPrompt,
            n: 1,
            output_format: "png",
            output_compression: 100,
            quality: azQuality,
          };
          if (size && size !== "auto") body.size = size;
          res = await fetch(`${base}/openai/deployments/${azureDeployment}/images/generations?api-version=${apiVersion}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${azureKey}` },
            body: JSON.stringify(body),
          });
        }

        const txt = await res.text();
        if (!res.ok) {
          let displayError = `Azure error ${res.status}`;
          try {
            const parsed = JSON.parse(txt);
            const code = parsed?.error?.code ?? parsed?.error?.type;
            const friendly: Record<string, string> = { EngineOverloaded: "Model is overloaded right now. Please try again." };
            displayError = code ? (friendly[code] ?? code) : displayError;
          } catch {
            /* not JSON */
          }
          await setJobResult(taskId, { status: "error", error: displayError });
          return;
        }

        const b64 = JSON.parse(txt)?.data?.[0]?.b64_json as string | undefined;
        if (!b64) {
          await setJobResult(taskId, { status: "error", error: "Azure returned no image data" });
          return;
        }

        const imageUrl = await uploadBuffer(base64ToBytes(b64), "image/png", "images");
        await db.insertGeneration({
          task_id: taskId,
          user_id: GUEST_USER_ID,
          generation_type: "image",
          status: "done",
          image_url: imageUrl,
          prompt: prompt.slice(0, 2000),
          model,
          aspect_ratio: aspectRatio,
          quality: azQuality,
          azure_resolution: azureResolution,
          reference_image_urls: hasRefImages ? localImageUrls : undefined,
        });
        await setJobResult(taskId, { status: "done", imageUrl });
      } catch (e) {
        // A TypeError from fetch here almost always means the endpoint blocked CORS.
        const msg = e instanceof TypeError ? `Couldn't reach Azure from the browser (CORS or network): ${e.message}` : errorMessage(e);
        console.error("[azure] background error:", e);
        await setJobResult(taskId, { status: "error", error: msg });
      }
    })();

    return json({ taskId });
  }

  // ── Kie.ai ──────────────────────────────────────────────────────────────────
  const kieToken = await db.getKieApiToken();
  if (!kieToken) return json({ error: NO_KIE_KEY }, 401);

  try {
    const { apiInput } = cfg;
    const hasImages = localImageUrls.length > 0;
    const resolvedApiId = !hasImages && cfg.textOnlyApiId ? cfg.textOnlyApiId : cfg.apiId;

    // kie.ai can't fetch local media, so push references to its temp store.
    const kieImageUrls = hasImages ? await ensureKieReachableImages(localImageUrls, kieToken) : [];

    const input: Record<string, unknown> = {
      prompt: prompt.slice(0, apiInput.promptMaxLength),
      [apiInput.aspectRatioKey]: aspectRatio,
    };
    if (apiInput.outputFormat) input.output_format = apiInput.outputFormat;
    if (apiInput.imageInputKey && hasImages) input[apiInput.imageInputKey] = kieImageUrls.slice(0, cfg.maxImages);
    if (apiInput.qualityKey) {
      input[apiInput.qualityKey] = apiInput.qualityMap
        ? (apiInput.qualityMap[quality] ?? quality)
        : quality === "4k" ? "4K" : quality === "2k" ? "2K" : quality === "1k" ? "1K" : quality;
    }
    if (apiInput.extra) Object.assign(input, apiInput.extra);

    const res = await fetch(CREATE, {
      method: "POST",
      headers: { Authorization: `Bearer ${kieToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: resolvedApiId, callBackUrl: undefined, input }),
    });
    if (!res.ok) {
      if (res.status === 401) throw new Error("Invalid Kie.ai API key — please update it in Settings.");
      throw new Error(await res.text());
    }
    const d = await res.json();
    if (d.code !== undefined && d.code !== 200) throw new Error(d.msg ?? `API error ${d.code}`);

    const taskId = d.data?.taskId ?? d.data?.id ?? d.taskId ?? d.id;
    if (!taskId) throw new Error("No task ID in response");

    await setJobResult(taskId, { status: "pending", type: "image" }, { provider: "kie", kind: "image", api: "jobs" });
    await db.insertGeneration({
      task_id: taskId,
      user_id: GUEST_USER_ID,
      generation_type: "image",
      status: "pending",
      prompt,
      model,
      aspect_ratio: aspectRatio,
      quality,
      reference_image_urls: localImageUrls,
    });
    pollKieJob(taskId, kieToken, "image");

    return json({ taskId, referenceImageUrls: localImageUrls });
  } catch (e) {
    return json({ error: errorMessage(e) }, 500);
  }
}
