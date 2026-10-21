/** Small Response helpers shared by the in-browser API handlers. */

export type RouteContext = { params: Record<string, string>; url: URL };
export type RouteHandler = (req: Request, ctx: RouteContext) => Response | Promise<Response>;
export type RouteModule = Partial<Record<"GET" | "POST" | "PUT" | "PATCH" | "DELETE", RouteHandler>>;

export function json(data: unknown, init: number | ResponseInit = 200): Response {
  const base: ResponseInit = typeof init === "number" ? { status: init } : init;
  const headers = new Headers(base.headers);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(data), { ...base, headers });
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
};

export const NO_KIE_KEY = "No Kie.ai API key configured. Add one in Settings.";
