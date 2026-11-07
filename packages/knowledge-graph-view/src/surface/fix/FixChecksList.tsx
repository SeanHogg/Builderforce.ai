/**
 * The four checks of a fix with their live status: a glyph AND a word, never colour alone. A
 * check that failed or never reported says why, as an alert.
 */

import type { FixCheckId, FixCheckStatus } from '../../fixPorts';
import { FIX_CHECK_IDS } from '../../fixPorts';
import type { KnowledgeGraphLabels } from '../../labels';
import { cssVar, type ThemeTone } from '../../scene/themeColors';
import { muted } from '../../styles';
import { TYPE } from '../ui/type';

const GLYPH: Record<FixCheckStatus, string> = { pending: '○', running: '◔', pass: '✓', fail: '✕', skipped: '–', error: '!', agent: '→' };
const TONE: Record<FixCheckStatus, ThemeTone> = { pending: 'muted', running: 'accent', pass: 'agrees', fail: 'violation', skipped: 'muted', error: 'violation', agent: 'accent' };

export interface FixChecksListProps {
    checks: Readonly<Record<FixCheckId, FixCheckStatus>>;
    details: Readonly<Partial<Record<FixCheckId, string>>>;
    labels: KnowledgeGraphLabels;
}

export function FixChecksList({ checks, details, labels }: FixChecksListProps) {
    const t = labels.surface.fix;
    return (
        <ul aria-label={t.checksList} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
            {FIX_CHECK_IDS.map((id) => {
                const status = checks[id];
                const bad = status === 'fail' || status === 'error';
                const why = details[id] ?? (status === 'error' ? t.checkNoReport : undefined);
                return (
                    <li key={id} data-check={id} data-status={status} style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', ...TYPE.bodyLarge, minWidth: 0 }}>
                            <span aria-hidden="true" style={{ ...TYPE.mono, color: cssVar(TONE[status]), width: 14, flex: 'none' }}>{GLYPH[status]}</span>
                            <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{t.check[id]}</span>
                            <span style={{ ...muted, color: cssVar(TONE[status]), flex: 'none' }}>{t.checkStatus[status]}</span>
                        </div>
                        {bad && why && <p role="alert" data-check-why={id} style={{ ...muted, margin: 0, paddingInlineStart: 22, ...TYPE.mono, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', color: cssVar('violation') }}>{why}</p>}
                    </li>
                );
            })}
        </ul>
    );
}
