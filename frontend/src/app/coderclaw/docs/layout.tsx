import DocsSidebar from './DocsSidebar';

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="cc-docs-shell">
      <DocsSidebar />
      <article className="cc-docs-content">{children}</article>
      <style>{`
        .cc-docs-shell {
          max-width: 1280px;
          margin: 0 auto;
          padding: 48px 24px 80px;
          display: grid;
          grid-template-columns: 240px 1fr;
          gap: 48px;
        }
        @media (max-width: 900px) {
          .cc-docs-shell {
            grid-template-columns: 1fr;
            gap: 24px;
          }
        }
        .cc-docs-content {
          min-width: 0;
          color: var(--text-secondary);
          line-height: 1.7;
        }
        .cc-docs-content h1 {
          font-family: var(--font-display);
          font-weight: 700;
          font-size: clamp(2rem, 4vw, 2.75rem);
          margin: 0 0 12px;
          color: var(--text-primary);
        }
        .cc-docs-content .lead {
          font-size: 1.075rem;
          color: var(--text-secondary);
          margin: 0 0 32px;
        }
        .cc-docs-content section {
          margin-bottom: 40px;
        }
        .cc-docs-content h2 {
          font-family: var(--font-display);
          font-weight: 700;
          font-size: 1.5rem;
          margin: 32px 0 12px;
          color: var(--text-primary);
        }
        .cc-docs-content h3 {
          font-weight: 600;
          font-size: 1.05rem;
          margin: 20px 0 8px;
          color: var(--text-primary);
        }
        .cc-docs-content p { margin: 0 0 12px; }
        .cc-docs-content ul {
          padding-left: 22px;
          margin: 8px 0 12px;
        }
        .cc-docs-content li { margin-bottom: 4px; }
        .cc-docs-content a {
          color: var(--coral-bright);
          text-decoration: none;
        }
        .cc-docs-content a:hover { text-decoration: underline; }
        .cc-docs-content code {
          font-family: 'JetBrains Mono', ui-monospace, monospace;
          background: rgba(77,158,255,0.1);
          color: var(--coral-bright);
          padding: 1px 6px;
          border-radius: 4px;
          font-size: 0.875em;
        }
        .cc-docs-content pre {
          background: #0a0f1a;
          border: 1px solid var(--border-subtle);
          border-radius: 11px;
          padding: 16px 18px;
          overflow-x: auto;
          margin: 12px 0;
          color: #f0f4ff;
        }
        .cc-docs-content pre code {
          background: transparent;
          color: inherit;
          padding: 0;
          font-size: 0.85rem;
          line-height: 1.55;
        }
        .cc-docs-content table {
          width: 100%;
          border-collapse: collapse;
          margin: 16px 0;
        }
        .cc-docs-content th,
        .cc-docs-content td {
          padding: 10px 12px;
          border: 1px solid var(--border-subtle);
          text-align: left;
        }
        .cc-docs-content th {
          background: color-mix(in srgb, var(--bg-surface) 80%, transparent);
          color: var(--text-primary);
          font-weight: 600;
        }
      `}</style>
    </div>
  );
}
