'use client';
/**
 * A code-analysis report in the ONE `KnowledgeGraphView` (PRD 38 §4.10). This is only the
 * adapter: the report becomes a source (`codeAnalysisSource`), its views are the Structure,
 * Duplication, Unused and Compare lenses (named in the report's own words, as tabs), and a
 * finding's range opens through the host's `openSource`. Web and the VS Code audit panel
 * mount it unchanged.
 */
import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { KnowledgeGraphView, type KnowledgeGraphLabels, type LensId, type SourceLocation } from '@builderforce/knowledge-graph-view';
import type { AnalysisLocation, CodeAnalysisComparison } from '@builderforce/agent-tools';
import { codeAnalysisSource } from '@/lib/knowledge/codeAnalysisSource';
import { useKnowledgeGraphLabels } from '@/lib/knowledge/labels';

export const CODE_AUDIT_KEYS = ['title', 'graph', 'duplicates', 'unused', 'comparison', 'before', 'after', 'incomparable', 'unknown', 'localChanges', 'complete', 'failed'] as const;

const AUDIT_LENSES: readonly LensId[] = ['structure', 'duplication', 'unused', 'compare'];

export function CodeAuditVisualizer({ analysis, openSource }: { analysis: CodeAnalysisComparison; openSource?: (location: AnalysisLocation, historicalCommit?: string) => void }) {
  const t = useTranslations('codeAudit');
  const graphLabels = useKnowledgeGraphLabels();
  const labels = useMemo<KnowledgeGraphLabels>(() => ({
    ...graphLabels,
    lenses: { ...graphLabels.lenses, structure: t('graph'), duplication: t('duplicates'), unused: t('unused'), compare: t('comparison') },
    compareBefore: t('before'),
    compareAfter: t('after'),
    compareIncomparable: t('incomparable'),
  }), [graphLabels, t]);
  const source = useMemo(() => codeAnalysisSource(analysis), [analysis]);
  const onOpenSource = useMemo(() => (openSource
    ? ({ path, startLine, endLine, revision }: SourceLocation) => (revision ? openSource({ path, startLine, endLine }, revision) : openSource({ path, startLine, endLine }))
    : undefined), [openSource]);

  const { source: provenance, tools, capturedAt } = analysis.current;
  return (
    <section aria-label={t('title')} style={{ display: 'grid', gap: 8, minHeight: 480 }}>
      <p style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>
        <code>{provenance.scope ?? '.'}</code> · {provenance.branch ?? t('unknown')} · <code>{provenance.commit?.slice(0, 12) ?? t('unknown')}</code>
        {' · '}{new Date(capturedAt).toLocaleString()}{provenance.dirty ? ` · ${t('localChanges')}` : ''}
        {tools.map((tool) => <span key={tool.name}> · {tool.name} {tool.version}: {tool.status === 'complete' ? t('complete') : t('failed')}</span>)}
      </p>
      {tools.filter((tool) => tool.error).map((tool) => (
        <pre key={tool.name} style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 'var(--font-size-small)' }}>{tool.name}: {tool.error}</pre>
      ))}
      <KnowledgeGraphView
        source={source}
        labels={labels}
        lenses={AUDIT_LENSES}
        lensControl="tabs"
        {...(onOpenSource ? { onOpenSource } : {})}
      />
    </section>
  );
}
