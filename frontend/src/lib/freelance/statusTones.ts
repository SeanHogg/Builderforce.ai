import type { StatusToneMap } from '@/lib/statusTone';
import type { Engagement } from './engagements';

/**
 * What an engagement's status MEANS, for every surface that draws one.
 *
 * The freelancer dashboard and the marketplace's "My engagements" tab both colour the
 * same `Engagement['status']`, and before this map they disagreed — `invited` was amber on
 * one and blue on the other. An invitation is waiting on the freelancer's answer (warning);
 * an interview is progress (info); an active engagement is the good outcome.
 */
export const ENGAGEMENT_TONE: StatusToneMap<Engagement['status']> = {
  invited: 'warning',
  interviewing: 'info',
  active: 'success',
  declined: 'neutral',
  terminated: 'neutral',
};
