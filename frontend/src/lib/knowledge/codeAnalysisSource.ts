/**
 * A code-analysis report as a `KnowledgeGraphSource` (PRD 38 §4.10): the tool result's
 * `CodeAnalysisComparison` becomes the graph the ONE `KnowledgeGraphView` draws.
 *
 *   current    `analysisToExtracted(current)` → memory's `buildGraph` with the ONE pack list
 *   baseline   the same over `comparison.baseline`; comparable exactly when agent-tools'
 *              `compareAnalysis` says so (same scope, repo, branch and complete tools) —
 *              a finding missing from an incomplete run is never shown as resolved
 *   evidence   the report's own issues behind a finding: a clone group's ranges and
 *              snippet (`params.group` is the jscpd issue id), and every unused item of
 *              the finding's kind
 *
 * The report already holds both graphs, so the source is a `snapshot` — painted on the
 * first render, nothing to load. Pure: no I/O.
 */

import { MAX_NODES_CAP, buildGraph, type Finding, type KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { analysisToExtracted, knowledgePacks } from '@builderforce/agent-tools/knowledge';
import { compareAnalysis, type AnalysisIssue, type CodeAnalysisComparison, type CodeAnalysisSnapshot } from '@builderforce/agent-tools';
import type { EvidenceSide, FindingEvidence, KnowledgeGraphSource, SourceLocation } from '@builderforce/knowledge-graph-view';

/** The root id a report's graph is drawn under: its analysed scope. */
export function codeAnalysisRootId(snapshot: CodeAnalysisSnapshot): string {
  return `analysis:${snapshot.source.scope ?? '.'}`;
}

function graphOf(snapshot: CodeAnalysisSnapshot, rootId: string): KnowledgeGraph {
  return buildGraph(
    { rootId, extracted: analysisToExtracted(snapshot, rootId), facts: [], relations: [], packs: knowledgePacks() },
    { maxNodes: MAX_NODES_CAP },
  );
}

/** A clean commit of a hosted repository: the only revision a range can be linked or reopened at. */
function pinnedCommit(snapshot: CodeAnalysisSnapshot): string | undefined {
  return snapshot.source.commit && snapshot.source.dirty === false ? snapshot.source.commit : undefined;
}

function locationsOf(issue: AnalysisIssue, snapshot: CodeAnalysisSnapshot, historical: boolean): SourceLocation[] {
  const commit = pinnedCommit(snapshot);
  const repo = snapshot.source.repository;
  return issue.locations.map((l) => ({
    path: l.path, startLine: l.startLine, endLine: l.endLine,
    // An earlier run's range opens only at the commit it was measured on.
    ...(historical ? (commit ? { revision: commit } : { openable: false }) : {}),
    ...(repo && commit
      ? { href: `${repo}/blob/${encodeURIComponent(commit)}/${l.path.split('/').map(encodeURIComponent).join('/')}#L${l.startLine}` }
      : {}),
  }));
}

/** The report's issues behind one graph finding. */
function issuesBehind(finding: Finding, snapshot: CodeAnalysisSnapshot): AnalysisIssue[] {
  if (finding.kind === 'clone-group') {
    const group = String(finding.params.group ?? '');
    return snapshot.issues.filter((i) => i.kind === 'duplicate' && i.id === group);
  }
  return snapshot.issues.filter((i) => i.kind === finding.kind);
}

export function codeAnalysisSource(analysis: CodeAnalysisComparison, title?: string): KnowledgeGraphSource {
  const { current, baseline } = analysis;
  const rootId = codeAnalysisRootId(current);
  const graph = graphOf(current, rootId);
  const before = baseline ? { graph: graphOf(baseline, rootId), comparable: compareAnalysis(current, baseline).comparable } : null;
  const scope = { rootId, title: title ?? current.source.scope ?? '.', packs: graph.scope.packs };

  return {
    snapshot: { graph, title: scope.title, baseline: before },
    async scopes() { return [scope]; },
    async load(id) { return id === rootId ? graph : null; },
    async baseline(id) { return id === rootId ? before : null; },
    evidence(finding: Finding, side: EvidenceSide): FindingEvidence[] {
      const snapshot = side === 'baseline' && baseline ? baseline : current;
      return issuesBehind(finding, snapshot).map((issue) => ({
        ...(issue.symbol ? { label: issue.symbol } : {}),
        locations: locationsOf(issue, snapshot, snapshot !== current),
        ...(issue.snippet ? { excerpt: issue.snippet } : {}),
      }));
    },
  };
}
