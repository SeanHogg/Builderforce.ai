/**
 * The chat header's small chrome — its glyphs. Inline SVG so they render crisply in
 * the editor's light AND dark themes, inheriting the surrounding button's colour.
 *
 * The composer's glyphs and its `+` popover now live in the shared `BrainComposer`
 * (brain-ui `composer/`), so only the header's rename pencil remains here.
 */

/* Rename = pencil glyph for editing the selected chat's title. */
export const IconRename = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10.75 2.25 13.75 5.25 6 13H3v-3l7.75-7.75zM9.5 3.5l3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
