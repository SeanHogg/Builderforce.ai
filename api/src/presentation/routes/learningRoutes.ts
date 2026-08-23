/**
 * Learning paths, prerequisites and enrolment — mounted under /api/learning
 *
 *   GET    /paths                          → every path, with its course count
 *   POST   /paths                          → create one (manager)
 *   GET    /paths/:id                      → one path with its courses, in order
 *   PUT    /paths/:id/courses              → replace the whole sequence (manager)
 *   PATCH  /paths/:id/status               → publish or retire (manager)
 *   POST   /paths/:id/enroll               → enrol; a manager may enrol somebody else
 *   GET    /paths/:id/progress             → how far a learner has got
 *   GET    /courses                        → the courses a path can be built from
 *   GET    /courses/gates                  → the catalogue with this learner's locks
 *   GET    /courses/:id/paths              → which paths sequence this course
 *   GET    /courses/:id/prerequisites      → what a course requires
 *   POST   /courses/:id/prerequisites      → add one (manager)
 *   DELETE /courses/:id/prerequisites/:pid → remove one (manager)
 *   POST   /courses/:id/complete           → mark a course finished; moves its paths
 *
 * ── WHO A LEARNER IS ─────────────────────────────────────────────────────────
 * The authenticated user, always — except that a MANAGER may name somebody else
 * with `?learner=`. That one rule is written once, in {@link learnerFor}, because
 * getting it wrong in either direction is serious: defaulting to a query parameter
 * would let any signed-in person read a colleague's transcript, and refusing it
 * outright would leave a training manager unable to see whether the team has done
 * the compliance course.
 *
 * ── WHY `PUT /courses` AND NOT THREE EDGE ENDPOINTS ──────────────────────────
 * `setPathCourses` takes the whole sequence; see its docstring. The route mirrors
 * that rather than offering add/remove/move, so two people reordering the same
 * path cannot interleave into an order neither of them chose.
 */

import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import type { Env, HonoEnv } from '../../env';
import type { DbHandle as Db } from '../../application/shared/dbHandle';
import {
  createPath, getPath, listCourses, listPaths, loadCourse, pathsContaining,
  setPathCourses, setPathStatus, type CourseStatus,
} from '../../application/learning/learningPaths';
import {
  addPrerequisiteByCourseId, gatesForLearner, prerequisitesOfCourseId,
  removePrerequisiteByCourseId,
} from '../../application/learning/coursePrerequisites';
import { completeCourse, enrollInPath, pathProgressFor } from '../../application/learning/pathProgress';

const STATUSES: readonly CourseStatus[] = ['draft', 'published', 'retired'];
const isStatus = (value: unknown): value is CourseStatus =>
  typeof value === 'string' && (STATUSES as readonly string[]).includes(value);

/** A positive integer path parameter, or null. `Number('')` is 0 and
 *  `Number('3x')` is NaN, and both would otherwise reach a query. */
function idParam(raw: string | undefined): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function createLearningRoutes(db: Db): Hono<HonoEnv> {
  const r = new Hono<HonoEnv>();
  const manager = requireRole(TenantRole.MANAGER);

  r.use('*', authMiddleware);

  const ctx = (c: { env: unknown; get: (key: string) => unknown }) => ({
    env: c.env as Env,
    tenantId: c.get('tenantId') as number,
    userId: c.get('userId') as string,
    role: c.get('role') as string,
  });

  /**
   * Whose transcript this call is about.
   *
   * Returns null when a non-manager asks about somebody else, which every caller
   * turns into a 403 — a distinct answer from "that learner has no progress",
   * which would let the parameter be used to probe who exists.
   */
  const learnerFor = (
    c: { env: unknown; get: (key: string) => unknown },
    requested: string | undefined,
  ): string | null => {
    const { userId, role } = ctx(c);
    const asked = (requested ?? '').trim();
    if (!asked || asked === userId) return userId;
    return role === TenantRole.MANAGER || role === TenantRole.OWNER ? asked : null;
  };

  // ── Paths ─────────────────────────────────────────────────────────────────

  r.get('/paths', async (c) => {
    const { env, tenantId } = ctx(c);
    return c.json({ paths: await listPaths(db, env, tenantId) });
  });

  r.post('/paths', manager, async (c) => {
    const { env, tenantId, userId } = ctx(c);
    const body = await c.req.json().catch(() => ({})) as {
      slug?: string; title?: string; summary?: string; level?: string;
    };

    const title = (body.title ?? '').trim();
    if (!title) return c.json({ error: 'A path needs a title.' }, 400);

    const result = await createPath(db, env, {
      tenantId,
      // Derived from the title when absent, because a slug is a URL detail an
      // author should not have to think about — but honoured when given, because
      // an existing link is a promise.
      slug: (body.slug ?? '').trim() || title,
      title,
      summary: body.summary ?? null,
      level: body.level ?? null,
      authorRef: userId,
    });
    if (!result.ok) return c.json({ error: result.detail, reason: result.reason }, 409);
    return c.json({ path: result.path }, 201);
  });

  r.get('/paths/:id', async (c) => {
    const { env, tenantId } = ctx(c);
    const id = idParam(c.req.param('id'));
    if (id === null) return c.json({ error: 'Unknown path.' }, 404);

    const path = await getPath(db, env, tenantId, id);
    return path ? c.json({ path }) : c.json({ error: 'Unknown path.' }, 404);
  });

  r.put('/paths/:id/courses', manager, async (c) => {
    const { env, tenantId } = ctx(c);
    const id = idParam(c.req.param('id'));
    if (id === null) return c.json({ error: 'Unknown path.' }, 404);

    const body = await c.req.json().catch(() => ({})) as { courseIds?: unknown };
    if (!Array.isArray(body.courseIds) || body.courseIds.some((v) => !Number.isInteger(v))) {
      return c.json({ error: 'Send courseIds as an array of course ids, in the order they should be taken.' }, 400);
    }

    const result = await setPathCourses(db, env, tenantId, id, body.courseIds as number[]);
    if (!result.ok) return c.json({ error: result.detail, reason: result.reason }, 409);
    return c.json({ updated: true, count: result.count });
  });

  r.patch('/paths/:id/status', manager, async (c) => {
    const { env, tenantId } = ctx(c);
    const id = idParam(c.req.param('id'));
    if (id === null) return c.json({ error: 'Unknown path.' }, 404);

    const body = await c.req.json().catch(() => ({})) as { status?: unknown };
    if (!isStatus(body.status)) {
      return c.json({ error: `Status must be one of: ${STATUSES.join(', ')}.` }, 400);
    }

    const path = await setPathStatus(db, env, tenantId, id, body.status);
    return path ? c.json({ path }) : c.json({ error: 'Unknown path.' }, 404);
  });

  r.post('/paths/:id/enroll', async (c) => {
    const { env, tenantId } = ctx(c);
    const id = idParam(c.req.param('id'));
    if (id === null) return c.json({ error: 'Unknown path.' }, 404);

    const body = await c.req.json().catch(() => ({})) as { learner?: string; dueAt?: string };
    const learnerRef = learnerFor(c, body.learner);
    if (!learnerRef) return c.json({ error: 'Only a manager can enrol somebody else.' }, 403);

    const due = body.dueAt ? Date.parse(body.dueAt) : NaN;
    const result = await enrollInPath(db, env, {
      tenantId, pathId: id, learnerRef,
      dueAt: Number.isFinite(due) ? new Date(due) : null,
    });
    if (!result.ok) {
      return c.json({ error: result.detail, reason: result.reason }, result.reason === 'not_a_path' ? 404 : 409);
    }
    return c.json({ progress: result.progress }, 201);
  });

  r.get('/paths/:id/progress', async (c) => {
    const { tenantId } = ctx(c);
    const id = idParam(c.req.param('id'));
    if (id === null) return c.json({ error: 'Unknown path.' }, 404);

    const learnerRef = learnerFor(c, c.req.query('learner'));
    if (!learnerRef) return c.json({ error: 'Only a manager can read somebody else’s progress.' }, 403);
    return c.json({ progress: await pathProgressFor(db, tenantId, id, learnerRef) });
  });

  // ── Courses ───────────────────────────────────────────────────────────────
  // `/courses/gates` is declared before every `/courses/:id` route: a static
  // segment registered after a wildcard at the same depth is unreachable.

  r.get('/courses', async (c) => {
    const { tenantId } = ctx(c);
    return c.json({ courses: await listCourses(db, tenantId) });
  });

  r.get('/courses/gates', async (c) => {
    const { env, tenantId } = ctx(c);
    const learnerRef = learnerFor(c, c.req.query('learner'));
    if (!learnerRef) return c.json({ error: 'Only a manager can read somebody else’s progress.' }, 403);
    return c.json({ gates: await gatesForLearner(db, env, tenantId, learnerRef) });
  });

  // The reverse edge of a path's `contains`. A course page needs it to say "part
  // of 3 paths", and it is the same edge read the other way rather than a second
  // stored fact — which is the property that makes it impossible to disagree with
  // the path's own member list.
  r.get('/courses/:id/paths', async (c) => {
    const { env, tenantId } = ctx(c);
    const id = idParam(c.req.param('id'));
    if (id === null) return c.json({ error: 'Unknown course.' }, 404);

    const course = await loadCourse(db, tenantId, id);
    if (!course || !course.objectId) return c.json({ error: 'Unknown course.' }, 404);
    return c.json({ paths: await pathsContaining(db, env, tenantId, course.objectId) });
  });

  r.get('/courses/:id/prerequisites', async (c) => {
    const { env, tenantId } = ctx(c);
    const id = idParam(c.req.param('id'));
    if (id === null) return c.json({ error: 'Unknown course.' }, 404);

    const prerequisites = await prerequisitesOfCourseId(db, env, tenantId, id);
    return prerequisites ? c.json({ prerequisites }) : c.json({ error: 'Unknown course.' }, 404);
  });

  r.post('/courses/:id/prerequisites', manager, async (c) => {
    const { env, tenantId } = ctx(c);
    const id = idParam(c.req.param('id'));
    if (id === null) return c.json({ error: 'Unknown course.' }, 404);

    const body = await c.req.json().catch(() => ({})) as { prerequisiteId?: unknown };
    if (!Number.isInteger(body.prerequisiteId)) {
      return c.json({ error: 'Send prerequisiteId — the course that must be completed first.' }, 400);
    }

    const result = await addPrerequisiteByCourseId(db, env, tenantId, id, body.prerequisiteId as number);
    if (!result.ok) {
      // A cycle is the caller's mistake and a 409; an id that is not a course
      // here is a 404 about the thing they named.
      return c.json({ error: result.detail, reason: result.reason }, result.reason === 'would_cycle' ? 409 : 404);
    }
    return c.json({ linked: true }, 201);
  });

  r.delete('/courses/:id/prerequisites/:prerequisiteId', manager, async (c) => {
    const { env, tenantId } = ctx(c);
    const id = idParam(c.req.param('id'));
    const prerequisiteId = idParam(c.req.param('prerequisiteId'));
    if (id === null || prerequisiteId === null) return c.json({ error: 'Unknown course.' }, 404);

    const removed = await removePrerequisiteByCourseId(db, env, tenantId, id, prerequisiteId);
    return removed ? c.json({ removed: true }) : c.json({ error: 'That prerequisite is not set.' }, 404);
  });

  r.post('/courses/:id/complete', async (c) => {
    const { env, tenantId } = ctx(c);
    const id = idParam(c.req.param('id'));
    if (id === null) return c.json({ error: 'Unknown course.' }, 404);

    const body = await c.req.json().catch(() => ({})) as { learner?: string };
    const learnerRef = learnerFor(c, body.learner);
    if (!learnerRef) return c.json({ error: 'Only a manager can complete a course for somebody else.' }, 403);

    const { pathIds } = await completeCourse(db, env, tenantId, id, learnerRef);
    return c.json({ completed: true, pathIds });
  });

  return r;
}
