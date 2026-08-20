'use client';

import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';

/**
 * Mermaid, kept out of the SERVER bundle. The ONE place that decides this.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
 * `MermaidDiagramView` already loads mermaid with `await import('mermaid')` inside an
 * effect, so it never RUNS on the server. That is not the same as never being BUILT for
 * it: two client components import the view statically, the server build follows them,
 * and webpack emits mermaid's chunk into the server graph — where `next-on-pages` bundles
 * it into the Worker.
 *
 * It is not a small passenger. Mermaid carries cytoscape (for architecture and mindmap
 * diagrams) and a full HTML-entity table, and it was measured as the largest single item
 * in the Worker: a 6.71 MiB shared chunk, in a bundle 1.29 MiB over Cloudflare's 10 MiB
 * ceiling and therefore undeployable. `scripts/check-worker-size.mjs` names it.
 *
 * `ssr: false` is what severs the server edge — the same treatment the 3D canvas, the
 * voice panel and every other heavy view already get in this codebase.
 *
 * ── WHY A WRAPPER RATHER THAN `dynamic()` AT EACH CALL SITE ───────────────────
 * Two components render diagrams (`ChatMessageContent`, `CreationNode`) and more will.
 * A `dynamic(..., { ssr: false })` copied per consumer is a decision each of them can
 * get wrong independently, and one static import anywhere puts the whole 6.71 MiB back.
 * Importing `MermaidDiagram` from here cannot: the laziness lives with the dependency,
 * not with the caller, and the callers did not have to change at all.
 *
 * ── WHAT THE VIEWER SEES ─────────────────────────────────────────────────────
 * Identical. The view's own pre-render state was a centred "rendering diagram" line, and
 * `loading` reproduces it, so the server HTML says what it always said.
 */

function MermaidLoading() {
  const t = useTranslations('common');
  return (
    <div className="mermaid-diagram" style={{ margin: '12px 0', textAlign: 'center', overflowX: 'auto' }}>
      <span style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-small)' }}>{t('renderingDiagram')}</span>
    </div>
  );
}

export const MermaidDiagram = dynamic(
  () => import('./MermaidDiagramView').then((module) => module.MermaidDiagramView),
  { ssr: false, loading: MermaidLoading },
);
