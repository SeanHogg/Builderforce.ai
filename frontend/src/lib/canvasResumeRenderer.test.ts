import { describe, expect, it } from 'vitest';
import { createResumeFamily, deriveResume, resumeNodePatch, updateActiveResume } from './canvasResume';
import { renderedCanvasResume, resumeHtmlFile } from './canvasResumeRenderer';

describe('canonical Canvas resume renderer', () => {
  it('uses the active revision template in preview, HTML, and print-ready markup', () => {
    const original = createResumeFamily({ title: 'Ada', markdown: '# Ada', idFactory: () => 'original' });
    const derived = deriveResume(original, 'Executive', { idFactory: () => 'derived' });
    const family = updateActiveResume(derived, { templateId: 'executive-taupe', markdown: '# Ada\n\n## Experience\n\nBuilt engines.' });
    const rendered = renderedCanvasResume({ kind: 'resume', title: 'Ada', ...resumeNodePatch(family) });
    expect(rendered?.template).toMatchObject({ id: 'executive-taupe', font: 'serif', density: 'spacious', columns: 1 });
    expect(rendered?.html).toContain('data-template="executive-taupe"');
    expect(rendered?.html).toContain('--resume-accent:#78716c');
    expect(rendered?.html).toContain('<h2>Experience</h2>');
    expect(resumeHtmlFile('Ada', rendered!)).toContain(rendered!.html);
  });
});
