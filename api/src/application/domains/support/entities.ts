/**
 * Support & knowledge entities — owned by **Support** (PRD 20 §3.2, migration 0423).
 *
 * The smallest domain in the roster, and deliberately so: a ticket is a
 * `work_item` with a kind, its conversation is `thread` + `message`, its
 * satisfaction survey is `question_set` + `response`. What survives is the
 * article people read and the widget that asks them how it went.
 */
import {
  customerEngagementFeedbackWidgets,
  feedbackSentiments,
  supportArticles,
} from '../../../infrastructure/database/schema/support';
import { defineDomainEntities, entity } from '../entityDefinition';

export const SUPPORT_ENTITIES = defineDomainEntities('support', [
  entity(supportArticles, { kind: 'article', registers: true }),
  customerEngagementFeedbackWidgets,
  /** A sentiment is a model's reading of a response. Re-score it; do not edit
   *  the score into agreement. */
  entity(feedbackSentiments, { readOnly: true }),
]);
