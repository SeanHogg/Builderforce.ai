import { describe, expect, it } from 'vitest';
import { summarisePath, type EnrollmentStatus } from './pathProgress';

const members = (...statuses: Array<[number, EnrollmentStatus]>) =>
  statuses.map(([courseId, status]) => ({ courseId, status }));

describe('summarisePath', () => {
  it('reports an EMPTY path as 0%, not 100%', () => {
    // Dividing by its own zero members is how an empty curriculum certifies
    // everybody who enrols in it.
    const progress = summarisePath(1, 'user_7', []);
    expect(progress.percent).toBe(0);
    expect(progress.status).toBe('enrolled');
    expect(progress.nextCourseId).toBeNull();
  });

  it('is complete only when EVERY member is', () => {
    expect(summarisePath(1, 'u', members([10, 'completed'], [11, 'completed'])).status).toBe('completed');
    expect(summarisePath(1, 'u', members([10, 'completed'], [11, 'enrolled'])).status).toBe('in_progress');
  });

  it('rounds the percentage to a whole number', () => {
    const progress = summarisePath(1, 'u', members(
      [10, 'completed'], [11, 'enrolled'], [12, 'enrolled'],
    ));
    expect(progress.percent).toBe(33);
    expect(progress.completedCourses).toBe(1);
    expect(progress.totalCourses).toBe(3);
  });

  it('points nextCourseId at the first UNFINISHED member, not the first member', () => {
    const progress = summarisePath(1, 'u', members(
      [10, 'completed'], [11, 'completed'], [12, 'in_progress'], [13, 'enrolled'],
    ));
    expect(progress.nextCourseId).toBe(12);
  });

  it('has no next course once everything is done', () => {
    expect(summarisePath(1, 'u', members([10, 'completed'])).nextCourseId).toBeNull();
  });

  it('counts a started member as in_progress even before anything is completed', () => {
    expect(summarisePath(1, 'u', members([10, 'in_progress'], [11, 'enrolled'])).status).toBe('in_progress');
  });

  it('stays enrolled while nothing has been opened', () => {
    expect(summarisePath(1, 'u', members([10, 'enrolled'], [11, 'enrolled'])).status).toBe('enrolled');
  });

  it('does not count a withdrawn or expired member as progress', () => {
    const progress = summarisePath(1, 'u', members([10, 'withdrawn'], [11, 'expired']));
    expect(progress.percent).toBe(0);
    expect(progress.status).toBe('enrolled');
    // Still the next thing to deal with: a withdrawn member is unfinished.
    expect(progress.nextCourseId).toBe(10);
  });

  it('carries the path and learner it was asked about', () => {
    const progress = summarisePath(42, 'user_9', members([10, 'completed']));
    expect(progress.pathId).toBe(42);
    expect(progress.learnerRef).toBe('user_9');
  });
});
