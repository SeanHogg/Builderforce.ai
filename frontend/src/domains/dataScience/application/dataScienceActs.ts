/**
 * Data-science card acts — the `labelSet` promotion.
 *
 * `promoteToGoldenSet` and `labelAgreement` were built, tested and rendered by
 * nothing: the `labelSet` spec declared a `promote` action and an `agreement`
 * meter, and neither reached the board. The meter is now a `derive` on the spec
 * (lib/dataScienceObjects.ts); this file is the act, registered in the canvas's
 * card-act list so the dispatch is a lookup rather than a new branch.
 *
 * What promotion produces is a `dataset`, not a bespoke "golden set" kind: an
 * eval set IS rows with a known answer, and a dataset is the one shape every
 * downstream object (`evaluation`, `chart`, `notebook`) already reads. The rows
 * carry the reproducibility envelope `datasetObjectData` attaches at the one
 * point rows enter the board, so a score computed against this set can name the
 * version of it that was scored.
 */

import { datasetObjectData } from '@/domains/canvas/application/ImportCanvasFile';
import { actEdge, type CardAct } from '@/domains/canvas/application/CardAct';
import type { CreationObjectKind } from '@/domains/canvas/domain/canvasObject';
import { labelAgreement, promoteToGoldenSet, readLabelRecords, readLabelSamples } from '@/lib/canvasLabelSet';
import type { TabularSource } from '@/lib/canvasTabularData';

/** The columns a promoted set carries — the sample, and the answer reviewers agreed on. */
export const GOLDEN_SET_COLUMNS = ['id', 'text', 'answer'] as const;

export const promoteLabelSetAct: CardAct = {
  kind: 'labelSet' as CreationObjectKind,
  actions: ['promote'],
  run({ object, board, t }) {
    const data = object.data as Record<string, unknown>;
    const samples = readLabelSamples(data);
    const labels = readLabelRecords(data);
    const agreed = promoteToGoldenSet(samples, labels);
    if (!agreed.length) {
      // Named, not generic: "nothing agreed" and "nothing labelled" are different
      // problems for the person holding the guidelines.
      const { contested, unlabelled } = labelAgreement(samples, labels);
      return { notice: t('noticeGoldenSetNothingAgreed', { contested: contested.length, unlabelled }) };
    }

    const source: TabularSource = {
      columns: [...GOLDEN_SET_COLUMNS],
      rows: agreed.map((row) => ({ id: row.id, text: row.text, answer: row.answer })),
    };
    const title = t('goldenSetTitle', { title: String(data.title ?? '').trim() || t('goldenSetUntitledLabelSet') });
    const node = board.create('dataset' as CreationObjectKind, { x: object.position.x + 440, y: object.position.y });
    node.data = {
      ...node.data,
      ...datasetObjectData(title, source, {
        subtitle: t('goldenSetSubtitle', { count: agreed.length, of: samples.length }),
        status: t('goldenSetStatus'),
        sourceRows: samples.length,
      }),
      // The join back to the labels this set was agreed from, so the provenance of
      // every answer stays one hop away. Contested samples are EXCLUDED, never
      // resolved by majority — see `promoteToGoldenSet`.
      sourceLabelSetId: object.id,
    };

    return {
      add: { nodes: [node], edges: [actEdge(object, node, t('goldenSetEdgeLabel'), 'data')] },
      notice: t('noticeGoldenSetPromoted', { count: agreed.length, of: samples.length }),
    };
  },
};

export const DATA_SCIENCE_CARD_ACTS: readonly CardAct[] = [promoteLabelSetAct];
