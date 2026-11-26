/** The two buttons of an anti-pattern block: *Fix* (Resolve on a finding; absent finding ⇒ "Re-review to get a fix", when asked) beside *Show in Tower*. */

import type { Finding } from '@seanhogg/builderforce-memory/knowledge';
import { fillTemplate, type KnowledgeGraphLabels } from './labels';
import { button, muted, primaryButton } from './styles';

export interface AntiPatternActionsProps {
    labels: KnowledgeGraphLabels;
    title: string;
    fix: Finding | undefined;
    onResolve: ((finding: Finding) => void) | undefined;
    /** Absent ⇒ no Tower to show it in: the button is disabled, not hidden. */
    tower: (() => void) | undefined;
    /** Say "Re-review to get a fix" when there is no finding to fix. */
    hint?: boolean;
}

export function AntiPatternActions({ labels, title, fix, onResolve, tower, hint }: AntiPatternActionsProps) {
    const t = labels.surface.patterns.block;
    return (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {fix
                ? <button type="button" style={{ ...primaryButton, borderRadius: 8 }} disabled={!onResolve} aria-label={fillTemplate(t.fixAria, { title })} onClick={() => onResolve?.(fix)}>{t.fix}</button>
                : hint && <span role="status" style={muted}>{t.reReview}</span>}
            <button type="button" style={{ ...button, borderRadius: 8 }} disabled={!tower} onClick={tower}>{t.showInTower}</button>
        </div>
    );
}
