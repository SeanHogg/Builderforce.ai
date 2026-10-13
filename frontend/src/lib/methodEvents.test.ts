/**
 * The method's four acts reach the page's Insights recorder ONLY from the
 * `realizationApi` wrappers, and only on success (PRD 33 §5.3.6).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const transport = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('./apiClient', () => ({
  apiRequest: transport.request,
  apiRequestStream: vi.fn(),
  apiRequestText: vi.fn(),
}));

import { emitMethodEvent } from './methodEvents';
import { realizationApi } from './builderforceApi';

const recorder = { event: vi.fn() };
const g = globalThis as unknown as { window?: { BFReplay?: unknown } };

beforeEach(() => {
  recorder.event.mockReset();
  transport.request.mockReset();
  g.window = { BFReplay: recorder };
});
afterEach(() => { delete g.window; });

describe('emitMethodEvent', () => {
  it('sends the act to BFReplay', () => {
    emitMethodEvent('proof.build');
    expect(recorder.event).toHaveBeenCalledWith('proof.build');
  });

  it('is a silent no-op without the recorder, and never throws from it', () => {
    g.window = {};
    expect(() => emitMethodEvent('idea.read')).not.toThrow();
    g.window = { BFReplay: { event: () => { throw new Error('recorder broke'); } } };
    expect(() => emitMethodEvent('idea.read')).not.toThrow();
  });
});

describe('the realizationApi wrappers', () => {
  it('plan → idea.read, create → proof.choose, build → proof.build, on success', async () => {
    transport.request.mockResolvedValue({ spec: {}, recommendations: [], targets: [], realization: { id: 'r1' }, result: {} });
    await realizationApi.plan('An idea');
    await realizationApi.create({ idea: 'An idea', targetKey: 'smoke-test' });
    await realizationApi.build('r1');
    expect(recorder.event.mock.calls.map((c) => c[0])).toEqual(['idea.read', 'proof.choose', 'proof.build']);
  });

  it('a failed act emits nothing', async () => {
    transport.request.mockRejectedValue(new Error('500'));
    await expect(realizationApi.build('r1')).rejects.toThrow();
    await expect(realizationApi.plan('An idea')).rejects.toThrow();
    expect(recorder.event).not.toHaveBeenCalled();
  });

  it('a verdict read emits proof.grade only when the read changed the grade', async () => {
    transport.request.mockResolvedValueOnce({ realization: { id: 'r1' }, verdictChanged: false });
    await realizationApi.get('r1');
    expect(recorder.event).not.toHaveBeenCalled();
    transport.request.mockResolvedValueOnce({ realization: { id: 'r1', verdict: 'met' }, verdictChanged: true });
    await realizationApi.get('r1');
    expect(recorder.event).toHaveBeenCalledWith('proof.grade');
  });

  it('passes priorRealizationId to the plan route', async () => {
    transport.request.mockResolvedValue({ spec: {}, recommendations: [], targets: [] });
    await realizationApi.plan('An idea', 's1', { priorRealizationId: 'r0' });
    expect(JSON.parse(transport.request.mock.calls[0]![1].body)).toEqual({ idea: 'An idea', sessionId: 's1', priorRealizationId: 'r0' });
  });
});

describe('where it is called from', () => {
  it('only builderforceApi.ts calls emitMethodEvent', () => {
    const src = resolve(__dirname, '..');
    const callers: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules') continue;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && readFileSync(path, 'utf8').includes('emitMethodEvent(')) {
          callers.push(relative(src, path).replace(/\\/g, '/'));
        }
      }
    };
    walk(src);
    expect(callers.sort()).toEqual(['lib/builderforceApi.ts', 'lib/methodEvents.ts']);
  });
});
