/**
 * `next/link` shim for the VS Code canvas bundle.
 *
 * Renders a plain anchor and routes the click through the shared host port, so an
 * in-app link opens the right editor panel (or the external browser) instead of
 * trying to navigate the webview document — which would blank the panel with no
 * way back. It forwards its ref like `next/link` does, so `ButtonLink` can pass one.
 */

import { forwardRef, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { canvasNavigate } from '@/lib/canvasHost';

/** Exported like `next/link`'s own, so `ui/Button`'s `ButtonLink` types against the shim. */
export type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: string | { pathname: string };
  children?: ReactNode;
  /** Accepted and ignored — there is nothing to prefetch in a webview. */
  prefetch?: boolean;
  replace?: boolean;
  scroll?: boolean;
};

const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { href, children, prefetch: _prefetch, replace: _replace, scroll: _scroll, onClick, ...rest },
  ref,
) {
  const path = typeof href === 'string' ? href : href.pathname;
  return (
    <a
      {...rest}
      ref={ref}
      href={path}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        event.preventDefault();
        canvasNavigate(path);
      }}
    >
      {children}
    </a>
  );
});

export default Link;
