/**
 * THE idea's two acts — talk to someone, then ask a crowd.
 *
 * `explore` puts a `customerInterview` beside the idea (the conversation the
 * scratchpad's "Plan an interview" already authors). `test` puts a `form`
 * beside it, seeded from the idea's problem and riskiest assumptions, and
 * names that form in `testedBy` so the idea's evidence derivation counts it.
 *
 * Both live here rather than in the Ideas surface so Brain's
 * `canvas_invoke_object_action` and a person pressing the row button cannot
 * disagree about what "test this idea" means.
 */

import { cardText, type CardAct } from '@/domains/canvas/application/CardAct';
import type { CreationObjectKind } from '@/domains/canvas/domain/canvasObject';
import { withTestedBy } from '@/lib/ideaLog';
import { questionsFromIdea } from '@/lib/formObject';

export const ideaActs: CardAct = {
  kind: 'idea' as CardAct['kind'],
  actions: ['explore', 'test'],
  failureNotice: 'noticeIdeaActFailed',
  async run({ object, action, board, t }) {
    const data = object.data as Record<string, unknown>;
    const ideaTitle = cardText(data, 'title') || t('noticeIdeaUntitled');
    const segment = cardText(data, 'segment');
    const stage = cardText(data, 'stage');
    const validating = stage === 'captured' || stage === 'exploring' || stage === ''
      ? { stage: 'validating' }
      : {};

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
      title,
      purpose: cardText(data, 'problem') || ideaTitle,
      questions: questionsFromIdea(data),
      audience: 'anyoneWithLink',
      anonymous: false,
    };
    return {
      patch: { testedBy: withTestedBy(data, title), ...validating },
      add: { nodes: [created], edges: [] },
      notice: t('noticeIdeaFormCreated', { idea: ideaTitle }),
    };
  },
};
