/**
 * `next/link` shim for the VS Code canvas bundle.
 *
 * Renders a plain anchor and routes the click through the shared host port, so an
 * in-app link opens the right editor panel (or the external browser) instead of
 * trying to navigate the webview document — which would blank the panel with no
 * way back.
 */

import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { canvasNavigate } from '@/lib/canvasHost';

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: string | { pathname: string };
  children?: ReactNode;
  /** Accepted and ignored — there is nothing to prefetch in a webview. */
  prefetch?: boolean;
  replace?: boolean;
  scroll?: boolean;
};

export default function Link({ href, children, prefetch: _prefetch, replace: _replace, scroll: _scroll, onClick, ...rest }: LinkProps) {
  const path = typeof href === 'string' ? href : href.pathname;
  return (
    <a
      {...rest}
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
}
