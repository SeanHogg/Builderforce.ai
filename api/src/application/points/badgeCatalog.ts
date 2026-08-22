/**
 * THE BUILT-IN BADGES — definitions as data, awards as `user_badges` rows.
 *
 * ── WHY THE DEFINITIONS ARE CODE AND THE AWARDS ARE ROWS ─────────────────────
 * `badges` (People) already models a badge DEFINITION and `user_badges`
 * (Identity) already models one person holding one — the coverage map keeps both
 * and this module adds neither. What it adds is the platform's OWN badges, which
 * are not tenant data: every workspace gets the same "first application" badge,
 * and seeding one row per tenant per badge would be the same fact stored once per
 * customer, drifting the moment a name is corrected in one place.
 *
 * `badges.tenant_id` is nullable, which invites a global row instead — but its
 * uniqueness is `uq_badges_key (tenant_id, key)`, and Postgres treats NULLs as
 * DISTINCT in a unique index, so "global badges" in that table would admit
 * duplicates of exactly the rows that must not duplicate. Built-ins therefore
 * live here, tenant-authored badges live in `badges`, and the read path unions
 * them with the tenant's row winning on a key collision — the same precedence a
 * tenant override takes everywhere else on this platform.
 *
 * ── BONUS POINTS ARE A FIELD, NOT A BRANCH ───────────────────────────────────
 * Unlocking a badge may pay points. That value belongs to the BADGE, so it is a
 * column here rather than a case in the award path; a badge worth nothing simply
 * omits it and the writer skips the ledger row.
 */

/** 'skill' | 'tenure' | 'achievement' | 'certification' — mirrors `badges.kind`. */
export type BadgeKind = 'skill' | 'tenure' | 'achievement' | 'certification';

export interface BadgeDefinition {
  key: string;
  name: string;
  description: string;
  iconKey: string;
  kind: BadgeKind;
  /** Points paid on unlock. Omitted = the badge is its own reward. */
  bonusPoints?: number;
}

export const BUILT_IN_BADGES: readonly BadgeDefinition[] = [
  // ── Getting started ──────────────────────────────────────────────────────
  { key: 'get_it_done', name: 'Get it done', description: 'Completed your first task.', iconKey: 'check', kind: 'achievement', bonusPoints: 25 },
  { key: 'hundred_tasks', name: 'Century', description: 'Completed a hundred tasks you set yourself.', iconKey: 'trophy', kind: 'achievement', bonusPoints: 500 },

  // ── Job hunting ──────────────────────────────────────────────────────────
  { key: 'first_application', name: 'In the running', description: 'Submitted your first application.', iconKey: 'send', kind: 'achievement', bonusPoints: 25 },
  { key: 'applications_10', name: 'Persistent', description: 'Submitted ten applications.', iconKey: 'send', kind: 'achievement', bonusPoints: 100 },
  { key: 'applications_50', name: 'Relentless', description: 'Submitted fifty applications.', iconKey: 'send', kind: 'achievement', bonusPoints: 400 },
  { key: 'ai_tool_first', name: 'Assisted', description: 'Put an AI tool to work.', iconKey: 'sparkle', kind: 'achievement', bonusPoints: 25 },

  // ── Community ────────────────────────────────────────────────────────────
  { key: 'first_post', name: 'Said hello', description: 'Posted to the feed for the first time.', iconKey: 'message', kind: 'achievement', bonusPoints: 25 },
  { key: 'resource_first', name: 'Contributor', description: 'Shared your first community resource.', iconKey: 'bookmark', kind: 'achievement', bonusPoints: 25 },
  { key: 'resources_10', name: 'Local guide', description: 'Shared ten community resources.', iconKey: 'bookmark', kind: 'achievement', bonusPoints: 150 },
  { key: 'first_article', name: 'Published', description: 'Published your first article.', iconKey: 'document', kind: 'achievement', bonusPoints: 50 },
  { key: 'articles_10', name: 'Columnist', description: 'Published ten articles.', iconKey: 'document', kind: 'achievement', bonusPoints: 300 },

  // ── Commerce ─────────────────────────────────────────────────────────────
  { key: 'purchase_first', name: 'Backer', description: 'Made your first purchase.', iconKey: 'card', kind: 'achievement' },

  // ── Learning ─────────────────────────────────────────────────────────────
  { key: 'first_lesson_passed', name: 'Started learning', description: 'Completed your first lesson.', iconKey: 'book', kind: 'skill', bonusPoints: 25 },
  { key: 'first_course_passed', name: 'Course complete', description: 'Passed your first course.', iconKey: 'book', kind: 'certification', bonusPoints: 100 },
  { key: 'courses_completed_5', name: 'Scholar', description: 'Passed five courses.', iconKey: 'book', kind: 'certification', bonusPoints: 400 },
  { key: 'first_certificate_earned', name: 'Certified', description: 'Earned a verifiable certificate.', iconKey: 'seal', kind: 'certification', bonusPoints: 100 },
  { key: 'first_path_completed', name: 'Pathfinder', description: 'Completed a learning path.', iconKey: 'route', kind: 'certification', bonusPoints: 250 },
  { key: 'instructor_first_course', name: 'Instructor', description: 'Published a course of your own.', iconKey: 'lectern', kind: 'skill', bonusPoints: 200 },
  { key: 'educator_first_cohort', name: 'Educator', description: 'Created a learning cohort.', iconKey: 'lectern', kind: 'skill', bonusPoints: 100 },
  { key: 'student_enrolled', name: 'Enrolled', description: 'Joined a learning cohort.', iconKey: 'book', kind: 'achievement', bonusPoints: 25 },
  { key: 'first_assignment_completed', name: 'Handed in', description: 'Completed a cohort assignment.', iconKey: 'check', kind: 'achievement', bonusPoints: 50 },

  // ── Creation ─────────────────────────────────────────────────────────────
  { key: 'studio_creator_first', name: 'Creator', description: 'Published something you made on the canvas.', iconKey: 'palette', kind: 'skill', bonusPoints: 150 },

  // ── Events and sessions ──────────────────────────────────────────────────
  { key: 'event_host_first', name: 'Host', description: 'Created your first event.', iconKey: 'calendar', kind: 'achievement', bonusPoints: 50 },
  { key: 'event_attendee_first', name: 'Showed up', description: 'Took part in your first event.', iconKey: 'calendar', kind: 'achievement', bonusPoints: 25 },
  { key: 'session_host_first', name: 'Mentor in session', description: 'Delivered your first booked session.', iconKey: 'headset', kind: 'skill', bonusPoints: 75 },
  { key: 'session_host_10', name: 'Ten sessions in', description: 'Delivered ten booked sessions.', iconKey: 'headset', kind: 'skill', bonusPoints: 500 },
  { key: 'session_booked_first', name: 'Booked in', description: 'Booked your first session.', iconKey: 'headset', kind: 'achievement', bonusPoints: 25 },

  // ── Reputation ───────────────────────────────────────────────────────────
  { key: 'reference_given_first', name: 'Vouched', description: 'Gave someone a reference.', iconKey: 'quote', kind: 'achievement', bonusPoints: 50 },
  { key: 'reference_received_first', name: 'Vouched for', description: 'Received your first reference.', iconKey: 'quote', kind: 'achievement', bonusPoints: 25 },
  { key: 'first_company_review', name: 'On the record', description: 'Reviewed an employer.', iconKey: 'star', kind: 'achievement', bonusPoints: 25 },
  { key: 'feedback_first', name: 'Second pair of eyes', description: 'Reviewed someone else’s résumé.', iconKey: 'eye', kind: 'skill', bonusPoints: 50 },
  { key: 'mentor', name: 'Mentor', description: 'Reviewed five résumés for other people.', iconKey: 'eye', kind: 'skill', bonusPoints: 300 },

  // ── Streaks. Awarded by the streak roll, not by an action threshold. ──────
  { key: 'on_fire', name: 'On fire', description: 'Seven days in a row.', iconKey: 'flame', kind: 'tenure' },
  { key: 'streak_14', name: 'Two weeks straight', description: 'Fourteen days in a row.', iconKey: 'flame', kind: 'tenure' },
  { key: 'streak_30', name: 'A month of momentum', description: 'Thirty days in a row.', iconKey: 'flame', kind: 'tenure' },
  { key: 'streak_60', name: 'Sixty strong', description: 'Sixty days in a row.', iconKey: 'flame', kind: 'tenure' },
  { key: 'streak_90', name: 'Unbroken', description: 'Ninety days in a row.', iconKey: 'flame', kind: 'tenure' },
];

const BY_KEY: ReadonlyMap<string, BadgeDefinition> = new Map(BUILT_IN_BADGES.map((badge) => [badge.key, badge]));

export function builtInBadge(key: string): BadgeDefinition | null {
  return BY_KEY.get(key) ?? null;
}
