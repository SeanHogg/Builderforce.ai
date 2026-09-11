import { describe, expect, it } from 'vitest';
import { canvasEvidencePatch, sanitizeCreationObjectPatch } from './creationObjectRegistry';

/**
 * `derived` fields are "written by the canvas, never by you". The canvas mechanisms that
 * ARE that writer used to run their readings through the model-facing sanitizer, which
 * drops every derived field — so a training run placed a card with none of the run.
 */
describe('canvasEvidencePatch', () => {
  const job = {
    jobId: 'job-1',
    baseModel: 'llama-3.1-8b',
    runStatus: 'complete',
    lossCurve: [{ label: '1', value: 0.9 }, { label: '2', value: 0.4 }],
    scorecard: [{ axis: 'overall', score: 81 }],
    summary: 'Loss fell from 0.9 to 0.4.',
  };

  it('reproduces the defect: the model-facing sanitizer drops the evidence a tool read', () => {
    const patch = sanitizeCreationObjectPatch('trainingRun', { title: 'Run', ...job });
    expect(patch).not.toHaveProperty('jobId');
    expect(patch).not.toHaveProperty('lossCurve');
  });

  it('writes the evidence a tool read onto the card, alongside the authored fields', () => {
    const patch = canvasEvidencePatch('trainingRun', { title: 'Run', ...job }, job);
    expect(patch).toMatchObject({ title: 'Run', jobId: 'job-1', baseModel: 'llama-3.1-8b', runStatus: 'complete', summary: job.summary });
    expect(patch).toHaveProperty('lossCurve', job.lossCurve);
    expect(patch).toHaveProperty('scorecard', job.scorecard);
  });

  it('still refuses a derived field in the AUTHORED half — only evidence may set one', () => {
    const patch = canvasEvidencePatch('runComparison', { title: 'Compare', verdict: { status: 'pass' } }, {});
    expect(patch).not.toHaveProperty('verdict');
  });

  it('admits evidence only for declared derived fields, never an arbitrary or sensitive key', () => {
    const patch = canvasEvidencePatch('notebook', { title: 'Analysis' }, {
      outputs: [{ cellId: 'c1', kind: 'value', preview: '42' }],
      lastRunAt: '2026-09-10T00:00:00Z',
      sourceObjectId: 'smuggled',
      apiToken: 'sk-nope',
    });
    expect(patch).toHaveProperty('outputs');
    expect(patch).toHaveProperty('lastRunAt', '2026-09-10T00:00:00Z');
    expect(patch).not.toHaveProperty('sourceObjectId');
    expect(patch).not.toHaveProperty('apiToken');
  });

  it('never stores a computed field, even when offered as evidence', () => {
    const patch = canvasEvidencePatch('labelSet', { title: 'Labels' }, { samples: [{ id: 's1', text: 'x' }], labels: [], agreement: 99 });
    expect(patch).toHaveProperty('samples');
    expect(patch).toHaveProperty('labels');
    expect(patch).not.toHaveProperty('agreement');
  });
});
