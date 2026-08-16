import { describe, expect, it } from 'vitest';
import {
  WEBSITE_ADDABLE_SECTION_KINDS,
  WEBSITE_MAX_SECTIONS,
  applyWebsiteEdit,
  authoredWebsiteProblem,
  isMarkupSectionBody,
  patchWebsiteHero,
  websitePagesFrom,
  websiteSectionCapabilities,
} from './websiteWysiwyg';
import type { CreationNodeData } from './types';

const pages = [{
  id: 'home', name: 'Home', path: '/', sections: [
    { id: 'hero', kind: 'hero', heading: 'Turn data into decisions', body: 'Acme Analytics gives operators a clear view.', cta: 'Book a demo' },
    { id: 'features', kind: 'features', heading: 'Move with confidence', items: [{ title: 'Live signals', body: 'See changes as they happen.' }] },
  ],
}];

const node = (override: Partial<CreationNodeData> = {}): CreationNodeData =>
  ({ kind: 'website', title: 'Acme', pages, ...override }) as CreationNodeData;

/** The sections an edit produced, in order — what every assertion below is about. */
const sectionsOf = (patch: Partial<CreationNodeData> | null): Array<{ id: string; kind: string }> =>
  (websitePagesFrom({ pages: patch?.pages })[0]?.sections ?? []).map((s) => ({ id: s.id, kind: s.kind }));

describe('website WYSIWYG contract', () => {
  it('rejects generic website shells and accepts authored page sections', () => {
    expect(authoredWebsiteProblem({ title: 'My Website' })).toContain('fields.pages');
    expect(authoredWebsiteProblem({ pages: [{ id: 'home', name: 'Home', path: '/', sections: [{ id: 'hero', kind: 'hero', heading: 'Only a heading' }] }] })).toContain('hero section');
    expect(authoredWebsiteProblem({ pages })).toBeNull();
  });

  it('edits the rendered WYSIWYG hero through the simple inspector fields', () => {
    const patch = patchWebsiteHero(node(), { websiteHeadline: 'A sharper decision layer' });
    expect(websitePagesFrom({ pages: patch.pages })[0]?.sections[0]).toMatchObject({ heading: 'A sharper decision layer', body: 'Acme Analytics gives operators a clear view.' });
  });

  it('flags a content section as markup only when its body actually contains an HTML tag', () => {
    expect(isMarkupSectionBody({ kind: 'content', body: '<form><input name="email"></form>' })).toBe(true);
    expect(isMarkupSectionBody({ kind: 'content', body: 'Just prose about the company.' })).toBe(false);
    expect(isMarkupSectionBody({ kind: 'content', body: undefined })).toBe(false);
    // Other kinds never take the markup path, even with an HTML-shaped body — `hero`,
    // `cta` etc. render through their own fixed layout, not a free-text frame.
    expect(isMarkupSectionBody({ kind: 'hero', body: '<form></form>' })).toBe(false);
  });
});

describe('block-level section operations', () => {
  it('inserts an addable kind with content, so the next parse does not drop it', () => {
    const patch = applyWebsiteEdit(node(), { op: 'insert', kind: 'cta' });
    // The parse is the real assertion: `websiteSection` keeps only sections that carry
    // content, so an insert that seeded nothing would vanish silently right here.
    expect(sectionsOf(patch).map((s) => s.kind)).toEqual(['hero', 'features', 'cta']);
  });

  it('inserts directly after the section that was acted on', () => {
    const three = applyWebsiteEdit(node(), { op: 'insert', kind: 'stats' });
    const patch = applyWebsiteEdit(node({ pages: three!.pages }), { op: 'insert', kind: 'cta', afterSectionId: 'hero' });
    expect(sectionsOf(patch).map((s) => s.kind)).toEqual(['hero', 'cta', 'features', 'stats']);
  });

  it('never offers a second hero', () => {
    expect(WEBSITE_ADDABLE_SECTION_KINDS).not.toContain('hero');
    // …and refuses one asked for directly, so the vocabulary is not the only guard.
    expect(applyWebsiteEdit(node(), { op: 'insert', kind: 'hero' })).toBeNull();
  });

  it('moves a section one slot and refuses to move it off either end', () => {
    const up = applyWebsiteEdit(node(), { op: 'move', sectionId: 'features', direction: 'up' });
    expect(sectionsOf(up).map((s) => s.id)).toEqual(['features', 'hero']);
    expect(applyWebsiteEdit(node(), { op: 'move', sectionId: 'hero', direction: 'up' })).toBeNull();
    expect(applyWebsiteEdit(node(), { op: 'move', sectionId: 'features', direction: 'down' })).toBeNull();
  });

  it('duplicates with a fresh id rather than a colliding one', () => {
    const patch = applyWebsiteEdit(node(), { op: 'duplicate', sectionId: 'features' });
    const ids = sectionsOf(patch).map((s) => s.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    expect(ids[1]).toBe('features');
  });

  it('refuses to delete the hero or the last remaining section', () => {
    // Deleting the hero would make `websiteHeroFrom` ambiguous for every reader of it.
    expect(applyWebsiteEdit(node(), { op: 'delete', sectionId: 'hero' })).toBeNull();
    // And a page parsed down to zero sections is dropped entirely by `websitePagesFrom`,
    // so deleting the last one would delete the page as a side effect of editing it.
    const solo = node({ pages: [{ ...pages[0]!, sections: [pages[0]!.sections[1]!] }] });
    expect(applyWebsiteEdit(solo, { op: 'delete', sectionId: 'features' })).toBeNull();
  });

  it('deletes an ordinary section', () => {
    const patch = applyWebsiteEdit(node(), { op: 'delete', sectionId: 'features' });
    expect(sectionsOf(patch).map((s) => s.id)).toEqual(['hero']);
  });

  it('refuses an insert that would exceed the section cap', () => {
    const many = Array.from({ length: WEBSITE_MAX_SECTIONS }, (_, index) => (index === 0
      ? pages[0]!.sections[0]!
      : { id: `content-${index}`, kind: 'content', heading: `Block ${index}`, body: 'Words.' }));
    expect(applyWebsiteEdit(node({ pages: [{ ...pages[0]!, sections: many }] }), { op: 'insert', kind: 'cta' })).toBeNull();
  });

  it('reports capabilities that match what the operations actually allow', () => {
    const page = websitePagesFrom({ pages })[0]!;
    expect(websiteSectionCapabilities(page, 'hero')).toMatchObject({ canMoveUp: false, canMoveDown: true, canDelete: false, canDuplicate: false });
    expect(websiteSectionCapabilities(page, 'features')).toMatchObject({ canMoveUp: true, canMoveDown: false, canDelete: true, canDuplicate: true });
    expect(websiteSectionCapabilities(page, 'nope')).toMatchObject({ canMoveUp: false, canDelete: false });
  });

  it('returns null for an unauthored object rather than inventing a page', () => {
    expect(applyWebsiteEdit(node({ pages: [] }), { op: 'insert', kind: 'cta' })).toBeNull();
  });
});
