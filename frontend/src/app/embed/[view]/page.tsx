'use client';

import { useParams } from 'next/navigation';
import { isEmbedView, EMBED_VIEWS } from '@seanhogg/builderforce-embedded';
import { useEmbedFrame, type EmbedFrameState } from '../../../lib/embed/useEmbedFrame';

/**
 * The framed BuilderForce surface. ONE dynamic route serves every embeddable
 * view (DRY) — `/embed/<view>` is mounted inside an <BuilderForceEmbed> on the
 * host (e.g. BurnRateOS). It completes the postMessage handshake (token, resize,
 * deep links) via useEmbedFrame, then renders the surface for `view`.
 *
 * Feature surfaces (kanban board, SOC 2 tracker, …) register in `renderSurface`
 * as they are built against the `/v1` API; until then a view shows a connected
 * scaffold so the embed transport can be wired end-to-end from the host today.
 */
export default function EmbedViewPage() {
  const params = useParams<{ view: string }>();
  const view = params?.view ?? '';
  const frame = useEmbedFrame();

  const wrap = (children: React.ReactNode) => (
    <div
      data-theme={frame.theme}
      style={{
        minHeight: '100vh',
        padding: 24,
        font: '14px system-ui, -apple-system, sans-serif',
        background: frame.theme === 'dark' ? '#0b1220' : '#ffffff',
        color: frame.theme === 'dark' ? '#e2e8f0' : '#0f172a',
        boxSizing: 'border-box',
      }}
    >
      {children}
    </div>
  );

  if (!isEmbedView(view)) {
    frame.reportError(`Unknown embed view: ${view}`);
    return wrap(<strong role="alert">Unknown BuilderForce view: {view}</strong>);
  }

  const meta = EMBED_VIEWS[view];

  if (!frame.ready) {
    return wrap(
      <div style={{ color: '#64748b' }}>Connecting to BuilderForce — {meta.label}…</div>,
    );
  }

  return wrap(renderSurface(view, frame, meta.label, meta.pillar));
}

/**
 * Surface registry seam. Replace a branch with the real feature component once
 * its `/v1` API exists — the host, transport, and auth are already done.
 */
function renderSurface(
  view: string,
  frame: EmbedFrameState,
  label: string,
  pillar: string,
): React.ReactNode {
  // (future) switch (view) { case 'kanban': return <KanbanBoard frame={frame} />; … }
  void view;
  const segment = frame.accountId && frame.companyId
    ? `${frame.accountId} / ${frame.companyId}`
    : 'default segment';
  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 600 }}>{label}</div>
      <div style={{ color: '#64748b', marginTop: 4, textTransform: 'capitalize' }}>{pillar} surface</div>
      <div
        style={{
          marginTop: 20,
          padding: 16,
          borderRadius: 8,
          border: '1px solid #e2e8f0',
          background: frame.theme === 'dark' ? '#111a2e' : '#f8fafc',
        }}
      >
        <div>✓ Embedded and authenticated (segment: {segment}).</div>
        <div style={{ color: '#64748b', marginTop: 6 }}>
          The {label} surface renders here once its <code>/v1</code> API lands. The host embed,
          token handoff, resize, and deep-link sync are wired.
        </div>
      </div>
    </div>
  );
}
