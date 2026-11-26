/**
 * THE card shell of the stage (the design's `#note`): docked in the stage's top-left corner (not anchored to a mark), a
 * header (the shape's glyph, its mono bold name, its kind at the right), a facts row, an actions row, and, under a rule,
 * the answer to the question being asked. A station, a symbol and a call site all compose this one shell; what differs is
 * only the `facts`, `acts` and `answer` they hand it. Every row wraps, so nothing overflows at 360px. Tokens only.
 */

import type { CSSProperties, ReactNode, Ref } from 'react';
import { cssVar } from '../../scene/themeColors';
import { FONT_MONO, TYPE } from '../ui/type';

/** The card's column inside a narrow stage (the design's `calc(100% - 120px)`) and a wide one (`calc(100% - 130px)`). */
export const NOTE_WIDTH = 360;
export const NARROW_STAGE_PX = 900;

export interface NoteAnswer {
    icon: ReactNode;
    /** The question, bold. */
    lead: string;
    /** What it answers ("3 stations"); may be empty when every station does. */
    text: string;
}

export interface NoteCardProps {
    ariaLabel: string;
    glyph: ReactNode;
    name: string;
    kind: string;
    /** Under the header: a path and lines, a loading or no-symbols note. */
    meta?: ReactNode;
    /** The facts row. */
    facts?: ReactNode;
    /** The actions row. */
    acts?: ReactNode;
    answer?: NoteAnswer | null | undefined;
    /** The stage box is narrow (≤ 900px): the card leaves 120px at the right for the level rail. */
    narrow?: boolean | undefined;
    boxRef?: Ref<HTMLElement> | undefined;
    /** `data-*` role of this card (`station`, `symbol`, `call-site`). */
    role: string;
}

const shell = (narrow: boolean): CSSProperties => ({
    position: 'absolute', zIndex: 3, left: 10, top: 10, width: `min(${NOTE_WIDTH}px, calc(100% - ${narrow ? 120 : 130}px))`, boxSizing: 'border-box',
    display: 'flex', flexDirection: 'column', borderRadius: 6, background: cssVar('panel'), color: cssVar('muted'), border: `1px solid ${cssVar('border')}`,
    boxShadow: '0 4px 14px rgba(0,0,0,.18)', pointerEvents: 'auto', ...TYPE.body,
});

export function NoteCard({ ariaLabel, glyph, name, kind, meta, facts, acts, answer, narrow = false, boxRef, role }: NoteCardProps) {
    return (
        <section ref={boxRef} aria-label={ariaLabel} data-note-card={role} style={shell(narrow)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px 0', color: cssVar('text') }}>
                {glyph}
                <b title={name} style={{ fontFamily: FONT_MONO, fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{name}</b>
                <span style={{ marginInlineStart: 'auto', ...TYPE.meta, whiteSpace: 'nowrap' }}>{kind}</span>
            </div>
            {meta && <div style={{ padding: '2px 12px 0', minWidth: 0, overflowWrap: 'anywhere' }}>{meta}</div>}
            {facts && <div data-note-facts style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', padding: '6px 12px 0' }}>{facts}</div>}
            {acts && <div data-note-acts style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '9px 12px 10px' }}>{acts}</div>}
            {answer && (
                <div data-note-answer style={{ display: 'flex', gap: 8, padding: '9px 12px 10px', borderTop: `1px solid ${cssVar('border')}` }}>
                    <span aria-hidden="true" style={{ display: 'inline-flex', marginTop: 1, color: cssVar('accent') }}>{answer.icon}</span>
                    <p style={{ margin: 0, minWidth: 0 }}><b style={{ color: cssVar('text'), fontWeight: 600 }}>{answer.lead}</b>{answer.text ? ` ${answer.text}` : ''}</p>
                </div>
            )}
        </section>
    );
}
