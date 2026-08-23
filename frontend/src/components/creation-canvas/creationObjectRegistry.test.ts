import { describe, expect, it } from 'vitest';
import { CREATION_OBJECT_REGISTRY, CREATION_PALETTE_GROUPS, availableCreationObjects, createDefaultCreationData, creationPaletteGroupsFor, creationObjectAiContext, creationObjectDefinition, creationObjectMutableFields, creationObjectName, emptyShellProblem, sanitizeCreationObjectPatch, TITLE_IS_CONTENT_KINDS } from './creationObjectRegistry';
import { CREATION_CONNECTION_KINDS, CREATION_OBJECT_KINDS } from '@builderforce/creation-canvas-contract';

describe('creation object registry', () => {
  it('has one unique definition for every palette object, legacy kinds kept off the palette', () => {
    const kinds = CREATION_OBJECT_REGISTRY.map((definition) => definition.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    // A `legacy` kind (currently just `workflow`) stays a REGISTRY entry — a saved
    // board still has to render, name and inspect it — but is not a PALETTE entry:
    // nothing may place a new one. The two sets diverge by exactly the legacy kinds.
    const legacyKinds = new Set(CREATION_OBJECT_REGISTRY.filter((definition) => definition.legacy).map((definition) => definition.kind));
    expect(legacyKinds).toEqual(new Set(['workflow']));
    const paletteKinds = new Set(CREATION_PALETTE_GROUPS.flatMap((group) => group.items.map((item) => item.kind)));
    expect(paletteKinds).toEqual(new Set(kinds.filter((kind) => !legacyKinds.has(kind))));
    expect(new Set(kinds)).toEqual(new Set(CREATION_OBJECT_KINDS));
  });

  it('produces valid default data and resolves the same canonical definition', () => {
    for (const definition of CREATION_OBJECT_REGISTRY) {
      const data = createDefaultCreationData(definition.kind);
      expect(data.kind).toBe(definition.kind);
      // A sticky is the one kind whose title IS its content, so it starts blank
      // on purpose — see `TITLE_IS_CONTENT_KINDS`. Every other kind arrives named.
      if (TITLE_IS_CONTENT_KINDS.has(definition.kind)) expect(data.title).toBe('');
      else expect(data.title.trim()).not.toBe('');
      expect(creationObjectDefinition(definition.kind)).toBe(definition);
      expect(definition.actions.length).toBeGreaterThan(0);
      expect(definition.actions).toEqual(expect.arrayContaining(['inspect', 'edit']));
      expect(definition.mutableFields).toEqual(creationObjectMutableFields(definition.kind));
      expect(definition.mutableFields).toEqual(expect.arrayContaining(['title', 'subtitle', 'status', 'content']));
      // Derived, not counted: a connection kind added to the contract is a kind
      // every object may use, and hard-coding the number made adding one a test
      // failure in a file that has nothing to do with connections.
      expect(definition.allowedConnections.length).toBe(CREATION_CONNECTION_KINDS.length);
      expect(definition.contextAdapter({ ...data, secret: 'must-not-leak' })).not.toHaveProperty('secret');
      // What to CALL an object where it is referred to rather than drawn. A kind whose
      // title is legitimately blank still has to be nameable, or the accessible outline
      // renders "Focus " and the Brain's roster of connected work draws an empty line.
      expect(creationObjectName(data).trim()).not.toBe('');
      if (TITLE_IS_CONTENT_KINDS.has(definition.kind)) expect(creationObjectName(data)).toBe(definition.label);
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
    expect(base).toContain('flowStep');
    expect(base).not.toContain('evermind');
    // LEGACY, not entitlement-gated: `workflow` has no editor left to unlock, so it
    // is absent from what may be authored while staying resolvable off the registry.
    expect(base).not.toContain('workflow');
    expect(creationObjectDefinition('workflow').kind).toBe('workflow');
    expect(availableCreationObjects(new Set(['evermind'])).map((definition) => definition.kind)).toContain('evermind');
  });

  it('makes the PALETTE ask the capability question, not just the registry', () => {
    // The defect this covers: `availableCreationObjects` existed, filtered correctly, and
    // was called by nothing but this file — so the palette rendered from the raw group
    // list and a card marked as needing an entitlement was placeable by anybody. If the
    // palette ever stops consulting the gate, this fails rather than going quietly inert.
    const itemFor = (capabilities: ReadonlySet<string>) =>
      creationPaletteGroupsFor(true, capabilities).flatMap((group) => group.items).find((item) => item.kind === 'evermind');
    // SHOWN and LOCKED, not hidden: `<RoleGate>`'s rule, applied to the palette. Hiding a
    // paid feature means nobody can discover it.
    expect(itemFor(new Set())?.locked).toBe(true);
    expect(itemFor(new Set(['evermind']))?.locked).toBeUndefined();
  });

  it('keeps the palette the same size whether or not the caller is entitled', () => {
    // An entitlement gate that costs the palette its unentitled kinds would be worse
    // than none — and a heading over an emptied list reads as a loading failure.
    const count = (capabilities: ReadonlySet<string>) =>
      creationPaletteGroupsFor(true, capabilities).reduce((total, group) => total + group.items.length, 0);
    expect(count(new Set())).toBe(count(new Set(['evermind'])));
    for (const group of creationPaletteGroupsFor(true, new Set())) {
      expect(group.items.length, group.group).toBeGreaterThan(0);
    }
  });

  it('locks nothing while the entitlement set is UNKNOWN', () => {
    // `null` is a loading state, a guest board, or a failed fetch — none of which is a
    // refusal. Greying out a card somebody pays for on a network blip is a worse failure
    // than an unlocked row, and the API refuses on its own regardless.
    const unknown = creationPaletteGroupsFor(true, null).flatMap((group) => group.items);
    expect(unknown.some((item) => item.locked)).toBe(false);
    expect(unknown.find((item) => item.kind === 'evermind')).toBeTruthy();
  });

  it('still HIDES a restricted kind from a guest, which is a different question', () => {
    // A guest board has no tenant and no access control, so there is no upgrade that
    // makes a Grievance case safe there — the board itself is the problem. Hidden, not
    // locked.
    const guest = creationPaletteGroupsFor(false, new Set()).flatMap((group) => group.items.map((item) => item.kind));
    expect(guest).not.toContain('grievance');
    // Legacy for everybody, guest or not — there is no upgrade that gives `workflow`
    // an editor back.
    expect(guest).not.toContain('workflow');
    expect(guest).toContain('flowStep');
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
        { id: 'original', kind: 'original', title: 'Uploaded', markdown: '# Original', templateId: 'standard', sourceRevisionId: null, createdAt: '2026-08-11', updatedAt: '2026-08-11', document: { basics: { name: 'Ada' }, work: [{ name: 'Engines', position: 'Programmer', highlights: ['Algorithms'] }] } },
        { id: 'derived', kind: 'derived', title: 'Tailored', markdown: '# Tailored', templateId: 'standard', sourceRevisionId: 'original', createdAt: '2026-08-11', updatedAt: '2026-08-11', document: { basics: { name: 'Ada' }, skills: [{ name: 'Computing' }] } },
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

  /**
   * Measured 2026-08-14 (ui 2026.8.15). Asked to write an email, the canvas produced an
   * email tile whose body read "No body": `email` was exempt from this guard on the
   * grounds that a message is READ from a mailbox, but the read path
   * (`canvas_pin_email`) never reaches this function — only the authored one does. Even
   * unexempted, a `subject` alone would have cleared it, and the subject is the envelope.
   */
  it('rejects a message whose subject was authored but whose body was not', () => {
    expect(emptyShellProblem('email', { title: 'Reviewing my compensation', subject: 'Reviewing my compensation' }))
      .toContain('empty shell');
    // The error NAMES the field to author, so the model can correct it in the same turn.
    expect(emptyShellProblem('email', { title: 'Raise request' })).toContain('bodyText');
    expect(emptyShellProblem('emailTemplate', { title: 'Welcome', subject: 'Welcome aboard' })).toContain('bodyHtml');
    expect(emptyShellProblem('email', { title: 'Raise request', subject: 'x', bodyText: '   ' }))
      .toContain('empty shell');
  });

  it('accepts a message that carries its letter, by copy or by template', () => {
    expect(emptyShellProblem('email', { title: 'Raise request', subject: 'Reviewing my compensation', bodyText: 'Hi Dana, I would like to discuss my salary.' })).toBeNull();
    expect(emptyShellProblem('emailCampaign', { title: 'Launch', bodyHtml: '<p>We are live.</p>' })).toBeNull();
    // A campaign may reference an authored template instead of carrying its own copy.
    expect(emptyShellProblem('emailCampaign', { title: 'Launch', templateId: 42 })).toBeNull();
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
