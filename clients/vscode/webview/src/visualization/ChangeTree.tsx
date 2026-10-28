/**
 * THE CHANGE TREE — the Visualization panel's Changes view (Epic #5330, AC4): every file
 * the run touched, its place in the graph, and the before/after of each hunk. Split from
 * `VisualizationPanel.tsx`, which now switches between three views.
 */
import { useMemo, useState } from 'react';
import { makeT } from '../chat/chatLabels';
import type { LabelBundle } from '../vscodeBridge';
import type { ChangeGraph } from './changeGraph';

/** Git's status word, as the Source Control view beside it words it. */
const STATUS_GLYPH: Record<string, string> = {
  added: 'A', untracked: 'U', modified: 'M', deleted: 'D', renamed: 'R', conflict: '!',
};

/**
 * THE CHANGE TREE — every file the run touched, its place in the graph, and the
 * before/after of each hunk.
 *
 * The diff ROWS are rendered, not summarised: `+`/`-`/` ` per line with the line
 * number on each side is the only representation of a change that reconciles with the
 * Source Control view the user has open in the same window.
 */
export function ChangeTree({ graph, labels, hasEverWritten }: { graph: ChangeGraph; labels: LabelBundle; hasEverWritten: boolean }) {
  const t = makeT(labels);
  /**
   * WHICH file is expanded, as a tri-state:
   *   undefined → follow the first node (the default: open what matters most);
   *   an id    → the user picked this one;
   *   null     → the user closed it, and "closed" must be distinguishable from
   *              "not chosen yet" — otherwise collapsing the first file silently
   *              re-opens it on the next render.
   *
   * It has to be derived rather than seeded: the panel swaps to this view on the
   * FIRST write, which can beat the host's change list, so `nodes` is often still
   * empty at mount and a value seeded once would open nothing when it fills in.
   */
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const open = picked === undefined ? graph.nodes[0]?.id ?? null : picked;
  /** Who each node references, by id → the referenced files' paths. */
  const linked = useMemo(() => {
    const pathOf = new Map(graph.nodes.map((node) => [node.id, node.path] as const));
    const bySource = new Map<string, string[]>();
    for (const edge of graph.edges) {
      const to = pathOf.get(edge.to) ?? edge.to;
      const list = bySource.get(edge.from);
      if (list) list.push(to);
      else bySource.set(edge.from, [to]);
    }
    return bySource;
  }, [graph.nodes, graph.edges]);

  if (graph.nodes.length === 0) {
    // Two empties that mean opposite things, so they must not read alike: a run that
    // has not written yet is still coming, and "nothing has changed" as the answer to
    // that would tell the user the opposite.
    return (
      <div className="bf-viz__empty">
        <p>{hasEverWritten
          ? t('viz.empty', 'This run has not changed any files yet.')
          : t('viz.emptyIdle', 'No run has changed anything yet.')}</p>
      </div>
    );
  }

  return (
    <div className="bf-viz__tree">
      <ul className="bf-viz__files" role="tree" aria-label={t('viz.filesLabel', 'Files changed by this run')}>
        {graph.nodes.map((node) => {
          const expanded = open === node.id;
          const outs = linked.get(node.id) ?? [];
          return (
            <li key={node.id} role="treeitem" aria-expanded={expanded}>
              <button type="button" className="bf-viz__file" onClick={() => setPicked(expanded ? null : node.id)}>
                <span className="bf-viz__glyph" data-status={node.status}>{STATUS_GLYPH[node.status] ?? '?'}</span>
                <span className="bf-viz__path">{node.dir ? `${node.dir}/` : ''}<strong>{node.name}</strong></span>
                <span className="bf-viz__tally"><span className="bf-viz__add">+{node.diff.added}</span>{' '}<span className="bf-viz__del">-{node.diff.removed}</span></span>
              </button>

              {/* THE MATRIX: who this file talks to, and who touched it. */}
              <dl className="bf-viz__matrix">
                <dt>{t('viz.relations', 'References')}</dt>
                <dd>{outs.length === 0 ? t('viz.noRelations', 'none in this change') : outs.join(', ')}</dd>
                <dt>{t('viz.tools', 'Written by')}</dt>
                <dd>{node.tools.length === 0 ? t('viz.noTools', 'no recorded tool call') : node.tools.join(', ')}</dd>
                {!node.diff.tracked && <><dt>{t('viz.untracked', 'State')}</dt><dd>{t('viz.untrackedNote', 'untracked — git has no diff for it')}</dd></>}
              </dl>

              {expanded && (
                <div className="bf-viz__diff" role="group" aria-label={t('viz.diffLabel', 'Before and after')}>
                  {node.diff.hunks.length === 0
                    ? <p className="bf-viz__nodiff">{t('viz.noDiff', 'No diff to show (untracked file).')}</p>
                    : node.diff.hunks.map((hunk, i) => (
                        <table key={i} className="bf-viz__hunk">
                          <caption>{hunk.header}</caption>
                          <tbody>
                            {hunk.rows.map((row, j) => (
                              <tr key={j} data-kind={row.kind} className={`bf-viz__row bf-viz__row--${row.kind}`}>
                                <td className="bf-viz__num">{row.oldLine ?? ''}</td>
                                <td className="bf-viz__num">{row.newLine ?? ''}</td>
                                <td className="bf-viz__sign">{row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ' '}</td>
                                <td className="bf-viz__code">{row.text}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
