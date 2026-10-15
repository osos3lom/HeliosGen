// Transitional stand-in for `next/link`, backed by react-router.
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { Link as RRLink } from "react-router";

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string;
  replace?: boolean;
  prefetch?: boolean;
  scroll?: boolean;
  children?: ReactNode;
};

export default function Link({ href, replace, prefetch: _prefetch, scroll: _scroll, ...rest }: Props) {
  return <RRLink to={href} replace={replace} {...rest} />;
}
