import { beforeEach, describe, expect, it, vi } from 'vitest';

const provenance = { engine: 'browser', model: 'gemini-nano' };
const tasks = {
  available: vi.fn(async () => new Set(['json'])),
  json: vi.fn(async (): Promise<unknown> => ({ rewrites: [{ id: 0, rewritten: 'Cut build time by 40% by caching deps' }] })),
};
vi.mock('./onDeviceTasks', () => ({ browserClientFirst: () => ({ tasks, provenance: () => provenance }) }));
const apiRequest = vi.fn(async (..._args: unknown[]) => ({ ok: true }));
vi.mock('@/lib/apiClient', () => ({ apiRequest: (...args: unknown[]) => apiRequest(...args) }));

import { careerAiApi } from '../careerAiApi';
import { resumeMergeResult, resumeRewriteResult } from './resumeClientFirst';

const RESUME = 'Experience\n- Responsible for the build pipeline\n- Reduced build time by 40% by caching dependencies\n';

beforeEach(() => {
  apiRequest.mockClear();
  tasks.json.mockClear();
  tasks.available.mockResolvedValue(new Set(['json']));
});

describe('résumé client-first', () => {
  it('rewrite: prompts the device with the shared brief and sends its JSON as clientResult.json', async () => {
    await careerAiApi.rewriteBullets(RESUME);
    const call = tasks.json.mock.calls[0] as unknown as [{ system: string; user: string }];
    expect(call[0].system).toContain('accomplished [X] as measured by [Y]');
    expect(call[0].user).toContain('Responsible for the build pipeline');
    const [path, init] = apiRequest.mock.calls[0] as [string, { body: string }];
    expect(path).toBe('/api/career-ai/rewrite-bullets');
    expect(JSON.parse(init.body)).toEqual({
      resumeText: RESUME,
      clientResult: { json: { rewrites: [{ id: 0, rewritten: 'Cut build time by 40% by caching deps' }] }, provenance },
    });
  });

  it('merge: sends the device reply for the duplicate groups', async () => {
    const texts = ['Experience\n- Reduced build time by 40% by caching dependencies\n', 'Experience\n- Reduced build time 40% through dependency caching\n'];
    tasks.json.mockResolvedValueOnce({ merged: [{ id: 0, merged: 'Reduced build time by 40% by caching dependencies' }] });
    const out = await resumeMergeResult(texts);
    expect(out).toMatchObject({ json: { merged: [{ id: 0 }] }, provenance });
  });

  it('declines (null) without a JSON task, or when there is nothing for a model to do', async () => {
    tasks.available.mockResolvedValueOnce(new Set());
    expect(await resumeRewriteResult(RESUME)).toBeNull();
    expect(await resumeRewriteResult('Experience\n- Reduced build time by 40% by caching dependencies\n')).toBeNull();
    expect(await resumeMergeResult(['one résumé only'])).toBeNull();
    expect(tasks.json).not.toHaveBeenCalled();
  });

  it('a declined device sends the request exactly as before; grade never asks the device', async () => {
    tasks.available.mockResolvedValue(new Set());
    await careerAiApi.rewriteBullets(RESUME, 5);
    expect(JSON.parse((apiRequest.mock.calls[0] as [string, { body: string }])[1].body)).toEqual({ resumeText: RESUME, limit: 5 });
    await careerAiApi.grade(RESUME);
    expect(tasks.json).not.toHaveBeenCalled();
  });
});
