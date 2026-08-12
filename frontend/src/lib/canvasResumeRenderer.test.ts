import { describe, expect, it } from 'vitest';
import { createResumeFamily, deriveResume, resumeNodePatch, updateActiveResume } from './canvasResume';
import { renderedCanvasResume, resumeHtmlFile, resumePageDimensions, resumePageCss } from './canvasResumeRenderer';

describe('canonical Canvas resume renderer', () => {
  it('uses the active revision template in preview, HTML, and print-ready markup', () => {
    const original = createResumeFamily({ title: 'Ada', markdown: '# Ada', idFactory: () => 'original' });
    const derived = deriveResume(original, 'Executive', { idFactory: () => 'derived' });
    const family = updateActiveResume(derived, { templateId: 'executive-taupe', markdown: '# Ada\n\n## Experience\n\nBuilt engines.' });
    const rendered = renderedCanvasResume({ kind: 'resume', title: 'Ada', ...resumeNodePatch(family) });
    expect(rendered?.template).toMatchObject({ id: 'executive-taupe', font: 'serif', density: 'spacious', columns: 1 });
    expect(rendered?.html).toContain('data-template="executive-taupe"');
    expect(rendered?.html).toContain('data-heading="divider"');
    expect(rendered?.html).toContain('--resume-accent:#78716c');
    expect(rendered?.html).toContain('<h2>Experience</h2>');
    expect(resumeHtmlFile('Ada', rendered!)).toContain(rendered!.html);
  });

  it('uses the persisted page size and orientation in true-size preview and export CSS', () => {
    expect(resumePageDimensions('letter', 'portrait')).toEqual({ width: 215.9, height: 279.4 });
    expect(resumePageDimensions('legal', 'landscape')).toEqual({ width: 355.6, height: 215.9 });
    expect(resumePageCss({ pageSize: 'legal', orientation: 'landscape' })).toContain('size:legal landscape');
  });

  it('routes complete sections into the sidebar and applies template section order/layout', () => {
    const original = createResumeFamily({ title: 'Ada', markdown: '# Ada', idFactory: () => 'original' });
    const derived = deriveResume(original, 'Engineering', { idFactory: () => 'derived' });
    const family = updateActiveResume(derived, { templateId: 'software-engineer-graphite', markdown: '# Ada\n\n## Experience\n\n### Engineer\n\nBuilt systems.\n\n## Skills\n\n- TypeScript\n\n## Projects\n\n### Compiler' });
    const html = renderedCanvasResume({ kind: 'resume', title: 'Ada', ...resumeNodePatch(family) })!.html;
    expect(html).toMatch(/<main>[\s\S]*data-section="work"/);
    expect(html).toMatch(/<aside>[\s\S]*data-section="skills"[\s\S]*data-section="projects"/);

    const ordered = updateActiveResume(family, { templateId: 'intern-education-first', markdown: '# Ada\n\n## Experience\n\nWork\n\n## Education\n\nStudy' });
    const orderedHtml = renderedCanvasResume({ kind: 'resume', title: 'Ada', ...resumeNodePatch(ordered) })!.html;
    expect(orderedHtml.indexOf('data-section="education"')).toBeLessThan(orderedHtml.indexOf('data-section="work"'));
  });

  it('carries Hired hero and section descriptor flags into canonical output', () => {
    const family = createResumeFamily({ title: 'Ada', markdown: '# Ada\n\n## Projects\n\n### Film\n\n- Director', idFactory: () => 'source' });
    const selected = { ...family, revisions: family.revisions.map((revision) => ({ ...revision, templateId: 'actor-headshot-hero' as const })) };
    const html = renderedCanvasResume({ kind: 'resume', title: 'Ada', ...resumeNodePatch(selected) })!.html;
    expect(html).toContain('data-show-avatar="true"');
    expect(html).toContain('data-show-video="true"');
    expect(html).toContain('data-section="projects" data-layout="list"');
    expect(html).toContain('data-media="true"');
  });

  it('renders safe hero avatar, contacts, summary and associated video from canonical basics', () => {
    const family = createResumeFamily({ title: 'Ada', markdown: '# Ada', document: { basics: { name: 'Ada Lovelace', label: 'Engineer', image: 'https://cdn.example/ada.jpg', email: 'ada@example.com', phone: '+1 555 0100', url: 'https://ada.example', summary: 'Builds engines.', video: 'https://cdn.example/reel.mp4' } }, idFactory: () => 'source' });
    const html = renderedCanvasResume({ kind: 'resume', title: 'Ada', ...resumeNodePatch(family) })!.html;
    expect(html).toContain('class="canvasResumeHero"');
    expect(html).toContain('class="canvasResumeAvatar"');
    expect(html).toContain('mailto:ada@example.com');
    expect(html).toContain('tel:+15550100');
    expect(html).toContain('Builds engines.');
    expect(html.match(/Builds engines\./g)).toHaveLength(1);
    expect(html).toContain('https://cdn.example/reel.mp4');
  });

  it('sorts descriptor sections, suppresses highlights, and renders bound media only when enabled', () => {
    const family = createResumeFamily({ title: 'Ada', markdown: '# Ada', document: {
      basics: { name: 'Ada' },
      projects: [
        { id: 'old', name: 'Old Film', startDate: '2020', highlights: ['Old credit'] },
        { id: 'new', name: 'New Film', startDate: '2025', highlights: ['New credit'] },
      ],
      metaData: [{ id: 'still', referenceId: 'new', metaType: 'Image', url: 'https://cdn.example/still.jpg', name: 'Production still' }],
    }, idFactory: () => 'source' });
    const selected = { ...family, revisions: family.revisions.map((revision) => ({ ...revision, templateId: 'actor-headshot-hero' as const })) };
    const html = renderedCanvasResume({ kind: 'resume', title: 'Ada', ...resumeNodePatch(selected) })!.html;
    expect(html.indexOf('New Film')).toBeLessThan(html.indexOf('Old Film'));
    expect(html).toContain('class="canvasResumeMediaStrip"');
    expect(html).toContain('https://cdn.example/still.jpg');
  });

  it('suppresses references marked private from every canonical rendition', () => {
    const family = createResumeFamily({ title: 'Ada', markdown: '# Ada', document: { basics: { name: 'Ada' }, references: [{ name: 'Public Ref', reference: 'Visible' }, { name: 'Private Ref', reference: 'Secret', private: true }] }, idFactory: () => 'source' });
    const html = renderedCanvasResume({ kind: 'resume', title: 'Ada', ...resumeNodePatch(family) })!.html;
    expect(html).toContain('Public Ref');
    expect(html).not.toContain('Private Ref');
    expect(html).not.toContain('Secret');
  });
});
