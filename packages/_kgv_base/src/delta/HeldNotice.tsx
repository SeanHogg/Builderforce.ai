/**
 * A held run on its Run Delta card (PRD 41 §12.5): "Held: needs review" naming the blocking rules — or "Not measured: held
 * for review" when the run was held because its changes could not be measured — the "Release run" button (the host asks
 * for confirmation first — `onRelease`), and the released / refused states, each refusal in its own words. Props only.
 */

import { cssVar } from '../scene/themeColors';
import { quietButton } from '../styles';
import { TYPE } from '../surface/ui/type';
import { fillTemplate } from '../template';
import type { RunDeltaReleaseRefusal } from '@builderforce/run-delta/contract';
import { heldRulesText } from './deltaText';
import type { RunDeltaLabels } from './labels';

/** The message of each refusal the host answers. */
export function releaseRefusalText(labels: RunDeltaLabels, refusal: RunDeltaReleaseRefusal): string {
    switch (refusal) {
        case 'notHeld': return labels.releaseRefused;
        case 'pending': return labels.releasePending;
        case 'identityRequired': return labels.releaseIdentityRequired;
        case 'notApprover': return labels.releaseNotApprover;
        default: return labels.releaseError;
    }
}

export interface HeldNoticeProps {
    rules: readonly string[];
    /** Held because what the run changed could not be measured (no rules to name). */
    unmeasured?: boolean | undefined;
    labels: RunDeltaLabels;
    released?: boolean | undefined;
    /** Absent ⇒ no button (a host that cannot release). */
    onRelease?: (() => void) | undefined;
    /** A release is in flight: the button is disabled. */
    releasing?: boolean | undefined;
    /** The host refused the release, and why (`true`: it is no longer held). */
    refused?: boolean | RunDeltaReleaseRefusal | undefined;
}

export function HeldNotice({ rules, unmeasured, labels, released, onRelease, releasing, refused }: HeldNoticeProps) {
    const tone = released ? cssVar('muted') : cssVar('sev5');
    const refusal = refused === true ? 'notHeld' : refused || undefined;
    return (
        <div data-held={released ? 'released' : 'held'} style={{ display: 'grid', gap: 4, minWidth: 0, paddingInlineStart: 8, borderInlineStart: `3px solid ${tone}` }}>
            <p style={{ ...TYPE.status, margin: 0, color: released ? cssVar('muted') : cssVar('text') }}>{released ? labels.released : unmeasured ? labels.heldUnmeasured : labels.held}</p>
            {rules.length > 0 && (
                <p data-testid="run-delta-held-rules" style={{ ...TYPE.meta, margin: 0, overflowWrap: 'anywhere' }}>
                    {fillTemplate(labels.heldRules, { rules: heldRulesText(labels, rules) })}
                </p>
            )}
            {!released && onRelease && (
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <button type="button" onClick={onRelease} disabled={releasing} style={{ ...quietButton, color: cssVar('sev5'), borderColor: cssVar('sev5') }}>
                        {labels.releaseRun}
                    </button>
                    {refusal && <span role="alert" data-refusal={refusal} style={{ ...TYPE.meta, color: cssVar('sev5'), overflowWrap: 'anywhere', minWidth: 0 }}>{releaseRefusalText(labels, refusal)}</span>}
                </div>
            )}
        </div>
    );
}
