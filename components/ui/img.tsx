// Image element with the props the app's call sites use (formerly next/image).
// There is no image optimizer on a static host: `sizes`/`quality` are ignored,
// `priority` maps to eager loading, `fill` becomes absolute positioning, and
// root-absolute paths are resolved against Vite's base via assetUrl().
import type { CSSProperties, ImgHTMLAttributes, Ref } from "react";
import { assetUrl } from "@/src/lib/assetUrl";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "width" | "height"> & {
  src: string | { src: string };
  ref?: Ref<HTMLImageElement>;
  width?: number | string;
  height?: number | string;
  fill?: boolean;
  priority?: boolean;
  quality?: number;
  unoptimized?: boolean;
  placeholder?: string;
  blurDataURL?: string;
};

export default function Image({
  src,
  fill,
  priority,
  quality: _quality,
  unoptimized: _unoptimized,
  placeholder: _placeholder,
  blurDataURL: _blurDataURL,
  sizes: _sizes,
  style,
  loading,
  ...rest
}: Props) {
  const raw = typeof src === "string" ? src : src.src;
  const fillStyle: CSSProperties | undefined = fill
    ? { position: "absolute", inset: 0, width: "100%", height: "100%" }
    : undefined;
  return (
    <img
      src={assetUrl(raw)}
      loading={loading ?? (priority ? "eager" : "lazy")}
      decoding="async"
      style={{ ...fillStyle, ...style }}
      {...rest}
    />
  );
}
