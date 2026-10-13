/**
 * THE idea's three acts — talk to someone, ask a crowd, then grade what came back.
 *
 * `explore` puts a `customerInterview` beside the idea (the conversation the
 * scratchpad's "Plan an interview" already authors). `test` puts a `form`
 * beside it, seeded from the idea's problem and riskiest assumptions, and
 * names that form in `testedBy` so the idea's evidence derivation counts it.
 *
 * `reveal` is the grade. It does not invent evidence: it reads the
 * `customerInterview` / `experiment` / `form` cards `testedBy` names, and
 * scores whether any of them has actually answered. Met (`stage: validated`,
 * `metricValue` 1) and missed (`metricValue` 0, stage stays) are both grades.
 * Naming nothing, or naming cards that are not on the board, is not a grade —
 * it is a notice, because there was nothing to measure.
 *
 * All three live here rather than in the Ideas surface so Brain's
 * `canvas_invoke_object_action` and a person pressing the row button cannot
 * disagree about what "test this idea" means.
 */

import { cardRows, cardText, type CardAct, type CardActOutcome } from '@/domains/canvas/application/CardAct';
import type { CanvasObject, CreationObjectKind } from '@/domains/canvas/domain/canvasObject';
import type { CanvasTextTranslator } from '@/domains/canvas/domain/canvasText';
import { IDEA_EVIDENCE_KINDS, withTestedBy } from '@/lib/ideaLog';
import { formFromIdea } from '@/lib/formObject';
import { specRefKey } from '@/lib/specObjects';

function chips(data: Record<string, unknown>, field: string): string[] {
  const raw = data[field];
  if (!Array.isArray(raw)) return [];
  return raw.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

/** True when this evidence card has actually answered, not merely been placed. */
export function evidenceAnswered(kind: string, data: Record<string, unknown>): boolean {
  if (kind === 'form') return Number(data.responseCount ?? 0) > 0;
  if (kind === 'customerInterview') {
    return Boolean(
      cardText(data, 'verdict')
      || chips(data, 'painsHeard').length
      || cardRows(data, 'quotes').length,
    );
  }
  if (kind === 'experiment') {
    return Boolean(cardText(data, 'result') || cardText(data, 'status') === 'evaluated');
  }
  return false;
}

function evidenceOnBoard(objects: readonly CanvasObject[], ref: string): CanvasObject | undefined {
  const key = specRefKey(ref);
  if (!key) return undefined;
  return objects.find((node) => {
    if (!(IDEA_EVIDENCE_KINDS as readonly string[]).includes(node.data.kind)) return false;
    return specRefKey(cardText(node.data as Record<string, unknown>, 'title')) === key;
  });
}

function revealIdea(object: CanvasObject, boardObjects: readonly CanvasObject[], t: CanvasTextTranslator): CardActOutcome {
  const data = object.data as Record<string, unknown>;
  const refs = chips(data, 'testedBy');
  if (!refs.length) return { notice: t('noticeIdeaNothingToReveal') };

  const missing: string[] = [];
  let answered = 0;
  for (const ref of refs) {
    const found = evidenceOnBoard(boardObjects, ref);
    if (!found) {
      missing.push(ref);
      continue;
    }
    if (evidenceAnswered(found.data.kind, found.data as Record<string, unknown>)) answered += 1;
  }
  if (missing.length === refs.length) {
    return { notice: t('noticeIdeaRevealMissing', { refs: missing.join(', ') }) };
  }

  const met = answered > 0;
  return {
    patch: met ? { stage: 'validated' } : {},
    notice: t(met ? 'noticeIdeaRevealMet' : 'noticeIdeaRevealMissed'),
    ledger: {
      metricKey: 'proof.grade',
      metricValue: met ? 1 : 0,
    },
  };
}

export const ideaActs: CardAct = {
  kind: 'idea' as CardAct['kind'],
  actions: ['explore', 'test', 'reveal'],
  failureNotice: 'noticeIdeaActFailed',
  async run({ object, action, board, t }) {
    const data = object.data as Record<string, unknown>;
    const ideaTitle = cardText(data, 'title') || t('noticeIdeaUntitled');
    const segment = cardText(data, 'segment');
    const stage = cardText(data, 'stage');
    const validating = stage === 'captured' || stage === 'exploring' || stage === ''
      ? { stage: 'validating' }
      : {};

    if (action === 'reveal') return revealIdea(object, board.objects, t);

    if (action === 'explore') {
      const title = t('noticeIdeaInterviewTitle', { idea: ideaTitle });
      const created = board.create('customerInterview' as CreationObjectKind, {
        x: object.position.x + 360,
        y: object.position.y,
      });
      created.data = {
        ...created.data,
        title,
        ...(segment ? { segment } : {}),
      };
      return {
        patch: { testedBy: withTestedBy(data, title), ...validating },
        add: { nodes: [created], edges: [] },
        notice: t('noticeIdeaInterviewPlanned', { idea: ideaTitle }),
      };
    }

    const title = t('noticeIdeaFormTitle', { idea: ideaTitle });
    const created = board.create('form' as CreationObjectKind, {
      x: object.position.x + 360,
      y: object.position.y + 80,
    });
    created.data = {
      ...created.data,
      ...formFromIdea({ ...data, title: ideaTitle }, title),
    };
    return {
      patch: { testedBy: withTestedBy(data, title), ...validating },
      add: { nodes: [created], edges: [] },
      notice: t('noticeIdeaFormCreated', { idea: ideaTitle }),
    };
  },
};
