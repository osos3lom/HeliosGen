// Port of app/api/gallery/route.ts.
import { GUEST_USER_ID } from "@/lib/guestMode";
import * as db from "@/lib/browser/db";
import { json } from "../http";

const LIMIT = 20;

type Item = {
  id: string;
  url: string;
  imageUrls?: string[];
  mediaType: "image" | "video";
  prompt?: string;
  model?: string;
  aspect_ratio?: string;
  quality?: string;
  azure_resolution?: string;
  source: "generation" | "upload";
  created_at: string;
  referenceImageUrls?: string[];
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const mediaType = searchParams.get("type") === "video" ? "video" : "image";
  const page = Math.max(0, Number(searchParams.get("page") ?? 0));
  const source = searchParams.get("source") as "generation" | "upload" | null;

  const genItems: Item[] =
    !source || source === "generation"
      ? (await db.getGenerations(GUEST_USER_ID, mediaType)).map((g) => ({
          id: g.id,
          url: (mediaType === "video" ? g.video_url : g.image_url) as string,
          imageUrls: g.image_urls?.length ? g.image_urls : undefined,
          mediaType,
          prompt: g.prompt ?? undefined,
          model: g.model ?? undefined,
          aspect_ratio: g.aspect_ratio ?? undefined,
          quality: g.quality ?? undefined,
          azure_resolution: g.azure_resolution ?? undefined,
          source: "generation" as const,
          created_at: g.created_at,
          referenceImageUrls: g.reference_image_urls?.length ? g.reference_image_urls : undefined,
        }))
      : [];

  const uploadItems: Item[] =
    !source || source === "upload"
      ? (await db.getUploads(GUEST_USER_ID, mediaType)).map((u) => ({
          id: u.id,
          url: u.r2_url,
          mediaType: (u.mime_type?.startsWith("video/") ? "video" : "image") as "image" | "video",
          source: "upload" as const,
          created_at: u.created_at,
        }))
      : [];

  let allItems: Item[];
  if (source) {
    allItems = [...genItems, ...uploadItems];
  } else {
    const seen = new Set<string>();
    allItems = [];
    for (const item of [...genItems, ...uploadItems]) {
      if (!item.url || seen.has(item.url)) continue;
      seen.add(item.url);
      allItems.push(item);
    }
  }

  allItems.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const offset = page * LIMIT;
  return json({
    items: allItems.slice(offset, offset + LIMIT),
    hasMore: allItems.length > offset + LIMIT,
    total: allItems.length,
  });
}

export async function DELETE(req: Request) {
  const { id, source } = (await req.json()) as { id: string; source: "generation" | "upload" };
  if (!id || !source) return json({ error: "Missing id or source" }, 400);
  if (source === "generation") await db.deleteGeneration(id, GUEST_USER_ID);
  else await db.deleteUpload(id, GUEST_USER_ID);
  return json({ ok: true });
}
