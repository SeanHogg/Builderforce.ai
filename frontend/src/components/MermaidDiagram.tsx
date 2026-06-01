'use client';

import { useEffect, useId, useRef, useState } from 'react';

/**
 * Renders a Mermaid diagram from source. Mermaid is loaded lazily (client-only)
 * so it never runs during SSR and doesn't bloat the initial bundle. LLM-authored
 * Mermaid frequently has syntax errors, so a parse/render failure falls back to
 * showing the raw source in a <pre> rather than throwing and blanking the page.
 */
export function MermaidDiagram({ code }: { code: string }) {
  const reactId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const id = `mermaid-${reactId.replace(/[^a-zA-Z0-9]/g, '')}`;
    (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict' });
        const { svg: out } = await mermaid.render(id, code);
        if (!cancelled) {
          setSvg(out);
          setFailed(false);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, reactId]);

  if (failed) {
    return (
      <pre
        style={{
          margin: '8px 0',
          padding: '10px 12px',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 8,
          overflowX: 'auto',
          fontSize: '0.78rem',
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          color: 'var(--text-primary)',
          whiteSpace: 'pre',
        }}
      >
        <code>{code}</code>
      </pre>
    );
  }

  return (
    <div
      ref={containerRef}
      className="mermaid-diagram"
      style={{ margin: '12px 0', textAlign: 'center', overflowX: 'auto' }}
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    >
      {svg ? undefined : <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>Rendering diagram…</span>}
    </div>
  );
}
