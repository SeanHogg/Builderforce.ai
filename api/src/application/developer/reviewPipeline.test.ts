/**
 * The pipeline's five precedence rules are the whole safety story of the review
 * gate, so they are tested against FAKE stages rather than through a submission:
 * what is under test is the composition, and a test that needed a sandbox
 * workspace and an LLM to assert "a fail blocks" would be testing neither.
 */
import { describe, expect, it, afterEach } from 'vitest';
import {
  runReviewPipeline,
  staticStage,
  __withStagesForTests,
  type ReviewStage,
  type ReviewStageContext,
  type StageResult,
  type StageVerdict,
} from './reviewPipeline';

let restore: (() => void) | null = null;
afterEach(() => { restore?.(); restore = null; });

const ctx = (over: Partial<ReviewStageContext> = {}): ReviewStageContext => ({
  db: {} as ReviewStageContext['db'],
  env: {} as ReviewStageContext['env'],
  packageId: 'pkg-1',
  packageSlug: 'acme-payroll',
  versionId: 'ver-1',
  semver: '1.0.0',
  kind: 'connector',
  spec: {},
  normalizedSpec: {},
  scopes: [],
  requestedScopes: ['tools:call'],
  verificationState: 'domain_verified',
  paid: false,
  previousScopes: null,
  priorStages: new Map(),
  ...over,
});

const fakeStage = (
  key: 'static' | 'dynamic' | 'agentic',
  order: number,
  verdict: StageVerdict,
  onRun?: (c: ReviewStageContext) => void,
): ReviewStage => ({
  key,
  order,
  applies: () => true,
  async run(c): Promise<StageResult> {
    onRun?.(c);
    return {
      stage: key,
      verdict,
      findings: [{ check: `${key}_check`, severity: verdict === 'fail' ? 'fail' : verdict === 'warn' ? 'warn' : 'pass', message: `${key} said ${verdict}` }],
      evidence: [{ subject: key, outcome: verdict === 'skipped' ? 'skipped' : verdict === 'fail' ? 'fail' : 'pass', detail: 'x' }],
      durationMs: 1,
    };
  },
});

describe('precedence', () => {
  it('rule 1 — stages run in `order`, not in registration order', async () => {
    const seen: string[] = [];
    restore = __withStagesForTests([
      fakeStage('agentic', 30, 'pass', () => seen.push('agentic')),
      fakeStage('static', 10, 'pass', () => seen.push('static')),
      fakeStage('dynamic', 20, 'pass', () => seen.push('dynamic')),
    ]);
    await runReviewPipeline(ctx());
    expect(seen).toEqual(['static', 'dynamic', 'agentic']);
  });

  it('rule 2 — a fail from ANY stage blocks, including the last one', async () => {
    restore = __withStagesForTests([
      fakeStage('static', 10, 'pass'),
      fakeStage('dynamic', 20, 'pass'),
      fakeStage('agentic', 30, 'fail'),
    ]);
    const outcome = await runReviewPipeline(ctx());
    expect(outcome.approved).toBe(false);
    // The agentic stage can BLOCK. If this ever becomes advisory it is decoration.
    expect(outcome.findings.some((f) => f.check === 'agentic:agentic_check' && f.severity === 'fail')).toBe(true);
  });

  it('rule 3 — a fail short-circuits the stages after it', async () => {
    const seen: string[] = [];
    restore = __withStagesForTests([
      fakeStage('static', 10, 'fail', () => seen.push('static')),
      fakeStage('dynamic', 20, 'pass', () => seen.push('dynamic')),
      fakeStage('agentic', 30, 'pass', () => seen.push('agentic')),
    ]);
    const outcome = await runReviewPipeline(ctx());
    expect(seen).toEqual(['static']);
    expect(outcome.stages).toHaveLength(1);
    expect(outcome.approved).toBe(false);
  });

  it('rule 4 — a warn is recorded and does NOT block', async () => {
    restore = __withStagesForTests([
      fakeStage('static', 10, 'pass'),
      fakeStage('dynamic', 20, 'warn'),
    ]);
    const outcome = await runReviewPipeline(ctx());
    expect(outcome.approved).toBe(true);
    expect(outcome.verdicts.dynamic).toBe('warn');
  });

  it('rule 5 — a skipped stage does not block, and is never recorded as a pass', async () => {
    restore = __withStagesForTests([
      fakeStage('static', 10, 'pass'),
      fakeStage('dynamic', 20, 'skipped'),
      fakeStage('agentic', 30, 'skipped'),
    ]);
    const outcome = await runReviewPipeline(ctx());
    expect(outcome.approved).toBe(true);
    expect(outcome.verdicts).toEqual({ static: 'pass', dynamic: 'skipped', agentic: 'skipped' });
  });

  it('a stage that THROWS is skipped, not failed — our bug must not refuse their submission', async () => {
    const exploding: ReviewStage = {
      key: 'dynamic',
      order: 20,
      applies: () => true,
      run: async () => { throw new Error('sandbox exploded'); },
    };
    restore = __withStagesForTests([fakeStage('static', 10, 'pass'), exploding]);
    const outcome = await runReviewPipeline(ctx());
    expect(outcome.approved).toBe(true);
    expect(outcome.verdicts.dynamic).toBe('skipped');
    expect(outcome.findings.some((f) => f.message.includes('sandbox exploded'))).toBe(true);
  });

  it('a stage that does not apply produces no row at all — different from skipped', async () => {
    const inapplicable: ReviewStage = { ...fakeStage('dynamic', 20, 'pass'), applies: () => false };
    restore = __withStagesForTests([fakeStage('static', 10, 'pass'), inapplicable]);
    const outcome = await runReviewPipeline(ctx());
    expect(Object.keys(outcome.verdicts)).toEqual(['static']);
  });
});

describe('context handed forward', () => {
  it('gives later stages the NORMALIZED spec, not the raw submission', async () => {
    let sawSpec: unknown = null;
    const normalizing: ReviewStage = {
      key: 'static',
      order: 10,
      applies: () => true,
      run: async () => ({
        stage: 'static',
        verdict: 'pass',
        findings: [],
        evidence: [],
        durationMs: 0,
        normalizedSpec: { key: 'normalized' },
        normalizedScopes: ['tools:call'],
      }),
    };
    restore = __withStagesForTests([
      normalizing,
      fakeStage('dynamic', 20, 'pass', (c) => { sawSpec = c.normalizedSpec; }),
    ]);
    const outcome = await runReviewPipeline(ctx({ spec: { key: 'RAW' } }));
    expect(sawSpec).toEqual({ key: 'normalized' });
    expect(outcome.normalizedSpec).toEqual({ key: 'normalized' });
    expect(outcome.scopes).toEqual(['tools:call']);
  });

  it('gives later stages the earlier stages results — the agentic stage reviews the pipeline', async () => {
    let priorKeys: string[] = [];
    restore = __withStagesForTests([
      fakeStage('static', 10, 'pass'),
      fakeStage('dynamic', 20, 'warn'),
      fakeStage('agentic', 30, 'pass', (c) => { priorKeys = [...c.priorStages.keys()]; }),
    ]);
    await runReviewPipeline(ctx());
    expect(priorKeys).toEqual(['static', 'dynamic']);
  });
});

describe('the real static stage, unchanged', () => {
  it('still refuses a paid listing from a publisher who is not identity-verified', async () => {
    // `paid_requires_identity` carries PRD 24 §9's open operator decision. It is
    // called through the registry now; it is not edited, and this is the assertion
    // that says so.
    restore = __withStagesForTests([staticStage]);
    const outcome = await runReviewPipeline(ctx({
      paid: true,
      verificationState: 'domain_verified',
      spec: {
        key: 'acme-payroll',
        name: 'Acme Payroll',
        description: 'Run payroll',
        category: 'finance',
        baseUrl: 'https://api.acme-payroll.example',
        auth: { kind: 'api_key', fields: [{ key: 'token', label: 'API token', secret: true, required: true }], in: 'header', name: 'Authorization' },
        actions: [{ key: 'list_employees', label: 'List employees', description: 'List every employee', method: 'GET', path: '/v1/employees', mutates: false, params: {} }],
      },
    }));
    expect(outcome.approved).toBe(false);
    expect(outcome.findings.some((f) => f.check === 'static:paid_requires_identity' && f.severity === 'fail')).toBe(true);
  });

  it('approves the same submission when the listing is free', async () => {
    restore = __withStagesForTests([staticStage]);
    const outcome = await runReviewPipeline(ctx({
      paid: false,
      spec: {
        key: 'acme-payroll',
        name: 'Acme Payroll',
        description: 'Run payroll',
        category: 'finance',
        baseUrl: 'https://api.acme-payroll.example',
        auth: { kind: 'api_key', fields: [{ key: 'token', label: 'API token', secret: true, required: true }], in: 'header', name: 'Authorization' },
        actions: [{ key: 'list_employees', label: 'List employees', description: 'List every employee', method: 'GET', path: '/v1/employees', mutates: false, params: {} }],
      },
    }));
    expect(outcome.approved).toBe(true);
    expect(outcome.normalizedSpec.key).toBe('acme-payroll');
  });
});
