/**
 * The catalog's invariants — the drift this design exists to make impossible.
 *
 * Three of these assert things a `switch`-based points engine could not assert at
 * all, which is the argument for the rules being data: an invariant over a table
 * is a loop, and an invariant over forty scattered case arms is a code review.
 */

import { describe, expect, it } from 'vitest';
import { BUILT_IN_BADGES, builtInBadge } from './badgeCatalog';
import {
  POINTS_CATALOG,
  POINT_ACTIONS,
  STREAK_MILESTONES,
  getPointsRule,
  ruleSource,
} from './pointsCatalog';
import { rollStreak, daysBetween, localDay } from './streakEngine';
import { fraudFlagsFor } from './fraudSignals';
import { pointsReference } from './pointsLedger';
import { facetsAllow, facetsFor } from './earnerFacets';

describe('points catalog', () => {
  it('has no duplicate action keys', () => {
    const keys = POINTS_CATALOG.map((rule) => rule.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('declares a rule for every action constant', () => {
    for (const action of Object.values(POINT_ACTIONS)) {
      expect(getPointsRule(action), `no rule for ${action}`).not.toBeNull();
    }
  });

  it('names only badges that exist — the drift a switch statement could not catch', () => {
    for (const rule of POINTS_CATALOG) {
      for (const tier of rule.badges ?? []) {
        expect(builtInBadge(tier.slug), `${rule.key} names missing badge ${tier.slug}`).not.toBeNull();
      }
    }
    for (const milestone of STREAK_MILESTONES) {
      expect(builtInBadge(milestone.badgeSlug), `milestone ${milestone.day} names missing badge`).not.toBeNull();
    }
  });

  it('never sets a daily cap below one award, which would make the rule unearnable', () => {
    for (const rule of POINTS_CATALOG) {
      if (rule.dailyCapPoints == null || rule.points === 0) continue;
      expect(rule.dailyCapPoints, `${rule.key} caps below a single award`).toBeGreaterThanOrEqual(rule.points);
    }
  });

  it('pays streak milestones through the milestone bonus, not twice via a badge', () => {
    // A streak badge that ALSO carried bonusPoints would pay the same milestone
    // twice — once from the roll, once from the award.
    for (const milestone of STREAK_MILESTONES) {
      expect(builtInBadge(milestone.badgeSlug)?.bonusPoints).toBeUndefined();
    }
  });

  it('has unique badge keys', () => {
    const keys = BUILT_IN_BADGES.map((badge) => badge.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('derives a source for every rule', () => {
    for (const rule of POINTS_CATALOG) expect(ruleSource(rule)).toBeTruthy();
  });
});

describe('streak engine', () => {
  const fresh = { currentStreak: 0, longestStreak: 0, lastActivityDate: null, lastBonusMilestone: 0 };

  it('starts at one on first activity', () => {
    const rolled = rollStreak(fresh, '2026-08-22');
    expect(rolled.next.currentStreak).toBe(1);
    expect(rolled.advanced).toBe(true);
  });

  it('does not advance twice in one day', () => {
    const state = { currentStreak: 3, longestStreak: 5, lastActivityDate: '2026-08-22', lastBonusMilestone: 0 };
    const rolled = rollStreak(state, '2026-08-22');
    expect(rolled.advanced).toBe(false);
    expect(rolled.next.currentStreak).toBe(3);
  });

  it('resets after a gap and keeps the longest', () => {
    const state = { currentStreak: 9, longestStreak: 9, lastActivityDate: '2026-08-01', lastBonusMilestone: 7 };
    const rolled = rollStreak(state, '2026-08-22');
    expect(rolled.next.currentStreak).toBe(1);
    expect(rolled.next.longestStreak).toBe(9);
    expect(rolled.next.lastBonusMilestone).toBe(0);
  });

  it('pays a milestone once per streak instance', () => {
    const day6 = { currentStreak: 6, longestStreak: 6, lastActivityDate: '2026-08-21', lastBonusMilestone: 0 };
    const crossed = rollStreak(day6, '2026-08-22');
    expect(crossed.milestone?.day).toBe(7);

    const day7 = crossed.next;
    const after = rollStreak(day7, '2026-08-23');
    expect(after.milestone).toBeNull();
  });

  it('treats a replayed earlier day as already counted rather than as a gap', () => {
    const state = { currentStreak: 4, longestStreak: 4, lastActivityDate: '2026-08-22', lastBonusMilestone: 0 };
    expect(rollStreak(state, '2026-08-20').next.currentStreak).toBe(4);
  });

  it('measures days across a month boundary', () => {
    expect(daysBetween('2026-08-31', '2026-09-01')).toBe(1);
    expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1); // 2026 is not a leap year
  });

  it('falls back to UTC for an unknown timezone instead of throwing', () => {
    const at = new Date('2026-08-22T23:30:00Z');
    expect(localDay(at, 'Not/AZone')).toBe('2026-08-22');
    expect(localDay(at, 'Australia/Sydney')).toBe('2026-08-23');
  });
});

describe('fraud rules', () => {
  it('flags a bulk close burst as high severity', () => {
    const flags = fraudFlagsFor({ peakClosesPerMinute: 25, closesLastHour: 25 });
    expect(flags.some((flag) => flag.kind === 'bulk_close_burst' && flag.severity === 'high')).toBe(true);
  });

  it('leaves ordinary activity alone', () => {
    expect(fraudFlagsFor({ peakClosesPerMinute: 3, closesLastHour: 12 })).toEqual([]);
  });
});

describe('ledger reference', () => {
  it('stays inside the reference column and keeps its scan prefix', () => {
    const long = 'x'.repeat(400);
    const ref = pointsReference('u'.repeat(36), POINT_ACTIONS.APPLICATION_SUBMITTED, long);
    expect(ref.length).toBeLessThanOrEqual(160);
    expect(ref.startsWith(`pts:${'u'.repeat(36)}:${POINT_ACTIONS.APPLICATION_SUBMITTED}:`)).toBe(true);
  });

  it('does not collapse two different long refs onto one reference', () => {
    const user = 'u'.repeat(36);
    const a = pointsReference(user, POINT_ACTIONS.APPLICATION_SUBMITTED, `${'x'.repeat(200)}a`);
    const b = pointsReference(user, POINT_ACTIONS.APPLICATION_SUBMITTED, `${'x'.repeat(200)}b`);
    expect(a).not.toBe(b);
  });
});

describe('earner facets', () => {
  const none = { accountType: 'standard', availableForHire: false, hasWorkspaceSeat: false, partyRoles: [] };

  it('lets a builder who opted in to for-hire hold BOTH facets', () => {
    const facets = facetsFor({ ...none, availableForHire: true, hasWorkspaceSeat: true });
    expect(facets.has('talent')).toBe(true);
    expect(facets.has('employer')).toBe(true);
  });

  it('pays unrestricted rules to somebody with no facet at all', () => {
    expect(facetsAllow([], facetsFor(none))).toBe(true);
  });

  it('refuses a recruiter rule to a non-recruiter', () => {
    expect(facetsAllow(['recruiter'], facetsFor(none))).toBe(false);
  });
});
