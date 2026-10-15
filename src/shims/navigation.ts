// Transitional stand-in for `next/navigation`, backed by react-router.
// Aliased in vite.config.ts; removed in Phase 7 once call sites import
// react-router directly.
import { useMemo } from "react";
import { useLocation, useNavigate, useSearchParams as useRRSearchParams } from "react-router";

export function useRouter() {
  const navigate = useNavigate();
  return useMemo(
    () => ({
      push: (href: string) => navigate(href),
      replace: (href: string) => navigate(href, { replace: true }),
      back: () => navigate(-1),
      forward: () => navigate(1),
      refresh: () => {},
      prefetch: () => {},
    }),
    [navigate],
  );
}

export function usePathname(): string {
  return useLocation().pathname;
}

/** Read-only, like Next's ReadonlyURLSearchParams. */
export function useSearchParams(): URLSearchParams {
  return useRRSearchParams()[0];
}

/** Next's `redirect()` throws during render; outside of it we just navigate the hash. */
export function redirect(href: string): never {
  window.location.hash = href;
  throw new Error(`redirect(${href})`);
}
