/**
 * A3 — a founder at business_stage:mvp sees mvp-tagged courses and can enrol
 * in one. The filter is the pure predicate; the enrol call is the existing LMS
 * `enrollInCourse`, which is what writes `course_enrollments`.
 */
import { describe, expect, it } from 'vitest';
import { BUSINESS_STAGES } from '@builderforce/creation-canvas-contract';
import { fakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';
import { courseEnrollments } from '../../infrastructure/database/schema';
import {
  coursesForFounderStage,
  enrolFounderInStageCourse,
  listAcademyCoursesForFounder,
  stagesOnListing,
} from './stageCourses';

const listing = (over: Record<string, unknown> = {}) => ({
  id: '11111111-1111-1111-1111-111111111111',
  tenantId: 9,
  slug: 'mvp-finance',
  name: 'MVP finance',
  summary: null,
  kind: 'course',
  tags: ['mvp'],
  body: { lmsCourseId: 42 },
  visibility: 'public',
  publishedAt: new Date('2026-10-01T00:00:00Z'),
  ...over,
});

describe('coursesForFounderStage', () => {
  const shelf = [
    { id: 'mvp', kind: 'course', tags: ['mvp', 'finance'], visibility: 'public', published: true },
    { id: 'both', kind: 'course', tags: ['growth', 'mvp'], visibility: 'public', published: true },
    { id: 'growth', kind: 'course', tags: ['growth'], visibility: 'public', published: true },
    { id: 'idea', kind: 'course', tags: ['idea'], visibility: 'public', published: true },
    { id: 'untagged', kind: 'course', tags: ['finance'], visibility: 'public', published: true },
    { id: 'freelancer', kind: 'course', tags: ['start', 'grow', 'exit'], visibility: 'public', published: true },
    { id: 'pack', kind: 'pack', tags: ['mvp'], visibility: 'public', published: true },
    { id: 'draft', kind: 'course', tags: ['mvp'], visibility: 'private', published: false },
  ];

  it('shows an mvp founder only mvp-tagged course listings', () => {
    expect(coursesForFounderStage(shelf, 'mvp').map((row) => row.id)).toEqual(['mvp', 'both']);
  });

  it('does not treat freelancer start|grow|exit as a business stage', () => {
    expect(stagesOnListing(['mvp', 'start', 'grow', 'exit', 'idea'])).toEqual(['idea', 'mvp']);
    expect(stagesOnListing([...BUSINESS_STAGES])).toEqual([...BUSINESS_STAGES]);
    expect(coursesForFounderStage(shelf, 'start')).toEqual([]);
    expect(coursesForFounderStage(shelf, 'grow')).toEqual([]);
  });

  it('hides a draft and a non-course even when the tag matches', () => {
    expect(coursesForFounderStage(shelf, 'mvp').map((row) => row.id)).not.toContain('draft');
    expect(coursesForFounderStage(shelf, 'mvp').map((row) => row.id)).not.toContain('pack');
  });
});

describe('listAcademyCoursesForFounder', () => {
  it('reads companies.business_stage and returns only the matching courses', async () => {
    const db = fakeDb([
      [{ businessStage: 'mvp' }],
      [
        listing({ id: 'mvp-course', tags: ['mvp'] }),
        listing({ id: 'growth-course', slug: 'growth', tags: ['growth'], body: { lmsCourseId: 7 } }),
        listing({ id: 'skill', kind: 'skill', tags: ['mvp'] }),
      ],
    ]);

    const result = await listAcademyCoursesForFounder(db as unknown as Db, 7, 3);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stage).toBe('mvp');
    expect(result.courses.map((row) => row.id)).toEqual(['mvp-course']);
  });

  it('shows nothing when the company stage is a freelancer token, not a BUSINESS_STAGES value', async () => {
    const db = fakeDb([[{ businessStage: 'start' }]]);
    const result = await listAcademyCoursesForFounder(db as unknown as Db, 7, 3);
    expect(result).toMatchObject({ ok: false, reason: 'no_business_stage' });
    expect(db.calls).toHaveLength(1);
  });
});

describe('enrolFounderInStageCourse', () => {
  it('calls enrollInCourse for an mvp-tagged course and not for any other stage', async () => {
    const db = fakeDb([
      [{ businessStage: 'mvp' }],
      [listing()],
      [{ id: 42, kind: 'course', status: 'published', objectId: 'obj-1' }],
      [],
    ]);

    const result = await enrolFounderInStageCourse(db as unknown as Db, {
      tenantId: 7,
      companyId: 3,
      listingId: '11111111-1111-1111-1111-111111111111',
      learnerRef: 'founder_1',
    });

    expect(result).toEqual({
      ok: true,
      stage: 'mvp',
      courseId: 42,
      enrollment: { courseId: 42, learnerRef: 'founder_1', status: 'enrolled' },
    });
    const insert = db.calls.find((call) => call.kind === 'insert');
    expect(insert?.args[0]).toBe(courseEnrollments);
    expect(insert?.payload).toMatchObject({
      tenantId: 9,
      courseId: 42,
      learnerRef: 'founder_1',
    });
    expect(insert?.chain).toContain('onConflictDoUpdate');
  });

  it('does not call enrollInCourse when the listing is tagged for a different stage', async () => {
    const db = fakeDb([
      [{ businessStage: 'mvp' }],
      [listing({ tags: ['growth'], body: { lmsCourseId: 99 } })],
    ]);

    const result = await enrolFounderInStageCourse(db as unknown as Db, {
      tenantId: 7,
      companyId: 3,
      listingId: '11111111-1111-1111-1111-111111111111',
      learnerRef: 'founder_1',
    });

    expect(result).toMatchObject({ ok: false, reason: 'wrong_stage' });
    expect(db.calls.some((call) => call.kind === 'insert')).toBe(false);
    expect(db.calls).toHaveLength(2);
  });
});
