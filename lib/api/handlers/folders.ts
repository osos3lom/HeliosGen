// Port of app/api/folders/route.ts, app/api/folders/[id]/route.ts and
// app/api/folder-items/route.ts.
import { GUEST_USER_ID } from "@/lib/guestMode";
import * as db from "@/lib/browser/db";
import { json, type RouteModule } from "../http";

export const folders: RouteModule = {
  GET: async () => {
    const [folderList, folderItems] = await Promise.all([db.getFolders(GUEST_USER_ID), db.getFolderItems(GUEST_USER_ID)]);
    return json({ folders: folderList, folderItems });
  },
  POST: async (req) => {
    const { name, parentId = null, orderIndex = 0 } = (await req.json()) as {
      name: string;
      parentId?: string | null;
      orderIndex?: number;
    };
    if (!name || typeof name !== "string") return json({ error: "Missing name" }, 400);
    const folder = await db.insertFolder({
      id: crypto.randomUUID(),
      user_id: GUEST_USER_ID,
      name,
      parent_id: parentId ?? null,
      order_index: orderIndex,
    });
    return json({ folder });
  },
};

export const folderById: RouteModule = {
  PATCH: async (req, { params }) => {
    const body = (await req.json()) as { name?: string; parentId?: string | null; orderIndex?: number; color?: string | null };
    await db.updateFolder(params.id, GUEST_USER_ID, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.parentId !== undefined ? { parent_id: body.parentId ?? null } : {}),
      ...(body.orderIndex !== undefined ? { order_index: body.orderIndex } : {}),
      ...(body.color !== undefined ? { color: body.color } : {}),
    });
    return json({ ok: true });
  },
  DELETE: async (_req, { params }) => {
    await db.deleteFolder(params.id, GUEST_USER_ID);
    return json({ ok: true });
  },
};

async function readItems(req: Request): Promise<{ folderId: string; itemIds: string[] } | null> {
  const { folderId, itemIds } = (await req.json()) as { folderId: string; itemIds: string[] };
  return folderId && Array.isArray(itemIds) ? { folderId, itemIds } : null;
}

export const folderItems: RouteModule = {
  POST: async (req) => {
    const body = await readItems(req);
    if (!body) return json({ error: "Missing folderId or itemIds" }, 400);
    await db.insertFolderItems(body.folderId, body.itemIds, GUEST_USER_ID);
    return json({ ok: true });
  },
  DELETE: async (req) => {
    const body = await readItems(req);
    if (!body) return json({ error: "Missing folderId or itemIds" }, 400);
    await db.deleteFolderItems(body.folderId, body.itemIds, GUEST_USER_ID);
    return json({ ok: true });
  },
};
