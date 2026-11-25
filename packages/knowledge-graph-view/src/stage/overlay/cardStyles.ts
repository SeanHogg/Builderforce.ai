/**
 * The look of the stage's floating cards at the code level (the step card, the symbol card): the card itself in a top
 * corner, a chip for a fact about it, and its action buttons. One place, so the cards read as one set. Tokens only.
 */

import type { CSSProperties } from 'react';
import { cssVar } from '../../scene/themeColors';
import { TYPE } from '../../surface/ui/type';

const CARD_PX = 258;

/** A card in the stage's top `side` corner. */
export const card = (side: 'left' | 'right'): CSSProperties => ({
    position: 'absolute', zIndex: 3, top: 12, [side]: 12, width: `min(${CARD_PX}px, calc(100% - 24px))`, boxSizing: 'border-box',
    display: 'grid', gap: 6, padding: '10px 12px 12px', borderRadius: 10, pointerEvents: 'auto',
    background: cssVar('panel'), color: cssVar('text'), border: `1px solid ${cssVar('border')}`, boxShadow: '0 12px 28px color-mix(in srgb, currentColor 18%, transparent)',
});

/** The card's kicker: what it is about, and a note on the right. */
export const kicker: CSSProperties = { ...TYPE.sectionHeading, display: 'flex', justifyContent: 'space-between', gap: 8 };

/** A fact about the card's subject (a count, same file or another, awaited). */
export const chip: CSSProperties = { ...TYPE.meta, padding: '2px 8px', borderRadius: 99, border: `1px solid ${cssVar('border')}`, background: cssVar('bg') };

/** A row of chips that wraps. */
export const chips: CSSProperties = { display: 'flex', gap: 4, flexWrap: 'wrap' };

/** A card action; the primary one on the accent. */
export const action = (primary: boolean): CSSProperties => ({
    ...TYPE.pill, padding: '4px 9px', borderRadius: 5, cursor: 'pointer',
    border: `1px solid ${cssVar(primary ? 'accent' : 'border')}`, background: cssVar(primary ? 'accent' : 'bg'), color: cssVar(primary ? 'onAccent' : 'text'),
});

/** A small toggle button over the map or in the code pane's bar (Follow, Outline, Out, Reset view). */
export const toggleButton: CSSProperties = { ...TYPE.meta, padding: '2px 8px', borderRadius: 6, cursor: 'pointer', border: `1px solid ${cssVar('border')}`, background: 'transparent', color: cssVar('text'), whiteSpace: 'nowrap' };
