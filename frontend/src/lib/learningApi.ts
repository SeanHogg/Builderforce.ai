import { apiRequest, getApiBaseUrl } from './apiClient';

/**
 * Learning paths, prerequisites, enrolment — and the workspace's LRS keys.
 *
 * Server counterpart: `api/src/presentation/routes/learningRoutes.ts` and
 * `lrsCredentialRoutes.ts`, both mounted on `/api/learning`.
 *
 * ── A PATH IS A COURSE ───────────────────────────────────────────────────────
 * Which is why `LearningCourse` describes both and `kind` tells them apart. The
 * server stores a path as a `courses` row so it inherits enrolment, certificates
 * and checkout for free (migration 1112); a client that modelled them as two
 * unrelated things would immediately need two of everything again.
 *
 * ── THE xAPI ENDPOINT IS NOT HERE ────────────────────────────────────────────
 * `/xapi/*` is a standard spoken by third-party authoring tools over Basic auth,
 * not by this application. What IS here is the key management around it: minting
 * the credential a customer pastes into Storyline, and pointing this LRS at a
 * corporate one to forward to.
 *
 * Rides the ONE transport (`apiRequest`) for the reasons documented in
 * `apiClient.ts`.
 */

const LEARNING = '/api/learning';
const json = { 'Content-Type': 'application/json' };

/** A `courses` row is either a course or a path over courses. */
export type CourseKind = 'course' | 'path';

/** 'draft' — invisible to learners. 'published' — enrollable. 'retired' — kept
 *  for the people already in it. */
export type CourseStatus = 'draft' | 'published' | 'retired';

export interface LearningCourse {
  id: number;
  objectId: string | null;
  kind: CourseKind;
  slug: string;
  title: string;
  summary: string | null;
  level: string | null;
  durationMin: number | null;
  status: CourseStatus;
  priceCents: number | null;
  currency: string | null;
  publishedAt: string | null;
}

export interface LearningPathSummary extends LearningCourse {
  courseCount: number;
}

export interface LearningPathDetail extends LearningCourse {
  courses: LearningCourse[];
}

export type EnrollmentStatus = 'enrolled' | 'in_progress' | 'completed' | 'expired' | 'withdrawn';

export interface PathProgress {
  pathId: number;
  learnerRef: string;
  status: EnrollmentStatus;
  /** Whole percent, 0–100. An EMPTY path is 0, never 100. */
  percent: number;
  completedCourses: number;
  totalCourses: number;
  /** The first course the learner has not completed. */
  nextCourseId: number | null;
}

/** A course and whether this learner may start it. `blockedBy` names WHICH
 *  prerequisite is outstanding, so the UI never has to say only "locked". */
export interface CourseGate {
  courseId: number;
  objectId: string;
  title: string;
  unlocked: boolean;
  blockedBy: Array<{ courseId: number; title: string }>;
}

export interface CoursePrerequisite {
  courseId: number;
  objectId: string;
  title: string;
}

/** One path a course belongs to. `refId` is the path's `courses.id`. */
export interface CourseInPath {
  objectId: string;
  refId: string;
  title: string | null;
}

/** 'inbound' — a key we issued, that an authoring tool sends us.
 *  'outbound' — an external LRS we forward statements to. */
export type LrsDirection = 'inbound' | 'outbound';

export interface LrsCredential {
  id: number;
  direction: LrsDirection;
  /** The Basic username. Public by construction; its partner is never readable. */
  key: string;
  label: string;
  endpoint: string | null;
  status: string;
  lastUsedAt: string | null;
  createdAt: string;
}

export const learningApi = {
  paths: (): Promise<{ paths: LearningPathSummary[] }> =>
    apiRequest(`${LEARNING}/paths`),

  path: (id: number): Promise<{ path: LearningPathDetail }> =>
    apiRequest(`${LEARNING}/paths/${id}`),

  createPath: (input: { title: string; slug?: string; summary?: string; level?: string }):
  Promise<{ path: LearningPathSummary }> =>
    apiRequest(`${LEARNING}/paths`, { method: 'POST', headers: json, body: JSON.stringify(input) }),

  /** Replaces the WHOLE sequence, in the order the author dragged it into. Three
   *  add/remove/move calls is how two editors produce an order neither chose. */
  setPathCourses: (id: number, courseIds: number[]): Promise<{ updated: true; count: number }> =>
    apiRequest(`${LEARNING}/paths/${id}/courses`, {
      method: 'PUT', headers: json, body: JSON.stringify({ courseIds }),
    }),

  setPathStatus: (id: number, status: CourseStatus): Promise<{ path: LearningCourse }> =>
    apiRequest(`${LEARNING}/paths/${id}/status`, {
      method: 'PATCH', headers: json, body: JSON.stringify({ status }),
    }),

  /** Enrols the signed-in person unless `learner` is given, which only a manager
   *  may do. Enrols in the path AND every course it sequences. */
  enroll: (id: number, input: { learner?: string; dueAt?: string } = {}):
  Promise<{ progress: PathProgress }> =>
    apiRequest(`${LEARNING}/paths/${id}/enroll`, {
      method: 'POST', headers: json, body: JSON.stringify(input),
    }),

  progress: (id: number, learner?: string): Promise<{ progress: PathProgress }> =>
    apiRequest(`${LEARNING}/paths/${id}/progress${learner ? `?learner=${encodeURIComponent(learner)}` : ''}`),

  courses: (): Promise<{ courses: LearningCourse[] }> =>
    apiRequest(`${LEARNING}/courses`),

  /** The whole catalogue with this learner's locks, in ONE call — asking per card
   *  is the N+1 the server's `gateCourses` exists to avoid. */
  gates: (learner?: string): Promise<{ gates: CourseGate[] }> =>
    apiRequest(`${LEARNING}/courses/gates${learner ? `?learner=${encodeURIComponent(learner)}` : ''}`),

  /** Which paths sequence this course — the SAME edge as a path's member list,
   *  read the other way, so the two can never disagree. */
  pathsFor: (courseId: number): Promise<{ paths: CourseInPath[] }> =>
    apiRequest(`${LEARNING}/courses/${courseId}/paths`),

  prerequisites: (courseId: number): Promise<{ prerequisites: CoursePrerequisite[] }> =>
    apiRequest(`${LEARNING}/courses/${courseId}/prerequisites`),

  addPrerequisite: (courseId: number, prerequisiteId: number): Promise<{ linked: true }> =>
    apiRequest(`${LEARNING}/courses/${courseId}/prerequisites`, {
      method: 'POST', headers: json, body: JSON.stringify({ prerequisiteId }),
    }),

  removePrerequisite: (courseId: number, prerequisiteId: number): Promise<{ removed: true }> =>
    apiRequest(`${LEARNING}/courses/${courseId}/prerequisites/${prerequisiteId}`, { method: 'DELETE' }),

  completeCourse: (courseId: number, learner?: string): Promise<{ completed: true; pathIds: number[] }> =>
    apiRequest(`${LEARNING}/courses/${courseId}/complete`, {
      method: 'POST', headers: json, body: JSON.stringify(learner ? { learner } : {}),
    }),

  lrsCredentials: (): Promise<{ credentials: LrsCredential[] }> =>
    apiRequest(`${LEARNING}/lrs/credentials`),

  /** The secret comes back ONCE. There is no read path that returns it again —
   *  it is sealed on the way in — so a caller that discards it cannot recover it. */
  issueLrsCredential: (label: string): Promise<{ credential: LrsCredential; secret: string }> =>
    apiRequest(`${LEARNING}/lrs/credentials`, {
      method: 'POST', headers: json, body: JSON.stringify({ label }),
    }),

  addLrsTarget: (input: { label: string; endpoint: string; key: string; secret: string }):
  Promise<{ credential: LrsCredential }> =>
    apiRequest(`${LEARNING}/lrs/targets`, {
      method: 'POST', headers: json, body: JSON.stringify(input),
    }),

  revokeLrsCredential: (id: number): Promise<{ revoked: true }> =>
    apiRequest(`${LEARNING}/lrs/credentials/${id}`, { method: 'DELETE' }),
};

/** The endpoint a customer pastes into an authoring tool. Read from the SAME
 *  base the transport uses rather than hard-coded, so a self-hosted deployment
 *  shows its own address instead of ours. */
export function xapiEndpoint(): string {
  return `${getApiBaseUrl().replace(/\/+$/, '')}/xapi`;
}
