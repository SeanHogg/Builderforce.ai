import type { ReactNode } from 'react';

/**
 * Render catalog copy (a plain string, so the message catalogs stay JSX-free) with its
 * `backtick`-wrapped tokens as inline <code>. Shared by every marketing surface that
 * names a command or a tool in its copy.
 */
export function renderInlineCode(text: string): ReactNode {
  if (!text.includes('`')) return text;
  return text.split(/(`[^`]+`)/).map((part, i) =>
    part.startsWith('`') && part.endsWith('`') ? <code key={i}>{part.slice(1, -1)}</code> : part,
  );
}
