/**
 * Schema — People & HR, owned by **HR** (PRD 20 §3).
 *
 * Root entity `employment`. 74 source tables in → 23 out: 38 absorbed by the
 * kernel, 1 by the canvas, 10 merged into a sibling. hired.video contributed 18
 * of the 23.
 *
 * WHAT COLLAPSED ON THE WAY IN. `course_enrollments` and
 * `learning_path_enrollments` were one table under two names — the second's
 * columns are a strict subset of the first's (§3.3) — so there is one
 * `course_enrollments` with a nullable `path_ref`. `learning_path_courses` was
 * `path_id` + `course_id` + `display_order` + `is_required`: an ordered join row,
 * which is a kernel `relations` row with a `position`, not DDL. Every pulse,
 * check-in and engagement survey is a `question_sets` + `responses` pair.
 *
 * NO SIBLING IMPORTS beyond the kernel — see the header of `hiring.ts`.
 *
 * See migration 0420.
 */

import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { objects } from './kernel';

// ---------------------------------------------------------------------------
// Employment
// ---------------------------------------------------------------------------

/** A person employed by a tenant. The person is a `party_roles` row holding the
 *  `employee` role; this is the employment relationship itself, which can end
 *  and begin again without the person changing. */
export const peopleEmployees = pgTable('people_employees', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id').notNull(),
  objectId:     uuid('object_id').references(() => objects.id, { onDelete: 'cascade' }),
  partyRef:     varchar('party_ref', { length: 64 }).notNull(),
  employeeCode: varchar('employee_code', { length: 48 }),
  title:        varchar('title', { length: 200 }),
  department:   varchar('department', { length: 120 }),
  managerRef:   varchar('manager_ref', { length: 64 }),
  location:     varchar('location', { length: 120 }),
  /** 'full_time' | 'part_time' | 'contract' | 'intern'. */
  employment:   varchar('employment', { length: 24 }).notNull().default('full_time'),
  /** 'active' | 'on_leave' | 'notice' | 'terminated'. */
  status:       varchar('status', { length: 16 }).notNull().default('active'),
  startedAt:    timestamp('started_at'),
  endedAt:      timestamp('ended_at'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_people_employees_party').on(t.tenantId, t.partyRef),
  index('idx_people_employees_manager').on(t.tenantId, t.managerRef, t.status),
]);

/** An immutable record of a change to an employment — a promotion, a transfer, a
 *  compensation change. The employee row carries current state; this carries how
 *  it got there, which is what an HR audit reads. */
export const hrEmploymentRecords = pgTable('hr_employment_records', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull(),
  employeeId: integer('employee_id').references(() => peopleEmployees.id, { onDelete: 'cascade' }),
  /** 'hire' | 'promotion' | 'transfer' | 'comp_change' | 'leave' | 'termination'. */
  kind:       varchar('kind', { length: 32 }).notNull(),
  effectiveAt: timestamp('effective_at').notNull(),
  previous:   jsonb('previous'),
  next:       jsonb('next'),
  reason:     text('reason'),
  approvedBy: varchar('approved_by', { length: 64 }),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_hr_employment_records_employee').on(t.employeeId, t.effectiveAt),
]);

/** Who to call. Deliberately its own table rather than columns on the employee:
 *  it is the one field set with a genuinely different access policy. */
export const hrEmergencyContacts = pgTable('hr_emergency_contacts', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id').notNull(),
  employeeId:   integer('employee_id').references(() => peopleEmployees.id, { onDelete: 'cascade' }),
  name:         varchar('name', { length: 200 }).notNull(),
  relationship: varchar('relationship', { length: 64 }),
  phone:        varchar('phone', { length: 40 }),
  email:        varchar('email', { length: 320 }),
  isPrimary:    boolean('is_primary').notNull().default(false),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_hr_emergency_contacts_employee').on(t.employeeId, t.isPrimary),
]);

/** The org's own tenant record within People — the employing entity, when a
 *  group runs several. */
export const peopleTenants = pgTable('people_tenants', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  legalName:   varchar('legal_name', { length: 255 }).notNull(),
  country:     varchar('country', { length: 2 }),
  payrollRef:  varchar('payroll_ref', { length: 96 }),
  fiscalStart: integer('fiscal_start').notNull().default(1),
  policies:    jsonb('policies'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_people_tenants_legal').on(t.tenantId, t.legalName),
]);

/** A headcount plan — how many of what, by when, at what cost. */
export const peopleHeadcountPlans = pgTable('people_headcount_plans', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  name:        varchar('name', { length: 200 }).notNull(),
  period:      varchar('period', { length: 24 }).notNull(),
  department:  varchar('department', { length: 120 }),
  plannedHeads: integer('planned_heads').notNull().default(0),
  actualHeads: integer('actual_heads').notNull().default(0),
  budget:      numeric('budget', { precision: 16, scale: 2 }),
  currency:    varchar('currency', { length: 8 }).notNull().default('USD'),
  status:      varchar('status', { length: 16 }).notNull().default('draft'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_people_headcount_plans_period').on(t.tenantId, t.name, t.period),
]);

/** What one hiring or attrition event does to the plan. The bridge People shares
 *  with Finance, which is why it is a row and not a recomputation. */
export const headcountImpacts = pgTable('headcount_impacts', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull(),
  planId:     integer('plan_id').references(() => peopleHeadcountPlans.id, { onDelete: 'cascade' }),
  /** 'hire' | 'attrition' | 'transfer' | 'freeze'. */
  kind:       varchar('kind', { length: 24 }).notNull(),
  headDelta:  integer('head_delta').notNull(),
  costDelta:  numeric('cost_delta', { precision: 16, scale: 2 }),
  effectiveAt: timestamp('effective_at').notNull(),
  note:       text('note'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('idx_headcount_impacts_plan').on(t.planId, t.effectiveAt),
]);

/** An outcome an objective is measured by, at the person level. The objective
 *  itself is a kernel `work_items` row of kind `objective`; this is the People
 *  reading of it, which HR owns and Delivery does not. */
export const peopleObjectiveOutcomes = pgTable('people_objective_outcomes', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  employeeId:  integer('employee_id').references(() => peopleEmployees.id, { onDelete: 'cascade' }),
  workItemRef: varchar('work_item_ref', { length: 64 }),
  period:      varchar('period', { length: 24 }).notNull(),
  rating:      numeric('rating', { precision: 4, scale: 2 }),
  narrative:   text('narrative'),
  calibratedBy: varchar('calibrated_by', { length: 64 }),
  finalisedAt: timestamp('finalised_at'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_people_objective_outcomes_period').on(t.employeeId, t.workItemRef, t.period),
]);

/** An HR automation trigger — what event starts which flow. */
export const peopleWorkflowTriggers = pgTable('people_workflow_triggers', {
  id:         serial('id').primaryKey(),
  tenantId:   integer('tenant_id').notNull(),
  name:       varchar('name', { length: 200 }).notNull(),
  /** 'hire' | 'anniversary' | 'termination' | 'leave_start' | 'review_due'. */
  event:      varchar('event', { length: 48 }).notNull(),
  conditions: jsonb('conditions'),
  actions:    jsonb('actions').notNull().default('[]'),
  enabled:    boolean('enabled').notNull().default(true),
  lastFiredAt: timestamp('last_fired_at'),
  createdAt:  timestamp('created_at').notNull().defaultNow(),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_people_workflow_triggers_name').on(t.tenantId, t.name),
]);

/** A dimension the org's health is scored on. The scores themselves are
 *  `responses` to a `question_sets` pulse; this is what a dimension MEANS, which
 *  is stable and shared across every pulse that uses it. */
export const healthDimensions = pgTable('health_dimensions', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  key:         varchar('key', { length: 64 }).notNull(),
  label:       varchar('label', { length: 200 }).notNull(),
  description: text('description'),
  weight:      numeric('weight', { precision: 5, scale: 2 }).notNull().default('1'),
  benchmark:   numeric('benchmark', { precision: 5, scale: 2 }),
  position:    integer('position').notNull().default(0),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_health_dimensions_key').on(t.tenantId, t.key),
]);

/** A skill or behaviour the org expects, with its levels. */
export const competencies = pgTable('competencies', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  key:         varchar('key', { length: 64 }).notNull(),
  name:        varchar('name', { length: 200 }).notNull(),
  category:    varchar('category', { length: 64 }),
  description: text('description'),
  /** Level definitions, never queried independently — JSON, per §3.1's thin rule. */
  levels:      jsonb('levels'),
  roleFamilies: jsonb('role_families'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_competencies_key').on(t.tenantId, t.key),
]);

/** A badge a person can hold. The award is a `party_roles`-adjacent grant row
 *  (`user_badges`, Identity); this is the badge's definition. */
export const badges = pgTable('badges', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id'),
  key:         varchar('key', { length: 64 }).notNull(),
  name:        varchar('name', { length: 200 }).notNull(),
  description: text('description'),
  iconKey:     varchar('icon_key', { length: 96 }),
  /** 'skill' | 'tenure' | 'achievement' | 'certification'. */
  kind:        varchar('kind', { length: 32 }).notNull().default('achievement'),
  criteria:    jsonb('criteria'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_badges_key').on(t.tenantId, t.key),
]);

// ---------------------------------------------------------------------------
// Learning
// ---------------------------------------------------------------------------

/** A course. Its lessons and modules are children; its enrolments are below; its
 *  place in a learning path is a kernel `relations` row with a position, which
 *  is what `learning_path_courses` collapsed into (§3.3). */
export const courses = pgTable('courses', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id'),
  objectId:    uuid('object_id').references(() => objects.id, { onDelete: 'cascade' }),
  /** 'course' — modules and lessons — or 'path', an ordered sequence of OTHER
   *  courses (1112). One table because the columns are identical and because a
   *  path that is a course row is enrollable, certifiable and sellable through
   *  `course_enrollments` / `course_certificates` / `course_checkouts` without
   *  three more tables beside them. What it contains is an edge, not a column. */
  kind:        varchar('kind', { length: 16 }).notNull().default('course'),
  slug:        varchar('slug', { length: 160 }).notNull(),
  title:       varchar('title', { length: 300 }).notNull(),
  summary:     text('summary'),
  level:       varchar('level', { length: 24 }),
  durationMin: integer('duration_min'),
  /** 'draft' | 'published' | 'retired'. */
  status:      varchar('status', { length: 16 }).notNull().default('draft'),
  priceCents:  integer('price_cents'),
  currency:    varchar('currency', { length: 8 }),
  authorRef:   varchar('author_ref', { length: 64 }),
  publishedAt: timestamp('published_at'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_courses_slug').on(t.tenantId, t.slug),
  index('idx_courses_kind').on(t.tenantId, t.kind, t.status),
]);

/** A chapter of a course. Distinct from `modules` in Identity, which is a
 *  PERMISSION module — same word, different noun, and one of the three the
 *  machine kept and should have (§3.3). */
export const courseModules = pgTable('course_modules', {
  id:        serial('id').primaryKey(),
  tenantId:  integer('tenant_id'),
  courseId:  integer('course_id').references(() => courses.id, { onDelete: 'cascade' }),
  title:     varchar('title', { length: 300 }).notNull(),
  summary:   text('summary'),
  position:  integer('position').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_course_modules_pos').on(t.courseId, t.position),
]);

/** A lesson inside a module. Its video, slides and handout are `artifacts`. */
export const courseLessons = pgTable('course_lessons', {
  id:        serial('id').primaryKey(),
  tenantId:  integer('tenant_id'),
  moduleId:  integer('module_id').references(() => courseModules.id, { onDelete: 'cascade' }),
  title:     varchar('title', { length: 300 }).notNull(),
  /** 'video' | 'reading' | 'quiz' | 'lab' | 'scorm'. */
  kind:      varchar('kind', { length: 24 }).notNull().default('reading'),
  body:      text('body'),
  artifactId: uuid('artifact_id'),
  durationMin: integer('duration_min'),
  position:  integer('position').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_course_lessons_pos').on(t.moduleId, t.position),
]);

/**
 * One person's enrolment on one course.
 *
 * `learning_path_enrollments` is gone: its columns were a strict subset of this
 * one's (§3.3), so the path is a nullable `pathRef` here rather than a second
 * table that has to be kept in step.
 */
export const courseEnrollments = pgTable('course_enrollments', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  courseId:    integer('course_id').references(() => courses.id, { onDelete: 'cascade' }),
  /** Set when the enrolment came through a learning path rather than directly. */
  pathRef:     varchar('path_ref', { length: 64 }),
  learnerRef:  varchar('learner_ref', { length: 64 }).notNull(),
  cohortId:    integer('cohort_id'),
  /** 'enrolled' | 'in_progress' | 'completed' | 'expired' | 'withdrawn'. */
  status:      varchar('status', { length: 16 }).notNull().default('enrolled'),
  progress:    numeric('progress', { precision: 5, scale: 2 }).notNull().default('0'),
  enrolledAt:  timestamp('enrolled_at').notNull().defaultNow(),
  startedAt:   timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  dueAt:       timestamp('due_at'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_course_enrollments_learner').on(t.tenantId, t.courseId, t.learnerRef),
  index('idx_course_enrollments_status').on(t.tenantId, t.status, t.dueAt),
  // "How far through the path is this learner" folds over the MEMBER enrolments
  // (1112). Partial, because `pathRef` is null on every standalone enrolment.
  index('idx_course_enrollments_path').on(t.tenantId, t.pathRef, t.learnerRef)
    .where(sql`${t.pathRef} IS NOT NULL`),
]);

/** A group moving through a course together. Its members are `memberships`. */
export const learningCohorts = pgTable('learning_cohorts', {
  id:        serial('id').primaryKey(),
  tenantId:  integer('tenant_id').notNull(),
  objectId:  uuid('object_id').references(() => objects.id, { onDelete: 'cascade' }),
  courseId:  integer('course_id').references(() => courses.id, { onDelete: 'set null' }),
  name:      varchar('name', { length: 200 }).notNull(),
  startsAt:  timestamp('starts_at'),
  endsAt:    timestamp('ends_at'),
  seatLimit: integer('seat_limit'),
  facilitatorRef: varchar('facilitator_ref', { length: 64 }),
  status:    varchar('status', { length: 16 }).notNull().default('scheduled'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_learning_cohorts_course').on(t.tenantId, t.courseId, t.startsAt),
]);

/** A certificate awarded on completion. The PDF is an `artifacts` row; this is
 *  the award, which must survive the file being regenerated. */
export const courseCertificates = pgTable('course_certificates', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id').notNull(),
  enrollmentId: integer('enrollment_id').references(() => courseEnrollments.id, { onDelete: 'cascade' }),
  learnerRef:   varchar('learner_ref', { length: 64 }).notNull(),
  serial:       varchar('serial', { length: 64 }).notNull(),
  artifactId:   uuid('artifact_id'),
  issuedAt:     timestamp('issued_at').notNull().defaultNow(),
  expiresAt:    timestamp('expires_at'),
  revokedAt:    timestamp('revoked_at'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_course_certificates_serial').on(t.serial),
]);

/**
 * A seat reservation on a paid course.
 *
 * Narrowed to an ORDER SATELLITE for the same reason as `boost_checkouts` — the
 * two scored 0.60 on column signature, which is what happens when two features
 * each re-model the money half of an `orders` row. `orderId` points at it.
 *
 * What survives is the part learning owns: a paid seat is HELD before it is
 * paid for (a cohort has a capacity), and the hold has to expire on its own or
 * the cohort silently fills with abandoned checkouts.
 */
export const courseCheckouts = pgTable('course_checkouts', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id').notNull(),
  courseId:     integer('course_id').references(() => courses.id, { onDelete: 'cascade' }),
  cohortId:     integer('cohort_id'),
  /** The `orders` row that carries amount, currency, provider and status. */
  orderId:      integer('order_id'),
  seatHeldAt:   timestamp('seat_held_at'),
  seatHoldExpiresAt: timestamp('seat_hold_expires_at'),
  /** Set when the paid seat became a real enrolment. */
  enrollmentId: integer('enrollment_id'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_course_checkouts_hold').on(t.tenantId, t.seatHoldExpiresAt),
]);

/** An external LMS this tenant publishes into. The OAuth grant is a
 *  `connections` + `credentials` pair; this is the LMS-specific configuration
 *  that grant does not carry. */
export const lmsConnectors = pgTable('lms_connectors', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id').notNull(),
  connectionId: integer('connection_id'),
  /** 'scorm' | 'xapi' | 'lti' | 'cmi5'. */
  standard:     varchar('standard', { length: 16 }).notNull(),
  endpoint:     text('endpoint'),
  defaultCourseFolder: varchar('default_course_folder', { length: 255 }),
  config:       jsonb('config'),
  status:       varchar('status', { length: 16 }).notNull().default('active'),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('idx_lms_connectors_tenant').on(t.tenantId, t.standard, t.status),
]);

/** One publish of one course to one LMS. The run is a `runs` row; this is the
 *  resulting external identity, which outlives the run. */
export const lmsCoursePublishes = pgTable('lms_course_publishes', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  connectorId: integer('connector_id').references(() => lmsConnectors.id, { onDelete: 'cascade' }),
  courseId:    integer('course_id').references(() => courses.id, { onDelete: 'cascade' }),
  externalId:  varchar('external_id', { length: 160 }),
  version:     varchar('version', { length: 24 }).notNull().default('1'),
  status:      varchar('status', { length: 16 }).notNull().default('pending'),
  publishedAt: timestamp('published_at'),
  lastError:   text('last_error'),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_lms_course_publishes_target').on(t.connectorId, t.courseId),
]);

/** SCORM runtime state for one learner in one lesson — the CMI data model the
 *  standard requires be persisted verbatim between sessions. */
export const scormCmiStates = pgTable('scorm_cmi_states', {
  id:           serial('id').primaryKey(),
  tenantId:     integer('tenant_id').notNull(),
  enrollmentId: integer('enrollment_id').references(() => courseEnrollments.id, { onDelete: 'cascade' }),
  lessonId:     integer('lesson_id'),
  learnerRef:   varchar('learner_ref', { length: 64 }).notNull(),
  cmi:          jsonb('cmi').notNull().default('{}'),
  lessonStatus: varchar('lesson_status', { length: 24 }),
  scoreRaw:     numeric('score_raw', { precision: 6, scale: 2 }),
  totalTimeSec: integer('total_time_sec').notNull().default(0),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
  createdAt:    timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_scorm_cmi_states_learner').on(t.enrollmentId, t.lessonId, t.learnerRef),
]);

/** An xAPI Learning Record Store document — state, activity profile or agent
 *  profile, addressed exactly as the specification addresses it. */
export const lrsDocuments = pgTable('lrs_documents', {
  id:          serial('id').primaryKey(),
  tenantId:    integer('tenant_id').notNull(),
  /** 'state' | 'activity_profile' | 'agent_profile'. */
  scope:       varchar('scope', { length: 24 }).notNull(),
  /** The three addressing dimensions are '' when the scope does not use them,
   *  never NULL: two NULLs are DISTINCT in a Postgres unique index, so a nullable
   *  key would let the same Activity Profile be written twice (migration 1114). */
  activityId:  varchar('activity_id', { length: 320 }).notNull().default(''),
  agentKey:    varchar('agent_key', { length: 320 }).notNull().default(''),
  registration: varchar('registration', { length: 64 }).notNull().default(''),
  documentId:  varchar('document_id', { length: 255 }).notNull(),
  contentType: varchar('content_type', { length: 128 }),
  content:     jsonb('content'),
  etag:        varchar('etag', { length: 64 }),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_lrs_documents_key')
    .on(t.tenantId, t.scope, t.activityId, t.agentKey, t.registration, t.documentId),
  index('idx_lrs_documents_scope').on(t.tenantId, t.scope, t.activityId, t.agentKey, t.updatedAt),
]);
