import { describe, expect, it } from 'vitest';
import { labelAgreement, promoteToGoldenSet, sampleRows } from './canvasLabelSet';
import { projectLlmCost } from './canvasLlmCost';

const source = {
  columns: ['id', 'text'],
  rows: Array.from({ length: 100 }, (_, index) => ({ id: index, text: `row ${index}` })),
};

describe('sampleRows', () => {
  it('spreads the sample across the file rather than taking the head', () => {
    // The head of an export is usually its oldest data, so a head sample measures the
    // model on the data it will see least.
    const samples = sampleRows(source, 5, 'text');
    expect(samples.map((sample) => sample.text)).toEqual(['row 0', 'row 20', 'row 40', 'row 60', 'row 80']);
  });

  it('is reproducible — the same request returns the same rows', () => {
    expect(sampleRows(source, 7, 'text')).toEqual(sampleRows(source, 7, 'text'));
  });

  it('never asks for more rows than exist', () => {
    expect(sampleRows(source, 500, 'text')).toHaveLength(100);
    expect(sampleRows({ columns: [], rows: [] }, 10)).toEqual([]);
  });

  it('describes the whole row when no text column is named', () => {
    expect(sampleRows(source, 1)[0].text).toBe('id: 0 · text: row 0');
  });
});

describe('labelAgreement', () => {
  const samples = [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }, { id: 'c', text: 'C' }];

  it('measures agreement only over multiply-labelled samples', () => {
    const result = labelAgreement(samples, [
      { sampleId: 'a', reviewer: 'x', answer: 'yes' },
      { sampleId: 'a', reviewer: 'y', answer: 'yes' },
      { sampleId: 'b', reviewer: 'x', answer: 'yes' },
      { sampleId: 'b', reviewer: 'y', answer: 'no' },
      { sampleId: 'c', reviewer: 'x', answer: 'yes' },
    ]);
    expect(result).toMatchObject({ multiplyLabelled: 2, unanimous: 1, agreement: 50, unlabelled: 0 });
    expect(result.contested).toEqual(['b']);
  });

  it('reports null rather than 100% when nothing was double-labelled', () => {
    const result = labelAgreement(samples, [{ sampleId: 'a', reviewer: 'x', answer: 'yes' }]);
    expect(result.agreement).toBeNull();
    expect(result.unlabelled).toBe(2);
  });

  it('ignores an empty answer instead of counting it as a label', () => {
    expect(labelAgreement(samples, [
      { sampleId: 'a', reviewer: 'x', answer: 'yes' },
      { sampleId: 'a', reviewer: 'y', answer: '   ' },
    ]).multiplyLabelled).toBe(0);
  });
});

describe('promoteToGoldenSet', () => {
  const samples = [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }];

  it('keeps only what reviewers agreed on', () => {
    // A majority vote would manufacture a ground truth out of a genuine ambiguity.
    const golden = promoteToGoldenSet(samples, [
      { sampleId: 'a', reviewer: 'x', answer: 'yes' },
      { sampleId: 'a', reviewer: 'y', answer: 'yes' },
      { sampleId: 'b', reviewer: 'x', answer: 'yes' },
      { sampleId: 'b', reviewer: 'y', answer: 'no' },
      { sampleId: 'b', reviewer: 'z', answer: 'no' },
    ]);
    expect(golden).toEqual([{ id: 'a', text: 'A', answer: 'yes' }]);
  });

  it('accepts a single-reviewer answer as agreed', () => {
    expect(promoteToGoldenSet(samples, [{ sampleId: 'a', reviewer: 'x', answer: 'yes' }])).toHaveLength(1);
  });
});

describe('projectLlmCost', () => {
  const complete = {
    costPerMillionInput: 3, costPerMillionOutput: 15,
    tokensPerRequestIn: 2_000, tokensPerRequestOut: 500, monthlyRequests: 1_000_000,
  };

  it('prices a request and a month from the rate card', () => {
    const projection = projectLlmCost(complete);
    // 2000/1e6*3 = 0.006 in, 500/1e6*15 = 0.0075 out
    expect(projection.costPerRequest).toBe(0.0135);
    expect(projection.monthlyCost).toBe(13_500);
    expect(projection.monthlyTokens).toBe(2_500_000_000);
  });

  it('splits input against output, which is what decides where to optimise', () => {
    const projection = projectLlmCost(complete);
    expect(projection.outputShare).toBeGreaterThan(projection.inputShare);
  });

  it('discounts cache hits on the input side only, as providers actually price it', () => {
    const cached = projectLlmCost({ ...complete, cacheHitRate: 1 });
    expect(cached.costPerRequest).toBe(0.0075);
    expect(cached.inputShare).toBe(0);
  });

  it('flags an incomplete rate card so the card shows a dash, not a free feature', () => {
    // "$0.00" is a far more actionable-looking wrong answer than a blank.
    expect(projectLlmCost({ costPerMillionInput: 3 }).incomplete).toBe(true);
    expect(projectLlmCost(complete).incomplete).toBe(false);
  });
});
