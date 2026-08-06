'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

/** The theme the page is actually painted in. Mermaid bakes its palette into the
 * generated SVG, so a fixed theme renders dark boxes on a light surface. */
function activeTheme(): 'dark' | 'default' {
  if (typeof document === 'undefined') return 'default';
  const declared = document.documentElement.dataset.theme;
  if (declared === 'light') return 'default';
  if (declared === 'dark') return 'dark';
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'default';
}

/**
 * Renders a Mermaid diagram from source. Mermaid is loaded lazily (client-only)
 * so it never runs during SSR and doesn't bloat the initial bundle. LLM-authored
 * Mermaid frequently has syntax errors, so a parse/render failure falls back to
 * showing the raw source in a <pre> rather than throwing and blanking the page.
 *
 * The palette follows the viewer's theme and re-renders when it changes, so the
 * same diagram is legible on a light canvas and a dark one.
 */
export function MermaidDiagram({ code }: { code: string }) {
  const t = useTranslations('common');
  const reactId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'default'>(activeTheme);

  useEffect(() => {
    const sync = () => setTheme(activeTheme());
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    media?.addEventListener('change', sync);
    return () => { observer.disconnect(); media?.removeEventListener('change', sync); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const id = `mermaid-${reactId.replace(/[^a-zA-Z0-9]/g, '')}`;
    (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({ startOnLoad: false, theme, securityLevel: 'strict' });
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
  }, [code, reactId, theme]);

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
      {svg ? undefined : <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{t('renderingDiagram')}</span>}
    </div>
  );
}
