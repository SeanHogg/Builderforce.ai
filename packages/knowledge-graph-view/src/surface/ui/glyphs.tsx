/**
 * The view's icon glyphs, one module: the camera icons (the View switcher) and the action icons (the selection card's
 * Go inside, Callers, Simulate, Restructure). One 16px box, a 1.6 round stroke, `currentColor`, so a glyph follows its
 * button's text colour in both themes and is decorative (`aria-hidden`): the accessible name is the button's label.
 */

import type { ReactNode } from 'react';

export function Glyph({ children }: { children: ReactNode }) {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style={{ display: 'block', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
            {children}
        </svg>
    );
}

/** One icon per switcher camera (ids from the registry, `cameras.tsx`); an unknown id keeps its text label. */
export function cameraGlyph(id: string): ReactNode {
    switch (id) {
        // Transit: an isometric map — two offset sheets.
        case 'transit': return <Glyph><rect x="2.5" y="5.5" width="8" height="8" rx="1" /><rect x="5.5" y="2.5" width="8" height="8" rx="1" /></Glyph>;
        // System: three stacked layers.
        case 'system': return <Glyph><path d="M8 2.5 13.5 5 8 7.5 2.5 5 8 2.5z" /><path d="M2.5 8 8 10.5 13.5 8M2.5 11 8 13.5 13.5 11" /></Glyph>;
        // Graph: three connected nodes.
        case 'graph': return <Glyph><path d="M5.7 4.9l4.6 1.2M4.6 6.1l1.8 4.3M10.9 7.8l-2.7 2.9" /><circle cx="4" cy="4.5" r="1.7" /><circle cx="12" cy="6.5" r="1.7" /><circle cx="7" cy="12" r="1.7" /></Glyph>;
        // Map: a radial mind-map — center dot, three spokes.
        case 'map': return <Glyph><path d="M8 6.5V4.2M9.3 8.8l2.4 1.6M6.7 8.8l-2.4 1.6" /><circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none" /><circle cx="8" cy="3" r="1.2" /><circle cx="12.8" cy="11.2" r="1.2" /><circle cx="3.2" cy="11.2" r="1.2" /></Glyph>;
        // 3D: a cube.
        case '3d': return <Glyph><path d="M8 2.5 13 5v6l-5 2.5L3 11V5l5-2.5z" /><path d="M3 5l5 2.5L13 5M8 7.5v6" /></Glyph>;
        // Heat: three rising bars.
        case 'heat': return <Glyph><path d="M4 13V9.5M8 13V6M12 13V3" /></Glyph>;
        // Style: a half-filled swatch circle.
        case 'style': return <Glyph><circle cx="8" cy="8" r="5.5" /><path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" stroke="none" /></Glyph>;
        // Features: a flag.
        case 'features': return <Glyph><path d="M4 13.5V2.5M4 3h8l-2 2.5 2 2.5H4" /></Glyph>;
        // List: three horizontal lines.
        case 'list': return <Glyph><path d="M3 4.5h10M3 8h10M3 11.5h10" /></Glyph>;
        default: return undefined;
    }
}

/** The action glyph names: what a card action, a lens or a fact can show. */
export const ACTION_GLYPHS = ['inside', 'out', 'callers', 'simulate', 'restructure', 'warning', 'testMissing', 'close'] as const;
export type ActionGlyphName = (typeof ACTION_GLYPHS)[number];

/** The icon for an action or fact; every name has one. */
export function actionGlyph(name: ActionGlyphName): ReactNode {
    switch (name) {
        // Go inside: an arrow dropping into a box.
        case 'inside': return <Glyph><path d="M8 2.5v6.5M5 6.5 8 9.5l3-3" /><path d="M3 10.5v2h10v-2" /></Glyph>;
        // Out: an arrow leaving upward (the camera bar's Out icon).
        case 'out': return <Glyph><path d="M8 13V3.5M4.5 7 8 3.5 11.5 7" /></Glyph>;
        // Callers: arrows coming in to a node.
        case 'callers': return <Glyph><circle cx="11.5" cy="8" r="2" /><path d="M2.5 4.5h4.5l2.2 2M2.5 11.5h4.5l2.2-2" /></Glyph>;
        // Simulate: a play triangle.
        case 'simulate': return <Glyph><path d="M5 3l8 5-8 5V3z" /></Glyph>;
        // Restructure: a box splitting into two.
        case 'restructure': return <Glyph><rect x="2.5" y="2.5" width="11" height="4" rx="1" /><rect x="2.5" y="9.5" width="4.5" height="4" rx="1" /><rect x="9" y="9.5" width="4.5" height="4" rx="1" /><path d="M5 6.5v3M11.2 6.5v3" /></Glyph>;
        // Warning (anti-pattern): a triangle with a mark.
        case 'warning': return <Glyph><path d="M8 2.5 14 13H2L8 2.5z" /><path d="M8 6.5v3" /><circle cx="8" cy="11.3" r="0.5" fill="currentColor" /></Glyph>;
        // Test missing: a dashed square.
        case 'testMissing': return <Glyph><rect x="3" y="3" width="10" height="10" rx="1.5" strokeDasharray="2.2 2" /></Glyph>;
        // Close: a cross.
        case 'close': return <Glyph><path d="M4 4l8 8M12 4l-8 8" /></Glyph>;
    }
}
