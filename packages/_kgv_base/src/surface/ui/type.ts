/**
 * The view's typography, ONCE: the two typefaces and the type scale of the design mockup
 * (`B-Surface.dc.html`: Inter for text, JetBrains Mono for names, paths and code), as named roles.
 *
 * A component takes a role (`...TYPE.meta`), never a size of its own, so the scale cannot drift
 * between the header, the panels and the cards. Sizes are the mockup's own, in px.
 *
 * The stacks reach the DOM through two variables the view's root defines (`TYPE_VARS`):
 * `--kg-font-ui` and `--kg-font-mono`. Every role reads them with a literal fallback, so a node
 * rendered outside the root (a portal) still gets the right face. The typefaces themselves are
 * bundled by each host (`@fontsource/inter`, `@fontsource/jetbrains-mono`) - never fetched from
 * Google: the VS Code webview is offline and CSP-bound.
 */

import type { CSSProperties } from 'react';
import { cssVar } from '../../scene/themeColors';

const UI_STACK = 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const MONO_STACK = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/** The text face: `var(--kg-font-ui)` with the stack as its fallback. */
export const FONT_UI = `var(--kg-font-ui, ${UI_STACK})`;
/** The name/path/code face: `var(--kg-font-mono)` with the stack as its fallback. */
export const FONT_MONO = `var(--kg-font-mono, ${MONO_STACK})`;

/** What the view's root defines, so the two faces are one override away for any host. */
export const TYPE_VARS = { '--kg-font-ui': UI_STACK, '--kg-font-mono': MONO_STACK } as CSSProperties;

const ui = (fontSize: number, fontWeight: number, rest?: CSSProperties): CSSProperties => ({ fontFamily: FONT_UI, fontSize, fontWeight, ...rest });
const mono = (fontSize: number, fontWeight: number, rest?: CSSProperties): CSSProperties => ({ fontFamily: FONT_MONO, fontSize, fontWeight, ...rest });
const muted = { color: cssVar('muted') } as const;

export const TYPE = {
    /** The view's base text: header meta, drawer bodies, lists. */
    body: ui(12, 400),
    /** A larger body: the question input, an empty-state paragraph. */
    bodyLarge: ui(13, 400),
    /** Body text in the muted colour. */
    bodyMuted: ui(12, 400, muted),
    /** Secondary detail under a name: card meta, a line's "7 stations · 12k runs a day". */
    meta: ui(11, 400, muted),
    /** The smallest text: a stat tile's label, a tier's meta, a hop payload. */
    caption: ui(10, 400, muted),
    /** A section heading: LINES FROM THE ENTRY POINTS, STATIONS ON THE CRON LINE. */
    sectionHeading: ui(11, 700, { margin: 0, letterSpacing: '0.06em', textTransform: 'uppercase', ...muted }),
    /** An architecture band / tier label drawn on the map: 10px, wider tracking. */
    bandLabel: ui(10, 700, { letterSpacing: '0.08em' }),
    /** A panel's title: the drawer title. */
    title: ui(14, 700, { margin: 0 }),
    /** A block's name in the text colour: "Reading the picture now", a line's name. */
    subtitle: ui(12, 700, { margin: 0 }),
    /** A pill, chip or button label. */
    pill: ui(12, 600),
    /** A pill or chip that is switched on. */
    pillOn: ui(12, 700),
    /** A small outlined tag: provenance, a source chip. */
    tag: ui(10, 700),
    /** A state word ("reached", "1 dead end"): coloured by its tone, never by this role. */
    status: ui(11, 700),
    /** A big number: a KPI value. */
    figure: ui(18, 700),
    /** A text field. */
    input: ui(13, 400),
    /** A name in a list, a path in prose, a code line. */
    mono: mono(11.5, 400),
    /** A station name on a card, a strip step, a table cell: the bold-ish name. */
    monoName: mono(11, 600),
    /** The title of a card or panel that names a station or an endpoint. */
    monoTitle: mono(13, 700),
    /** A mono value in prose (a count, a step, a variable). */
    monoValue: mono(12, 400),
    /** Mono detail: a hop payload, a note under a station. */
    monoMeta: mono(10, 400, muted),
} as const satisfies Record<string, CSSProperties>;

export type TypeRole = keyof typeof TYPE;
