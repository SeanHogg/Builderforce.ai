import { beforeEach, describe, expect, it, vi } from 'vitest';

const tenantComplete = vi.fn();
const listAssignments = vi.fn();

vi.mock('../llm/tenantProxy', () => ({
  TenantAiService: class {
    protected constructor(protected readonly aiEnv: unknown) {}
  },
  completeForTenant: (...args: unknown[]) => tenantComplete(...args),
}));
vi.mock('../agent/AgentAssignmentService', () => ({
  AgentAssignmentService: class {
    list = listAssignments;
  },
}));
vi.mock('../swimlane/resolveAssignedAgent', () => ({
  resolveAssignedAgent: async () => ({ model: 'agent/model' }),
}));

import { SecurityReviewService, UNREADABLE_REVIEW_SUMMARY } from './SecurityReviewService';
import { ServiceUnavailableError } from '../../domain/shared/errors';

function proxyResult(status: number, content: string | null, model = 'served/model') {
  const body = content === null ? {} : { choices: [{ message: { role: 'assistant', content } }] };
  return {
    response: new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
    resolvedModel: model,
  };
}

const service = () => new SecurityReviewService({} as never, {} as never);

describe('SecurityReviewService.review — through completeJson', () => {
  beforeEach(() => {
    tenantComplete.mockReset();
    listAssignments.mockReset().mockResolvedValue([]);
  });

  it('normalises findings from a fenced JSON reply and meters under security_review', async () => {
    tenantComplete.mockResolvedValue(proxyResult(200, '```json\n{"summary":"One issue","findings":[{"severity":"bogus","title":"SQLi","detail":"d"},{"detail":"no title"}]}\n```'));
    const out = await service().review(7, { code: 'select *', context: 'db layer' });
    expect(out).toEqual({
      findings: [{ severity: 'info', title: 'SQLi', detail: 'd', location: undefined, recommendation: undefined }],
      summary: 'One issue',
      model: 'served/model',
      ranAsAssignedAgent: false,
    });
    const [, tenantId, body, opts] = tenantComplete.mock.calls[0]!;
    expect(tenantId).toBe(7);
    expect(body).toMatchObject({ response_format: { type: 'json_object' }, temperature: 0.1, max_tokens: 2048, useCase: 'security_review' });
    expect(opts).toMatchObject({ meterUseCase: 'security_review', explicitModel: undefined });
  });

  it('runs as the assigned security agent when there is one', async () => {
    listAssignments.mockResolvedValue([{ agentKind: 'workforce', agentRef: 'sec-1' }]);
    tenantComplete.mockResolvedValue(proxyResult(200, '{"summary":"","findings":[]}'));
    const out = await service().review(7, { code: 'x' });
    expect(tenantComplete.mock.calls[0]![3]).toMatchObject({ explicitModel: 'agent/model' });
    expect(out).toMatchObject({ summary: '0 finding(s).', ranAsAssignedAgent: true });
  });

  it('a gateway failure is an error, never "0 finding(s)"', async () => {
    tenantComplete.mockResolvedValue(proxyResult(503, null));
    await expect(service().review(7, { code: 'x' })).rejects.toBeInstanceOf(ServiceUnavailableError);
    tenantComplete.mockRejectedValue(new Error('no route'));
    await expect(service().review(7, { code: 'x' })).rejects.toBeInstanceOf(ServiceUnavailableError);
  });

  it('prose instead of JSON says the review did not run', async () => {
    tenantComplete.mockResolvedValue(proxyResult(200, 'Looks fine to me.'));
    const out = await service().review(7, { code: 'x' });
    expect(out).toMatchObject({ findings: [], summary: UNREADABLE_REVIEW_SUMMARY, model: 'served/model' });
  });

  it('answers without a model call when there is no code', async () => {
    const out = await service().review(7, { code: '  ' });
    expect(out.summary).toBe('No code supplied for review.');
    expect(tenantComplete).not.toHaveBeenCalled();
  });
});
