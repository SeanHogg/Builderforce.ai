import { pgTable, uuid, varchar, text, integer, timestamp, boolean, jsonb } from 'pg-core';

export const projects = pgTable('projects', {
  id: integer('id').primaryKey().generatedByAlwaysAsIdentity(),
  key: varchar('key', { length: 50 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  status: varchar('status', { length: 50 }).notNull().default('active'),
});

export const misalignment_rules = pgTable('misalignment_rules', {
  id: varchar('id', { length: 255 }).primaryKey(),
  project_id: integer('project_id'),
  rule_type: varchar('rule_type', { length: 50 }).notNull(), // hierarchical, strategic, dependency
  enabled: boolean('enabled').notNull().default(false),
  severity: varchar('severity', { length: 50 }).notNull().default('warning'), // warning, error
  threshold: integer('threshold').notNull().default(1), // deviation threshold in priority levels
  description: text('description').notNull(),
  created_at: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Optional: For storing checkbox must_have_strategic_link per rule (infrastructure hook support)
export const misalignment_rule_config = pgTable('misalignment_rule_config', {
  rule_id: varchar('rule_id', { length: 255 }).primaryKey().references(() => misalignment_rules.id, { onDelete: 'cascade' }),
  must_have_strategic_link: boolean('must_have_strategic_link').notNull().default(false),
});

export const task_dependencies = pgTable('task_dependencies', {
  id: uuid('id').primaryKey().defaultRandom(),
  blocking_task_id: integer('blocking_task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  blocked_task_id: integer('blocked_task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
});

export const objective_dependencies = pgTable('objective_dependencies', {
  id: uuid('id').primaryKey().defaultRandom(),
  blocking_objective_id: integer('blocking_objective_id').notNull().references(() => objectives.id, { onDelete: 'cascade' }),
  dependent_objective_id: integer('dependent_objective_id').notNull().references(() => objectives.id, { onDelete: 'cascade' }),
});

// Placeholder schema version - this is a subset under API only
export const tasks = pgTable('tasks', {
  id: integer('id').primaryKey().generatedByAlwaysAsIdentity(),
  title: varchar('title', { length: 255 }).notNull(),
  project_id: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  parent_id: integer('parent_id').references(() => tasks.id, { onDelete: 'set null' }),
  task_type: varchar('task_type', { length: 50 }),
  priority: varchar('priority', { length: 50 }),
  description: text('description'),
  status: varchar('status', { length: 50 }).notNull().default('backlog'),
  created_at: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const tasksMetadata = pgTable('tasks_metadata', {
  id: varchar('id', { length: 255 }).primaryKey(),
  task_id: integer('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
});

export const objectives = pgTable('objectives', {
  id: integer('id').primaryKey().generatedByAlwaysAsIdentity(),
  title: varchar('title', { length: 255 }).notNull(),
  project_id: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  priority: varchar('priority', { length: 50 }),
  description: text('description'),
  created_at: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const key_results = pgTable('key_results', {
  id: integer('id').primaryKey().generatedByAlwaysAsIdentity(),
  objective_id: integer('objective_id').notNull().references(() => objectives.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 255 }).notNull(),
  metric_type: varchar('metric_type', { length: 50 }),
  start_value: integer('start_value').default(0),
  target_value: integer('target_value').default(0),
  current_value: integer('current_value').default(0),
  unit: varchar('unit', { length: 50 }),
  percentage: float('percentage').default(0.0),
  created_at: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});