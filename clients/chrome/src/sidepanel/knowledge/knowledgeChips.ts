/**
 * A chat answer's knowledge chips in Rovr (PRD 38 §3.1): the transcript's PreFetch rows
 * (`<BrainTimeline prefetch>`) in Rovr's own words, and their chips routed to the
 * Knowledge TAB — focused on the chip's refs (**Open in graph**) or on the view's review
 * launcher (**Choose a folder to review**). The web routes the same intent to its canvas
 * surface. The intent itself is the shared one (`knowledgeChipIntent`).
 */

import type { TimelinePrefetch } from '@seanhogg/builderforce-brain-ui';
import { knowledgeChipIntent, type KnowledgeChipIntent } from '@builderforce/knowledge-browser';
import type { MessageKey } from '../../i18n/keys';

/** Rovr's catalog key for a PreFetch row's or chip's `labelKey`; undefined ⇒ the shared default. */
const LABEL_KEYS: Readonly<Record<string, MessageKey>> = {
  'prefetch.chip.openInGraph': 'prefetchOpenInGraph',
  'prefetch.chip.chooseFolderToReview': 'prefetchChooseFolderToReview',
  'prefetch.action.knowledge.graph': 'prefetchActionKnowledgeGraph',
  'prefetch.action.knowledge.review-dir': 'prefetchActionKnowledgeReview',
  'prefetch.action.knowledge.ask': 'prefetchActionKnowledgeAsk',
};

export function rovrPrefetchLabelKey(labelKey: string): MessageKey | undefined {
  return LABEL_KEYS[labelKey];
}

/** What the Knowledge tab opens on: the chip's intent, and a token so the same intent re-opens. */
export interface KnowledgeTabIntent extends KnowledgeChipIntent {
  seq: number;
}

/** The transcript's PreFetch binding: Rovr's copy, and knowledge chips → `openKnowledge`. */
export function rovrPrefetchTimeline(
  translate: (key: MessageKey) => string,
  openKnowledge: (intent: KnowledgeChipIntent) => void,
): TimelinePrefetch {
  return {
    labels: {
      answeredBy: translate('prefetchAnsweredBy'),
      answeredHint: translate('prefetchAnsweredHint'),
      nextSteps: translate('prefetchNextSteps'),
    },
    labelOf: (labelKey) => {
      const key = rovrPrefetchLabelKey(labelKey);
      return key ? translate(key) : undefined;
    },
    onChip: (chip) => {
      const intent = knowledgeChipIntent(chip);
      if (intent) openKnowledge(intent);
    },
  };
}
