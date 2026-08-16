import { describe, expect, it } from 'vitest';
import {
  activeResumeRevision,
  RESUME_TEMPLATES,
  createResumeFamily,
  deriveResume,
  deleteResumeRevision,
  detachResumeRevision,
  initializeResumeFromPatch,
  isJsonResume,
  originalResumeRevision,
  promoteResumeToMaster,
  preserveResumeSourceForPatch,
  restoreResumeAsNew,
  renderResumeMarkdown,
  resumeDocumentFromJson,
  resumeDocumentFromNode,
  resumeTemplateFromDescriptor,
  resumeTemplateVariants,
  selectResumeRevision,
  updateActiveResume,
  updateActiveResumePresentation,
  updateResumeFamilySettings,
} from './canvasResume';

const ids = (...values: string[]) => {
  let index = 0;
  return () => values[index++]!;
};

describe('Canvas resume lineage', () => {
  it('attributes the built-in résumé catalog to Hired.VIDEO', () => {
    expect(RESUME_TEMPLATES).toHaveLength(12);
    expect(RESUME_TEMPLATES.every((template) => template.firstParty && template.creator === 'Hired.VIDEO')).toBe(true);
  });
  it('validates and migrates Hired v1.0-v1.2 template descriptors', () => {
    const descriptor = resumeTemplateFromDescriptor({
      id: 'actor-headshot-hero', name: 'Actor', version: '1.2', documentMode: 'hero',
      theme: { fontFamily: 'serif', headingStyle: 'caps', density: 'compact' },
      layout: { columns: 1 }, hero: { enabled: true, layout: 'stacked', showAvatar: true, showContactButtons: false, showSummary: true, showVideo: false },
      sections: [{ key: 'projects', enabled: true, layout: 'cards', columns: 2, showHighlights: true, showMedia: true, sortBy: 'date_desc' }],
    });
    expect(descriptor).toMatchObject({ id: 'actor-headshot-hero', mode: 'hero', hero: { layout: 'stacked', showContactButtons: false }, sections: { projects: { layout: 'cards', columns: 2, showMedia: true } } });
    expect(resumeTemplateFromDescriptor({ id: 'actor-headshot-hero', version: '9.0' })).toBeNull();
    expect(resumeTemplateFromDescriptor({ id: 'unknown', version: '1.2' })).toBeNull();
  });
  it('keeps the uploaded original immutable while a derivative changes', () => {
    const original = createResumeFamily({ title: 'Uploaded.pdf', markdown: '# Original', now: '2026-08-11T00:00:00Z', idFactory: ids('original') });
    const derived = deriveResume(original, 'Product résumé', { now: '2026-08-11T01:00:00Z', idFactory: ids('derived') });
    const edited = updateActiveResume(derived, { markdown: '# Tailored', templateId: 'executive-taupe' }, '2026-08-11T02:00:00Z');
    expect(edited.revisions.find((revision) => revision.id === 'original')?.markdown).toBe('# Original');
    expect(activeResumeRevision(edited)).toMatchObject({ id: 'derived', markdown: '# Tailored', sourceRevisionId: 'original' });
    expect(activeResumeRevision(selectResumeRevision(edited, 'original')).markdown).toBe('# Original');
  });

  it('never edits the immutable original in place', () => {
    const family = createResumeFamily({ title: 'Original', markdown: '# Keep me', idFactory: ids('original') });
    expect(updateActiveResume(family, { markdown: '# Replaced' })).toEqual(family);
  });

  it('allows presentation changes on Original while protecting its content', () => {
    const family = createResumeFamily({ title: 'Original', markdown: '# Keep me', idFactory: ids('original') });
    const presented = updateActiveResumePresentation(family, { templateId: 'risk-asphalt', pageSize: 'legal', orientation: 'landscape' });
    expect(activeResumeRevision(presented)).toMatchObject({ markdown: '# Keep me', templateId: 'risk-asphalt', pageSize: 'legal', orientation: 'landscape' });
    expect(updateActiveResume(presented, { markdown: '# Replaced' })).toEqual(presented);
  });

  it('restores as a new head and promotes without changing source revisions', () => {
    const original = createResumeFamily({ title: 'Original', markdown: '# One', idFactory: ids('original') });
    const first = deriveResume(original, 'First', { idFactory: ids('first') });
    const restored = restoreResumeAsNew(first, 'original', 'Restored original', { idFactory: ids('restored') });
    const promoted = promoteResumeToMaster(restored, 'restored');
    expect(promoted.masterRevisionId).toBe('restored');
    expect(activeResumeRevision(promoted)).toMatchObject({ title: 'Restored original', sourceRevisionId: 'original' });
    expect(promoted.revisions).toHaveLength(3);
  });

  it('persists privacy, archive, and watch settings on the family', () => {
    const family = createResumeFamily({ title: 'Original', markdown: '# One', idFactory: ids('original') });
    const updated = updateResumeFamilySettings(family, { privacy: 'recruiter_only', archivedAt: '2026-08-11T04:00:00Z', watched: true, defaultTemplateId: 'executive-taupe', viewZoom: 90 });
    expect(updated).toMatchObject({ privacy: 'recruiter_only', archivedAt: '2026-08-11T04:00:00Z', watched: true, defaultTemplateId: 'executive-taupe', viewZoom: 90 });
    expect(family).toMatchObject({ privacy: 'private', archivedAt: null, watched: false });
  });

  it('protects original and master while deleting an ordinary derived version', () => {
    const original = createResumeFamily({ title: 'Original', markdown: '# One', idFactory: ids('original') });
    const first = deriveResume(original, 'First', { idFactory: ids('first') });
    const second = deriveResume(first, 'Second', { idFactory: ids('second') });
    expect(deleteResumeRevision(second, 'original')).toEqual(second);
    const deleted = deleteResumeRevision(second, 'second');
    expect(deleted.revisions.map((revision) => revision.id)).toEqual(['original', 'first']);
    expect(deleted.activeRevisionId).toBe('original');
  });

  it('reparents descendants when an intermediate revision is deleted', () => {
    const original = createResumeFamily({ title: 'Original', markdown: '# One', idFactory: ids('original') });
    const first = deriveResume(original, 'First', { idFactory: ids('first') });
    const second = deriveResume(first, 'Second', { fromRevisionId: 'first', idFactory: ids('second') });
    const third = deriveResume(second, 'Third', { fromRevisionId: 'second', idFactory: ids('third') });
    const selectedFirst = selectResumeRevision(third, 'first');
    const deleted = deleteResumeRevision(selectedFirst, 'first');
    expect(deleted.revisions.map((revision) => revision.id)).toEqual(['original', 'second', 'third']);
    expect(deleted.revisions.find((revision) => revision.id === 'second')?.sourceRevisionId).toBe('original');
    expect(deleted.revisions.find((revision) => revision.id === 'third')?.sourceRevisionId).toBe('second');
  });

  it('detaches a derived revision into an independent immutable family', () => {
    const original = createResumeFamily({ title: 'Original', markdown: '# One', idFactory: ids('original') });
    const derived = updateActiveResume(deriveResume(original, 'Tailored', { idFactory: ids('derived') }), { templateId: 'risk-asphalt', document: { basics: { name: 'Tailored' } } });
    const detached = detachResumeRevision(derived, 'derived', { now: '2026-08-11T05:00:00Z', idFactory: ids('detached') })!;
    expect(detached.revisions).toHaveLength(1);
    expect(activeResumeRevision(detached)).toMatchObject({ id: 'detached', kind: 'original', sourceRevisionId: null, templateId: 'risk-asphalt' });
    expect(detached.defaultTemplateId).toBe('risk-asphalt');
    expect(originalResumeRevision(derived).markdown).toBe('# One');
  });

  it('turns an agent content rewrite into a derivative patch', () => {
    const family = createResumeFamily({ title: 'Uploaded', markdown: '# Source', idFactory: ids('original') });
    const patch = preserveResumeSourceForPatch(
      { kind: 'resume', title: 'Uploaded', resumeFamily: family },
      { markdown: '# Tailored', templateId: 'sales-growth-emerald' },
      { now: '2026-08-11T03:00:00Z', idFactory: ids('agent-version') },
    );
    const next = patch.resumeFamily as ReturnType<typeof createResumeFamily>;
    expect(next.revisions).toHaveLength(2);
    expect(next.revisions[0]?.markdown).toBe('# Source');
    expect(activeResumeRevision(next)).toMatchObject({ id: 'agent-version', markdown: '# Tailored', sourceRevisionId: 'original' });
    expect(patch.content).toBe('# Tailored');
  });

  it('accepts a canonical agent document without persisting a parallel field', () => {
    const family = createResumeFamily({ title: 'Uploaded', markdown: '# Source', document: { basics: { name: 'Source' } }, idFactory: ids('original') });
    const patch = preserveResumeSourceForPatch(
      { kind: 'resume', title: 'Uploaded', resumeFamily: family },
      { resumeDocument: { basics: { name: 'Tailored' }, skills: [{ name: 'Leadership' }] } },
      { idFactory: ids('structured-agent-version') },
    );
    const next = patch.resumeFamily as ReturnType<typeof createResumeFamily>;
    expect(activeResumeRevision(next).document?.basics?.name).toBe('Tailored');
    expect(activeResumeRevision(next).markdown).toContain('# Tailored');
    expect(patch.resumeDocument).toBeUndefined();
    expect(next.revisions[0]?.document?.basics?.name).toBe('Source');
  });

  it('initializes an agent-authored canonical resume as a selectable family', () => {
    const patch = initializeResumeFromPatch('Generated', { resumeDocument: { basics: { name: 'Grace Hopper' }, skills: [{ name: 'Compilers' }] } });
    const family = patch.resumeFamily as ReturnType<typeof createResumeFamily>;
    expect(family.revisions).toHaveLength(1);
    expect(activeResumeRevision(family)).toMatchObject({ kind: 'original', title: 'Generated' });
    expect(patch.markdown).toContain('# Grace Hopper');
    expect(patch.resumeDocument).toBeUndefined();
  });

  it('retains JSON Resume extension fields and renders canonical sections', () => {
    const document = resumeDocumentFromJson({
      basics: { name: 'Ada Lovelace', label: 'Engineer', email: 'ada@example.test', xProfile: { handle: 'ada' } },
      work: [{ id: 'work-1', name: 'Analytical Engines', position: 'Programmer', startDate: '1842', highlights: ['Published the first algorithm'], securityClearance: 'custom' }],
      education: [{ institution: 'Self-directed', area: 'Mathematics' }],
      skills: [{ name: 'Computing', keywords: ['Algorithms'] }],
      interests: [{ name: 'Mathematics', keywords: ['Number theory'] }],
      references: [{ name: 'Charles Babbage', reference: 'Exceptional analytical work.' }],
      customSection: [{ preserved: true }],
    });
    expect(document).not.toBeNull();
    expect(document?.customSection).toEqual([{ preserved: true }]);
    expect(document?.work?.[0]?.securityClearance).toBe('custom');
    expect(renderResumeMarkdown(document!)).toContain('## Experience');
    expect(renderResumeMarkdown(document!)).toContain('Published the first algorithm');
    expect(renderResumeMarkdown(document!)).toContain('## Interests');
    expect(renderResumeMarkdown(document!)).toContain('Exceptional analytical work.');
  });

  it('renders an empty canonical document without hanging or inventing content', () => {
    expect(renderResumeMarkdown({})).toBe('');
  });

  it('honors section visibility and ordering without deleting structured content', () => {
    const document = {
      basics: { name: 'Ada', summary: 'Hidden summary' },
      work: [{ position: 'Engineer', name: 'Engines' }],
      skills: [{ name: 'Algorithms' }],
      builderforceLayout: { sectionOrder: ['skills', 'work'], hiddenSections: ['summary'] },
    };
    const markdown = renderResumeMarkdown(document);
    expect(markdown).not.toContain('Hidden summary');
    expect(markdown.indexOf('## Skills')).toBeLessThan(markdown.indexOf('## Experience'));
    expect(document.basics.summary).toBe('Hidden summary');
  });

  it('regenerates rendered markdown after a structured edit', () => {
    const family = createResumeFamily({
      title: 'Ada',
      markdown: '# Ada',
      document: { basics: { name: 'Ada' }, skills: [{ name: 'Mathematics' }] },
      idFactory: ids('original'),
    });
    const derived = deriveResume(family, 'Structured edit', { idFactory: ids('derived') });
    const updated = updateActiveResume(derived, { document: { basics: { name: 'Ada' }, skills: [{ name: 'Computing', keywords: ['Algorithms'] }] } });
    expect(activeResumeRevision(updated).markdown).toContain('**Computing**: Algorithms');
    expect(activeResumeRevision(updated).structuredStale).toBe(false);
    expect(originalResumeRevision(updated).document?.skills?.[0]?.name).toBe('Mathematics');
  });
});

/**
 * THE HIRED.VIDEO EXPORT.
 *
 * Its JSON Resume is PascalCase. Every reader in this module is camelCase, so the
 * document parsed, passed an "is it an object" check, and then rendered completely
 * blank — which is what left a real résumé unrenderable and pushed the request onto a
 * model that spent four minutes retyping it (2026-08-15).
 */
describe('JSON Resume recognition', () => {
  const HIRED_EXPORT = {
    Basics: { Name: 'Sean Hogg', Label: 'CTO and Technology Leader', Email: 'sean@example.com', Summary: 'Technology leader.' },
    Work: [{ Name: 'Alliance', Position: 'VP of Technology', StartDate: '2021-08-01', EndDate: '2024-01-01', Highlights: ['Reduced operating costs by $1.79M.'] }],
    Education: [{ Institution: 'University of Windsor', Area: 'Computer Science', StudyType: 'Bachelor' }],
    Skills: [], Awards: [], Projects: [],
  };

  it('recognises a PascalCase export and a camelCase one alike', () => {
    expect(isJsonResume(HIRED_EXPORT)).toBe(true);
    expect(isJsonResume({ basics: { name: 'Ada' } })).toBe(true);
  });

  it('does not claim an ordinary data export is a résumé', () => {
    expect(isJsonResume({ rows: [{ id: 1 }], total: 1 })).toBe(false);
    expect(isJsonResume([{ id: 1 }])).toBe(false);
    expect(isJsonResume({ basics: 'not an object' })).toBe(false);
  });

  it('renders every section of a PascalCase export', () => {
    const document = resumeDocumentFromJson(HIRED_EXPORT)!;
    expect(document.basics?.name).toBe('Sean Hogg');
    const markdown = renderResumeMarkdown(document);
    expect(markdown).toContain('# Sean Hogg');
    expect(markdown).toContain('VP of Technology — Alliance');
    expect(markdown).toContain('2021-08-01 – 2024-01-01');
    expect(markdown).toContain('Reduced operating costs by $1.79M.');
    expect(markdown).toContain('University of Windsor — Bachelor — Computer Science');
  });

  /** The résumé a JSON Resume import left behind BEFORE this shipped: a one-row dataset
   *  whose cells are stringified sections. Those boards still exist, so the fan-out has
   *  to read them rather than telling the user their résumé is not a résumé. */
  it('reads a résumé back out of a legacy one-row dataset', () => {
    const rows = [Object.fromEntries(Object.entries(HIRED_EXPORT).map(([key, value]) => [key, JSON.stringify(value)]))];
    const document = resumeDocumentFromNode({ kind: 'dataset', title: 'JsonResume.json', rows });
    expect(document?.basics?.name).toBe('Sean Hogg');
    expect(document?.work?.[0]?.position).toBe('VP of Technology');
  });

  it('reads the document off a résumé object', () => {
    const family = createResumeFamily({ title: 'Ada', markdown: '# Ada', document: { basics: { name: 'Ada' } } });
    expect(resumeDocumentFromNode({ kind: 'resume', title: 'Ada', resumeFamily: family })?.basics?.name).toBe('Ada');
  });

  it('holds no résumé for an unrelated dataset', () => {
    expect(resumeDocumentFromNode({ kind: 'dataset', title: 'Sales', rows: [{ region: 'EMEA', total: '12' }] })).toBeNull();
  });

  /**
   * A résumé held as TEXT — which is every PDF and every Word import — used to reach
   * this accessor through a reader that recovered only a name and a summary, so the
   * variant renderer and the candidate screener both saw an empty work history. The
   * accessor now runs the same deterministic parser the upload route uses.
   */
  it('structures a résumé that is held only as text', () => {
    const family = createResumeFamily({
      title: 'Sean Hogg',
      markdown: [
        'Sean Hogg',
        'seanhogg@gmail.com',
        '',
        'Experience',
        'Alliance Inspection Management — CIO',
        'Sep 2021 - Present',
        '- Reduced operating costs by $1.79M.',
        '',
        'Skills',
        'TypeScript, Kubernetes, PostgreSQL',
      ].join('\n'),
    });
    const document = resumeDocumentFromNode({ kind: 'resume', title: 'Sean Hogg', resumeFamily: family });
    expect(document?.basics?.name).toBe('Sean Hogg');
    expect(document?.work?.length).toBeGreaterThan(0);
    expect(document?.skills?.length).toBeGreaterThan(0);
  });
});

/**
 * THE TEMPLATE ENGINE FAN-OUT — the whole point of the change. "Ten versions in ten
 * styles" must be one deterministic transform of one document, not ten generations.
 */
describe('resumeTemplateVariants', () => {
  const DOCUMENT = { basics: { name: 'Sean Hogg', summary: 'Technology leader.' }, work: [{ name: 'Alliance', position: 'VP of Technology' }] };

  it('renders one document in every requested style, with no content drift', () => {
    const variants = resumeTemplateVariants(DOCUMENT, ['executive-taupe', 'creative-minimal', 'software-engineer-graphite']);
    expect(variants.map((variant) => variant.templateId)).toEqual(['executive-taupe', 'creative-minimal', 'software-engineer-graphite']);
    // Same history in every one — the property authoring ten résumés cannot guarantee.
    const bodies = variants.map((variant) => activeResumeRevision(variant.family).markdown);
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).toContain('VP of Technology — Alliance');
  });

  it('binds each variant to its own template rather than the default', () => {
    for (const variant of resumeTemplateVariants(DOCUMENT, ['risk-asphalt', 'hospitality-amber'])) {
      expect(activeResumeRevision(variant.family).templateId).toBe(variant.templateId);
      expect(variant.family.defaultTemplateId).toBe(variant.templateId);
    }
  });

  it('names each variant for the person and the style it serves', () => {
    const [variant] = resumeTemplateVariants(DOCUMENT, ['healthcare-clinical-blue']);
    expect(activeResumeRevision(variant!.family).title).toBe('Sean Hogg — Healthcare');
  });

  /** An agent-authored résumé asking for a template used to have it silently reset. */
  it('keeps an authored template when a résumé object is created', () => {
    const patch = initializeResumeFromPatch('Ada', { markdown: '# Ada', templateId: 'executive-taupe' });
    expect(patch.templateId).toBe('executive-taupe');
  });
});
