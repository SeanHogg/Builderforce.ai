/**
 * The files a run wrote: path, write count, and whether a successful check followed (in words). "Show on graph"
 * focuses the file's node through the drawer's own `onShow` (the focus every drawer uses); a file this graph has no
 * node for says so instead of offering a dead button.
 */

import { useMemo } from 'react';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { fillTemplate, type KnowledgeGraphLabels } from '../../../labels';
import { cssVar } from '../../../scene/themeColors';
import { list, quietButton } from '../../../styles';
import type { AgentRunFile } from '../../../types';
import { TYPE } from '../../ui/type';
import { StateLabel } from '../ui';
import { fileRefFor } from './agentRunsModel';

export interface RunFilesProps {
    files: readonly AgentRunFile[];
    graph: KnowledgeGraph;
    labels: KnowledgeGraphLabels;
    onShow(refs: string[]): void;
}

export function RunFiles({ files, graph, labels, onShow }: RunFilesProps) {
    const t = labels.surface.agentRuns;
    const refs = useMemo(() => new Map(files.map((f) => [f.path, fileRefFor(graph, f.path)])), [files, graph]);
    if (files.length === 0) return <p style={{ ...TYPE.bodyMuted, margin: 0 }}>{t.filesEmpty}</p>;
    return (
        <ul data-testid="kg-agent-run-files" style={{ ...list, gap: 6 }}>
            {files.map((f) => {
                const ref = refs.get(f.path);
                return (
                    <li key={f.path} data-path={f.path} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 10px', minWidth: 0 }}>
                        <code style={{ ...TYPE.mono, color: cssVar('text'), overflowWrap: 'anywhere', flex: '1 1 160px', minWidth: 0 }}>{f.path}</code>
                        <span style={TYPE.meta}>{fillTemplate(t.fileWrites, { count: f.writes })}</span>
                        <StateLabel tone={f.checked ? 'sev1' : 'sev5'}>{f.checked ? t.fileChecked : t.fileUnchecked}</StateLabel>
                        {ref
                            ? <button type="button" style={{ ...quietButton, fontWeight: 500 }} onClick={() => onShow([ref])}>{t.showOnGraph}</button>
                            : <span style={TYPE.meta}>{t.notOnGraph}</span>}
                    </li>
                );
            })}
        </ul>
    );
}
