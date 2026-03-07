import { describe, it, expect } from 'vitest';
import { parseEvaluationResponse, buildArtifactKey } from '../services/training';

// ---------------------------------------------------------------------------
// parseEvaluationResponse
// ---------------------------------------------------------------------------

describe('parseEvaluationResponse', () => {
  it('returns default scores when text is empty', () => {
    const result = parseEvaluationResponse('', 'job-123');
    expect(result.job_id).toBe('job-123');
    expect(result.score).toBe(0.5);
    expect(result.code_correctness).toBe(0.5);
    expect(result.reasoning_quality).toBe(0.5);
    expect(result.hallucination_rate).toBe(0.1);
  });

  it('parses a clean JSON object', () => {
    const json = JSON.stringify({
      score: 0.85,
      code_correctness: 0.9,
      reasoning_quality: 0.8,
      hallucination_rate: 0.05,
      details: 'Good results',
    });
    const result = parseEvaluationResponse(json, 'job-1');
    expect(result.score).toBeCloseTo(0.85);
    expect(result.code_correctness).toBeCloseTo(0.9);
    expect(result.reasoning_quality).toBeCloseTo(0.8);
    expect(result.hallucination_rate).toBeCloseTo(0.05);
    expect(result.details).toBe('Good results');
  });

  it('strips markdown code fences', () => {
    const json = '```json\n{"score":0.7,"code_correctness":0.7,"reasoning_quality":0.7,"hallucination_rate":0.1,"details":"ok"}\n```';
    const result = parseEvaluationResponse(json, 'job-2');
    expect(result.score).toBeCloseTo(0.7);
  });

  it('extracts JSON object from surrounding text', () => {
    const text = 'Here is the evaluation:\n{"score":0.6,"code_correctness":0.6,"reasoning_quality":0.6,"hallucination_rate":0.2,"details":"fair"}\nEnd.';
    const result = parseEvaluationResponse(text, 'job-3');
    expect(result.score).toBeCloseTo(0.6);
  });

  it('clamps values to [0, 1]', () => {
    const json = JSON.stringify({
      score: 1.5,
      code_correctness: -0.1,
      reasoning_quality: 2,
      hallucination_rate: -1,
      details: 'out of range',
    });
    const result = parseEvaluationResponse(json, 'job-4');
    expect(result.score).toBe(1.0);
    expect(result.code_correctness).toBe(0.0);
    expect(result.reasoning_quality).toBe(1.0);
    expect(result.hallucination_rate).toBe(0.0);
  });

  it('returns default scores for malformed JSON', () => {
    const result = parseEvaluationResponse('{invalid json}', 'job-5');
    expect(result.score).toBe(0.5);
  });

  it('sets job_id correctly', () => {
    const result = parseEvaluationResponse('', 'my-job-id');
    expect(result.job_id).toBe('my-job-id');
  });
});

// ---------------------------------------------------------------------------
// buildArtifactKey
// ---------------------------------------------------------------------------

describe('buildArtifactKey', () => {
  it('builds a namespaced R2 key', () => {
    const key = buildArtifactKey('project-1', 'job-1');
    expect(key).toBe('artifacts/project-1/job-1/adapter.bin');
  });

  it('includes both projectId and jobId', () => {
    const key = buildArtifactKey('proj-abc', 'job-xyz');
    expect(key).toContain('proj-abc');
    expect(key).toContain('job-xyz');
  });
});
