import { describe, expect, it } from 'vitest';
import {
  founderSeeksMentorship,
  isAdvisorsTalentFilter,
  isTalentFamilyParam,
  rankTalentForFounder,
} from './rankAdvisors';

describe('isTalentFamilyParam', () => {
  it('treats category=advisors as the talent family, not a new listing kind', () => {
    expect(isTalentFamilyParam('talent')).toBe(true);
    expect(isTalentFamilyParam('advisors')).toBe(true);
    expect(isTalentFamilyParam('Talent')).toBe(true);
    expect(isTalentFamilyParam('course')).toBe(false);
    expect(isTalentFamilyParam('pack')).toBe(false);
    expect(isAdvisorsTalentFilter('advisors')).toBe(true);
    expect(isAdvisorsTalentFilter('talent')).toBe(false);
  });
});

describe('founderSeeksMentorship', () => {
  it('matches seeking:mentorship and advisors without a volunteer table', () => {
    expect(founderSeeksMentorship('mentorship')).toBe(true);
    expect(founderSeeksMentorship('advisors')).toBe(true);
    expect(founderSeeksMentorship('customers')).toBe(false);
  });
});

describe('rankTalentForFounder', () => {
  it('keeps Free (price 0) in the ranked set for seeking:mentorship + mvp', () => {
    const ranked = rankTalentForFounder(
      [
        { userId: 'paid', bookable: true, hourlyRateCents: 15000, skills: ['growth'], rating: 5 },
        { userId: 'free', bookable: true, hourlyRateCents: 0, skills: ['mvp', 'mentorship'], rating: 4 },
        { userId: 'unbound', bookable: false, hourlyRateCents: 20000, skills: ['mvp'], rating: 5 },
      ],
      { seeking: 'mentorship', businessStage: 'mvp' },
    );
    expect(ranked.map((row) => row.userId)).toEqual(['free', 'paid', 'unbound']);
    expect(ranked.some((row) => row.hourlyRateCents === 0)).toBe(true);
  });

  it('does not drop a Free bookable listing when others have higher ratings', () => {
    const ranked = rankTalentForFounder(
      [
        { userId: 'star', bookable: true, hourlyRateCents: 25000, rating: 5, skills: [] },
        { userId: 'free', bookable: true, hourlyRateCents: 0, rating: 1, skills: [] },
      ],
      { seeking: 'mentorship', businessStage: 'mvp' },
    );
    expect(ranked.map((row) => row.userId)).toContain('free');
    expect(ranked).toHaveLength(2);
  });

  it('never invents an advisor listing kind — bookable talent is the bind', () => {
    const ranked = rankTalentForFounder([
      { userId: 'a', bookable: true, hourlyRateCents: 0 },
      { userId: 'b', bookable: false, hourlyRateCents: 0 },
    ]);
    expect(ranked[0].userId).toBe('a');
  });
});
