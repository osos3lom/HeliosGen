import { assetUrl } from "@/src/lib/assetUrl";
export interface GalleryItem {
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
}

/**
 * Display URL for `url` at roughly `w` px. There is no image optimizer on a
 * static host, so this serves the original (resolved against Vite's base);
 * `w` is kept for call-site compatibility and a future client-side thumb cache.
 */
export function thumbSrc(url: string, _w = 96): string {
  return assetUrl(url);
}

/** Local-only app has no real auth; call sites still gate on a truthy token. */
export async function getToken(): Promise<string | undefined> {
  return "guest";
}

const _galleryCacheMem = new Map<string, { items: GalleryItem[]; hasMore: boolean }>();

export const galleryCache = {
  /** Forget every cached tab (e.g. after importing data) so the next view refetches. */
  clear() {
    _galleryCacheMem.clear();
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith("nf-gallery-cache-")) localStorage.removeItem(k);
    } catch { /* storage unavailable */ }
  },
  get(tab: string): { items: GalleryItem[]; hasMore: boolean } | undefined {
    const mem = _galleryCacheMem.get(tab);
    if (mem) return mem;
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(`nf-gallery-cache-${tab}`) : null;
      if (!raw) return undefined;
      const parsed = JSON.parse(raw) as { items: GalleryItem[]; hasMore: boolean };
      _galleryCacheMem.set(tab, parsed);
      return parsed;
    } catch { return undefined; }
  },
  set(tab: string, data: { items: GalleryItem[]; hasMore: boolean }) {
    _galleryCacheMem.set(tab, data);
    try {
      if (typeof window !== "undefined") localStorage.setItem(`nf-gallery-cache-${tab}`, JSON.stringify(data));
    } catch { }
  },
};
