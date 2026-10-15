/**
 * Register public/media-sw.js, which serves OPFS-backed `generated/*` URLs.
 * Scoped to Vite's base so it works under a GitHub Pages project path.
 * Resolves once the worker controls the page (immediately if it already does).
 */
export async function registerMediaWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const base = import.meta.env.BASE_URL;
  try {
    const register = () => navigator.serviceWorker.register(`${base}media-sw.js`, { scope: base });
    // Script fetches occasionally fail transiently right after a server
    // (re)start; one delayed retry covers it.
    await register().catch(() => new Promise((r) => setTimeout(r, 2000)).then(register));
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => {
        const done = () => resolve();
        navigator.serviceWorker.addEventListener("controllerchange", done, { once: true });
        setTimeout(done, 3000); // never block startup on it
      });
    }
  } catch (e) {
    console.warn("[media-sw] registration failed; local media will not load", e);
  }
}
