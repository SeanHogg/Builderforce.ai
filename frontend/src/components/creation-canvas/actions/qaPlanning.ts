/** QA planning — test plans, coverage and defects. */
import type { BrainAction } from '@seanhogg/builderforce-brain-embedded';
import { findingFingerprint, normalizeQaSteps, QA_FINDING_TYPES, QA_SEVERITIES, QA_STEP_ACTIONS, type QaFindingSeverity, type QaFindingType } from '@builderforce/creation-canvas-contract';
import { type BuildPlanInput, buildTestPlan, coverageReport, normalizeExitCriteria, routesFromHtml, testTargetUrl } from '@/lib/canvasQa';
import { sanitizeCreationObjectPatch } from '../creationObjectRegistry';
import type { CanvasActionContext } from './context';

export function canvasQaPlanningActions(ctx: CanvasActionContext): BrainAction[] {
  const { canEdit, recentJournalEvidence, stage } = ctx;
  return [  {
    /**
     * "I'm trying to create automation tests, can you create them for my website."
     *
     * The whole answer, in one call and with no account: a plan bound to the target,
     * one runnable case per route, the generated Playwright source on each, and the
     * membership edges that make them a suite. Route discovery is deterministic —
     * pass the page HTML from a web fetch and the same links produce the same plan.
     */
    name: 'canvas_create_test_plan',
    description: 'Create automation tests for a website. Builds a test plan bound to a target URL plus one runnable Playwright test case per route, each with real spec source the user can download and run. Use this for any request to write, generate or set up tests, e2e tests, automated QA or regression checks for a site. Pass `html` from a fetched page to discover the routes automatically, or pass `routes` when the user named them. Pass `scenarios` for journeys the user described in words ("a visitor requests a quote") — those become cases with their own steps.',
    parameters: {
      type: 'object', required: ['targetUrl'], additionalProperties: false,
      properties: {
        targetUrl: { type: 'string', description: 'The site under test — "acme.com" or "https://acme.com/app".' },
        name: { type: 'string', description: 'What the plan is called. Defaults to the target.' },
        routes: { type: 'array', items: { type: 'string' }, description: 'Absolute paths to cover, e.g. ["/", "/pricing"]. "/" is always included.' },
        html: { type: 'string', description: 'HTML of the fetched target page. Same-site page links become routes; assets, /api and auth pages are excluded.' },
        scenarios: {
          type: 'array',
          description: 'Named journeys with their own steps. A scenario with no steps becomes a smoke case for its route.',
          items: {
            type: 'object', required: ['title'], additionalProperties: false,
            properties: {
              title: { type: 'string' },
              intent: { type: 'string', description: 'What this case proves.' },
              route: { type: 'string' },
              priority: { type: 'string', enum: ['critical', 'high', 'normal'] },
              steps: {
                type: 'array',
                items: {
                  type: 'object', required: ['action'], additionalProperties: false,
                  properties: {
                    action: { type: 'string', enum: [...QA_STEP_ACTIONS] },
                    route: { type: 'string', description: 'For goto: the path to navigate to.' },
                    selector: { type: 'string', description: 'Resilient first: "testid=submit", "role=button[name=Save]", "label=Email", "text=Thanks", or a CSS selector.' },
                    value: { type: 'string', description: 'For fill: a synthetic value. For press: the key.' },
                    assertion: { type: 'string', description: 'For expect: what is being proven, in one phrase.' },
                  },
                },
              },
            },
          },
        },
        exitCriteria: {
          type: 'object', additionalProperties: false,
          description: 'The release gate this plan is read as. Omit unless the user asked for one.',
          properties: {
            minPassRate: { type: 'number', description: 'Percentage of cases that must pass, 0-100.' },
            maxOpenDefects: { type: 'number' },
            maxSevereDefects: { type: 'number' },
            requireAccessibility: { type: 'boolean' },
            signOffs: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
    mutates: true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { targetUrl?: string; name?: string; routes?: string[]; html?: string; scenarios?: BuildPlanInput['scenarios']; exitCriteria?: unknown };
      const target = typeof args.targetUrl === 'string' ? testTargetUrl(args.targetUrl) : null;
      if (!target) return { error: 'Pass the site under test as a URL or host, e.g. "acme.com".' };
      const discovered = typeof args.html === 'string' && args.html ? routesFromHtml(args.html, target) : [];
      const built = buildTestPlan({
        name: typeof args.name === 'string' && args.name.trim() ? args.name.trim().slice(0, 120) : target,
        targetUrl: target,
        routes: [...(args.routes ?? []), ...discovered],
        ...(args.scenarios ? { scenarios: args.scenarios } : {}),
        exitCriteria: normalizeExitCriteria(args.exitCriteria),
      });
      if (!built.cases.length) return { error: 'Nothing to test — pass routes, page html, or at least one scenario.' };

      const planNode = stage.createObject('testPlan');
      planNode.data = {
        ...planNode.data,
        ...sanitizeCreationObjectPatch('testPlan', {
          title: built.plan.title, targetUrl: built.plan.targetUrl, routes: built.plan.routes,
          exitCriteria: built.plan.exitCriteria, summary: built.plan.summary, planSlug: built.plan.slug,
          status: built.plan.status,
        }),
        caseCount: built.cases.length,
      };
      stage.addObject(`Add test plan “${built.plan.title}”`, planNode);

      for (const [index, testCase] of built.cases.entries()) {
        const caseNode = stage.createObject('testCase', { x: planNode.position.x + 520, y: planNode.position.y + index * 260 });
        caseNode.data = {
          ...caseNode.data,
          ...sanitizeCreationObjectPatch('testCase', {
            title: testCase.title, steps: testCase.steps, spec: testCase.spec, priority: testCase.priority,
            caseId: testCase.id, targetUrl: built.plan.targetUrl, status: 'Not run',
            ...(testCase.route ? { route: testCase.route } : {}),
            ...(testCase.intent ? { intent: testCase.intent } : {}),
          }),
        };
        stage.addObject(`Add test case “${testCase.title}”`, caseNode);
        stage.addConnection(
          `Case of ${built.plan.title}`,
          { id: crypto.randomUUID(), source: planNode.id, target: caseNode.id, type: 'smoothstep', label: 'covers', data: { connectionKind: 'membership' } },
        );
      }

      return {
        ok: true, proposed: true,
        object: { id: planNode.id, kind: 'testPlan', title: built.plan.title, created: true },
        targetUrl: built.plan.targetUrl,
        routes: built.plan.routes,
        cases: built.cases.map((testCase) => ({ id: testCase.id, title: testCase.title, steps: testCase.steps.length, priority: testCase.priority })),
        // The model must tell the user what it actually made, and what it did not:
        // these run against the site, they are not connected to CI by this call.
        note: 'Each case carries runnable Playwright source. The user can download the .spec.ts files from the case cards. Connecting them to a CI pipeline is a separate step.',
      };
    },
  },   {
    /**
     * Coverage. Computed over `verifies` edges ONLY — see the connection kind's note
     * in the contract for why a `reference` edge must not count.
     */
    name: 'canvas_test_coverage',
    description: 'Report what on this canvas is proven by a test and what is not. Reads the "verifies" connections between test cases/plans and the work they cover, and names the requirements, tasks and builds with no test at all, plus any test case that verifies nothing. Use this to answer "what is untested", "what breaks if this fails", or before a release. Connect a case to what it proves with canvas_connect_objects using kind "verifies".',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    run: () => {
      const all = stage.nodes();
      const report = coverageReport(
        all.map((node) => ({ id: node.id, kind: node.data.kind, title: node.data.title })),
        stage.edges().map((edge) => ({
          source: edge.source, target: edge.target,
          connectionKind: typeof (edge.data as { connectionKind?: unknown } | undefined)?.connectionKind === 'string'
            ? String((edge.data as { connectionKind?: unknown }).connectionKind) : undefined,
        })),
      );
      return { ok: true, ...report };
    },
  },   {
    /**
     * The defect object, with the journal attached.
     *
     * `journal` is the canvas action record — what the person was actually DOING —
     * and attaching it here is the reason it is persisted at all: a bug report whose
     * repro is "it did this three steps ago" is unactionable, and by the time anyone
     * files one the steps are gone.
     */
    name: 'canvas_record_defect',
    description: 'File a defect on the canvas: what was expected, what happened, how to see it again, and how bad it is. Use this whenever the user reports something broken, or a test case fails. Pass caseObjectId to inherit that case\'s steps as the repro. The recent canvas action journal is attached automatically so the report carries what was actually being done.',
    parameters: {
      type: 'object', required: ['title', 'expected', 'actual'], additionalProperties: false,
      properties: {
        title: { type: 'string', description: 'The defect in one line, as a symptom rather than a guess at the cause.' },
        expected: { type: 'string' },
        actual: { type: 'string' },
        severity: { type: 'string', enum: [...QA_SEVERITIES] },
        defectType: { type: 'string', enum: [...QA_FINDING_TYPES] },
        route: { type: 'string' },
        targetUrl: { type: 'string' },
        caseObjectId: { type: 'string', description: 'A testCase object on this canvas whose steps reproduce it.' },
        reproSteps: {
          type: 'array', description: 'Repro steps, when no case covers it.',
          items: {
            type: 'object', required: ['action'], additionalProperties: false,
            properties: {
              action: { type: 'string', enum: [...QA_STEP_ACTIONS] },
              route: { type: 'string' }, selector: { type: 'string' }, value: { type: 'string' }, assertion: { type: 'string' },
            },
          },
        },
      },
    },
    mutates: true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as {
        title?: string; expected?: string; actual?: string; severity?: QaFindingSeverity;
        defectType?: QaFindingType; route?: string; targetUrl?: string; caseObjectId?: string; reproSteps?: unknown;
      };
      const title = typeof args.title === 'string' ? args.title.trim().slice(0, 160) : '';
      const expected = typeof args.expected === 'string' ? args.expected.trim().slice(0, 2_000) : '';
      const actual = typeof args.actual === 'string' ? args.actual.trim().slice(0, 2_000) : '';
      if (!title || !expected || !actual) return { error: 'A defect needs a title, what was expected, and what actually happened.' };

      const all = stage.nodes();
      const source = args.caseObjectId ? all.find((node) => node.id === args.caseObjectId && node.data.kind === 'testCase') : undefined;
      const steps = normalizeQaSteps(args.reproSteps ?? source?.data.steps ?? []);
      const severity = QA_SEVERITIES.includes(args.severity as QaFindingSeverity) ? args.severity as QaFindingSeverity : 'medium';
      const defectType = QA_FINDING_TYPES.includes(args.defectType as QaFindingType) ? args.defectType as QaFindingType : 'assertion';
      const route = typeof args.route === 'string' ? args.route.slice(0, 200) : String(source?.data.route ?? '');
      const targetUrl = typeof args.targetUrl === 'string' ? args.targetUrl.slice(0, 400) : String(source?.data.targetUrl ?? '');

      const node = stage.createObject('defect', source ? { x: source.position.x + 520, y: source.position.y + 120 } : {});
      node.data = {
        ...node.data,
        ...sanitizeCreationObjectPatch('defect', {
          title, expected, actual, severity, defectType, reproSteps: steps,
          ...(route ? { route } : {}), ...(targetUrl ? { targetUrl } : {}),
          ...(source ? { caseId: String(source.data.caseId ?? source.id) } : {}),
          fingerprint: findingFingerprint({ type: defectType, route: route || null, selector: null, message: actual }),
          journal: recentJournalEvidence(),
          status: 'open',
        }),
      };
      stage.addObject(`File defect “${title}”`, node);
      if (source) {
        stage.addConnection(
          `Found by ${source.data.title}`,
          { id: crypto.randomUUID(), source: source.id, target: node.id, type: 'smoothstep', label: 'found', data: { connectionKind: 'reference' } },
        );
      }
      return { ok: true, proposed: true, object: { id: node.id, kind: 'defect', title, created: true }, severity, reproSteps: steps.length };
    },
  }];
}
