/**
 * Who uses whom, by partition: rows use columns, each cell the number of references and
 * coloured by its worst verdict (a climbed or skipped layer). The insight beside the
 * Partitions lens. Scrolls sideways at phone width rather than shrinking the numbers.
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import type { KnowledgeGraphLabels } from './labels';
import { matrixKey, type PartitionCell } from './graphModel';
import { useComputed } from './compute/useComputed';
import { isSmall } from './compute/size';
import { placementLabel } from './placement';

const EMPTY_MATRIX = { partitions: [] as string[], cells: new Map<string, PartitionCell>() };
import { cssVar } from './scene/themeColors';
import { heading, muted } from './styles';

export function PartitionMatrix({ graph, labels }: { graph: KnowledgeGraph; labels: KnowledgeGraphLabels }) {
    const { partitions, cells } = useComputed('partitionMatrix', { graph }, [graph], EMPTY_MATRIX, { inline: isSmall(graph), scope: [graph] }).value ?? EMPTY_MATRIX;
    if (partitions.length === 0) return <p style={muted}>{labels.matrixEmpty}</p>;
    // Rows and columns are placement keys: a community reads as its table label.
    const name = (key: string): string => placementLabel(key, graph, labels);
    const cellStyle = { padding: '8px 10px', borderBottom: `1px solid ${cssVar('border')}`, textAlign: 'center' as const, minWidth: 44 };
    return (
        <section aria-label={labels.matrixTitle} style={{ display: 'grid', gap: 8 }}>
            <h3 style={heading}>{labels.matrixTitle}</h3>
            <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', fontSize: 12, color: cssVar('text') }}>
                    <thead>
                        <tr>
                            <th scope="col" style={{ ...cellStyle, textAlign: 'start' }}>{labels.matrixFrom} \ {labels.matrixTo}</th>
                            {partitions.map((p) => <th key={p} scope="col" style={cellStyle}>{name(p)}</th>)}
                        </tr>
                    </thead>
                    <tbody>
                        {partitions.map((from) => (
                            <tr key={from}>
                                <th scope="row" style={{ ...cellStyle, textAlign: 'start' }}>{name(from)}</th>
                                {partitions.map((to) => {
                                    const cell = cells.get(matrixKey(from, to));
                                    const bad = cell?.verdict === 'upward' || cell?.verdict === 'skips';
                                    return (
                                        <td
                                            key={to}
                                            data-verdict={cell?.verdict ?? ''}
                                            style={{
                                                ...cellStyle,
                                                fontWeight: bad ? 700 : 400,
                                                color: bad ? cssVar('violation') : cell ? cssVar('text') : cssVar('muted'),
                                                background: bad ? cssVar('warnBg') : 'transparent',
                                            }}
                                        >
                                            {cell?.count ?? '·'}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
}
