import { describe, expect, it } from 'vitest';
import { authoredWebsiteProblem, patchWebsiteHero, websitePagesFrom } from './websiteWysiwyg';

const pages = [{
  id: 'home', name: 'Home', path: '/', sections: [
    { id: 'hero', kind: 'hero', heading: 'Turn data into decisions', body: 'Acme Analytics gives operators a clear view.', cta: 'Book a demo' },
    { id: 'features', kind: 'features', heading: 'Move with confidence', items: [{ title: 'Live signals', body: 'See changes as they happen.' }] },
  ],
}];

describe('website WYSIWYG contract', () => {
  it('rejects generic website shells and accepts authored page sections', () => {
    expect(authoredWebsiteProblem({ title: 'My Website' })).toContain('fields.pages');
    expect(authoredWebsiteProblem({ pages: [{ id: 'home', name: 'Home', path: '/', sections: [{ id: 'hero', kind: 'hero', heading: 'Only a heading' }] }] })).toContain('hero section');
    expect(authoredWebsiteProblem({ pages })).toBeNull();
  });

  it('edits the rendered WYSIWYG hero through the simple inspector fields', () => {
    const patch = patchWebsiteHero({ kind: 'website', title: 'Acme', pages }, { websiteHeadline: 'A sharper decision layer' });
    expect(websitePagesFrom({ pages: patch.pages })[0]?.sections[0]).toMatchObject({ heading: 'A sharper decision layer', body: 'Acme Analytics gives operators a clear view.' });
  });
});
