/**
 * Resolve a root-absolute app path ("/HG.svg", "/generated/…") against Vite's
 * base, so it still works when GitHub Pages serves the app from /<repo>/.
 * Remote, data:, blob: and already-relative URLs pass through unchanged.
 */
export function assetUrl(path: string): string {
  if (!path || !path.startsWith("/") || path.startsWith("//")) return path;
  const base = import.meta.env.BASE_URL; // always ends with "/"
  if (base === "/" || path.startsWith(base)) return path;
  return base + path.slice(1);
}

/**
 * Current in-app route under hash routing ("#/chat?id=1" → pathname "/chat",
 * search "?id=1"). For code outside React that used window.location.
 */
export function currentRoute(): { pathname: string; searchParams: URLSearchParams } {
  const hash = window.location.hash.replace(/^#/, "") || "/";
  const url = new URL(hash, "http://x");
  return { pathname: url.pathname, searchParams: url.searchParams };
}
