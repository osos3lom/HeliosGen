// Port of app/api/settings/{kie-key,azure-key}/route.ts. Keys stay in this
// browser's IndexedDB; GET only ever reports whether one is set.
import * as db from "@/lib/browser/db";
import { json, type RouteModule } from "../http";

function keyRoute(field: string, get: () => Promise<string | null>, set: (v: string) => Promise<void>, del: () => Promise<void>): RouteModule {
  return {
    GET: async () => json({ hasToken: !!(await get()) }),
    POST: async (req) => {
      const body = (await req.json()) as Record<string, unknown>;
      const value = body[field];
      if (typeof value !== "string" || !value.trim()) return json({ error: `${field} is required` }, 400);
      await set(value.trim());
      return json({ ok: true });
    },
    DELETE: async () => {
      await del();
      return json({ ok: true });
    },
  };
}

export const kieKey = keyRoute("kieApiToken", db.getKieApiToken, db.setKieApiToken, db.deleteKieApiToken);
export const azureKey = keyRoute("azureApiKey", db.getAzureApiKey, db.setAzureApiKey, db.deleteAzureApiKey);
