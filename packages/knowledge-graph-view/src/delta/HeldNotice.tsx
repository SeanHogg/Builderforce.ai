/**
 * A held run on its Run Delta card (PRD 41 §12.5): "Held: needs review" naming the blocking rules, the "Release run"
 * button (the host asks for confirmation first — `onRelease`), and the released / refused states. Props only.
 */

import { cssVar } from '../scene/themeColors';
import { quietButton } from '../styles';
import { TYPE } from '../surface/ui/type';
import { fillTemplate } from '../template';
import { heldRulesText } from './deltaText';
import type { RunDeltaLabels } from './labels';

export interface HeldNoticeProps {
    rules: readonly string[];
    labels: RunDeltaLabels;
    released?: boolean | undefined;
    /** Absent ⇒ no button (a host that cannot release). */
    onRelease?: (() => void) | undefined;
    /** A release is in flight: the button is disabled. */
    releasing?: boolean | undefined;
    /** The host refused the release. */
    refused?: boolean | undefined;
}

export function HeldNotice({ rules, labels, released, onRelease, releasing, refused }: HeldNoticeProps) {
    const tone = released ? cssVar('muted') : cssVar('sev5');
    return (
        <div data-held={released ? 'released' : 'held'} style={{ display: 'grid', gap: 4, minWidth: 0, paddingInlineStart: 8, borderInlineStart: `3px solid ${tone}` }}>
            <p style={{ ...TYPE.status, margin: 0, color: released ? cssVar('muted') : cssVar('text') }}>{released ? labels.released : labels.held}</p>
            <p data-testid="run-delta-held-rules" style={{ ...TYPE.meta, margin: 0, overflowWrap: 'anywhere' }}>
                {fillTemplate(labels.heldRules, { rules: heldRulesText(labels, rules) })}
            </p>
            {!released && onRelease && (
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <button type="button" onClick={onRelease} disabled={releasing} style={{ ...quietButton, color: cssVar('sev5'), borderColor: cssVar('sev5') }}>
                        {labels.releaseRun}
                    </button>
                    {refused && <span role="alert" style={{ ...TYPE.meta, color: cssVar('sev5'), overflowWrap: 'anywhere', minWidth: 0 }}>{labels.releaseRefused}</span>}
                </div>
            )}
        </div>
    );
}
