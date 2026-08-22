/**
 * THE POINTS CATALOG — what each platform action earns, as DATA.
 *
 * ── WHY THIS FILE HAS NO LOGIC ───────────────────────────────────────────────
 * The engine that reads it (`awardPoints.ts`) has one code path. Everything that
 * varies between "submitted an application" and "published a comic" — the payout,
 * the daily ceiling, who may earn it, which badges it can unlock — is a field on
 * a row here. Adding an earning action is a data edit; it is never a branch.
 *
 * That matters because the surface this replaces was a `switch` with forty-eight
 * arms across three files (a points table, a badge evaluator keyed on the action,
 * and a streak signal set), which is three places to edit for one new action and
 * three chances to edit only two of them. `BADGE_TIERS` living on the rule is the
 * whole of that fix: a rule's badges cannot drift from the rule.
 *
 * ── THE LEDGER IS THE STORE, SO THERE IS NO BALANCE HERE ─────────────────────
 * Points are `ledger_entries` rows in the `points` denomination (PRD 20 §3.2 —
 * "denomination is a column", and the coverage map files every one of the source
 * product's five points tables onto that primitive). This module never holds a
 * balance, a counter or a streak; it holds the RULES, and the ledger holds what
 * happened.
 *
 * ── FACETS, NOT ROLES ────────────────────────────────────────────────────────
 * The source product gated rules on a single `user_role` enum it owned. This
 * platform has no such column and should not grow one: whether somebody can earn
 * a recruiter's points is derivable from facts it already stores. `EarnerFacet`
 * is that derivation's vocabulary and `earnerFacets.ts` is the one place it is
 * computed — see the note there about why an empty `facets` array means "anyone".
 */

/** Who a rule pays. Derived per-user by {@link ../points/earnerFacets}; a rule
 *  with an EMPTY list pays every signed-in earner. */
export type EarnerFacet = 'talent' | 'recruiter' | 'employer' | 'creator';

/** Every facet that is not staff — the list ~30 of the rules below share. Named
 *  so the triple is written once (it was repeated per-rule in the source). */
export const ALL_EARNER_FACETS: readonly EarnerFacet[] = ['talent', 'recruiter', 'employer', 'creator'];

/** A badge this rule can unlock, and the lifetime count that unlocks it.
 *  `countOf: 'action'` counts qualifying awards of THIS action; `'user_tasks'`
 *  counts the user-authored task completions the gate below also reads. */
export interface BadgeTier {
  slug: string;
  threshold: number;
  countOf?: 'action' | 'user_tasks' | 'all_tasks';
}

export interface PointsRule {
  /** Stable dot-namespaced key. Stored in the ledger row's reference. */
  key: string;
  /** Human label for the activity feed. Localized client-side off `key`; this
   *  is the fallback and the admin-facing name. */
  label: string;
  /** Facets that may earn this. EMPTY = every earner. */
  facets: readonly EarnerFacet[];
  /** Points per qualifying event, before caps. */
  points: number;
  /** At most this many points from this action per UTC day. */
  dailyCapPoints?: number;
  /** Requires the user-authored-task gate ({@link USER_TASK_GATE_THRESHOLD})
   *  before it pays. The anti-farming rule: authoring your own tasks and closing
   *  them earns nothing until you have closed a hundred of them. */
  requiresUserTaskGate?: boolean;
  /** Coarse family for the activity feed. Defaults to the key's first segment. */
  source?: string;
  /** Does a qualifying event count as an active day for the streak? */
  streakSignal?: boolean;
  /** Badges this action can unlock. */
  badges?: readonly BadgeTier[];
}

/** Action keys. Constants so call sites cannot mistype a string. */
export const POINT_ACTIONS = {
  TASK_COMPLETE_SYSTEM: 'task.complete.system',
  TASK_COMPLETE_USER: 'task.complete.user',
  APPLICATION_SUBMITTED: 'application.submitted',
  RESUME_TAILORED: 'resume.tailored',
  COVER_LETTER_GENERATED: 'cover_letter.generated',
  SESSION_DAILY: 'session.daily',
  SAVED_SEARCH_RUN: 'saved_search.run',
  AI_TOOL_USED: 'ai.tool.used',
  PURCHASE_TOKEN_PACK: 'purchase.token_pack',
  PURCHASE_SUBSCRIPTION: 'purchase.subscription',
  PURCHASE_ANY: 'purchase.any',
  FEED_POST_CREATED: 'feed.post.created',
  RESOURCE_SUBMITTED: 'resource.submitted',
  LESSON_COMPLETED: 'lesson.completed',
  COURSE_PASSED: 'course.passed',
  CERTIFICATE_EARNED: 'certificate.earned',
  LEARNING_PATH_COMPLETED: 'learning.path.completed',
  COURSE_PUBLISHED: 'course.published',
  PLAY_GAME_CHALLENGE: 'play.game.challenge',
  EVENT_CREATED: 'event.created',
  EVENT_REGISTERED: 'event.registered',
  EVENT_ATTENDED: 'event.attended',
  EVENT_CONNECTION_MADE: 'event.connection.made',
  BOOKING_SESSION_COMPLETED: 'booking.session.completed',
  BOOKING_SESSION_BOOKED: 'booking.session.booked',
  ARTICLE_PUBLISHED: 'article.published',
  REFERENCE_GIVEN: 'reference.given',
  REFERENCE_RECEIVED: 'reference.received',
  COMPANY_REVIEW_POSTED: 'company_review.posted',
  COHORT_CREATED: 'cohort.created',
  COHORT_STUDENT_JOINED: 'cohort.student.joined',
  COHORT_ASSIGNMENT_COMPLETED: 'cohort.assignment.completed',
  STUDIO_GAME_PUBLISHED: 'studio.game.published',
  STUDIO_COMIC_PUBLISHED: 'studio.comic.published',
  STUDIO_PODCAST_PUBLISHED: 'studio.podcast.published',
  FEEDBACK_REVIEW_SUBMITTED: 'feedback.review.submitted',
  FEEDBACK_SUGGESTION_ACCEPTED: 'feedback.suggestion.accepted',
  CANDIDATE_SOURCED: 'recruiter.candidate.sourced',
  CANDIDATE_SUBMITTED: 'recruiter.candidate.submitted',
  CANDIDATE_PLACED: 'recruiter.candidate.placed',
  BID_WON: 'recruiter.bid.won',
  JOB_POSTED: 'employer.job.posted',
  CANDIDATE_VIEWED: 'employer.candidate.viewed',
  SCORECARD_COMPLETED: 'employer.scorecard.completed',
  OFFER_EXTENDED: 'employer.offer.extended',
  HIRE_CONFIRMED: 'employer.hire.confirmed',
  /** Written by the streak roll, never by a caller. */
  STREAK_BONUS: 'streak.bonus',
  /** Written by the badge award, never by a caller. */
  BADGE_UNLOCKED: 'badge.unlocked',
} as const;

export type PointActionKey = (typeof POINT_ACTIONS)[keyof typeof POINT_ACTIONS];

const T = 'talent' as const;
const R = 'recruiter' as const;
const E = 'employer' as const;

/**
 * The catalog. Ordered by family so a reader can see a family's ceilings
 * together — the caps are the anti-farming design and they only make sense
 * relative to their neighbours.
 */
export const POINTS_CATALOG: readonly PointsRule[] = [
  // ── Tasks ────────────────────────────────────────────────────────────────
  { key: POINT_ACTIONS.TASK_COMPLETE_SYSTEM, label: 'Completed an onboarding task', facets: [T], points: 15, source: 'task', streakSignal: true,
    badges: [{ slug: 'get_it_done', threshold: 1, countOf: 'all_tasks' }] },
  { key: POINT_ACTIONS.TASK_COMPLETE_USER, label: 'Completed a self-created task', facets: [T], points: 5, dailyCapPoints: 25, requiresUserTaskGate: true, source: 'task', streakSignal: true,
    badges: [{ slug: 'get_it_done', threshold: 1, countOf: 'all_tasks' }, { slug: 'hundred_tasks', threshold: 100, countOf: 'user_tasks' }] },

  // ── Job hunting ──────────────────────────────────────────────────────────
  { key: POINT_ACTIONS.APPLICATION_SUBMITTED, label: 'Submitted a job application', facets: [T], points: 50, dailyCapPoints: 250, source: 'application', streakSignal: true,
    badges: [{ slug: 'first_application', threshold: 1 }, { slug: 'applications_10', threshold: 10 }, { slug: 'applications_50', threshold: 50 }] },
  { key: POINT_ACTIONS.RESUME_TAILORED, label: 'Tailored a résumé for a job', facets: [T], points: 20, dailyCapPoints: 80, source: 'resume', streakSignal: true,
    badges: [{ slug: 'ai_tool_first', threshold: 1 }] },
  { key: POINT_ACTIONS.COVER_LETTER_GENERATED, label: 'Generated a cover letter', facets: [T], points: 15, dailyCapPoints: 60, source: 'resume', streakSignal: true,
    badges: [{ slug: 'ai_tool_first', threshold: 1 }] },
  { key: POINT_ACTIONS.SAVED_SEARCH_RUN, label: 'Created or refreshed a saved search', facets: [T], points: 3, dailyCapPoints: 15, source: 'session', streakSignal: true },

  // ── Engagement ───────────────────────────────────────────────────────────
  { key: POINT_ACTIONS.SESSION_DAILY, label: 'Showed up today', facets: [T], points: 5, dailyCapPoints: 5, source: 'session', streakSignal: true },
  { key: POINT_ACTIONS.AI_TOOL_USED, label: 'Used an AI tool', facets: [T], points: 5, dailyCapPoints: 50, source: 'ai', streakSignal: true,
    badges: [{ slug: 'ai_tool_first', threshold: 1 }] },
  { key: POINT_ACTIONS.FEED_POST_CREATED, label: 'Posted to the feed', facets: [], points: 10, dailyCapPoints: 30, source: 'feed', streakSignal: true,
    badges: [{ slug: 'first_post', threshold: 1 }] },
  { key: POINT_ACTIONS.RESOURCE_SUBMITTED, label: 'Submitted a community resource', facets: [], points: 25, dailyCapPoints: 100, source: 'resource', streakSignal: true,
    badges: [{ slug: 'resource_first', threshold: 1 }, { slug: 'resources_10', threshold: 10 }] },

  // ── Purchases ────────────────────────────────────────────────────────────
  { key: POINT_ACTIONS.PURCHASE_TOKEN_PACK, label: 'Purchased an AI credit pack', facets: [T], points: 100, source: 'purchase', streakSignal: true,
    badges: [{ slug: 'purchase_first', threshold: 1 }] },
  { key: POINT_ACTIONS.PURCHASE_SUBSCRIPTION, label: 'Started a paid plan', facets: [T], points: 250, source: 'purchase', streakSignal: true,
    badges: [{ slug: 'purchase_first', threshold: 1 }] },
  { key: POINT_ACTIONS.PURCHASE_ANY, label: 'Made a purchase', facets: [T], points: 25, source: 'purchase', streakSignal: true,
    badges: [{ slug: 'purchase_first', threshold: 1 }] },

  // ── Learning ─────────────────────────────────────────────────────────────
  { key: POINT_ACTIONS.LESSON_COMPLETED, label: 'Completed a lesson', facets: [], points: 10, dailyCapPoints: 80, source: 'learning', streakSignal: true,
    badges: [{ slug: 'first_lesson_passed', threshold: 1 }] },
  { key: POINT_ACTIONS.COURSE_PASSED, label: 'Passed a course', facets: [], points: 100, source: 'learning', streakSignal: true,
    badges: [{ slug: 'first_course_passed', threshold: 1 }, { slug: 'courses_completed_5', threshold: 5 }] },
  { key: POINT_ACTIONS.CERTIFICATE_EARNED, label: 'Earned a certificate', facets: [], points: 50, source: 'learning', streakSignal: true,
    badges: [{ slug: 'first_certificate_earned', threshold: 1 }] },
  { key: POINT_ACTIONS.LEARNING_PATH_COMPLETED, label: 'Completed a learning path', facets: [], points: 250, source: 'learning', streakSignal: true,
    badges: [{ slug: 'first_path_completed', threshold: 1 }] },
  { key: POINT_ACTIONS.COURSE_PUBLISHED, label: 'Published a course', facets: [], points: 200, source: 'learning', streakSignal: true,
    badges: [{ slug: 'instructor_first_course', threshold: 1 }] },
  { key: POINT_ACTIONS.COHORT_CREATED, label: 'Created a learning cohort', facets: [], points: 100, source: 'cohort', streakSignal: true,
    badges: [{ slug: 'educator_first_cohort', threshold: 1 }] },
  { key: POINT_ACTIONS.COHORT_STUDENT_JOINED, label: 'Joined a learning cohort', facets: [], points: 20, source: 'cohort', streakSignal: true,
    badges: [{ slug: 'student_enrolled', threshold: 1 }] },
  { key: POINT_ACTIONS.COHORT_ASSIGNMENT_COMPLETED, label: 'Completed a cohort assignment', facets: [], points: 50, dailyCapPoints: 200, source: 'cohort', streakSignal: true,
    badges: [{ slug: 'first_assignment_completed', threshold: 1 }] },

  // ── Canvas creation and play ─────────────────────────────────────────────
  { key: POINT_ACTIONS.PLAY_GAME_CHALLENGE, label: 'Completed a world challenge', facets: [], points: 25, dailyCapPoints: 200, source: 'game', streakSignal: true },
  { key: POINT_ACTIONS.STUDIO_GAME_PUBLISHED, label: 'Published a game', facets: [], points: 150, source: 'studio', streakSignal: true,
    badges: [{ slug: 'studio_creator_first', threshold: 1 }] },
  { key: POINT_ACTIONS.STUDIO_COMIC_PUBLISHED, label: 'Published a comic', facets: [], points: 150, source: 'studio', streakSignal: true,
    badges: [{ slug: 'studio_creator_first', threshold: 1 }] },
  { key: POINT_ACTIONS.STUDIO_PODCAST_PUBLISHED, label: 'Published a podcast', facets: [], points: 150, source: 'studio', streakSignal: true,
    badges: [{ slug: 'studio_creator_first', threshold: 1 }] },
  { key: POINT_ACTIONS.ARTICLE_PUBLISHED, label: 'Published an article', facets: [], points: 75, dailyCapPoints: 225, source: 'article', streakSignal: true,
    badges: [{ slug: 'first_article', threshold: 1 }, { slug: 'articles_10', threshold: 10 }] },

  // ── Events and sessions ──────────────────────────────────────────────────
  { key: POINT_ACTIONS.EVENT_CREATED, label: 'Created an event', facets: [], points: 50, dailyCapPoints: 200, source: 'event', streakSignal: true,
    badges: [{ slug: 'event_host_first', threshold: 1 }] },
  { key: POINT_ACTIONS.EVENT_REGISTERED, label: 'Registered for an event', facets: [], points: 10, dailyCapPoints: 50, source: 'event', streakSignal: true,
    badges: [{ slug: 'event_attendee_first', threshold: 1 }] },
  { key: POINT_ACTIONS.EVENT_ATTENDED, label: 'Attended an event', facets: [], points: 25, dailyCapPoints: 100, source: 'event', streakSignal: true,
    badges: [{ slug: 'event_attendee_first', threshold: 1 }] },
  { key: POINT_ACTIONS.EVENT_CONNECTION_MADE, label: 'Connected with someone from an event', facets: [], points: 30, dailyCapPoints: 150, source: 'event', streakSignal: true },
  { key: POINT_ACTIONS.BOOKING_SESSION_COMPLETED, label: 'Completed a booked session', facets: [], points: 75, dailyCapPoints: 300, source: 'booking', streakSignal: true,
    badges: [{ slug: 'session_host_first', threshold: 1 }, { slug: 'session_host_10', threshold: 10 }] },
  { key: POINT_ACTIONS.BOOKING_SESSION_BOOKED, label: 'Booked a session', facets: [], points: 20, dailyCapPoints: 100, source: 'booking', streakSignal: true,
    badges: [{ slug: 'session_booked_first', threshold: 1 }] },

  // ── Reputation ───────────────────────────────────────────────────────────
  { key: POINT_ACTIONS.REFERENCE_GIVEN, label: 'Gave a reference', facets: [], points: 40, dailyCapPoints: 160, source: 'reference', streakSignal: true,
    badges: [{ slug: 'reference_given_first', threshold: 1 }] },
  { key: POINT_ACTIONS.REFERENCE_RECEIVED, label: 'Received a reference', facets: [], points: 20, dailyCapPoints: 100, source: 'reference', streakSignal: true,
    badges: [{ slug: 'reference_received_first', threshold: 1 }] },
  { key: POINT_ACTIONS.COMPANY_REVIEW_POSTED, label: 'Posted a company review', facets: [], points: 25, dailyCapPoints: 75, source: 'company_review', streakSignal: true,
    badges: [{ slug: 'first_company_review', threshold: 1 }] },
  { key: POINT_ACTIONS.FEEDBACK_REVIEW_SUBMITTED, label: 'Submitted résumé feedback', facets: [], points: 40, dailyCapPoints: 200, source: 'feedback', streakSignal: true,
    badges: [{ slug: 'feedback_first', threshold: 1 }, { slug: 'mentor', threshold: 5 }] },
  { key: POINT_ACTIONS.FEEDBACK_SUGGESTION_ACCEPTED, label: 'A suggested edit was accepted', facets: [], points: 15, dailyCapPoints: 150, source: 'feedback', streakSignal: true },

  // ── Recruiting ───────────────────────────────────────────────────────────
  { key: POINT_ACTIONS.CANDIDATE_SOURCED, label: 'Sourced a candidate', facets: [R], points: 5, dailyCapPoints: 100, source: 'recruiter', streakSignal: true },
  { key: POINT_ACTIONS.CANDIDATE_SUBMITTED, label: 'Submitted a candidate', facets: [R], points: 25, dailyCapPoints: 250, source: 'recruiter', streakSignal: true },
  { key: POINT_ACTIONS.CANDIDATE_PLACED, label: 'Placed a candidate', facets: [R], points: 1000, source: 'recruiter', streakSignal: true },
  { key: POINT_ACTIONS.BID_WON, label: 'Won a sourcing bid', facets: [R], points: 200, source: 'recruiter', streakSignal: true },

  // ── Employing ────────────────────────────────────────────────────────────
  { key: POINT_ACTIONS.JOB_POSTED, label: 'Posted a job', facets: [E], points: 100, source: 'employer', streakSignal: true },
  { key: POINT_ACTIONS.CANDIDATE_VIEWED, label: 'Reviewed a candidate', facets: [E], points: 2, dailyCapPoints: 40, source: 'employer', streakSignal: true },
  { key: POINT_ACTIONS.SCORECARD_COMPLETED, label: 'Filled out a hiring scorecard', facets: [E], points: 30, dailyCapPoints: 150, source: 'employer', streakSignal: true },
  { key: POINT_ACTIONS.OFFER_EXTENDED, label: 'Extended an offer', facets: [E], points: 200, source: 'employer', streakSignal: true },
  { key: POINT_ACTIONS.HIRE_CONFIRMED, label: 'Confirmed a hire', facets: [E], points: 1000, source: 'employer', streakSignal: true },

  // ── Engine-written. Not callable; the value comes from the milestone. ─────
  { key: POINT_ACTIONS.STREAK_BONUS, label: 'Streak milestone reached', facets: [], points: 0, source: 'streak' },
  { key: POINT_ACTIONS.BADGE_UNLOCKED, label: 'Badge unlocked', facets: [], points: 0, source: 'badge' },
];

const BY_KEY: ReadonlyMap<string, PointsRule> = new Map(POINTS_CATALOG.map((rule) => [rule.key, rule]));

export function getPointsRule(action: string): PointsRule | null {
  return BY_KEY.get(action) ?? null;
}

/** The family label a ledger row is filed under, derived rather than stored twice. */
export function ruleSource(rule: PointsRule): string {
  return rule.source ?? rule.key.split('.')[0];
}

/**
 * Streak milestones. The bonus is paid ONCE per streak instance — breaking a
 * streak and rebuilding it pays again, which is the point of a streak; crossing
 * the same day twice inside one run does not.
 */
export const STREAK_MILESTONES: readonly { day: number; bonus: number; badgeSlug: string }[] = [
  { day: 7, bonus: 100, badgeSlug: 'on_fire' },
  { day: 14, bonus: 250, badgeSlug: 'streak_14' },
  { day: 30, bonus: 500, badgeSlug: 'streak_30' },
  { day: 60, bonus: 1000, badgeSlug: 'streak_60' },
  { day: 90, bonus: 2500, badgeSlug: 'streak_90' },
];

/** User-authored task completions required before `task.complete.user` pays. */
export const USER_TASK_GATE_THRESHOLD = 100;
