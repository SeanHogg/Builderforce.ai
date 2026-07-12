export const ticketAudits = pgTable(
  'ticket_audits',
  {
    id: serial('id').primaryKey(),
    taskId: integer('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    laneKey: varchar('lane_key', { length: 120 }),
    memberKind: varchar('member_kind', { length: 24 }),
    memberRef: varchar('member_ref', { length: 64 }),
    roleKey: varchar('role_key', { length: 32 }),
    verdict: varchar('verdict', { length: 24 }),
    summary: text('summary'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
   index('ticket_audits_task_id_idx').on(t.taskId),
  ]
);

// ---------------------------------------------------------------------
// Bottleneck registry (migration 0332)
//   - Tracks human review vs agent capability gaps across agentic workflows
//   - Supports classification, severity, orchestration, and postmortem tracking
// ---------------------------------------------------------------------

const bottleneckCategoryEnum = pgEnum(
  'bottleneck_category',
  ['human_review', 'agent_capability_gap']
);

const bottleneckSubclassEnum = pgEnum('bottleneck_subclass', [
  // Agent capability gap subclasses
  'reasoning_failure',
  'tool_misuse',
  'missing_context',
  'instruction_ambiguity',
  'knowledge_cutoff',
  'output_format_failure',
  'hallucination',
  // Human review subclasses
  'unnecessary_review',
  'necessary_review',
  'review_queue_overload'
]);

const bottleneckStatusEnum = pgEnum('bottleneck_status', [
  'open',
  'in_review',
  'resolved'
]);

const diagnosticSourceEnum = pgEnum('bottleneck_diagnostic_source', [
  'langsmith',
  'otel_compliant_orchestrator',
  'webhook_external_framework',
  'explicit_agent_signal'
]);

export const bottleneckRegistry = pgTable('bottleneck_registry', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Unique ID for this bottleneck instance derived from its source trace + step */
  bottleneckId: varchar('bottleneck_id', { length: 128 }).notNull().unique(),
  /** Workflow this step belongs to — e.g. AI-assisted code analysis. PK: workflow_id from orchestration metadata. */
  workflowId: varchar('workflow_id', { length: 255 }).notNull(),
  /** Specific step identifier within the workflow — e.g. "llm_complete" or "review_apply_changes". Multiple per workflow possible. */
  stepId: varchar('step_id', { length: 128 }).notNull(),
  /** Primary category (human vs agent). Classification confidence between 0.0 and 1.0 — records model uncertainty for low-confidence labels. */
  category: bottleneckCategoryEnum('category').notNull(),
  /** Sub-classification (reasoning_failure, tool_misuse, unnecessary_review, etc.). Null for low-confidence classifications. */
  subClass: bottleneckSubclassEnum('subclass'),
  /** Confidence score of classification (0.0 – 1.0). Low-confidence entries are flagged for human review. */
  classificationConfidence: real('classification_confidence').notNull().default(1),
  /** Time when this step FIRST produced bottleneck signs. Used for timeline and backfills. */
  firstSeen: timestamp('first_seen', { withTimezone: true }).notNull().defaultNow(),
  /** Most recent time when bottleneck persisted or was remediated. Updates on fallback or resolutions. */
  lastSeen: timestamp('last_seen', { withTimezone: true }).notNull().defaultNow(),
  /** Number of observed occurrences over the registry usage window (often daily rolling). Used for severity scoring. */
  occurrenceCount: integer('occurrence_count').notNull().default(0),
  /** Severity score 1–5 computed from frequency, latency impact, error amplification, and business criticality. Recalculated every 24h. */
  severityScore: integer('severity_score').notNull().default(1),
  /** Overall status of this bottleneck record. */
  status: bottleneckStatusEnum('status').notNull().default('open'),
  /** Optional assignment of a human stakeholder/owner to drive resolution. */
  assignedOwner: varchar('assigned_owner', { length: 255 }),
  /** Optional notes from human labeling or resolution engineering. */
  resolutionNotes: text('resolution_notes'),
  /** Elastic storage for scan_time and scan_dims_1h (urn:uuid::after_enrichment). Stored as JSONB in DB for schema flexibility. */
  enrichmentMetadata: text('enrichment_metadata'),
  /** Timestamp when this instance was first detected/recorded by the detection job. */
  detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),
  /** Timestamp when this instance was last re-scanned/evaluated by the detection job (used to track recalc of severity). */
  lastScannedAt: timestamp('last_scanned_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('bottleneck_registry_workflow_step_idx').on(t.workflowId, t.stepId),
  index('bottleneck_registry_category_idx').on(t.category),
  index('bottleneck_registry_subclass_idx').on(t.subClass),
  index('bottleneck_registry_status_idx').on(t.status),
  index('bottleneck_registry_severity_idx').on(t.severityScore),
  index('bottleneck_registry_status_severity_idx').on(t.status, t.severityScore),
  index('bottleneck_registry_assigned_owner_idx').on(t.assignedOwner),
  index('bottleneck_registry_first_seen_idx').on(t.firstSeen),
  index('bottleneck_registry_last_seen_idx').on(t.lastSeen),
]);