import { afterEach, describe, expect, it } from 'vitest';
import { resetRunSteering } from '@builderforce/agent-run';
import { childReportText } from '@builderforce/agent-tools';
import { queueRunSteering } from '../runSteering';
import { makeCell } from '../runStore/runCell';
import type { BrainRunContext } from '../runStore/brainRunContext';
import { brainSteeringSource, personSteers } from './brainSteering';

afterEach(() => resetRunSteering());

describe('brainSteeringSource — a child report delivered to the inbox', () => {
  it('regression: chat #157440 — hands the structured report to the progress detector (the agent reads it through its guards port), not just its words', async () => {
    const run = {
      c: makeCell(),
      chatId: 9301,
      runKey: 9301,
      req: { persistence: { sendMessages: async () => [] } },
      childReports: [],
    } as unknown as BrainRunContext;
    const report = { handle: 'a1', name: 'Ada', state: 'done' as const, label: 'slice', output: 'Implemented.', changedFiles: ['api/src/a.ts'] };
    queueRunSteering(9301, childReportText(report), { childReport: report });
    queueRunSteering(9301, 'keep going');
    const out = await brainSteeringSource(run, personSteers()).drain({ step: 3 });
    expect(out.map((s) => s.text)).toEqual([childReportText(report), 'keep going']);
    expect(run.childReports).toEqual([report]);
  });
});
