/**
 * The goals a site is judged against (PRD 33 §4.1 Goal band). Data: the
 * GoalBar renders this list, and the bands read the chosen id. Later waves
 * attach the smart event / funnel each goal measures to its row.
 */

export const INSIGHT_GOALS = [
  { id: 'activation', labelKey: 'goals.activation' },
  { id: 'revenue', labelKey: 'goals.revenue' },
  { id: 'signups', labelKey: 'goals.signups' },
  { id: 'retention', labelKey: 'goals.retention' },
] as const;

export type InsightGoal = (typeof INSIGHT_GOALS)[number]['id'];
