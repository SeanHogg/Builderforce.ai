/**
 * PRD 42 Part D on the résumé service: a client-supplied reply takes the place of the model
 * call (no `completeJson`), still goes through the parse + verification pass, and records
 * a usage row. Without it the routed call is made as before.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  completeJson: vi.fn(),
  recordClientResultUsage: vi.fn(async () => {}),
}));
vi.mock('../llm/completeJson', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../llm/completeJson')>()),
  completeJson: mocks.completeJson,
}));
vi.mock('../llm/clientResultUsage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../llm/clientResultUsage')>()),
  recordClientResultUsage: mocks.recordClientResultUsage,
}));
vi.mock('../../infrastructure/cache/readThroughCache', () => ({
  getOrSetCached: async (_env: unknown, _key: string, load: () => Promise<unknown>) => load(),
}));

import { ResumeAiService } from './resumeAi';

const RESUME = [
  'Jane Doe',
  'jane@example.com | +1 555 0100',
  '',
  'Summary',
  'Backend engineer working on payments infrastructure.',
  '',
  'Experience',
  'Acme Corp — Senior Engineer, 2021-03 – Present',
  '- Responsible for the payments service and its on-call rotation',
  '- Worked on migrating the billing pipeline',
  '- Reduced checkout latency by 40% by moving settlement off the request path',
  '',
  'Skills',
  'TypeScript, PostgreSQL, Terraform, Kubernetes',
].join('\n');
const provenance = { engine: 'webllm' as const, model: 'Qwen-0.5B' };

beforeEach(() => {
  mocks.completeJson.mockReset();
  mocks.recordClientResultUsage.mockClear();
});

describe('ResumeAiService.rewriteToXyz', () => {
  it('uses a client reply: no model call, model = provenance, usage recorded, not degraded', async () => {
    const db = {} as never;
    const out = await new ResumeAiService({} as never, db).rewriteToXyz(7, RESUME, { userId: 'u1', client: { value: { rewrites: [] }, provenance } });
    expect(out.brief.candidates.length).toBeGreaterThan(0);
    expect(mocks.completeJson).not.toHaveBeenCalled();
    expect(out.model).toBe('local/webllm/Qwen-0.5B');
    expect(out.degraded).toBe(false);
    expect(mocks.recordClientResultUsage).toHaveBeenCalledWith(db, {}, expect.objectContaining({ tenantId: 7, userId: 'u1', useCase: 'resume_xyz_rewrite', provenance }));
  });

  it('still verifies the client reply: an invented metric is refused', async () => {
    const service = new ResumeAiService({} as never, {} as never);
    const probe = await service.rewriteToXyz(7, RESUME, { client: { value: {}, provenance } });
    const weak = probe.brief.candidates.find((candidate) => candidate.original.startsWith('Responsible for'))!;
    const out = await service.rewriteToXyz(7, RESUME, {
      client: { value: { rewrites: [{ id: weak.id, rewritten: 'Cut payment failures by 62% by rebuilding the retry path' }] }, provenance },
    });
    expect(out.result.refusedForInventedMetric).toBe(1);
    expect(out.result.accepted).toBe(0);
  });

  it('asks the routed model when there is no client reply', async () => {
    mocks.completeJson.mockResolvedValue({ ok: true, value: { rewrites: [] }, model: 'm' });
    const out = await new ResumeAiService({} as never, {} as never).rewriteToXyz(7, RESUME, { userId: 'u1' });
    expect(out.brief.candidates.length).toBeGreaterThan(0);
    expect(mocks.completeJson).toHaveBeenCalledTimes(1);
    expect(mocks.recordClientResultUsage).not.toHaveBeenCalled();
  });
});
