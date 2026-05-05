import type { ReactNode } from 'react';

/**
 * Shared prose container for /coderclaw/* text-heavy pages (contact,
 * acknowledgements, vs-alternatives, …). Owns its own typography styles so
 * pages just render semantic HTML and don't repeat layout CSS.
 *
 * `width` lets a page request a roomier layout for tables (vs-alternatives)
 * without each page redefining its own max-width media query.
 */
export default function ProsePage({
  children,
  width = 'normal',
}: {
  children: ReactNode;
  width?: 'normal' | 'wide';
}) {
  return (
    <article className={`cc-prose-page cc-prose-${width}`}>
      {children}
      <style>{`
        .cc-prose-page {
          margin: 0 auto;
          padding: 56px 24px 80px;
          color: var(--text-secondary);
          line-height: 1.7;
        }
        .cc-prose-normal { max-width: 720px; }
        .cc-prose-wide   { max-width: 920px; }
        .cc-prose-page h1 {
          font-family: var(--font-display);
          font-weight: 700;
          font-size: clamp(2rem, 4vw, 2.75rem);
          margin: 0 0 12px;
          color: var(--text-primary);
        }
        .cc-prose-page .lead { font-size: 1.05rem; margin: 0 0 32px; }
        .cc-prose-page section { margin-bottom: 36px; }
        .cc-prose-page h2 {
          font-family: var(--font-display);
          font-weight: 700;
          font-size: 1.4rem;
          margin: 24px 0 12px;
          color: var(--text-primary);
        }
        .cc-prose-page h3 {
          font-weight: 600;
          font-size: 1.05rem;
          margin: 20px 0 8px;
          color: var(--text-primary);
        }
        .cc-prose-page p { margin: 0 0 12px; }
        .cc-prose-page ul { padding-left: 22px; margin: 8px 0 12px; }
        .cc-prose-page li { margin-bottom: 4px; }
        .cc-prose-page a {
          color: var(--coral-bright);
          text-decoration: none;
        }
        .cc-prose-page a:hover { text-decoration: underline; }
        .cc-prose-page table {
          width: 100%;
          border-collapse: collapse;
          margin: 16px 0;
        }
        .cc-prose-page th,
        .cc-prose-page td {
          padding: 10px 12px;
          border: 1px solid var(--border-subtle);
          text-align: left;
        }
        .cc-prose-page th {
          background: color-mix(in srgb, var(--bg-surface) 80%, transparent);
          color: var(--text-primary);
          font-weight: 600;
        }
      `}</style>
    </article>
  );
}
