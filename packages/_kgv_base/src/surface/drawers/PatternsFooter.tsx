/** The pinned footer of the Patterns drawer: what is selected, the promise that nothing changes yet, and the one primary action. */

import type { KnowledgeGraphLabels } from '../../labels';
import { cssVar } from '../../scene/themeColors';
import { primaryButton } from '../../styles';
import { counted } from '../plural';
import { TYPE } from '../ui/type';

export interface PatternsFooterProps {
    labels: KnowledgeGraphLabels;
    /** Groups selected. */
    count: number;
    /** The button's text, already counted ("Preview 2 fixes"). */
    action: string;
    disabled?: boolean;
    onAction(): void;
    /** A second button beside the action (the Preview's Back). */
    secondary?: { label: string; onClick(): void };
    note?: string;
}

export function PatternsFooter({ labels, count, action, disabled, onAction, secondary, note }: PatternsFooterProps) {
    const t = labels.surface.patterns;
    return (
        <div
            data-testid="kg-patterns-footer"
            style={{ position: 'sticky', bottom: 0, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '12px 0 4px', borderTop: `1px solid ${cssVar('border')}`, background: cssVar('bg') }}
        >
            <span style={{ flex: '1 1 160px', ...TYPE.body, color: cssVar('muted') }}>{note ?? `${counted(labels, 'groupSelected', count)} · ${t.footerNote}`}</span>
            {secondary && <button type="button" style={{ ...primaryButton, background: 'transparent', color: cssVar('text'), borderColor: cssVar('border'), borderRadius: 8 }} onClick={secondary.onClick}>{secondary.label}</button>}
            <button type="button" style={{ ...primaryButton, borderRadius: 8 }} disabled={disabled ?? count === 0} onClick={onAction}>{action}</button>
        </div>
    );
}
