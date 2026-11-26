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
        // Flow: three steps rising left to right.
        case 'flow': return <Glyph><path d="M2.5 13.5h3v-3h3v-3h3v-3h2" /></Glyph>;
        // Sequence: two lifelines with a call and its return.
        case 'sequence': return <Glyph><path d="M4 2.5v11M12 2.5v11M4 6h7M9.5 4.5 11 6 9.5 7.5M12 10H5M6.5 8.5 5 10l1.5 1.5" /></Glyph>;
        // 3D / Flat switch (not cameras): a tilted sheet standing over its ground line, and a top-down sheet.
        case 'depth3d': return <Glyph><path d="M3.5 6.5 8 3l4.5 3.5L8 10 3.5 6.5z" /><path d="M3.5 9.5 8 13l4.5-3.5" /></Glyph>;
        case 'flat': return <Glyph><rect x="2.5" y="4.5" width="11" height="7" rx="1" /><path d="M2.5 8h11" /></Glyph>;
        // List: three horizontal lines.
        case 'list': return <Glyph><path d="M3 4.5h10M3 8h10M3 11.5h10" /></Glyph>;
        default: return undefined;
    }
}

/** One icon per question (the toolbar's question segment and its More menu), drawn like the design prototype's. A question with no icon of its own keeps its words. */
export function questionGlyph(id: string): ReactNode {
    switch (id) {
        case 'where': return <Glyph><circle cx="3.5" cy="12.5" r="1.5" /><path d="M5 12.5h3.5a2.25 2.25 0 0 0 0-4.5h-1a2.25 2.25 0 0 1 0-4.5H13M11 1.5l2 2-2 2" /></Glyph>;
        case 'wrong': return <Glyph><path d="M8 2.5l6 11H2zM8 6.5v3.5" /><circle cx="8" cy="12" r=".8" fill="currentColor" stroke="none" /></Glyph>;
        case 'untested': return <Glyph><rect x="2.5" y="2.5" width="11" height="11" strokeDasharray="2.2 1.8" /></Glyph>;
        case 'patterns': return <Glyph><rect x="2.5" y="2.5" width="4.5" height="4.5" /><rect x="9" y="9" width="4.5" height="4.5" /><path d="M7 4.75h4.25V9M9 11.25H4.75V7" /></Glyph>;
        case 'changed': return <Glyph><circle cx="8" cy="8" r="5.5" /><path d="M8 5v3l2 1.5" /></Glyph>;
        case 'callers': return <Glyph><path d="M2 4h4l3 4M2 12h4l3-4M9 8h5M12 6l2 2-2 2" /></Glyph>;
        case 'copied': return <Glyph><rect x="2.5" y="5" width="7" height="8.5" /><path d="M6.5 5V2.5h7V11h-4" /></Glyph>;
        case 'unused': return <Glyph><circle cx="8" cy="8" r="5.5" /><path d="M4.2 11.8l7.6-7.6" /></Glyph>;
        case 'claims': return <Glyph><path d="M4 2h5l3 3v9H4zM9 2v3h3M6 8.5h4M6 11h4" /></Glyph>;
        case 'layers': return <Glyph><path d="M8 2l6 3-6 3-6-3zM2 8l6 3 6-3M2 11l6 3 6-3" /></Glyph>;
        case 'knowledge': return <Glyph><circle cx="8" cy="8" r="2" /><path d="M8 6V2M10 8h4M8 10v4M6 8H2" /></Glyph>;
        case 'more': return <Glyph><circle cx="3.5" cy="8" r="1.2" fill="currentColor" stroke="none" /><circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none" /><circle cx="12.5" cy="8" r="1.2" fill="currentColor" stroke="none" /></Glyph>;
        default: return undefined;
    }
}

/** The header's own icons (out, search, panels) and the drawer's tab icons, by id; the drawer's ids are the panel ids plus `act`. */
export function chromeGlyph(id: string): ReactNode {
    switch (id) {
        case 'out': return <Glyph><path d="M8 13V3M4 7l4-4 4 4" /></Glyph>;
        case 'search': return <Glyph><circle cx="7" cy="7" r="4" /><path d="M10 10l4 4" /></Glyph>;
        case 'panels': return <Glyph><rect x="2" y="3" width="12" height="10" rx="1" /><path d="M10 3v10" /></Glyph>;
        case 'act': return <Glyph><circle cx="8" cy="8" r="5.5" /><circle cx="8" cy="8" r="2.2" /></Glyph>;
        case 'coverage': return <Glyph><path d="M8 2l5 2v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4z" /><path d="M5.8 8l1.6 1.6 2.9-3" /></Glyph>;
        case 'patterns': return questionGlyph('patterns');
        case 'api': return <Glyph><path d="M6 2.5c-1.4 0-2 .7-2 2v1.6c0 .9-.6 1.9-1.5 1.9.9 0 1.5 1 1.5 1.9v1.6c0 1.3.6 2 2 2M10 2.5c1.4 0 2 .7 2 2v1.6c0 .9.6 1.9 1.5 1.9-.9 0-1.5 1-1.5 1.9v1.6c0 1.3-.6 2-2 2" /></Glyph>;
        case 'simulate': return <Glyph><path d="M5 3l8 5-8 5z" fill="currentColor" stroke="none" /></Glyph>;
        case 'resolve': return <Glyph><path d="M10.5 2.5a3 3 0 0 0-3.2 4L2.5 11.3l2.2 2.2 4.8-4.8a3 3 0 0 0 4-3.2l-1.9 1.1-1.6-1.6z" /></Glyph>;
        case 'run': return <Glyph><path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8z" /><circle cx="8" cy="8" r="2" /></Glyph>;
        case 'agentRuns': return <Glyph><rect x="3.5" y="5.5" width="9" height="7" rx="1.5" /><path d="M8 5.5V3.3M6 8.5v1M10 8.5v1" /><circle cx="8" cy="2.5" r="0.8" /></Glyph>;
        // A host's view switch (the VS Code visualization panel): the canvas is a board of cards, the changes a diff.
        case 'canvas': return <Glyph><rect x="2" y="2.5" width="12" height="11" rx="1" /><rect x="4" y="4.5" width="3.5" height="3" /><path d="M9.5 5h2M9.5 7h2M4 10.5h7.5" /></Glyph>;
        case 'diff': return <Glyph><path d="M5 2.5v7M2.5 5h5M8.5 11.5h5" /><path d="M11 2.5v3M9.5 4h3" /></Glyph>;
        case 'domains': return <Glyph><path d="M2.5 4.5c0-.6.4-1 1-1h3l1.5 1.5h4.5c.6 0 1 .4 1 1v5.5c0 .6-.4 1-1 1h-9c-.6 0-1-.4-1-1z" /></Glyph>;
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
