// Port of app/api/credit/route.ts. Next cached the upstream call for 60 s
// (`revalidate: 60`); an in-memory cache keeps the same behaviour.
import * as db from "@/lib/browser/db";
import { NO_KIE_KEY, json } from "../http";

const TTL_MS = 60_000;
let cache: { key: string; at: number; data: unknown } | null = null;

export async function GET() {
  const apiKey = await db.getKieApiToken();
  if (!apiKey) return json({ error: NO_KIE_KEY }, 401);
  if (cache && cache.key === apiKey && Date.now() - cache.at < TTL_MS) return json(cache.data);

  const res = await fetch("https://api.kie.ai/api/v1/chat/credit", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) return json({ error: "Failed to fetch credit" }, res.status);

  const data = await res.json();
  cache = { key: apiKey, at: Date.now(), data };
  return json(data);
}
