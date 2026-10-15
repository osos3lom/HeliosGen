// Transitional stand-in for `next/dynamic`: React.lazy + Suspense.
// Everything is client-rendered, so the `ssr` option is meaningless.
import { lazy, Suspense, type ComponentType, type ReactNode } from "react";

type Loader<P> = () => Promise<{ default: ComponentType<P> } | ComponentType<P>>;

export default function dynamic<P extends object>(
  loader: Loader<P>,
  opts: { ssr?: boolean; loading?: () => ReactNode } = {},
): ComponentType<P> {
  const Lazy = lazy(async () => {
    const mod = await loader();
    return "default" in mod ? mod : { default: mod };
  });
  return function Dynamic(props: P) {
    return (
      <Suspense fallback={opts.loading?.() ?? null}>
        <Lazy {...props} />
      </Suspense>
    );
  };
}
