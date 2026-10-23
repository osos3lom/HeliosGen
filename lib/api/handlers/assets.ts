// Port of app/api/assets/route.ts to in-browser handler.
import { GUEST_USER_ID } from "@/lib/guestMode";
import * as db from "@/lib/browser/db";
import { json } from "../http";

type Source = "generation" | "upload";

export interface AssetItem {
  id: string;
  url: string;
  imageUrls?: string[];
  mediaType: "image" | "video";
  prompt?: string;
  model?: string;
  aspect_ratio?: string;
  source: Source;
  created_at: string;
}

export async function GET() {
  const items: AssetItem[] = [];

  for (const type of ["image", "video"] as const) {
    const gens = await db.getGenerations(GUEST_USER_ID, type);
    for (const g of gens) {
      const url = (type === "video" ? g.video_url : g.image_url) as string | undefined;
      if (!url) continue;
      items.push({
        id: g.id,
        url,
        imageUrls: g.image_urls?.length ? g.image_urls : undefined,
        mediaType: type,
        prompt: g.prompt ?? undefined,
        model: g.model ?? undefined,
        aspect_ratio: g.aspect_ratio ?? undefined,
        source: "generation",
        created_at: g.created_at,
      });
    }
  }

  const uploads = await db.getUploads(GUEST_USER_ID, "");
  for (const u of uploads) {
    if (!u.r2_url) continue;
    items.push({
      id: u.id,
      url: u.r2_url,
      mediaType: u.mime_type?.startsWith("video/") ? "video" : "image",
      source: "upload",
      created_at: u.created_at,
    });
  }

  const seen = new Set<string>();
  const merged = items.filter((it) => {
    if (seen.has(it.url)) return false;
    seen.add(it.url);
    return true;
  });
  merged.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return json({ items: merged, total: merged.length });
}

export async function DELETE(req: Request) {
  const body = (await req.json()) as {
    items?: { id: string; source: Source }[];
    id?: string;
    source?: Source;
  };
  const targets = body.items ?? (body.id && body.source ? [{ id: body.id, source: body.source }] : []);
  if (targets.length === 0) {
    return json({ error: "Missing items" }, 400);
  }

  for (const { id, source } of targets) {
    if (source === "generation") await db.deleteGeneration(id, GUEST_USER_ID);
    else await db.deleteUpload(id, GUEST_USER_ID);
  }
  return json({ ok: true });
}
