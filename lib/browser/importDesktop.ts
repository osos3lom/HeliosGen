/**
 * Import a desktop-app export (scripts/export-desktop-data.mjs) into this
 * browser: tables → IndexedDB (lib/browser/db.ts), media → OPFS
 * (lib/browser/media.ts).
 *
 * The zip is streamed, so large media libraries don't have to fit in memory.
 * Importing is additive and idempotent: rows and files that already exist
 * here are kept as they are, so re-importing the same export is harmless.
 *
 * Desktop rows reference media as root-absolute `/generated/...`; they are
 * rewritten to the base-relative `generated/...` this build uses so they
 * resolve under a GitHub Pages sub-path.
 */
import { Unzip, UnzipInflate } from "fflate";
import { db, type FolderItemRecord, type FolderRecord, type Generation, type GuestSpace, type Upload } from "./db";
import { readMedia, writeMedia } from "./media";

export const EXPORT_FORMAT = "heliosgen-desktop-export";
const SUPPORTED_VERSION = 1;
const SECRET_KEYS = new Set(["kie_api_token", "azure_api_key"]);

export type ImportProgress = { stage: string; fraction?: number };

export interface ImportSummary {
  generations: { added: number; skipped: number };
  uploads: { added: number; skipped: number };
  workflows: { added: number; skipped: number };
  folders: { added: number; skipped: number };
  media: { added: number; skipped: number };
  keys: number;
  /** Workflows that were added, for the caller to merge into the open store. */
  addedSpaces: GuestSpace[];
}

interface Manifest {
  format: string;
  version: number;
  includesKeys?: boolean;
  media?: { files: number; bytes: number };
}

/** Rewrite `/generated/...` media references (anywhere in a value) to `generated/...`. */
export function normalizeMediaPaths<T>(value: T): T {
  if (typeof value === "string") return (value.startsWith("/generated/") ? value.slice(1) : value) as T;
  if (Array.isArray(value)) return value.map(normalizeMediaPaths) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = normalizeMediaPaths(v);
    return out as T;
  }
  return value;
}

/** SQLite NULLs become missing fields, matching rows this build writes itself. */
function dropNulls<T extends object>(row: T): T {
  return Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null)) as T;
}

// ── Unzip ─────────────────────────────────────────────────────────────────────

async function readExport(
  file: File,
  onProgress: (p: ImportProgress) => void,
): Promise<{ manifest: Manifest; tables: Record<string, unknown[]>; media: { added: number; skipped: number } }> {
  const texts: Record<string, string> = {};
  const media = { added: 0, skipped: 0 };
  let manifest: Manifest | null = null;
  let failure: Error | null = null;
  // Media writes are chained so files land one at a time, in order.
  let writes: Promise<void> = Promise.resolve();
  const decoder = new TextDecoder();

  const unzip = new Unzip((entry) => {
    const chunks: Uint8Array[] = [];
    entry.ondata = (err, data, final) => {
      if (err) {
        failure ??= err;
        return;
      }
      chunks.push(data);
      if (!final) return;
      const name = entry.name;
      if (name.startsWith("media/") && !name.endsWith("/")) {
        const key = name.slice("media/".length);
        const blob = new Blob(chunks as BlobPart[]);
        writes = writes.then(async () => {
          if (await readMedia(`generated/${key}`)) media.skipped++;
          else {
            await writeMedia(key, blob);
            media.added++;
          }
        });
      } else if (name.endsWith(".json")) {
        const text = chunks.map((c) => decoder.decode(c, { stream: true })).join("") + decoder.decode();
        if (name === "manifest.json") {
          try {
            manifest = JSON.parse(text) as Manifest;
          } catch {
            failure ??= new Error("This zip's manifest is unreadable.");
          }
          if (manifest && manifest.format !== EXPORT_FORMAT) {
            failure ??= new Error("This isn't a HeliosGen desktop export (scripts/export-desktop-data.mjs).");
          } else if (manifest && manifest.version > SUPPORTED_VERSION) {
            failure ??= new Error(`This export is format v${manifest.version}; this app reads up to v${SUPPORTED_VERSION}. Update the app.`);
          }
        } else {
          texts[name] = text;
        }
      }
    };
    entry.start();
  });
  unzip.register(UnzipInflate);

  const reader = file.stream().getReader();
  let read = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    unzip.push(value);
    read += value.byteLength;
    onProgress({ stage: "Reading export", fraction: file.size ? read / file.size : undefined });
    if (failure) {
      await reader.cancel();
      throw failure;
    }
  }
  unzip.push(new Uint8Array(0), true);
  if (failure) throw failure;
  if (!manifest) throw new Error("This zip has no manifest.json — is it a HeliosGen desktop export?");

  onProgress({ stage: "Saving media" });
  await writes;

  const tables: Record<string, unknown[]> = {};
  for (const [name, text] of Object.entries(texts)) {
    const m = name.match(/^tables\/([a-z_]+)\.json$/);
    if (m) tables[m[1]] = JSON.parse(text) as unknown[];
  }
  return { manifest, tables, media };
}

// ── Apply ─────────────────────────────────────────────────────────────────────

export async function importDesktopExport(file: File, onProgress: (p: ImportProgress) => void = () => {}): Promise<ImportSummary> {
  const { manifest, tables, media } = await readExport(file, onProgress);
  onProgress({ stage: "Importing library" });

  const t = <T,>(name: string) => normalizeMediaPaths((tables[name] ?? []) as T[]);
  const summary: ImportSummary = {
    generations: { added: 0, skipped: 0 },
    uploads: { added: 0, skipped: 0 },
    workflows: { added: 0, skipped: 0 },
    folders: { added: 0, skipped: 0 },
    media,
    keys: 0,
    addedSpaces: [],
  };

  await db.transaction("rw", [db.generations, db.uploads, db.asset_cache, db.folders, db.folder_items, db.settings, db.spaces], async () => {
    // Generations: unique by id and by task_id.
    for (const raw of t<Generation>("generations")) {
      const g = dropNulls(raw);
      const exists = (await db.generations.get(g.id)) || (g.task_id && (await db.generations.where("task_id").equals(g.task_id).count()));
      if (exists) summary.generations.skipped++;
      else {
        await db.generations.add(g);
        summary.generations.added++;
      }
    }

    for (const raw of t<Upload>("uploads")) {
      const u = dropNulls(raw);
      if (await db.uploads.get(u.id)) summary.uploads.skipped++;
      else {
        await db.uploads.add(u);
        summary.uploads.added++;
      }
    }

    for (const a of t<{ hash: string; cdn_url: string; mime_type: string; byte_size: number }>("asset_cache")) {
      if (!(await db.asset_cache.get(a.hash))) await db.asset_cache.add(a);
    }

    for (const raw of t<FolderRecord>("folders")) {
      const f = { ...dropNulls(raw), parent_id: raw.parent_id ?? null };
      if (await db.folders.get(f.id)) summary.folders.skipped++;
      else {
        await db.folders.add(f);
        summary.folders.added++;
      }
    }
    for (const fi of t<FolderItemRecord>("folder_items")) {
      if (!(await db.folder_items.get([fi.folder_id, fi.item_id]))) await db.folder_items.add(fi);
    }

    // API keys only when the export deliberately included them, and never
    // over a key already set in this browser.
    if (manifest.includesKeys) {
      for (const s of (tables.settings ?? []) as Array<{ key: string; value: string }>) {
        if (!SECRET_KEYS.has(s.key) || (await db.settings.get(s.key))) continue;
        await db.settings.put(s);
        summary.keys++;
      }
    }

    // Workflows: a workflow already in this browser wins over the import.
    for (const space of t<GuestSpace>("spaces")) {
      if (!space?.id) continue;
      if (await db.spaces.get(space.id)) summary.workflows.skipped++;
      else {
        await db.spaces.add({
          id: space.id,
          name: space.name ?? "Untitled",
          data: space,
          updated_at: Number(space.updatedAt ?? space.createdAt ?? Date.now()),
        });
        summary.addedSpaces.push(space);
        summary.workflows.added++;
      }
    }
  });

  onProgress({ stage: "Done", fraction: 1 });
  return summary;
}
