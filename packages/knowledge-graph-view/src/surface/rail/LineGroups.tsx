/**
 * The lines of a root with several systems (PRD 41 A9): one group per system under a header with its
 * name, and inside it one subgroup per app when the system has more than one. The row itself is the
 * caller's (`renderLine`), so a group shows exactly what the flat list shows.
 */

import type { ReactNode } from 'react';
import { fillTemplate, type KnowledgeGraphLabels } from '../../labels';
import { cssVar } from '../../scene/themeColors';
import { list } from '../../styles';
import type { Line } from '../lines';
import type { SystemInfo } from '../systems';
import { TYPE } from '../ui/type';
import { groupLines } from './lineGroups';

export interface LineGroupsProps {
    lines: readonly Line[];
    systems: readonly SystemInfo[];
    labels: KnowledgeGraphLabels;
    renderLine(line: Line): ReactNode;
}

export function LineGroups({ lines, systems, labels, renderLine }: LineGroupsProps) {
    const s = labels.surface;
    return (
        <div style={{ display: 'grid', gap: 10 }}>
            {groupLines(lines, systems).map((group) => (
                <section key={group.system} data-system={group.system} aria-label={fillTemplate(s.systems.groupAria, { name: group.name || s.systems.loose })} style={{ display: 'grid', gap: 4 }}>
                    <h4 style={{ ...TYPE.subtitle, margin: 0, color: cssVar('text'), overflowWrap: 'anywhere' }}>{group.name || s.systems.loose}</h4>
                    {group.apps.map((a) => (
                        <div key={a.app} data-app={a.app} style={{ display: 'grid', gap: 2 }}>
                            {a.app !== '' && group.apps.length > 1 && <span style={{ ...TYPE.meta, color: cssVar('muted'), overflowWrap: 'anywhere' }}>{a.app}</span>}
                            <ul style={{ ...list, gap: 2 }}>
                                {a.lines.map((l) => <li key={l.id}>{renderLine(l)}</li>)}
                            </ul>
                        </div>
                    ))}
                </section>
            ))}
        </div>
    );
}
