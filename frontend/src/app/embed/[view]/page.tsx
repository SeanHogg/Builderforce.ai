'use client';

export const runtime = 'edge';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { isEmbedView, EMBED_VIEWS, capabilityForView, type EmbedCapability } from '@seanhogg/builderforce-embedded';
import { useEmbedFrame } from '../../../lib/embed/useEmbedFrame';
import { embedApi } from '../../../lib/builderforceApi';
import { TaskMgmtContent } from '../../../components/TaskMgmtContent';
import { BrainPanel } from '../../../components/brain/BrainPanel';
import { EmbedPrdSurface } from '../../../components/embed/EmbedPrdSurface';
import { Soc2Content } from '../../../components/governance/Soc2Content';
import { TrackerSurface } from '../../../components/governance/TrackerSurface';
import { TRACKER_CONFIGS } from '../../../components/governance/trackerConfigs';
import { PokerSurface } from '../../../components/agile/PokerSurface';
import { RetroSurface } from '../../../components/agile/RetroSurface';
import { PmScopeProvider } from '../../../lib/pm/scope';
import { PmVisualizersContent } from '../../../components/pm/PmVisualizersContent';
import { DependencyGraph } from '../../../components/pm/DependencyGraph';
import { RiceMatrix } from '../../../components/pm/RiceMatrix';
import { RoiDashboard } from '../../../components/pm/RoiDashboard';

/**
 * The framed BuilderForce surface. ONE dynamic route serves every embeddable
 * view (DRY) — `/embed/<view>` is mounted inside <BuilderForceEmbed> on the host
 * (e.g. BurnRateOS). It completes the postMessage handshake (token, resize, deep
 * links) via useEmbedFrame, SELF-GATES on the host's enabled embed capabilities,
 * then RESURFACES the existing app component for `view`.
 *
 * Wired today (resurfaced, not reimplemented): kanban + backlog → TaskMgmtContent.
 * Views marked `available: false` in EMBED_VIEWS show a scaffold until their
 * feature/component is wired.
 */
export default function EmbedViewPage() {
  const params = useParams<{ view: string }>();
  const view = params?.view ?? '';
  const frame = useEmbedFrame();
  const [config, setConfig] = useState<{ enabled: boolean; capabilities: EmbedCapability[] } | null>(null);
  const [configError, setConfigError] = useState(false);

  useEffect(() => {
    if (!frame.ready) return;
    let cancelled = false;
    embedApi
      .getConfig()
      .then((cfg) => !cancelled && setConfig({ enabled: cfg.enabled, capabilities: cfg.capabilities }))
      .catch(() => !cancelled && setConfigError(true));
    return () => {
      cancelled = true;
    };
  }, [frame.ready]);

  const wrap = (children: React.ReactNode) => (
    <div
      data-theme={frame.theme}
      style={{
        minHeight: '100vh',
        padding: 16,
        font: '14px system-ui, -apple-system, sans-serif',
        background: frame.theme === 'dark' ? '#0b1220' : '#ffffff',
        color: frame.theme === 'dark' ? '#e2e8f0' : '#0f172a',
        boxSizing: 'border-box',
      }}
    >
      {children}
    </div>
  );

  const notice = (msg: string, tone: 'muted' | 'error' = 'muted') => (
    <div style={{ color: tone === 'error' ? '#dc2626' : '#64748b', padding: 8 }} role={tone === 'error' ? 'alert' : undefined}>
      {msg}
    </div>
  );

  if (!isEmbedView(view)) {
    frame.reportError(`Unknown embed view: ${view}`);
    return wrap(notice(`Unknown BuilderForce view: ${view}`, 'error'));
  }

  const meta = EMBED_VIEWS[view];

  if (!frame.ready) return wrap(notice(`Connecting to BuilderForce — ${meta.label}…`));
  if (configError) return wrap(notice('Could not load embed configuration.', 'error'));
  if (!config) return wrap(notice('Loading…'));

  // Self-gating: the surface decides its own visibility from the host's enabled
  // capabilities — no prop-drilled flags. governance views ⇒ 'security' capability.
  const capability = capabilityForView(view);
  if (!config.enabled) {
    return wrap(notice('This integration is not enabled. A workspace administrator can enable it in BuilderForce → Settings → Integration.'));
  }
  if (!config.capabilities.includes(capability)) {
    return wrap(notice(`The "${capability}" capability is not enabled for this workspace.`));
  }

  if (!meta.available) {
    return wrap(
      <div>
        <div style={{ fontSize: 16, fontWeight: 600 }}>{meta.label}</div>
        <div style={{ color: '#64748b', marginTop: 6 }}>
          This surface is coming soon — the embed transport, auth, and gating are wired; the {meta.label} UI lands with its API.
        </div>
      </div>,
    );
  }

  return wrap(renderSurface(view));
}

/** Resurface the existing app component for a wired view (DRY — reuse, don't rebuild). */
function renderSurface(view: string): React.ReactNode {
  switch (view) {
    case 'kanban':
    case 'backlog':
      // The same task feature the app uses at /tasks — board + list, full CRUD.
      return <TaskMgmtContent />;
    case 'ideas':
      // The full-page Brain (ideation) — same component as /brainstorm.
      return <BrainPanel variant="page" />;
    case 'prd':
      // PRDs & specs, project-scoped via a picker.
      return <EmbedPrdSurface />;
    case 'roadmap':
      // PM visualizers (Timeline / Gantt / Map + Epics + ROI). Portfolio scope by
      // default; reads ?project=<id> when the host deep-links one.
      return (
        <PmScopeProvider>
          <PmVisualizersContent />
        </PmScopeProvider>
      );
    // Standalone PM visualizers — host can embed one surface on its own.
    case 'dependency-graph':
      return <PmScopeProvider><DependencyGraph /></PmScopeProvider>;
    case 'rice-matrix':
      return <PmScopeProvider><RiceMatrix /></PmScopeProvider>;
    case 'roi-dashboard':
      return <PmScopeProvider><RoiDashboard /></PmScopeProvider>;
    case 'soc2':
      // SOC 2 Control Tracker — bespoke (readiness scoreboard + baseline seed).
      return <Soc2Content />;
    case 'poker':
      return <PokerSurface />;
    case 'retros':
      return <RetroSurface />;
    default: {
      // Every other governance tracker is the one generic CRUD surface (DRY).
      const cfg = TRACKER_CONFIGS[view];
      return cfg ? <TrackerSurface {...cfg} /> : null;
    }
  }
}
