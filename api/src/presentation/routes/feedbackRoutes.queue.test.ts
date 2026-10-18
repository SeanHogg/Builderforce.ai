import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = 42;

const { loadFeedbackQueue, reviewFeedbackSubmission } = vi.hoisted(() => ({
  loadFeedbackQueue: vi.fn(async () => ({ submissions: [], counts: { new: 0, approved: 0, declined: 0 } })),
  reviewFeedbackSubmission: vi.fn(async () => ({ ok: true, taskId: 9 })),
}));

vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
    c.set('tenantId', TENANT);
    c.set('userId', 'u-1');
    await next();
  },
}));
vi.mock('../../application/feedback/feedbackQueries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../application/feedback/feedbackQueries')>()),
  loadFeedbackQueue,
}));
vi.mock('../../application/feedback/feedbackEngine', () => ({
  submitFeedback: vi.fn(),
  reviewFeedbackSubmission,
}));

import { createFeedbackRoutes } from './feedbackRoutes';
import { collectorOriginAllowed } from '../../application/feedback/feedbackCollectors';

const post = (b: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });

describe('feedback intake — the workspace queue is the ONE queue read, tenant-scoped', () => {
  beforeEach(() => vi.clearAllMocks());

  it('GET /submissions reads loadFeedbackQueue with the caller tenant, project and paging', async () => {
    const res = await createFeedbackRoutes({} as never).request('/submissions?projectId=3&status=approved&limit=20&before=2026-10-01T00:00:00Z');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ submissions: [], counts: { new: 0, approved: 0, declined: 0 } });
    expect(loadFeedbackQueue).toHaveBeenCalledWith({}, undefined, {
      tenantId: TENANT, projectId: 3, status: 'approved', limit: 20, before: '2026-10-01T00:00:00Z',
    });
  });

  it('an unknown status is no filter, not an error', async () => {
    await createFeedbackRoutes({} as never).request('/submissions?status=bogus');
    expect(loadFeedbackQueue).toHaveBeenCalledWith({}, undefined, expect.objectContaining({ tenantId: TENANT, projectId: null, status: null }));
  });

  it('refuses a non-numeric projectId before reading', async () => {
    const res = await createFeedbackRoutes({} as never).request('/submissions?projectId=abc');
    expect(res.status).toBe(400);
    expect(loadFeedbackQueue).not.toHaveBeenCalled();
  });

  it('review answers the shared decision error and only passes a valid decision to the engine', async () => {
    const bad = await createFeedbackRoutes({} as never).request('/submissions/s1/review', post({ decision: 'maybe' }));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "decision must be 'approved' or 'declined'" });

    const ok = await createFeedbackRoutes({} as never).request('/submissions/s1/review', post({ decision: 'approved' }));
    expect(ok.status).toBe(200);
    expect(reviewFeedbackSubmission).toHaveBeenCalledWith({}, undefined, {
      tenantId: TENANT, submissionId: 's1', decision: 'approved', reviewerUserId: 'u-1',
    });
  });
});

describe('collectorOriginAllowed — the collector column over the platform allowlist rule', () => {
  it('blank and * accept any origin', () => {
    expect(collectorOriginAllowed('', 'https://a.test')).toBe(true);
    expect(collectorOriginAllowed('*', 'https://a.test')).toBe(true);
  });
  it('a listed origin passes, an unlisted one does not', () => {
    expect(collectorOriginAllowed('https://a.test, https://b.test', 'https://b.test')).toBe(true);
    expect(collectorOriginAllowed('https://a.test', 'https://evil.test')).toBe(false);
  });
  it('no Origin (server-side post) is allowed — the key is the credential', () => {
    expect(collectorOriginAllowed('https://a.test', undefined)).toBe(true);
  });
});
