'use client';
import { useCallback, useId, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { compareAnalysis, type AnalysisIssue, type AnalysisLocation, type CodeAnalysisComparison, type CodeAnalysisSnapshot } from '@builderforce/agent-tools';

export const CODE_AUDIT_KEYS = ["title", "graph", "duplicates", "unused", "comparison", "before", "after", "changes", "components", "files", "filter", "zoomIn", "zoomOut", "openSource", "dependsOn", "usedBy", "unknown", "localChanges", "complete", "failed", "views", "firstScan", "incomparable", "candidateNotice", "noFindings", "graphCount", "limited", "legend", "metric", "nodes", "edges", "issues", "duplicate", "unused-file", "unused-export", "unused-dependency", "added", "resolved", "unchanged"] as const;

export function CodeAuditVisualizer({ analysis, openSource }: { analysis: CodeAnalysisComparison; openSource?: (location: AnalysisLocation, historicalCommit?: string) => void }) {
  const t = useTranslations('codeAudit');
  const markerId = useId().replace(/:/g, '');
  const [tab, setTab] = useState<'graph' | 'duplicates' | 'unused' | 'comparison'>('graph');
  const [revision, setRevision] = useState<'before' | 'after' | 'changes'>('after');
  const [level, setLevel] = useState<'components' | 'files'>('components');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState('');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const { current, baseline } = analysis;
  const diff = useMemo(() => compareAnalysis(current, baseline), [current, baseline]);
  const compareView = revision === 'changes' && diff.comparable;
  const snapshot = revision === 'before' && baseline ? baseline : current;
  const group = useCallback((file: string) => level === 'files' ? file : file.split('/').slice(0, file.includes('/') ? 2 : 1).join('/'), [level]);
  const graph = useMemo(() => {
    const files = compareView && baseline ? [...new Set([...baseline.nodes, ...current.nodes])] : snapshot.nodes;
    const names = [...new Set(files.filter((file) => file.toLowerCase().includes(query.toLowerCase())).map(group))].sort();
    const visible = names.slice(0, 160);
    const positions = new Map(visible.map((name, i) => [name, { x: (i % 4) * 240 + 20, y: Math.floor(i / 4) * 95 + 25 }]));
    const edges = compareView && baseline ? [...new Map([...baseline.edges, ...current.edges].map((edge) => [JSON.stringify([edge.from, edge.to]), edge])).values()] : snapshot.edges;
    return { names, visible, positions, edges, files };
  }, [current, baseline, snapshot, query, group, compareView]);
  const edgeId = (edge: { from: string; to: string }) => JSON.stringify([edge.from, edge.to]);
  const oldEdges = new Set(baseline?.edges.map(edgeId));
  const newEdges = new Set(current.edges.map(edgeId));
  const locations = (issue: AnalysisIssue, source: CodeAnalysisSnapshot) => issue.locations.map((location, i) => {
    const text = `${location.path}:${location.startLine}${location.endLine !== location.startLine ? `–${location.endLine}` : ''}`;
    const href = source.source.repository && source.source.commit && source.source.dirty === false
      ? `${source.source.repository}/blob/${encodeURIComponent(source.source.commit)}/${location.path.split('/').map(encodeURIComponent).join('/')}#L${location.startLine}` : undefined;
    const historical = source !== current;
    return <div key={i}>{openSource && !(historical && (source.source.dirty !== false || !source.source.commit)) ? <button type="button" onClick={() => historical ? openSource(location, source.source.commit ?? undefined) : openSource(location)}>{text}</button> : href ? <a href={href} target="_blank" rel="noreferrer">{text}</a> : <code>{text}</code>}</div>;
  });
  const issues = (items: AnalysisIssue[], source = snapshot) => items.length ? items.map((issue) => <article key={issue.id} style={{ padding: 12, border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)' }}>
    <strong>{t(issue.kind)}</strong>{issue.symbol && <code> {issue.symbol}</code>}{locations(issue, source)}
    {issue.snippet && <pre style={{ overflow: 'auto', maxHeight: 180 }}>{issue.snippet}</pre>}
  </article>) : <p>{t('noFindings')}</p>;
  return <section aria-label={t('title')} style={{ display: 'grid', gap: 12 }}>
    <h3>{t('title')}</h3>
    <div><code>{snapshot.source.scope ?? '.'}</code> · {snapshot.source.branch ?? t('unknown')} · <code>{snapshot.source.commit?.slice(0, 12) ?? t('unknown')}</code> · {new Date(snapshot.capturedAt).toLocaleString()}{snapshot.source.dirty ? ` · ${t('localChanges')}` : ''}</div>
    <div>{snapshot.tools.map((tool) => <div key={tool.name}>{tool.name} {tool.version}: {tool.status === 'complete' ? t('complete') : t('failed')}{tool.error && <pre style={{ whiteSpace: 'pre-wrap' }}>{tool.error}</pre>}</div>)}</div>
    <div role="tablist" aria-label={t('views')}>{(['graph', 'duplicates', 'unused', 'comparison'] as const).map((name) => <button type="button" role="tab" aria-selected={tab === name} key={name} onClick={() => setTab(name)}>{t(name)}</button>)}</div>
    <div>{(['before', 'after', 'changes'] as const).map((name) => <button type="button" key={name} disabled={(name !== 'after' && !baseline) || (name === 'changes' && !diff.comparable)} aria-pressed={revision === name} onClick={() => setRevision(name)}>{t(name)}</button>)}</div>
    {!baseline && <p>{t('firstScan')}</p>}
    {!diff.comparable && baseline && <p role="status">{t('incomparable')}</p>}
    {tab === 'graph' && <>
      <div><label>{t('filter')} <input value={query} onChange={(e) => setQuery(e.target.value)} /></label>
        <button type="button" onClick={() => { setLevel(level === 'components' ? 'files' : 'components'); setSelected(''); }}>{t(level)}</button>
        <button type="button" aria-label={t('zoomIn')} onClick={() => setZoom(Math.min(3, zoom + .2))}>+</button>
        <button type="button" aria-label={t('zoomOut')} onClick={() => setZoom(Math.max(.3, zoom - .2))}>−</button>
      </div>
      <div>{t('graphCount', { nodes: snapshot.nodes.length, edges: snapshot.edges.length, cycles: snapshot.edges.filter((edge) => edge.circular).length })}</div>
      {graph.names.length > 160 && <p>{t('limited', { count: graph.names.length })}</p>}
      <div>{t('legend')}</div>
      <svg aria-label={t('graph')} role="img" viewBox="0 0 1000 450" style={{ width: '100%', minHeight: 350, background: 'var(--bg-base)', touchAction: 'none', border: '1px solid var(--border-subtle)' }}
        onPointerDown={(e) => { if (e.target === e.currentTarget) { setDrag({ x: e.clientX, y: e.clientY }); e.currentTarget.setPointerCapture(e.pointerId); } }}
        onPointerMove={(e) => { if (drag) { setPan({ x: pan.x + e.clientX - drag.x, y: pan.y + e.clientY - drag.y }); setDrag({ x: e.clientX, y: e.clientY }); } }} onPointerUp={() => setDrag(null)}>
        <defs><marker id={markerId} viewBox="0 0 10 10" refX={10} refY={5} markerWidth={6} markerHeight={6} orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="var(--text-muted)" /></marker></defs>
        <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
          {graph.edges.map((edge) => {
            const from = graph.positions.get(group(edge.from)); const to = graph.positions.get(group(edge.to));
            if (!from || !to || group(edge.from) === group(edge.to)) return null;
            const removed = compareView && !newEdges.has(edgeId(edge));
            const added = compareView && !oldEdges.has(edgeId(edge));
            return <path key={edgeId(edge)} d={`M${from.x + 100},${from.y + 45} L${to.x + 100},${to.y}`} markerEnd={`url(#${markerId})`} stroke={removed ? 'var(--error)' : added ? 'var(--success)' : edge.circular ? 'var(--warning)' : 'var(--text-muted)'} strokeWidth={edge.circular ? 3 : 1} strokeDasharray={removed ? '5 4' : undefined}><title>{`${edge.from} → ${edge.to}`}</title></path>;
          })}
          {graph.visible.map((name) => { const p = graph.positions.get(name)!;
            const removed = compareView && !current.nodes.some((file) => group(file) === name);
            const added = compareView && !baseline?.nodes.some((file) => group(file) === name);
            return <g key={name} role="button" tabIndex={0} aria-label={name} onClick={() => setSelected(name)} onKeyDown={(e) => { if (e.key === 'Enter') setSelected(name); }}>
              <rect x={p.x} y={p.y} width={215} height={45} rx={5} fill="var(--bg-elevated)" stroke={removed ? 'var(--error)' : added ? 'var(--success)' : selected === name ? 'var(--info)' : snapshot.edges.some((e) => e.circular && group(e.from) === name) ? 'var(--warning)' : 'var(--text-muted)'} strokeWidth={selected === name ? 3 : 1} />
              <text x={p.x + 8} y={p.y + 26} fill="currentColor" fontSize={12}>{name.length > 28 ? `…${name.slice(-27)}` : name}</text><title>{name}</title>
            </g>; })}
        </g>
      </svg>
      {selected && <aside><h4>{selected}</h4>
        {level === 'files' && openSource && <button type="button" disabled={snapshot !== current && (snapshot.source.dirty !== false || !snapshot.source.commit)} onClick={() => openSource({ path: selected, startLine: 1, endLine: 1 }, snapshot !== current ? snapshot.source.commit ?? undefined : undefined)}>{t('openSource')}</button>}
        {level === 'components' && graph.files.filter((file) => group(file) === selected).map((file) => <button type="button" key={file} onClick={() => { setLevel('files'); setQuery(file); setSelected(file); }}>{file}</button>)}
        <h4>{t('dependsOn')}</h4>{snapshot.edges.filter((edge) => group(edge.from) === selected).map((edge) => <div key={edgeId(edge)}>{edge.to}</div>)}
        <h4>{t('usedBy')}</h4>{snapshot.edges.filter((edge) => group(edge.to) === selected).map((edge) => <div key={edgeId(edge)}>{edge.from}</div>)}
        {issues(snapshot.issues.filter((issue) => issue.locations.some((location) => group(location.path) === selected)))}
      </aside>}
    </>}
    {tab === 'duplicates' && issues(snapshot.issues.filter((issue) => issue.kind === 'duplicate'))}
    {tab === 'unused' && <><p>{t('candidateNotice')}</p>{issues(snapshot.issues.filter((issue) => issue.kind !== 'duplicate'))}</>}
    {tab === 'comparison' && <>
      <table><thead><tr><th>{t('metric')}</th><th>{t('before')}</th><th>{t('after')}</th></tr></thead><tbody>
        {(['nodes', 'edges', 'issues'] as const).map((key) => <tr key={key}><th>{t(key)}</th><td>{baseline && baseline.tools.every((tool) => tool.status === 'complete') ? baseline[key].length : '—'}</td><td>{current.tools.every((tool) => tool.status === 'complete') ? current[key].length : '—'}</td></tr>)}
        {(['duplicate', 'unused-file', 'unused-export', 'unused-dependency'] as const).map((kind) => {
          const tool = kind === 'duplicate' ? 'jscpd' : 'knip';
          return <tr key={kind}><th>{t(kind)}</th><td>{baseline?.tools.some((t) => t.name === tool && t.status === 'complete') ? baseline.issues.filter((i) => i.kind === kind).length : '—'}</td><td>{current.tools.some((t) => t.name === tool && t.status === 'complete') ? current.issues.filter((i) => i.kind === kind).length : '—'}</td></tr>;
        })}
      </tbody></table>
      {baseline && <><h4>{t('added')}</h4>{diff.comparable ? issues(diff.added, current) : <p>{t('incomparable')}</p>}<h4>{t('resolved')}</h4>{diff.comparable ? issues(diff.resolved, baseline) : <p>{t('incomparable')}</p>}<h4>{t('unchanged')}</h4>{issues(diff.unchanged, current)}</>}
    </>}
  </section>;
}
