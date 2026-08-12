import { describe, expect, it } from 'vitest';
import { CREATION_OBJECT_REGISTRY, CREATION_PALETTE_GROUPS, availableCreationObjects, createDefaultCreationData, creationObjectAiContext, creationObjectDefinition, creationObjectMutableFields, emptyShellProblem, sanitizeCreationObjectPatch } from './creationObjectRegistry';
import { CREATION_OBJECT_KINDS } from '@builderforce/creation-canvas-contract';

describe('creation object registry', () => {
  it('has one unique definition for every palette object', () => {
    const kinds = CREATION_OBJECT_REGISTRY.map((definition) => definition.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(new Set(CREATION_PALETTE_GROUPS.flatMap((group) => group.items.map((item) => item.kind)))).toEqual(new Set(kinds));
    expect(new Set(kinds)).toEqual(new Set(CREATION_OBJECT_KINDS));
  });

  it('produces valid default data and resolves the same canonical definition', () => {
    for (const definition of CREATION_OBJECT_REGISTRY) {
      const data = createDefaultCreationData(definition.kind);
      expect(data.kind).toBe(definition.kind);
      expect(data.title.trim()).not.toBe('');
      expect(creationObjectDefinition(definition.kind)).toBe(definition);
      expect(definition.actions.length).toBeGreaterThan(0);
      expect(definition.actions).toEqual(expect.arrayContaining(['inspect', 'edit']));
      expect(definition.mutableFields).toEqual(creationObjectMutableFields(definition.kind));
      expect(definition.mutableFields).toEqual(expect.arrayContaining(['title', 'subtitle', 'status', 'content']));
      expect(definition.allowedConnections.length).toBe(6);
      expect(definition.contextAdapter({ ...data, secret: 'must-not-leak' })).not.toHaveProperty('secret');
      expect(definition.previewAdapter(data)).toMatchObject({ kind: definition.kind, title: data.title });
    }
  });

  it('accepts authored content for every palette object while rejecting unknown and sensitive fields', () => {
    const longDocument = Array.from({ length: 500 }, (_, index) => `word${index}`).join(' ');
    for (const definition of CREATION_OBJECT_REGISTRY) {
      const patch = sanitizeCreationObjectPatch(definition.kind, {
        title: `Authored ${definition.label}`,
        content: longDocument,
        secret: 'must-not-leak',
        unknownField: 'must-not-persist',
      });
      expect(patch.title).toBe(`Authored ${definition.label}`);
      expect(patch.content).toBe(longDocument);
      expect(patch).not.toHaveProperty('secret');
      expect(patch).not.toHaveProperty('unknownField');
    }
  });

  it('sanitizes nested credentials from structured Brain-authored content', () => {
    expect(sanitizeCreationObjectPatch('mcp', {
      operation: 'summarize',
      arguments: { projectId: 42, apiToken: 'do-not-store', nested: { password: 'nope', safe: true } },
    })).toEqual({ operation: 'summarize', arguments: { projectId: 42, nested: { safe: true } } });
  });

  it('keeps an authored course all the way down to its lessons and answer choices', () => {
    // Regression: the nesting cap was 4, and a course nests
    // course → modules[] → module → lessons[] → lesson, putting every lesson
    // object at exactly depth 4. They were all dropped, so a generated LMS
    // arrived with titled modules, no lessons, and answer-less assessments —
    // indistinguishable from the model having declined to write the content.
    const patch = sanitizeCreationObjectPatch('course', {
      course: {
        schema: 'https://builderforce.ai/schemas/course/v1',
        modules: [{
          id: 'scorecards', title: '2. Job scorecards', description: 'Define the outcome before the interview.',
          lessons: [{ id: 'scorecard-outcomes', title: 'Write the outcomes', objective: 'State what success looks like.', content: 'A scorecard names outcomes, not adjectives.', activity: 'Draft three outcomes for an open role.', durationMinutes: 20 }],
          assessment: { question: 'What belongs on a scorecard?', choices: ['Adjectives', 'Measurable outcomes'], answer: 1, explanation: 'Outcomes are assessable; adjectives are not.' },
        }],
      },
    });

    const course = patch.course as { modules: Array<{ lessons: Array<{ title: string; activity: string }>; assessment: { choices: string[]; answer: number } }> };
    expect(course.modules[0]!.lessons).toHaveLength(1);
    expect(course.modules[0]!.lessons[0]).toMatchObject({ title: 'Write the outcomes', activity: 'Draft three outcomes for an open role.' });
    expect(course.modules[0]!.assessment).toMatchObject({ choices: ['Adjectives', 'Measurable outcomes'], answer: 1 });
  });

  it('still refuses secrets no matter how deeply they are nested', () => {
    const patch = sanitizeCreationObjectPatch('course', {
      course: { modules: [{ lessons: [{ title: 'Sourcing', apiToken: 'do-not-store', nested: { password: 'nope', safe: true } }] }] },
    });
    const course = patch.course as { modules: Array<{ lessons: Array<Record<string, unknown>> }> };
    expect(course.modules[0]!.lessons[0]).toEqual({ title: 'Sourcing', nested: { safe: true } });
  });

  it('keeps a guided tour contract authorable while stripping sensitive fields', () => {
    const patch = sanitizeCreationObjectPatch('guidedTour', { tour: { version: 2, minimumVisits: 2, offerTitle: 'Welcome', apiKey: 'hidden', steps: [{ id: 'one', title: 'Start here', body: 'Learn this area', targetObjectId: 'node-1' }] } });
    expect(patch.tour).toMatchObject({ version: 2, minimumVisits: 2, steps: [{ targetObjectId: 'node-1' }] });
    expect(patch.tour).not.toHaveProperty('apiKey');
  });

  it('shows Brain the lessons of a course that is already on the board', () => {
    // The read-side twin of the sanitizer bug above. A teacher agent asked to
    // work through the material one step at a time and check understanding was
    // handed modules with titles and no lessons, so it re-invented the
    // curriculum instead of teaching the one the learner was looking at.
    const context = creationObjectAiContext({
      kind: 'course', title: 'Recruiting and Hiring',
      course: {
        modules: [{
          id: 'sourcing', title: '3. Inclusive sourcing',
          lessons: [{ id: 'sourcing-channels', title: 'Widen the channel mix', activity: 'Audit last quarter’s sources.' }],
          assessment: { question: 'What widens a candidate pool?', choices: ['One job board', 'Several channels'], answer: 1 },
        }],
      },
    } as never);

    const course = context.course as { modules: Array<{ lessons: Array<{ title: string }>; assessment: { choices: string[] } }> };
    expect(course.modules[0]!.lessons[0]).toMatchObject({ title: 'Widen the channel mix' });
    expect(course.modules[0]!.assessment.choices).toEqual(['One job board', 'Several channels']);
  });

  it('keeps the default nesting budget for every other field', () => {
    // The deeper budget is scoped to `course`; nothing else gained context depth.
    const context = creationObjectAiContext({
      kind: 'diagnostics', title: 'Audit',
      results: [{ group: 'a', items: [{ nested: { tooDeep: 'dropped' } }] }],
    } as never);
    const results = context.results as Array<{ group: string; items: unknown[] }>;
    expect(results[0]!.group).toBe('a');
    expect(results[0]!.items).toEqual([]);
  });

  it('retains authored agent tests and evaluation results', () => {
    expect(sanitizeCreationObjectPatch('agent', { testPrompt: 'Where is my order?', testExpected: 'ask for order number' })).toMatchObject({ testPrompt: 'Where is my order?', testExpected: 'ask for order number' });
    expect(sanitizeCreationObjectPatch('evaluation', { passRate: 80, runCount: 5, testResults: [{ passed: true }] })).toMatchObject({ passRate: 80, runCount: 5, testResults: [{ passed: true }] });
  });

  it('gates plan capabilities without hiding unrestricted object kinds', () => {
    const base = availableCreationObjects(new Set()).map((definition) => definition.kind);
    expect(base).toContain('workflow');
    expect(base).not.toContain('evermind');
    expect(availableCreationObjects(new Set(['evermind'])).map((definition) => definition.kind)).toContain('evermind');
  });

  it('binds every creative widget to the provider-neutral built-in MCP contract', () => {
    for (const kind of ['image', 'animation', 'podcast', 'comic', 'game', 'cad', 'model3d', 'resume', 'template'] as const) {
      const data = createDefaultCreationData(kind);
      expect(data.mcpServer).toBe('builtin');
      expect(data.provider).toBe('native');
      expect(data.capabilityId).toBe(`creative.${kind}`);
      expect(data.mcpTool).toMatch(/^builtin_creative_/);
    }
    expect(createDefaultCreationData('model3d').mediaKind).toBe('model3d');
    expect(createDefaultCreationData('resume')).toMatchObject({ mediaKind: 'document', templateId: 'resume' });
  });

  it('keeps the Canvas video timeline authorable by Brain and direct editing', () => {
    const data = createDefaultCreationData('video');
    expect(data).toMatchObject({ title: 'Untitled video', videoTimeline: { version: 1, clips: [] }, videoSources: [] });
    const patch = sanitizeCreationObjectPatch('video', {
      videoTimeline: { version: 1, fps: 30, width: 1920, height: 1080, backgroundColor: '#000000', clips: [{ id: 'clip-1', sourceId: 'source-1', track: 'visual', startSeconds: 0, durationSeconds: 4, trimStartSeconds: 0, volume: 1, label: 'Opening' }] },
      videoSources: [{ id: 'source-1', kind: 'video', captureKind: 'ai', url: '/opening.webm', fileName: 'opening.webm', mimeType: 'video/webm', durationSeconds: 4 }],
    });
    expect(patch.videoTimeline).toMatchObject({ clips: [{ id: 'clip-1', label: 'Opening' }] });
    expect(patch.videoSources).toEqual([expect.objectContaining({ captureKind: 'ai' })]);
  });

  it('exposes canonical resume fields to Brain without making lineage directly mutable', () => {
    const resumeFamily = {
      version: 1, originalRevisionId: 'original', activeRevisionId: 'derived', masterRevisionId: 'original',
      revisions: [
        { id: 'original', kind: 'original', title: 'Uploaded', markdown: '# Original', templateId: 'hired-default', sourceRevisionId: null, createdAt: '2026-08-11', updatedAt: '2026-08-11', document: { basics: { name: 'Ada' }, work: [{ name: 'Engines', position: 'Programmer', highlights: ['Algorithms'] }] } },
        { id: 'derived', kind: 'derived', title: 'Tailored', markdown: '# Tailored', templateId: 'hired-default', sourceRevisionId: 'original', createdAt: '2026-08-11', updatedAt: '2026-08-11', document: { basics: { name: 'Ada' }, skills: [{ name: 'Computing' }] } },
      ],
    };
    const context = creationObjectAiContext({ kind: 'resume', title: 'Ada', resumeFamily });
    // `toMatchObject` compares arrays by LENGTH as well as content, so listing one
    // revision against a two-revision family asserted the opposite of the intent —
    // Brain must see the WHOLE lineage. Assert the shape of each revision instead.
    expect(context.resumeFamily).toMatchObject({ originalRevisionId: 'original', activeRevisionId: 'derived' });
    const revisions = (context.resumeFamily as { revisions: unknown[] }).revisions;
    expect(revisions).toHaveLength(2);
    expect(revisions[0]).toMatchObject({ id: 'original', document: { basics: { name: 'Ada' }, work: [{ position: 'Programmer' }] } });
    expect(revisions[1]).toMatchObject({ id: 'derived', document: { skills: [{ name: 'Computing' }] } });
    expect(creationObjectMutableFields('resume')).toContain('resumeDocument');
    expect(creationObjectMutableFields('resume')).not.toContain('resumeFamily');
  });

  it('retains bounded evidence samples while excluding full rows, prompts, and secrets from Brain context', () => {
    const context = creationObjectAiContext({
      kind: 'projectComparison', title: 'Alpha vs Beta', status: 'Live evidence', fetchedAt: '2026-08-01T00:00:00.000Z',
      projects: [{ name: 'Alpha', health: 91, features: ['Canvas'] }],
      sources: [{ label: 'Project metrics', resource: '/api/projects', accessToken: 'nested-token-do-not-send' }],
      columns: ['customer', 'request'], rowCount: 12_000,
      sampleRows: [{ customer: 'Ada', request: 'Canvas', apiToken: 'nested-secret' }],
      rows: [{ customer: 'private customer', request: 'secret request' }],
      prompt: 'private prompt', secret: 'sk-do-not-send', accessToken: 'token-do-not-send',
    });

    expect(context).toMatchObject({ title: 'Alpha vs Beta', rowCount: 12_000, columns: ['customer', 'request'] });
    expect(context.projects).toEqual([{ name: 'Alpha', health: 91, features: ['Canvas'] }]);
    expect(context.sources).toEqual([{ label: 'Project metrics', resource: '/api/projects' }]);
    expect(context.sampleRows).toEqual([{ customer: 'Ada', request: 'Canvas' }]);
    expect(context).not.toHaveProperty('rows');
    expect(context).not.toHaveProperty('prompt');
    expect(context).not.toHaveProperty('secret');
    expect(context).not.toHaveProperty('accessToken');
  });
});

/**
 * Measured 2026-08-12 (ui 2026.7.213): a marketing turn created nine objects and eight
 * were title-only — a dashboard with no KPIs, four KPIs with no value — and Brain
 * reported success, telling the operator to populate them himself.
 */
describe('emptyShellProblem', () => {
  it('rejects an artifact whose only authored field is its title', () => {
    expect(emptyShellProblem('kpi', { title: 'Monthly Recurring Revenue (MRR)' }))
      .toContain('empty shell');
    expect(emptyShellProblem('dashboard', { title: 'SaaS Metrics Dashboard' }))
      .toContain('empty shell');
    // The error NAMES the fields to author, so the model can correct it in the same turn.
    expect(emptyShellProblem('kpi', { title: 'MRR' })).toContain('value');
  });

  it('accepts an artifact that carries real content', () => {
    expect(emptyShellProblem('kpi', { title: 'MRR', value: '42000', unit: 'USD/mo' })).toBeNull();
    expect(emptyShellProblem('dashboard', { title: 'SaaS', kpis: [{ label: 'MRR' }] })).toBeNull();
  });

  it('treats blank and empty values as unauthored, not as content', () => {
    expect(emptyShellProblem('kpi', { title: 'MRR', value: '   ', sources: [] })).toContain('empty shell');
  });

  it('leaves kinds whose shell IS the point alone', () => {
    // A Builder workspace is seeded from a starter project; a Dataset is filled by an
    // import; a Chat holds the conversation itself.
    for (const kind of ['build', 'chat', 'dataset', 'frame'] as const) {
      expect(emptyShellProblem(kind, { title: 'x' })).toBeNull();
    }
  });

  it('does not stamp a metric Live before it has a number', () => {
    expect(createDefaultCreationData('kpi').status).not.toBe('Live');
  });
});
