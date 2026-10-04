/** QA execution — page audits, generated test data and publishing cases to the library. */
import type { BrainAction } from '@seanhogg/builderforce-brain-embedded';
import { auditPageHtml } from '@/lib/canvasPageAudit';
import { sanitizeCreationObjectPatch } from '../creationObjectRegistry';
import { normalizeClassifications, normalizeDataContract } from '@/lib/canvasDataGovernance';
import { fixtureFromDataset, generateFixture, unmaskedSensitiveColumns } from '@/lib/canvasTestData';
import { getStoredTenantToken } from '@/lib/auth';
import { accountGateResult } from './accountGate';
import { CANVAS_QA_ACCOUNT_GATE, normalizeQaSteps } from '@builderforce/creation-canvas-contract';
import { canvasProjectId } from '@/lib/canvasProjectRef';
import * as qaApi from '@/lib/qa/api';
import { toolErrorMessage } from '@/lib/toolErrorMessage';
import { defectFromResult, summarizeRun } from '@/lib/canvasQa';
import type { CanvasActionContext } from './context';

export function canvasQaExecutionActions(ctx: CanvasActionContext): BrainAction[] {
  const { canEdit, recentJournalEvidence, requireAccount, resolveTabularTarget, stage, t } = ctx;
  return [  {
    /**
     * The accessibility / performance verdict, on the board beside the thing being
     * built. Static by construction — see `lib/canvasPageAudit` for what that can and
     * cannot decide, which the summary states rather than implies.
     */
    name: 'canvas_audit_page',
    description: 'Audit a web page for accessibility (WCAG 2.2) and performance from its HTML, and put the scored verdict on the canvas. Fetch the page first, then pass its html here. Checks language, title, image alt text, link and button names, form labels, heading order, zoom blocking, frame titles, focus order, landmarks, render-blocking scripts, image dimensions and page weight. It reads source, so it cannot judge colour contrast or anything that only exists after scripts run — the result says so.',
    parameters: {
      type: 'object', required: ['html', 'url'], additionalProperties: false,
      properties: {
        html: { type: 'string', description: 'The fetched page HTML.' },
        url: { type: 'string', description: 'The page that HTML came from.' },
      },
    },
    mutates: true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { html?: string; url?: string };
      const html = typeof args.html === 'string' ? args.html : '';
      const url = typeof args.url === 'string' ? args.url.trim().slice(0, 400) : '';
      if (html.trim().length < 40) return { error: 'Pass the fetched page HTML — fetch the page first, then audit it.' };
      const audit = auditPageHtml(html, url);

      const node = stage.createObject('diagnostics');
      const failed = audit.findings.filter((item) => item.count > 0);
      node.data = {
        ...node.data,
        ...sanitizeCreationObjectPatch('diagnostics', {
          title: `Accessibility & performance — ${url || 'page'}`,
          auditFindings: audit.findings, auditScore: audit.score, auditPassed: audit.passed, auditTarget: url,
          status: audit.passed ? `${audit.score}/100` : `${failed.length} issue(s)`,
          summary: `${failed.length} of ${audit.findings.length} checks failed (${audit.counts.accessibility} accessibility, ${audit.counts.performance} performance). Static source audit: contrast and script-rendered state are not covered.`,
        }),
      };
      stage.addObject(`Audit ${url || 'page'}`, node);
      return {
        ok: true, proposed: true,
        object: { id: node.id, kind: 'diagnostics', title: String(node.data.title), created: true },
        score: audit.score, passed: audit.passed, counts: audit.counts,
        failed: failed.map((item) => ({ rule: item.rule, category: item.category, severity: item.severity, count: item.count, wcag: item.wcag })),
      };
    },
  },   {
    /**
     * Test data. The generator's own fill value is the literal `qa-probe`, which
     * exercises no validation rule any product has — this produces the rows that do.
     */
    name: 'canvas_generate_test_data',
    description: 'Generate test data from a declared data contract: a valid control group, the exact boundary values (min, max, first/last allowed, longest string), and the rows that must be REJECTED (empty required fields, out-of-range numbers, wrong types, disallowed values, duplicate keys) plus the string shapes naive validation breaks on. Each row is labelled with the edge it exercises. Use this before testing a form, an import or an API. Pass objectId to read the contract already declared on a dataset.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        objectId: { type: 'string', description: 'A dataset/table object carrying a declared contract. Omit when the canvas holds exactly one.' },
        validRows: { type: 'number', description: 'Size of the valid control group. Default 5.' },
        includeHostileStrings: { type: 'boolean', description: 'Add quotes, markup, unicode, over-length and traversal strings to every free-text column. Default true.' },
        includeBoundary: { type: 'boolean' },
        includeInvalid: { type: 'boolean' },
        mode: { type: 'string', enum: ['contract', 'sample'], description: 'contract (default) generates rows from the declared contract. sample copies up to validRows REAL rows with every classified personal column masked — refused while a personal column is left unmasked, because a fixture that leaks is not a fixture. Use sample when the user wants realistic rows rather than edge cases.' },
      },
    },
    mutates: true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { objectId?: string; validRows?: number; includeHostileStrings?: boolean; includeBoundary?: boolean; includeInvalid?: boolean; mode?: string };
      const target = resolveTabularTarget(args.objectId);
      if ('error' in target) return target;
      const { node: dataset, source } = target;
      if (args.mode === 'sample') {
        const classifications = normalizeClassifications(dataset.data.classifications);
        const unmasked = unmaskedSensitiveColumns(classifications);
        if (unmasked.length) {
          return { error: `${dataset.data.title} still shows personal data in ${unmasked.join(', ')}. Mask those columns first (canvas_classify_dataset with masked: true) — a sample that leaks is not a fixture, so none was made.` };
        }
        const sample = fixtureFromDataset(source, classifications, Number(args.validRows) || 25);
        const node = stage.createObject('dataset', { x: dataset.position.x + 460, y: dataset.position.y + 320 });
        node.data = {
          ...node.data,
          ...sanitizeCreationObjectPatch('dataset', {
            title: `${dataset.data.title} sample`,
            columns: sample.columns, rows: sample.rows, rowCount: sample.rows.length,
            classifications,
            status: `${sample.rows.length} rows`,
            summary: `${sample.rows.length} real rows sampled from ${dataset.data.title}, every personal column masked.`,
          }),
        };
        stage.addObject(`Sample ${dataset.data.title}`, node);
        stage.addConnection(
          `Sample of ${dataset.data.title}`,
          { id: crypto.randomUUID(), source: dataset.id, target: node.id, type: 'smoothstep', label: 'sample', data: { connectionKind: 'data' } },
        );
        return { ok: true, proposed: true, object: { id: node.id, kind: 'dataset', title: String(node.data.title), created: true }, rows: sample.rows.length, maskedColumns: classifications.filter((item) => item.masked).map((item) => item.column) };
      }
      const contract = normalizeDataContract(dataset.data.dataContract);
      if (!contract?.columns.length) {
        return { error: `${dataset.data.title} has no declared contract to generate against. Declare one with canvas_set_data_contract first — the contract is what says which values are valid, so it is also what says which are not.` };
      }
      const fixture = generateFixture(contract, {
        validRows: Number(args.validRows) || 5,
        includeHostileStrings: args.includeHostileStrings !== false,
        ...(args.includeBoundary === false ? { includeBoundary: false } : {}),
        ...(args.includeInvalid === false ? { includeInvalid: false } : {}),
      });

      const node = stage.createObject('dataset', { x: dataset.position.x + 460, y: dataset.position.y + 320 });
      node.data = {
        ...node.data,
        ...sanitizeCreationObjectPatch('dataset', {
          title: `${dataset.data.title} fixtures`,
          columns: fixture.columns, rows: fixture.rows, rowCount: fixture.rows.length,
          fixtureCases: fixture.cases.map((item) => ({ kind: item.kind, rule: item.rule, ...(item.column ? { column: item.column } : {}) })),
          status: `${fixture.rows.length} rows`,
          summary: `${fixture.counts.valid} valid, ${fixture.counts.boundary} boundary, ${fixture.counts.invalid} must-reject rows generated from the declared contract.`,
        }),
      };
      stage.addObject(`Generate fixtures for ${dataset.data.title}`, node);
      stage.addConnection(
        `Fixtures for ${dataset.data.title}`,
        { id: crypto.randomUUID(), source: dataset.id, target: node.id, type: 'smoothstep', label: 'fixtures', data: { connectionKind: 'data' } },
      );
      return { ok: true, proposed: true, object: { id: node.id, kind: 'dataset', title: String(node.data.title), created: true }, counts: fixture.counts };
    },
  },   {
    /**
     * The tenant half: publish the board's cases into the QA library, and read the
     * runs back.
     *
     * GUEST-GATED rather than absent. A guest asking to "hook these up to CI" must be
     * told the real reason — an account — instead of being handed a model that was
     * never given the tool and therefore improvises a limitation the product does not
     * have. See the guest-gated set in the contract.
     */
    name: 'canvas_publish_tests',
    description: 'Publish this canvas\'s test cases to the workspace QA library so they can run on a schedule and in CI, and read the latest run results back onto the board. Each case becomes a stored flow with a persona-aware generated spec; any failures come back as defect objects. Use this after canvas_create_test_plan when the user wants the tests to actually run rather than only exist.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        planObjectId: { type: 'string', description: 'The testPlan to publish. Omit when the canvas holds exactly one.' },
        projectId: { type: 'number', description: 'Canonical project to file the tests under. Omit to use the project on this canvas.' },
      },
    },
    mutates: true,
    run: async (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      if (!getStoredTenantToken()) {
        requireAccount('qa', t('gateQaTitle'), t('gateQaBody'));
        return accountGateResult('canvas_publish_tests', CANVAS_QA_ACCOUNT_GATE);
      }
      const args = raw as { planObjectId?: string; projectId?: number };
      const all = stage.nodes();
      const plans = all.filter((node) => node.data.kind === 'testPlan');
      const plan = args.planObjectId ? plans.find((node) => node.id === args.planObjectId) : plans.length === 1 ? plans[0] : undefined;
      if (!plan) return { error: plans.length ? 'Name the testPlan to publish with planObjectId.' : 'There is no test plan on this canvas yet — create one first.' };

      const memberIds = new Set(stage.edges().filter((edge) => edge.source === plan.id).map((edge) => edge.target));
      const cases = all.filter((node) => node.data.kind === 'testCase' && (memberIds.has(node.id) || memberIds.size === 0));
      if (!cases.length) return { error: 'That plan has no test cases connected to it.' };

      const projectNode = all.find((node) => node.data.kind === 'project' && canvasProjectId(node.data) != null);
      const projectId = Number.isInteger(args.projectId) ? Number(args.projectId) : projectNode ? canvasProjectId(projectNode.data) ?? undefined : undefined;
      const targetUrl = String(plan.data.targetUrl ?? '');

      const published: Array<{ objectId: string; testId: string; title: string; model: string }> = [];
      const failures: Array<{ title: string; reason: string }> = [];
      for (const testCase of cases.slice(0, 25)) {
        const steps = normalizeQaSteps(testCase.data.steps);
        if (!steps.length) { failures.push({ title: String(testCase.data.title), reason: 'no steps' }); continue; }
        try {
          const { flow } = await qaApi.createFlow({
            name: String(testCase.data.title).slice(0, 160),
            steps,
            ...(typeof testCase.data.route === 'string' && testCase.data.route ? { startRoute: testCase.data.route } : {}),
            ...(typeof testCase.data.intent === 'string' && testCase.data.intent ? { description: testCase.data.intent } : {}),
            ...(projectId != null ? { projectId } : {}),
          });
          const generated = await qaApi.generateTest(flow.id);
          published.push({ objectId: testCase.id, testId: generated.test.id, title: String(testCase.data.title), model: generated.usedModel });
          stage.updateObject(
            `Publish ${testCase.data.title}`,
            testCase.id,
            sanitizeCreationObjectPatch('testCase', {
              caseId: generated.test.id, status: 'Published',
              ...(generated.test.spec ? { spec: generated.test.spec } : {}),
            }),
          );
        } catch (error) {
          failures.push({ title: String(testCase.data.title), reason: toolErrorMessage(error, 'publish failed') });
        }
      }
      if (!published.length) return { error: `No case could be published: ${failures.map((failure) => `${failure.title} (${failure.reason})`).join('; ')}` };

      // Pull the other direction: whatever CI has already reported for these tests.
      const byTestId = new Map(published.map((entry) => [entry.testId, entry]));
      const runs = await qaApi.fetchRuns(projectId ?? null).then(({ runs: rows }) => rows.filter((run) => run.testId && byTestId.has(run.testId))).catch(() => []);
      const results = runs.slice(0, 50).map((run) => ({
        caseId: run.testId ?? '',
        title: run.testName ?? byTestId.get(run.testId ?? '')?.title ?? '',
        status: run.status === 'passed' ? 'passed' as const : run.status === 'skipped' ? 'skipped' as const : run.status === 'error' ? 'error' as const : 'failed' as const,
        ...(run.durationMs != null ? { durationMs: run.durationMs } : {}),
        ...(run.errorMessage ? { errorMessage: run.errorMessage } : {}),
      }));

      const runNode = stage.createObject('testRun', { x: plan.position.x, y: plan.position.y + 340 });
      const summary = summarizeRun(results);
      runNode.data = {
        ...runNode.data,
        ...sanitizeCreationObjectPatch('testRun', {
          title: `${plan.data.title} — library`,
          results, targetUrl, planObjectId: plan.id,
          status: results.length ? `${summary.passRate}% passing` : `${published.length} published`,
          summary: results.length
            ? `${summary.passed} passed, ${summary.failed} failed, ${summary.errored} errored across ${results.length} reported run(s).`
            : `${published.length} case(s) published to the QA library. No CI run has reported against them yet.`,
        }),
      };
      stage.addObject(`Add test run for ${plan.data.title}`, runNode);
      stage.addConnection(
        `Run of ${plan.data.title}`,
        { id: crypto.randomUUID(), source: plan.id, target: runNode.id, type: 'smoothstep', label: 'run', data: { connectionKind: 'delivery' } },
      );

      // Every failure becomes a defect, fingerprinted the same way an Agentic Tester
      // finding is — so the same break reported twice is one defect.
      for (const [index, result] of results.filter((item) => item.status === 'failed' || item.status === 'error').slice(0, 10).entries()) {
        const defectNode = stage.createObject('defect', { x: runNode.position.x + 520, y: runNode.position.y + index * 240 });
        defectNode.data = {
          ...defectNode.data,
          ...sanitizeCreationObjectPatch('defect', {
            ...defectFromResult(result, { targetUrl, caseTitle: result.title }),
            journal: recentJournalEvidence(),
          }),
        };
        stage.addObject(`File defect “${result.title}”`, defectNode);
        stage.addConnection(
          `Found by ${plan.data.title}`,
          { id: crypto.randomUUID(), source: runNode.id, target: defectNode.id, type: 'smoothstep', label: 'found', data: { connectionKind: 'reference' } },
        );
      }

      return {
        ok: true, proposed: true,
        object: { id: runNode.id, kind: 'testRun', title: String(runNode.data.title), created: true },
        published: published.map((entry) => ({ title: entry.title, testId: entry.testId, generator: entry.model })),
        ...(failures.length ? { failures } : {}),
        reportedRuns: results.length,
        ...(projectId == null ? { note: 'Published without a project. Add a project object to the canvas to file these under it, which is what gives them a run target and a persona.' } : {}),
      };
    },
  }];
}
