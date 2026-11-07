import { describe, expect, it, vi } from 'vitest';

const provenance = { engine: 'browser', model: 'gemini-nano' };
const tasks = {
  available: vi.fn(async () => new Set(['summarize', 'json', 'write', 'rewrite'])),
  summarize: vi.fn(async (_text: string) => 'minutes'),
  json: vi.fn(async () => ({ key: 'open_tickets' })),
  write: vi.fn(async () => '# SOP'),
  rewrite: vi.fn(async () => '# Better SOP'),
};
vi.mock('./onDeviceTasks', () => ({ browserClientFirst: () => ({ tasks, provenance: () => provenance }) }));

import { dashboardIntentResult, documentDraftResult, meetingMinutesResult } from './clientFirstTasks';

describe('client-first producers', () => {
  it('meeting minutes: text clientResult from the transcript', async () => {
    const out = await meetingMinutesResult(async () => [{ speakerName: 'Ann', text: 'Ship it' }]);
    expect(out).toEqual({ text: 'minutes', provenance });
    expect(tasks.summarize.mock.calls[0]?.[0]).toBe('Ann: Ship it');
  });

  it('dashboard intent: json {key} constrained to the tenant keys', async () => {
    const out = await dashboardIntentResult('how many open tickets?', async () => ['open_tickets', 'velocity']);
    expect(out).toEqual({ json: { key: 'open_tickets' }, provenance });
    const schema = (tasks.json.mock.calls[0] as unknown as [{ schema: { properties: { key: { enum: string[] } } } }])[0].schema;
    expect(schema.properties.key.enum).toEqual(['open_tickets', 'velocity']);
  });

  it('SOP: write for a draft, rewrite for existing content', async () => {
    expect(await documentDraftResult({ prompt: 'onboarding' })).toEqual({ text: '# SOP', provenance });
    expect(await documentDraftResult({ prompt: 'tighten', existingContent: '# Old' })).toEqual({ text: '# Better SOP', provenance });
  });

  it('declines (null) without loading inputs when the device cannot run the task', async () => {
    tasks.available.mockResolvedValueOnce(new Set());
    const load = vi.fn(async () => ['k']);
    expect(await dashboardIntentResult('q', load)).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });
});
