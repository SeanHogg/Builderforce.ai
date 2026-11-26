/**
 * The journey strip (design prototype `#journey`): ONE row on the panel background under the scene, a top border — the cap "Journey", the path's bold title,
 * ‹ › step buttons, the numbered stops as a sideways-scrolling chip row (`<b>n</b> name`, the current one on the accent wash) and *Copy as Mermaid* at the end.
 * Stepping, Simulate and the Sequence view are elsewhere now: Simulate is a drawer tab, Sequence a view in the toolbar, and the plain-words sentence of the
 * step (`walkthroughSentence`) is the code pane's.
 */

import { CopiedNote, CopyFallback, useCopyText } from '../copyText';
import type { KnowledgeGraphLabels } from '../labels';
import { cssVar } from '../scene/themeColors';
import { ghostButtonStyle } from './ui';
import { TYPE } from './ui/type';
import type { PathModel } from './path';
import { pathMermaid } from './sequenceText';
import type { Station } from './stations';

export interface PathStripProps {
    path: PathModel;
    step: number;
    labels: KnowledgeGraphLabels;
    onStep(n: number): void;
    /** The strip's title ("Web line · GET /users"), made by the root; absent ⇒ "Path". */
    pathTitle?: string | null | undefined;
    /** The stations by id: a chip's tooltip is its file path. Absent ⇒ no tooltip. */
    stations?: ReadonlyMap<string, Station> | undefined;
}

const chip = (on: boolean) => ({
    flex: 'none', border: 0, padding: '4px 8px', borderRadius: 4, font: 'inherit', ...TYPE.pill, fontWeight: on ? 700 : 400, whiteSpace: 'nowrap', cursor: 'pointer',
    color: cssVar(on ? 'text' : 'muted'), background: on ? cssVar('accentSoft') : 'transparent',
} as const);

export function PathStrip({ path, step, labels, onStep, pathTitle, stations }: PathStripProps) {
    const s = labels.surface;
    const copier = useCopyText();
    const last = path.stops.length - 1;
    const at = Math.min(Math.max(step, 0), Math.max(last, 0));
    const mermaid = pathMermaid(path, labels);
    const cap = <h2 style={{ ...TYPE.sectionHeading, flex: 'none' }}>{s.path.journey}</h2>;
    const bar = { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', minWidth: 0, borderTop: `1px solid ${cssVar('border')}`, background: cssVar('panel') } as const;
    if (path.stops.length === 0) {
        return <section aria-label={s.pathTitle} data-testid="kg-path" style={bar}>{cap}<p style={{ ...TYPE.bodyMuted, margin: 0 }}>{s.pathEmpty}</p></section>;
    }
    const arrow = (label: string, to: number, disabled: boolean, glyph: string) => (
        <button type="button" aria-label={label} title={label} disabled={disabled} onClick={() => onStep(to)} style={{ ...ghostButtonStyle(false, true), border: `1px solid ${cssVar('border')}`, background: cssVar('panel'), flex: 'none', opacity: disabled ? 0.45 : 1, cursor: disabled ? 'default' : 'pointer' }}>
            <span aria-hidden="true">{glyph}</span>
        </button>
    );
    return (
        <section aria-label={s.pathTitle} data-testid="kg-path" style={bar}>
            {cap}
            <strong style={{ ...TYPE.subtitle, whiteSpace: 'nowrap', flex: 'none', maxWidth: '40%', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pathTitle || s.pathTitle}</strong>
            {arrow(s.pathBack, at - 1, at <= 0, '‹')}
            {arrow(s.pathNext, at + 1, at >= last, '›')}
            <ol aria-label={s.path.stops} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', gap: 2, minWidth: 0, overflowX: 'auto', flex: 1 }}>
                {path.stops.map((stop, i) => (
                    <li key={stop.id} style={{ display: 'flex', flex: 'none' }}>
                        <button type="button" aria-current={i === at ? 'step' : undefined} title={stations?.get(stop.id)?.path} style={chip(i === at)} onClick={() => onStep(i)}>
                            <b style={{ color: cssVar('accent'), fontWeight: 600, marginInlineEnd: 4 }}>{i + 1}</b>{stop.name}
                        </button>
                    </li>
                ))}
            </ol>
            <button type="button" onClick={() => void copier.copy(mermaid)} style={{ ...ghostButtonStyle(false, false), border: `1px solid ${cssVar('border')}`, background: cssVar('panel'), fontWeight: 400 }}>{labels.copyMermaid}</button>
            <CopiedNote status={copier.status} labels={labels} />
            <CopyFallback status={copier.status} text={mermaid} label={labels.copyMermaid} labels={labels} />
        </section>
    );
}
