/**
 * Promotion without a canvas: the eval set a label set produces is exactly the
 * agreed subset, as a dataset, joined back to the labels it came from.
 */

import { describe, expect, it } from 'vitest';
import { GOLDEN_SET_COLUMNS, promoteLabelSetAct } from './dataScienceActs';
import type { CardActBoard } from '@/domains/canvas/application/CardAct';
import type { CanvasObject, CreationObjectKind } from '@/domains/canvas/domain/canvasObject';

const t = (key: string, values?: Record<string, string | number>) => (values ? `${key}:${JSON.stringify(values)}` : key);

function object(id: string, kind: string, data: Record<string, unknown> = {}): CanvasObject {
  return { id, type: 'creation', position: { x: 10, y: 20 }, data: { kind: kind as CreationObjectKind, title: id, ...data } };
}

function board(objects: CanvasObject[]): CardActBoard {
  return {
    objects,
    create: (kind, position) => ({ id: `new-${kind}`, type: 'creation', position, data: { kind, title: '' } }),
  };
}

const samples = [{ id: 's1', text: 'refund please' }, { id: 's2', text: 'where is my order' }, { id: 's3', text: 'cancel' }];

describe('labelSet.promote', () => {
  it('creates a dataset of the unanimously labelled samples, connected to the label set', () => {
    const labelSet = object('ls1', 'labelSet', {
      title: 'Intent labels',
      samples,
      labels: [
        { sampleId: 's1', reviewer: 'ada', answer: 'refund' },
        { sampleId: 's1', reviewer: 'grace', answer: 'refund' },
        // s2 is contested — excluded, never resolved by majority.
        { sampleId: 's2', reviewer: 'ada', answer: 'shipping' },
        { sampleId: 's2', reviewer: 'grace', answer: 'refund' },
        { sampleId: 's2', reviewer: 'linus', answer: 'shipping' },
        // s3 is single-labelled — one reviewer agreeing with nobody still counts.
        { sampleId: 's3', reviewer: 'ada', answer: 'cancel' },
      ],
    });
    const outcome = promoteLabelSetAct.run({ object: labelSet, action: 'promote', board: board([labelSet]), t });
    if (outcome instanceof Promise) throw new Error('expected a synchronous act');

    const [dataset] = outcome.add?.nodes ?? [];
    expect(dataset?.data.kind).toBe('dataset');
    expect(dataset?.data.columns).toEqual([...GOLDEN_SET_COLUMNS]);
    expect(dataset?.data.rows).toEqual([
      { id: 's1', text: 'refund please', answer: 'refund' },
      { id: 's3', text: 'cancel', answer: 'cancel' },
    ]);
    expect(dataset?.data.rowCount).toBe(2);
    expect(dataset?.data.sourceLabelSetId).toBe('ls1');
    // Placed beside the label set, not on top of it.
    expect(dataset?.position).toEqual({ x: 450, y: 20 });
    expect(outcome.add?.edges).toHaveLength(1);
    expect(outcome.add?.edges[0]).toMatchObject({ source: 'ls1', target: 'new-dataset', data: { connectionKind: 'data' } });
    expect(outcome.notice).toBe('noticeGoldenSetPromoted:{"count":2,"of":3}');
  });

  it('refuses to promote when nothing was agreed, and says how much is contested vs unlabelled', () => {
    const labelSet = object('ls1', 'labelSet', {
      samples,
      labels: [
        { sampleId: 's1', reviewer: 'ada', answer: 'refund' },
        { sampleId: 's1', reviewer: 'grace', answer: 'shipping' },
      ],
    });
    const outcome = promoteLabelSetAct.run({ object: labelSet, action: 'promote', board: board([labelSet]), t });
    if (outcome instanceof Promise) throw new Error('expected a synchronous act');

    expect(outcome.add).toBeUndefined();
    expect(outcome.notice).toBe('noticeGoldenSetNothingAgreed:{"contested":1,"unlabelled":2}');
  });

  it('ignores malformed rows rather than promoting a blank answer', () => {
    const labelSet = object('ls1', 'labelSet', {
      samples: [{ id: 's1', text: 'x' }, { text: 'no id' }, null],
      labels: [{ sampleId: 's1', reviewer: 'ada', answer: '  ' }, { sampleId: 's1', answer: 'yes' }, 'junk'],
    });
    const outcome = promoteLabelSetAct.run({ object: labelSet, action: 'promote', board: board([labelSet]), t });
    if (outcome instanceof Promise) throw new Error('expected a synchronous act');

    expect(outcome.add?.nodes[0]?.data.rows).toEqual([{ id: 's1', text: 'x', answer: 'yes' }]);
  });
});
