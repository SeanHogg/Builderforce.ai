/**
 * Who uses whom, by partition: rows use columns, each cell the number of references and
 * coloured by its worst verdict (a climbed or skipped layer). The insight beside the
 * Partitions lens. Scrolls sideways at phone width rather than shrinking the numbers.
 */

import { useMemo } from 'react';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import type { KnowledgeGraphLabels } from './labels';
import { matrixKey, partitionMatrix } from './graphModel';
import { cssVar } from './scene/themeColors';
import { heading, muted } from './styles';

export function PartitionMatrix({ graph, labels }: { graph: KnowledgeGraph; labels: KnowledgeGraphLabels }) {
    const { partitions, cells } = useMemo(() => partitionMatrix(graph), [graph]);
    if (partitions.length === 0) return <p style={muted}>{labels.matrixEmpty}</p>;
    const cellStyle = { padding: '8px 10px', borderBottom: `1px solid ${cssVar('border')}`, textAlign: 'center' as const, minWidth: 44 };
    return (
        <section aria-label={labels.matrixTitle} style={{ display: 'grid', gap: 8 }}>
            <h3 style={heading}>{labels.matrixTitle}</h3>
            <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', fontSize: 12, color: cssVar('text') }}>
                    <thead>
                        <tr>
                            <th scope="col" style={{ ...cellStyle, textAlign: 'start' }}>{labels.matrixFrom} \ {labels.matrixTo}</th>
                            {partitions.map((p) => <th key={p} scope="col" style={cellStyle}>{p}</th>)}
                        </tr>
                    </thead>
                    <tbody>
                        {partitions.map((from) => (
                            <tr key={from}>
                                <th scope="row" style={{ ...cellStyle, textAlign: 'start' }}>{from}</th>
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
