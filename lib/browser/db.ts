import Dexie, { type Table } from "dexie";

/**
 * Browser data store, backed by IndexedDB (Dexie). Replaces the desktop app's
 * SQLite `guest.db` (lib/guest/sqlite.ts + lib/guest/db.ts): same tables, same
 * exported function names, but async. Array columns are stored natively rather
 * than as JSON strings.
 */

export interface Generation {
  id: string;
  user_id: string | null;
  task_id: string;
  generation_type: string;
  status: string;
  prompt?: string;
  model?: string;
  aspect_ratio?: string;
  quality?: string;
  azure_resolution?: string;
  duration?: number;
  kling_mode?: string;
  sound?: boolean;
  reference_image_urls?: string[];
  image_url?: string;
  image_urls?: string[];
  video_url?: string;
  error_msg?: string;
  created_at: string;
  updated_at: string;
}

export interface Upload {
  id: string;
  user_id: string;
  r2_url: string;
  mime_type?: string | null;
  source: string;
  created_at: string;
}

export interface AssetCacheRecord {
  hash: string;
  cdn_url: string;
  mime_type: string;
  byte_size: number;
}

export interface SettingRecord {
  key: string;
  value: string;
}

export interface FolderRecord {
  id: string;
  user_id: string;
  name: string;
  parent_id: string | null;
  order_index: number;
  created_at: string;
  updated_at: string;
  color?: string | null;
}

export interface FolderItemRecord {
  folder_id: string;
  item_id: string;
  user_id: string;
  created_at: string;
}

export interface SpaceRecord {
  id: string;
  name: string;
  data: GuestSpace;
  updated_at: number;
}

export interface GuestSpace {
  id: string;
  name: string;
  nodes: unknown[];
  edges: unknown[];
  nodeCounters: Record<string, number>;
  createdAt: number;
  updatedAt?: number;
  viewport?: { x: number; y: number; zoom: number };
}

/** In-flight provider job, polled from the page (replaces .job-store.json). */
export interface JobRecord {
  task_id: string;
  status: string;
  provider: string;
  kind?: string;
  payload?: unknown;
  result?: unknown;
  created_at: number;
  updated_at: number;
}

class HeliosDB extends Dexie {
  generations!: Table<Generation, string>;
  uploads!: Table<Upload, string>;
  asset_cache!: Table<AssetCacheRecord, string>;
  settings!: Table<SettingRecord, string>;
  folders!: Table<FolderRecord, string>;
  folder_items!: Table<FolderItemRecord, [string, string]>;
  spaces!: Table<SpaceRecord, string>;
  jobs!: Table<JobRecord, string>;

  constructor() {
    super("heliosgen");
    this.version(1).stores({
      generations: "id, &task_id, [user_id+generation_type], created_at",
      uploads: "id, user_id, created_at",
      asset_cache: "hash",
      settings: "key",
      folders: "id, user_id",
      folder_items: "[folder_id+item_id], folder_id, user_id",
      spaces: "id, updated_at",
      jobs: "task_id, status",
    });
  }
}

export const db = new HeliosDB();

const now = (): string => new Date().toISOString();
const byCreatedDesc = (a: { created_at: string }, b: { created_at: string }) =>
  a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0;

// ── Generations ────────────────────────────────────────────────────────────

export async function insertGeneration(
  data: Omit<Generation, "id" | "created_at" | "updated_at">,
): Promise<void> {
  const ts = now();
  // task_id is unique: mirror SQLite's ON CONFLICT(task_id) DO NOTHING.
  await db.transaction("rw", db.generations, async () => {
    if (await db.generations.where("task_id").equals(data.task_id).count()) return;
    await db.generations.add({ ...data, id: crypto.randomUUID(), created_at: ts, updated_at: ts });
  });
}

export async function updateGeneration(
  taskId: string,
  updates: Partial<Pick<Generation, "status" | "image_url" | "image_urls" | "video_url" | "error_msg">>,
): Promise<void> {
  await db.generations.where("task_id").equals(taskId).modify({ ...updates, updated_at: now() });
}

export async function recoverJob(
  taskId: string,
): Promise<Pick<Generation, "status" | "video_url" | "image_url" | "image_urls" | "error_msg"> | null> {
  return (await db.generations.where("task_id").equals(taskId).first()) ?? null;
}

export async function getGenerations(userId: string, type: "image" | "video"): Promise<Generation[]> {
  const rows = await db.generations
    .where("[user_id+generation_type]")
    .equals([userId, type])
    .filter((g) => g.status === "done" && !!(type === "video" ? g.video_url : g.image_url))
    .toArray();
  return rows.sort(byCreatedDesc).slice(0, 5000);
}

export async function deleteGeneration(id: string, userId: string): Promise<void> {
  await db.generations.where("id").equals(id).filter((g) => g.user_id === userId).delete();
}

// ── Uploads ────────────────────────────────────────────────────────────────

export async function insertUpload(data: Omit<Upload, "id" | "created_at">): Promise<void> {
  await db.uploads.add({ ...data, mime_type: data.mime_type ?? null, id: crypto.randomUUID(), created_at: now() });
}

export async function getUploads(userId: string, mimeTypePrefix: string): Promise<Upload[]> {
  const rows = await db.uploads
    .where("user_id")
    .equals(userId)
    .filter((u) => (u.mime_type ?? "").startsWith(mimeTypePrefix))
    .toArray();
  return rows.sort(byCreatedDesc).slice(0, 5000);
}

export async function deleteUpload(id: string, userId: string): Promise<void> {
  await db.uploads.where("id").equals(id).filter((u) => u.user_id === userId).delete();
}

// ── Asset Cache ────────────────────────────────────────────────────────────

export async function lookupAssetHash(hash: string): Promise<string | null> {
  return (await db.asset_cache.get(hash))?.cdn_url ?? null;
}

export async function storeAssetHash(
  hash: string,
  cdnUrl: string,
  mimeType: string,
  byteSize: number,
): Promise<void> {
  await db.asset_cache.put({ hash, cdn_url: cdnUrl, mime_type: mimeType, byte_size: byteSize });
}

// ── Settings ───────────────────────────────────────────────────────────────
// API keys live here, in this browser only. They are sent solely to their own
// provider; a static build has no env fallback (secrets must never be bundled).

export async function getSetting(key: string): Promise<string | null> {
  return (await db.settings.get(key))?.value ?? null;
}
export async function setSetting(key: string, value: string): Promise<void> {
  await db.settings.put({ key, value });
}
export async function deleteSetting(key: string): Promise<void> {
  await db.settings.delete(key);
}

export const getKieApiToken = () => getSetting("kie_api_token");
export const setKieApiToken = (token: string) => setSetting("kie_api_token", token);
export const deleteKieApiToken = () => deleteSetting("kie_api_token");

export const getAzureApiKey = () => getSetting("azure_api_key");
export const setAzureApiKey = (key: string) => setSetting("azure_api_key", key);
export const deleteAzureApiKey = () => deleteSetting("azure_api_key");

// ── Folders ────────────────────────────────────────────────────────────────

export async function getFolders(userId: string): Promise<FolderRecord[]> {
  const rows = await db.folders.where("user_id").equals(userId).toArray();
  return rows.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
}

export async function insertFolder(
  data: Omit<FolderRecord, "created_at" | "updated_at">,
): Promise<FolderRecord> {
  const ts = now();
  const rec: FolderRecord = {
    ...data,
    parent_id: data.parent_id ?? null,
    order_index: data.order_index ?? 0,
    color: data.color ?? null,
    created_at: ts,
    updated_at: ts,
  };
  await db.folders.add(rec);
  return rec;
}

export async function updateFolder(
  id: string,
  userId: string,
  updates: Partial<Pick<FolderRecord, "name" | "parent_id" | "order_index" | "color">>,
): Promise<void> {
  await db.folders
    .where("id")
    .equals(id)
    .filter((f) => f.user_id === userId)
    .modify({ ...updates, updated_at: now() });
}

export async function deleteFolder(id: string, userId: string): Promise<void> {
  await db.transaction("rw", db.folders, db.folder_items, async () => {
    await db.folders.where("id").equals(id).filter((f) => f.user_id === userId).delete();
    await db.folder_items.where("folder_id").equals(id).delete();
  });
}

// ── Folder Items ───────────────────────────────────────────────────────────

export async function getFolderItems(userId: string): Promise<FolderItemRecord[]> {
  return db.folder_items.where("user_id").equals(userId).toArray();
}

export async function insertFolderItems(folderId: string, itemIds: string[], userId: string): Promise<void> {
  const ts = now();
  await db.transaction("rw", db.folder_items, async () => {
    for (const itemId of itemIds) {
      // ON CONFLICT DO NOTHING: keep the original created_at.
      if (await db.folder_items.get([folderId, itemId])) continue;
      await db.folder_items.add({ folder_id: folderId, item_id: itemId, user_id: userId, created_at: ts });
    }
  });
}

export async function deleteFolderItems(folderId: string, itemIds: string[], userId: string): Promise<void> {
  if (itemIds.length === 0) return;
  const ids = new Set(itemIds);
  await db.folder_items
    .where("folder_id")
    .equals(folderId)
    .filter((fi) => fi.user_id === userId && ids.has(fi.item_id))
    .delete();
}

// ── Spaces (workflow canvases) ─────────────────────────────────────────────

export async function getSpaces(): Promise<GuestSpace[]> {
  const rows = await db.spaces.orderBy("updated_at").toArray();
  return rows.map((r) => r.data);
}

/** Replace the full set of spaces (spaces missing from `spaces` are deleted). */
export async function saveSpaces(spaces: GuestSpace[]): Promise<void> {
  await db.transaction("rw", db.spaces, async () => {
    const keep = new Set(spaces.map((s) => s.id));
    await db.spaces.bulkPut(
      spaces.map((s) => ({
        id: s.id,
        name: s.name ?? "Untitled",
        data: s,
        updated_at: Number(s.updatedAt ?? s.createdAt ?? Date.now()),
      })),
    );
    const stale = (await db.spaces.toCollection().primaryKeys()).filter((id) => !keep.has(id));
    if (stale.length) await db.spaces.bulkDelete(stale);
  });
}

// ── Jobs ───────────────────────────────────────────────────────────────────

export async function putJob(job: Omit<JobRecord, "created_at" | "updated_at"> & { created_at?: number }): Promise<void> {
  const ts = Date.now();
  await db.jobs.put({ ...job, created_at: job.created_at ?? ts, updated_at: ts });
}

export async function getJob(taskId: string): Promise<JobRecord | null> {
  return (await db.jobs.get(taskId)) ?? null;
}

export async function getPendingJobs(): Promise<JobRecord[]> {
  return db.jobs.where("status").anyOf("pending", "processing").toArray();
}

export async function deleteJob(taskId: string): Promise<void> {
  await db.jobs.delete(taskId);
}
