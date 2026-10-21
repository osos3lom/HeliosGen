// Port of app/api/download/route.ts. Callers turn the body into a Blob and
// click an <a download>, so this just returns the bytes. There is no proxy:
// local media comes from OPFS, remote media is fetched directly (CORS).
import { isLocalMediaPath, readMedia } from "@/lib/browser/media";
import { json } from "../http";

export async function GET(_req: Request, { url: reqUrl }: { url: URL }) {
  const url = reqUrl.searchParams.get("url");
  const filename = reqUrl.searchParams.get("filename") ?? "download";
  if (!url) return new Response("Missing url", { status: 400 });

  const headers = (type: string) => ({
    "Content-Type": type || "application/octet-stream",
    "Content-Disposition": `attachment; filename="${filename}"`,
  });

  if (isLocalMediaPath(url)) {
    const file = await readMedia(url);
    if (file) return new Response(file, { headers: headers(file.type) });
  }

  let upstream: Response;
  try {
    upstream = await fetch(url);
  } catch {
    // The host blocks cross-origin reads; let the browser open it instead so
    // the user can still save it.
    window.open(url, "_blank", "noopener");
    return json({ error: "This host doesn't allow in-browser downloads; opened it in a new tab." }, 502);
  }
  if (!upstream.ok) return new Response("Upstream error", { status: upstream.status });
  return new Response(upstream.body, { headers: headers(upstream.headers.get("content-type") ?? "") });
}
