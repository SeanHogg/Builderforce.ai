import { describe, expect, it } from 'vitest';
import { compareRuns } from './canvasRunComparison';
import { trainingRunFields } from './canvasTrainingRun';
import type { TrainingJob } from './types';

const run = (objectId: string, label: string, score: number | null, params: Record<string, number> = {}) => ({
  objectId,
  label,
  scorecard: score == null ? [] : [{ axis: 'evalScore', score }, { axis: 'hallucinationRate', score: 1 - score / 100 }],
  hyperparameters: Object.entries(params).map(([name, value]) => ({ name, value })),
});

describe('compareRuns', () => {
  it('ranks descending on an axis where higher is better', () => {
    const result = compareRuns([run('a', 'A', 70), run('b', 'B', 91), run('c', 'C', 84)], 'evalScore', 'a');
    expect(result.rows.map((row) => row.run)).toEqual(['B', 'C', 'A']);
    expect(result.rows[0]).toMatchObject({ score: 91, delta: 21, improvement: 21 });
  });

  it('inverts the ranking on an axis where lower is better', () => {
    // Ranking every axis descending would crown the most hallucinatory run.
    const result = compareRuns([run('a', 'A', 90), run('b', 'B', 50)], 'hallucinationRate', 'a');
    expect(result.rows[0].run).toBe('A');
    expect(result.rows[0].baseline).toBe(true);
  });

  it('signs improvement by direction so a column of deltas reads consistently', () => {
    const result = compareRuns([run('a', 'A', 90), run('b', 'B', 50)], 'hallucinationRate', 'a');
    const challenger = result.rows.find((row) => row.run === 'B')!;
    // Raw delta is positive (higher rate) and that is a REGRESSION on this axis.
    expect(challenger.delta).toBeGreaterThan(0);
    expect(challenger.improvement).toBeLessThan(0);
  });

  it('keeps an unevaluated run visible and sorts it last', () => {
    // Dropping it makes the comparison look complete while missing the config
    // somebody actually cares about.
    const result = compareRuns([run('a', 'A', 70), run('b', 'B', null)], 'evalScore', 'a');
    expect(result.rows).toHaveLength(2);
    expect(result.rows[1]).toMatchObject({ run: 'B', score: null, improvement: null });
  });

  it('shows only the settings that changed from the baseline', () => {
    const result = compareRuns([
      run('a', 'A', 70, { epochs: 3, loraRank: 8 }),
      run('b', 'B', 80, { epochs: 5, loraRank: 8 }),
    ], 'evalScore', 'a');
    expect(result.rows.find((row) => row.run === 'B')!.hyperparameters).toBe('epochs=5');
  });

  it('says "—" when a run differs from the baseline in nothing', () => {
    const result = compareRuns([
      run('a', 'A', 70, { epochs: 3 }),
      run('b', 'B', 71, { epochs: 3 }),
    ], 'evalScore', 'a');
    expect(result.rows.find((row) => row.run === 'B')!.hyperparameters).toBe('—');
  });

  it('reports a verdict naming the winner and the margin', () => {
    const result = compareRuns([run('a', 'A', 70), run('b', 'B', 91)], 'evalScore', 'a');
    expect(result.verdict).toEqual({ key: 'wins', values: { run: 'B', axis: 'evalScore', improvement: 21 } });
  });

  it('reports a regression when the baseline is still the best', () => {
    const result = compareRuns([run('a', 'A', 95), run('b', 'B', 70)], 'evalScore', 'a');
    expect(result.verdict?.key).toBe('regresses');
  });

  it('refuses to declare a winner without two scores', () => {
    expect(compareRuns([run('a', 'A', 70), run('b', 'B', null)], 'evalScore', 'a').verdict?.key).toBe('unscored');
  });

  it('defaults the baseline to the first run when none is named', () => {
    expect(compareRuns([run('a', 'A', 70), run('b', 'B', 91)]).baselineObjectId).toBe('a');
  });
});

describe('trainingRunFields', () => {
  const job: TrainingJob = {
    id: 'job1', project_id: 1, base_model: 'llama-3.1-8b', lora_rank: 8, epochs: 3, batch_size: 4,
    learning_rate: 0.0002, status: 'completed', current_epoch: 3, current_loss: 0.42,
    eval_score: 88, eval_code_correctness: 91, eval_reasoning_quality: 85, eval_hallucination_rate: 0.04,
    evaluated_at: '2026-08-13T00:00:00Z', created_at: '', updated_at: '',
  };

  it('lowers a job into canvas fields with all four axes', () => {
    const fields = trainingRunFields(job);
    expect(fields.jobId).toBe('job1');
    expect(fields.scorecard).toEqual([
      { axis: 'evalScore', score: 88 },
      { axis: 'codeCorrectness', score: 91 },
      { axis: 'reasoningQuality', score: 85 },
      { axis: 'hallucinationRate', score: 0.04 },
    ]);
    expect(fields.hyperparameters).toContainEqual({ name: 'epochs', value: 3 });
    expect(fields.summary).toContain('88');
  });

  it('prefers the log curve and falls back to the single current loss', () => {
    expect(trainingRunFields(job).lossCurve).toEqual([{ label: '3', value: 0.42 }]);
    const withLogs = trainingRunFields(job, [
      { id: '1', job_id: 'job1', epoch: 1, step: 10, loss: 0.9, message: '', created_at: '' },
      { id: '2', job_id: 'job1', epoch: 2, step: 20, loss: 0.5, message: '', created_at: '' },
    ]);
    expect(withLogs.lossCurve).toEqual([{ label: '1:10', value: 0.9 }, { label: '2:20', value: 0.5 }]);
  });

  it('says plainly when a finished run was never evaluated', () => {
    // Leading with the training loss would invite exactly the reading that a low loss
    // means a good model.
    const fields = trainingRunFields({ ...job, eval_score: null, eval_code_correctness: null, eval_reasoning_quality: null, eval_hallucination_rate: null, evaluated_at: null });
    expect(fields.status).toBe('Trained, not evaluated');
    expect(fields.summary).toContain('NOT been evaluated');
  });

  it('surfaces the failure reason rather than a loss number', () => {
    const fields = trainingRunFields({ ...job, status: 'failed', error_message: 'CUDA out of memory' });
    expect(fields.summary).toBe('CUDA out of memory');
    expect(fields.status).toContain('Failed');
  });
});
