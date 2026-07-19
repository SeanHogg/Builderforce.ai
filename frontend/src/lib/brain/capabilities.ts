/**
 * Brain capabilities — the "what am I making?" mode of a chat.
 *
 * A capability is picked from the Brain's empty state (or the composer toolbar)
 * and does two things:
 *   1. injects a capability-specific block into the chat's system prompt, so the
 *      model shapes its output as that artifact (a document, a deck, a chart, a
 *      sheet, a site, …) instead of generic prose;
 *   2. seeds the composer with a starter line so the tile is a real starting
 *      point rather than a mode flag.
 *
 * Capabilities are split by SURFACE. Making things that are *authored* — docs,
 * decks, data — belongs to Brain Storm; making things that are *built and run*
 * (a site, an app, a game) belongs to the IDE, where there is a file tree, a dev
 * server, and a preview. The surface a BrainPanel sits on picks the set; this
 * registry is the single source for both, so no surface inlines its own list.
 *
 * The selection is a property of the CHAT (`brain_chats.capability`, migration
 * 0345), so it follows the conversation across surfaces and devices rather than
 * the browser it was picked in.
 *
 * Labels/hints/starters are localized (`brain.capabilities.<id>.*`); the system
 * prompts are model-facing and stay in English here.
 */

export type BrainCapabilitySurface = 'brainstorm' | 'ide';

export type BrainCapabilityId =
  | 'document'
  | 'slides'
  | 'dataviz'
  | 'spreadsheet'
  | 'website'
  | 'design'
  | 'mobile'
  | 'animation'
  | 'game3d';

export interface BrainCapabilityDef {
  id: BrainCapabilityId;
  surface: BrainCapabilitySurface;
  /** Tile glyph. Decorative — the label carries the meaning. */
  icon: string;
  /** Model-facing directive folded into the chat's system prompt. */
  systemPrompt: string;
  /**
   * File a reply in this capability can be exported as. `docx`/`pptx` render
   * server-side (`/api/exports`); `csv` saves straight from the reply's table.
   * Absent = nothing to export: the IDE capabilities already emit real files via
   * path-tagged code blocks, so a download button there would be a worse copy of
   * "create file".
   */
  exportFormat?: 'docx' | 'pptx' | 'csv';
  /**
   * The shape a reply in this capability MUST contain to count as delivering the
   * artifact. Read by {@link replyHasArtifact} so the UI can tell a real answer
   * from a bare title line ("Project task distribution:" and nothing else) and
   * offer a retry instead of leaving the user staring at a stub.
   */
  expects: 'document' | 'slides' | 'chart' | 'table' | 'code';
}

/**
 * Appended to EVERY capability prompt (single source, same pattern as the
 * modality registry's strategy note).
 *
 * Both halves are here because a weak model actually did both: it replied with
 * the single line "Project tasks status distribution (fetched for …):" — a title,
 * no chart — and claimed the data was "fetched" having made zero tool calls.
 */
const ARTIFACT_CONTRACT = [
  'NEVER reply with only a title, a preamble, or a "here is the …" line. Either produce the artifact IN FULL in this same reply, or — if you genuinely cannot tell what it should cover — ask exactly ONE short clarifying question and nothing else.',
  'Never describe data as fetched, loaded, or looked up unless you actually called a tool for it in this turn. If you need data you do not have, call the tool or say plainly that you do not have it.',
].join('\n');

const BASE_CAPABILITIES: BrainCapabilityDef[] = [
  // ---- Brain Storm: things you author -------------------------------------
  {
    id: 'document',
    surface: 'brainstorm',
    icon: '📄',
    exportFormat: 'docx',
    expects: 'document',
    systemPrompt: [
      'CAPABILITY: DOCUMENT. The user is authoring a written document in this chat.',
      'Produce the document itself — not a description of one. Use markdown structure: a title heading, ordered sections with headings, short paragraphs, lists and tables where they carry meaning.',
      'Write the full document in one reply rather than an outline followed by "shall I expand?". Revise the whole document on follow-ups so the latest reply is always the current draft.',
    ].join('\n'),
  },
  {
    id: 'slides',
    surface: 'brainstorm',
    icon: '🖼',
    exportFormat: 'pptx',
    expects: 'slides',
    systemPrompt: [
      'CAPABILITY: SLIDES. The user is building a presentation in this chat.',
      'Reply as a deck: one markdown `##` heading per slide, in order, each followed by at most 5 short bullets plus an optional one-line speaker note prefixed "Note:".',
      'Keep slides scannable — no paragraphs. Open with a title slide and close with a summary or call-to-action slide. Where a slide is inherently visual, express it as a mermaid diagram in a ```mermaid block.',
    ].join('\n'),
  },
  {
    id: 'dataviz',
    surface: 'brainstorm',
    icon: '📊',
    exportFormat: 'csv',
    expects: 'chart',
    systemPrompt: [
      'CAPABILITY: DATA VISUALIZATION. The user wants data made visible in this chat.',
      'Render charts as ```mermaid blocks (xychart-beta, pie, quadrantChart, gantt) so they draw inline, and put the underlying figures in a markdown table beneath each chart.',
      'Pick the chart form from the question — trend over time, share of a whole, comparison across categories, distribution. State the insight in one sentence above the chart; never ship a chart without saying what it shows. When the data is unavailable, use the platform tools to fetch it rather than inventing figures.',
    ].join('\n'),
  },
  {
    id: 'spreadsheet',
    surface: 'brainstorm',
    icon: '🧮',
    exportFormat: 'csv',
    expects: 'table',
    systemPrompt: [
      'CAPABILITY: SPREADSHEET. The user is building a tabular model in this chat.',
      'Reply with a markdown table as the primary output: a header row, one row per record, consistent units, and a totals/summary row where it applies.',
      'When the model has calculated columns, state each formula once beneath the table in spreadsheet notation (e.g. `Margin = (Revenue - Cost) / Revenue`). Also emit the same table as a ```csv block so it can be pasted straight into a sheet.',
    ].join('\n'),
  },

  // ---- IDE: things you build and run --------------------------------------
  {
    id: 'website',
    surface: 'ide',
    icon: '🌐',
    expects: 'code',
    systemPrompt: [
      'CAPABILITY: WEBSITE. The user is building a web app or site in this workspace.',
      'Produce real files, not snippets: use a code block whose language tag is the file path (```src/App.tsx, ```package.json) so each one can be created in a click.',
      'Cover routing, responsive layout, and both light and dark themes. Prefer the stack already present in the workspace over introducing a new one.',
    ].join('\n'),
  },
  {
    id: 'design',
    surface: 'ide',
    icon: '🎨',
    expects: 'code',
    systemPrompt: [
      'CAPABILITY: DESIGN. The user is designing the interface before/while building it.',
      'Work at the design-system level: layout structure, spacing scale, type scale, and a token palette expressed as CSS custom properties with light and dark values.',
      'Deliver the design as real CSS/markup files (path-tagged code blocks) plus a short rationale. Check contrast in both themes and keep tap targets at least 44px.',
    ].join('\n'),
  },
  {
    id: 'mobile',
    surface: 'ide',
    icon: '📱',
    expects: 'code',
    systemPrompt: [
      'CAPABILITY: MOBILE. The user is building a mobile app in this workspace.',
      'Design for a phone first: single-column layouts, thumb-reachable actions, native-feeling navigation, offline and slow-network states.',
      'Produce real files with path-tagged code blocks, and call out any platform permission or store requirement the feature implies.',
    ].join('\n'),
  },
  {
    id: 'animation',
    surface: 'ide',
    icon: '✨',
    expects: 'code',
    systemPrompt: [
      'CAPABILITY: ANIMATION. The user is building motion into this workspace.',
      'Specify motion concretely — trigger, duration, easing curve, and the property being animated — and implement it in real files (CSS keyframes, the Web Animations API, or the workspace\'s existing motion library).',
      'Keep motion purposeful and under 400ms for UI feedback, and always honour `prefers-reduced-motion`.',
    ].join('\n'),
  },
  {
    id: 'game3d',
    surface: 'ide',
    icon: '🎮',
    expects: 'code',
    systemPrompt: [
      'CAPABILITY: 3D GAME. The user is building a 3D game in this workspace.',
      'Think in scene, camera, lighting, meshes, materials, input, and a game loop. Implement with WebGL/WebGPU via the library already in the workspace (Three.js unless told otherwise), in real path-tagged files.',
      'Keep the render loop allocation-free, dispose GPU resources on teardown, and state the target frame budget for any effect you add.',
    ].join('\n'),
  },
];

/** The public registry — every capability prompt carries the shared artifact
 *  contract, baked in once here so no entry can drift from it. */
const CAPABILITIES: BrainCapabilityDef[] = BASE_CAPABILITIES.map((c) => ({
  ...c,
  systemPrompt: `${c.systemPrompt}\n${ARTIFACT_CONTRACT}`,
}));

/** Every capability offered on a surface, in display order. */
export function capabilitiesForSurface(surface: BrainCapabilitySurface): BrainCapabilityDef[] {
  return CAPABILITIES.filter((c) => c.surface === surface);
}

/** Resolve an id (possibly stale/unknown, e.g. from storage) to its definition. */
export function getBrainCapability(id: string | null | undefined): BrainCapabilityDef | null {
  if (!id) return null;
  return CAPABILITIES.find((c) => c.id === id) ?? null;
}

