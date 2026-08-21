/**
 * THE stencil registry — the geometry vocabulary, and the packs the palette reads.
 *
 * ── WHAT WAS MISSING ────────────────────────────────────────────────────────────
 * The board could draw a shape and could not offer one. `stickyShape` shipped as a
 * renderer (an imported ellipse is drawn as an ellipse) and the inspector grew a select
 * with eight geometries in it — so a person could CHANGE a note into a shape, one card at
 * a time, from a settings panel, after already having made a note. There was no shape
 * LIBRARY on the palette, no flowchart vocabulary, no mind-map, no wireframe stencil and
 * no cloud-architecture pack. A diagram could be received here and not drawn here.
 *
 * ── WHY THIS IS DATA AND NOT COMPONENTS ─────────────────────────────────────────
 * A stencil is a NAMED PRESET of the one card the canvas already has: a geometry, a
 * pigment, a size and a starting label. That is the same open/closed shape the object
 * registry uses — `CREATION_PALETTE_GROUPS` is data and a new kind is an entry — and it
 * is what makes a sixth pack cost an entry here plus five i18n keys rather than a render
 * branch. Nothing below is a component, and nothing consuming it knows any stencil's
 * name.
 *
 * ── ONE LIST OF GEOMETRIES, NOT TWO ─────────────────────────────────────────────
 * `STENCIL_SHAPES` is the single vocabulary. The sticky inspector's shape select reads
 * it (`canvasKindSettings.board.ts`) instead of restating eight values, and every entry
 * has a matching rule in `CreationCanvas.module.css`. A geometry with no rule degrades to
 * the square card, which is the right answer for an import from a board with shapes we do
 * not model — and is exactly why the two lists must not be maintained separately: the
 * degradation is silent, so a select offering a shape nothing draws looks like a bug in
 * the card rather than a missing rule.
 *
 * ── WHY THE VALUES ARE MIRO'S SPELLINGS ─────────────────────────────────────────
 * Where a shape exists on Miro, the value here is Miro's own name for it, so an imported
 * board and a hand-drawn one are ONE value space. Two would need a translation table at
 * the import boundary, and a translation table is where a shape silently becomes a note.
 * The four that are ours (`cylinder`, `document`, `pill`, `round`) are named in the entry.
 */

import { STICKY_COLORS } from '@/components/creation-canvas/authoredColors';

/**
 * Every geometry the board can DRAW.
 *
 * `labelKey` resolves under `creationCanvas.stencilShape.*`. `ours` marks the four
 * spellings that are not Miro's, so a reader can tell at a glance which values an import
 * will and will not produce.
 */
export interface StencilShapeDef {
  value: string;
  labelKey: string;
  ours?: true;
}

export const STENCIL_SHAPES: readonly StencilShapeDef[] = [
  { value: 'square', labelKey: 'square' },
  { value: 'rectangle', labelKey: 'rectangle' },
  // Rounded CORNERS, not a circle — a note, softened. Ours, and listed beside Miro's
  // `round_rectangle` rather than translated at the boundary, because a value a person
  // chose and a value an importer read are two facts and only one may be rewritten.
  { value: 'round', labelKey: 'round', ours: true },
  { value: 'round_rectangle', labelKey: 'roundRectangle' },
  { value: 'ellipse', labelKey: 'ellipse' },
  { value: 'circle', labelKey: 'circle' },
  { value: 'rhombus', labelKey: 'rhombus' },
  { value: 'triangle', labelKey: 'triangle' },
  { value: 'parallelogram', labelKey: 'parallelogram' },
  { value: 'trapezoid', labelKey: 'trapezoid' },
  { value: 'pentagon', labelKey: 'pentagon' },
  { value: 'hexagon', labelKey: 'hexagon' },
  { value: 'octagon', labelKey: 'octagon' },
  { value: 'star', labelKey: 'star' },
  { value: 'cross', labelKey: 'cross' },
  { value: 'right_arrow', labelKey: 'rightArrow' },
  { value: 'left_arrow', labelKey: 'leftArrow' },
  { value: 'left_right_arrow', labelKey: 'leftRightArrow' },
  { value: 'cloud', labelKey: 'cloud' },
  // The three flowchart/architecture primitives Miro has no name for. A stored database
  // is a cylinder on every diagram ever drawn, a report is a page with a torn bottom
  // edge, and a start/end node is a stadium — omitting them would have made the
  // flowchart and cloud packs below undrawable, which is the whole point of the packs.
  { value: 'cylinder', labelKey: 'cylinder', ours: true },
  { value: 'document', labelKey: 'document', ours: true },
  { value: 'pill', labelKey: 'pill', ours: true },
];

export const STENCIL_SHAPE_VALUES: readonly string[] = STENCIL_SHAPES.map((shape) => shape.value);

export function isStencilShape(value: unknown): boolean {
  return typeof value === 'string' && STENCIL_SHAPE_VALUES.includes(value);
}

/**
 * One stencil: a named preset of the sticky card.
 *
 * `labelKey` and `descriptionKey` resolve under `creationCanvas.stencil.*`; `text` is the
 * starting LABEL written onto the card, and is deliberately empty for most of them. A
 * flowchart's "Decision" shape wants the word on it before you type — that is what makes
 * it a decision rather than a diamond — while a wireframe's image block does not, because
 * the word would then have to be deleted every single time.
 */
export interface StencilDef {
  key: string;
  shape: string;
  /** Author-chosen pigment, literal on purpose — see `authoredColors.ts`. */
  color: string;
  width: number;
  height: number;
  text?: string;
  labelKey: string;
}

export interface StencilPackDef {
  key: string;
  /** Resolves under `creationCanvas.stencilPack.*`. */
  labelKey: string;
  /** The glyph the palette rail shows for the pack. */
  icon: string;
  stencils: readonly StencilDef[];
}

const [YELLOW, GREEN, BLUE, PINK, ORANGE, PURPLE] = STICKY_COLORS;

/**
 * The packs.
 *
 * Five, chosen because each is a vocabulary somebody arrives already knowing — a
 * flowchart, a mind map, a wireframe, a cloud diagram, a UML sketch. A pack that only a
 * specialist recognises belongs in a workspace's own library rather than in the default
 * palette, which is why there is no BPMN or circuit pack here: the registry is open, and
 * "add one" is an entry.
 */
export const STENCIL_PACKS: readonly StencilPackDef[] = [
  {
    key: 'flowchart',
    labelKey: 'flowchart',
    icon: '◇',
    stencils: [
      { key: 'process', shape: 'rectangle', color: BLUE, width: 180, height: 96, labelKey: 'process' },
      // The three that carry their word: a diamond with nothing in it is not a decision,
      // it is a diamond, and a reader has to be told which convention is in use.
      { key: 'decision', shape: 'rhombus', color: YELLOW, width: 190, height: 150, text: 'Decision?', labelKey: 'decision' },
      { key: 'start', shape: 'pill', color: GREEN, width: 160, height: 72, text: 'Start', labelKey: 'start' },
      { key: 'end', shape: 'pill', color: PINK, width: 160, height: 72, text: 'End', labelKey: 'end' },
      { key: 'data', shape: 'parallelogram', color: ORANGE, width: 190, height: 96, labelKey: 'data' },
      { key: 'document', shape: 'document', color: PURPLE, width: 180, height: 112, labelKey: 'document' },
      { key: 'database', shape: 'cylinder', color: BLUE, width: 160, height: 130, labelKey: 'database' },
      { key: 'connector', shape: 'circle', color: YELLOW, width: 84, height: 84, labelKey: 'connector' },
    ],
  },
  {
    key: 'mindMap',
    labelKey: 'mindMap',
    icon: '◉',
    stencils: [
      // A mind map is a size hierarchy before it is anything else, so the three entries
      // differ mainly in how big they are — which is the fact the map encodes.
      { key: 'centre', shape: 'ellipse', color: PURPLE, width: 240, height: 160, labelKey: 'centre' },
      { key: 'branch', shape: 'round', color: BLUE, width: 180, height: 90, labelKey: 'branch' },
      { key: 'leaf', shape: 'round', color: GREEN, width: 150, height: 72, labelKey: 'leaf' },
      { key: 'question', shape: 'rhombus', color: YELLOW, width: 160, height: 130, text: '?', labelKey: 'question' },
    ],
  },
  {
    key: 'wireframe',
    labelKey: 'wireframe',
    icon: '▭',
    stencils: [
      { key: 'screen', shape: 'rectangle', color: BLUE, width: 360, height: 520, labelKey: 'screen' },
      { key: 'header', shape: 'rectangle', color: PURPLE, width: 340, height: 64, labelKey: 'header' },
      { key: 'block', shape: 'rectangle', color: YELLOW, width: 320, height: 180, labelKey: 'block' },
      { key: 'field', shape: 'round', color: GREEN, width: 300, height: 56, labelKey: 'field' },
      { key: 'button', shape: 'pill', color: ORANGE, width: 150, height: 52, text: 'Button', labelKey: 'button' },
      { key: 'modal', shape: 'round_rectangle', color: PINK, width: 300, height: 220, labelKey: 'modal' },
    ],
  },
  {
    key: 'cloud',
    labelKey: 'cloud',
    icon: '☁',
    stencils: [
      { key: 'internet', shape: 'cloud', color: BLUE, width: 200, height: 140, labelKey: 'internet' },
      { key: 'loadBalancer', shape: 'hexagon', color: PURPLE, width: 180, height: 140, labelKey: 'loadBalancer' },
      { key: 'compute', shape: 'rectangle', color: GREEN, width: 180, height: 110, labelKey: 'compute' },
      { key: 'store', shape: 'cylinder', color: ORANGE, width: 160, height: 140, labelKey: 'store' },
      { key: 'queue', shape: 'left_right_arrow', color: YELLOW, width: 220, height: 110, labelKey: 'queue' },
      { key: 'user', shape: 'circle', color: PINK, width: 110, height: 110, labelKey: 'user' },
      { key: 'boundary', shape: 'octagon', color: BLUE, width: 220, height: 180, labelKey: 'boundary' },
    ],
  },
  {
    key: 'uml',
    labelKey: 'uml',
    icon: '▤',
    stencils: [
      { key: 'class', shape: 'rectangle', color: BLUE, width: 200, height: 140, labelKey: 'class' },
      { key: 'interface', shape: 'round_rectangle', color: PURPLE, width: 200, height: 110, text: '«interface»', labelKey: 'interface' },
      { key: 'actor', shape: 'circle', color: GREEN, width: 110, height: 110, labelKey: 'actor' },
      { key: 'component', shape: 'pentagon', color: ORANGE, width: 180, height: 150, labelKey: 'component' },
      { key: 'note', shape: 'document', color: YELLOW, width: 190, height: 120, labelKey: 'note' },
    ],
  },
];

// ---------------------------------------------------------------------------
// The palette's choice vocabulary
// ---------------------------------------------------------------------------

/**
 * What the palette can hand back.
 *
 * The picker is generic over one STRING key, and a stencil is not an object kind — so
 * stencils occupy their own prefix in that one key space. It is a declared vocabulary
 * with a parser rather than an ad-hoc encoding: nothing outside this module splits the
 * string, and `parsePaletteChoice` is the only thing that reads the prefix.
 */
export const STENCIL_CHOICE_PREFIX = 'stencil:';

export type PaletteChoice = string;

export function stencilChoice(packKey: string, stencilKey: string): PaletteChoice {
  return `${STENCIL_CHOICE_PREFIX}${packKey}/${stencilKey}`;
}

/** A picked stencil, or null when the choice was a plain object kind. */
export function parsePaletteChoice(choice: PaletteChoice): { pack: StencilPackDef; stencil: StencilDef } | null {
  if (!choice.startsWith(STENCIL_CHOICE_PREFIX)) return null;
  const [packKey, stencilKey] = choice.slice(STENCIL_CHOICE_PREFIX.length).split('/');
  const pack = STENCIL_PACKS.find((entry) => entry.key === packKey);
  const stencil = pack?.stencils.find((entry) => entry.key === stencilKey);
  return pack && stencil ? { pack, stencil } : null;
}

/**
 * The card a stencil creates.
 *
 * A sticky, every time — a stencil is a PRESET of the untyped card, not a new kind. The
 * whole argument for `sticky` is that it claims nothing, and a stencil claiming to be a
 * `flowchartDecision` kind would be twenty-nine new kinds that the board cannot compute
 * anything over, which is the opposite of what the typed canvas is for.
 */
export function stencilSeed(stencil: StencilDef): Record<string, unknown> {
  return {
    kind: 'sticky',
    // `title` IS a sticky's text — see `TITLE_IS_CONTENT_KINDS`.
    title: stencil.text ?? '',
    stickyColor: stencil.color,
    stickyShape: stencil.shape,
  };
}

/**
 * The card's GEOMETRY, kept separate from its data.
 *
 * Size lives on the React Flow node (`node.style.width/height`), not in `data` — that is
 * where the board already stores an authored size and where the resizer writes. Returning
 * it as card content would have created a second place a card's width lives, and the
 * resizer would then silently disagree with it the first time anybody dragged a corner.
 *
 * It matters for a stencil in a way it does not for a note: a hexagon at 190x170 reads as
 * a hexagon and at 190x90 reads as a smudge, so the proportions ARE part of the preset.
 */
export function stencilSize(stencil: StencilDef): { width: number; height: number } {
  return { width: stencil.width, height: stencil.height };
}
