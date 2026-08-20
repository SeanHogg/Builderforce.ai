'use client';

/**
 * IncidentTopologySection — the derived RCA topology beside the hand-written analysis.
 *
 * Everything else on this panel is what somebody TYPED. This is what the platform
 * already knew and had never drawn: the classified affected system, the monitors
 * watching it (one of which usually raised the incident), the delivery tickets linked
 * as the implicated change, and the system's prior incidents. The derivation lives on
 * the server (`incidentDependencyGraph`) so it is unit-tested and cached with the
 * incident + monitoring version tokens; this component only renders it.
 */

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { DependencyGraphChart } from '@/components/charts/DependencyGraph';
import { incidentsApi, type IncidentDependencyGraph } from '@/lib/builderforceApi';

type T = ReturnType<typeof useTranslations>;

const card: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 16,
};

export function IncidentTopologySection({ t, incidentId, incidentTitle }: { t: T; incidentId: string; incidentTitle: string }) {
  const [graph, setGraph] = useState<IncidentDependencyGraph | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    incidentsApi.dependencyGraph(incidentId)
      .then((g) => { if (live) setGraph(g); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [incidentId]);

  // A derived panel that failed to load must not push an error card in front of the
  // war room — the incident is the point, this is context.
  if (failed || !graph) return null;
  // One node and no edge is the incident on its own: a picture of nothing.
  if (graph.nodes.length < 2) return null;

  return (
    <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>{t('depGraph.title')}</div>
      <DependencyGraphChart
        nodes={graph.nodes}
        edges={graph.edges}
        ariaLabel={t('depGraph.aria', { title: incidentTitle })}
        backEdgeLabel={t('depGraph.backEdge')}
      />
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('depGraph.legend')}</span>
    </div>
  );
}
