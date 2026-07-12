import { Kysely, Migrator } from 'kysely';
import { migrate } from 'kysely-session-storage-postgres';
import '@kysely/postgres'; // postgres adapter
import { R2 } from '@miniflare/r2';
import { SERVICE_NAME_KS } from '@/lib/registry';
import { logger } from '@/lib/logger';
import type { DB } from '@/infra/db';

interface Migration {
  name: string;
  up: (db: Kysely<DB>) => Promise<void>;
  down: (db: Kysely<DB>) => Promise<void>;
}

interface DeadlineTarget {
  id: string;
  tenantId: number;
  projectId: number | null;
  name: string;
  type: DeadlineType;
  targetDate: bigint;
  targetDateTz: string | null;
  ownerId: string;
  ownerKind: OwnerKind;
  status: DeadlineStatus;
  statusReason: string | null;
  isManualOverride: boolean;
  description: string | null;
  priority: DeadlinePriority;
  externalReference: string | null;
  confidential: boolean;
  healthScore: bigint;
  updatedAt: bigint; // epoch timestamp in seconds
}

interface DeadlineTargetWatchers {
  id: string;
  deadlineId: string;
  userId: string;
  projectId: number;
  tenantId: number;
  addedAt: bigint; // epoch timestamp in seconds
  source: 'manual' | 'assignment';
}

interface DeadlineTargetAssociations {
  id: string;
  deadlineId: string;
  entityType: string;
  entityId: string;
  linkedAt: bigint; // epoch timestamp in seconds
  source: 'owner_initiated' | 'system';
}

interface DeadlineTargetAudit {
  id: string;
  deadlineId: string;
  timestamp: bigint; // epoch timestamp in seconds
  actorRef: string;
  action: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  reason: string | null;
  auditType: string;
}

enum DeadlineType {
  Business = 'Business',
  Customer = 'Customer',
}

enum DeadlineStatus {
  OnTrack = 'On Track',
  AtRisk = 'At Risk',
  Overdue = 'Overdue',
  Completed = 'Completed',
}

enum OwnerKind {
  User = 'user',
  Team = 'team',
}

enum DeadlinePriority {
  Critical = 'Critical',
  High = 'High',
  Medium = 'Medium',
  Low = 'Low',
}

const migration: Migration = {
  name: '0053_deadline_targets',

  up: async (db: Kysely<DB>) => {
    await db.schema
      .createTable('deadline_targets')
      .addColumn('id', 'uuid', (col) =>
        col.primaryKey().defaultTo(db.fn.now().toString())
      )
      .addColumn('tenant_id', 'integer', (col) => col.notNull())
      .addColumn('project_id', 'integer', (col) => col.references('projects.id').onDelete('set null'))
      .addColumn('name', 'varchar(500)', (col) => col.notNull())
      .addColumn('type', 'varchar(50)', (col) => col.notNull().checkInValues(['Business', 'Customer']))
      .addColumn('target_date', 'bigint', (col) => col.notNull())
      .addColumn('target_date_tz', 'varchar(100)', (col) => col.nullable())
      .addColumn('owner_id', 'varchar(255)', (col) => col.notNull())
      .addColumn('owner_kind', 'varchar(50)', (col) => col.notNull().checkInValues(['user', 'team']))
      .addColumn('status', 'varchar(50)', (col) =>
        col.notNull().checkInValues(['On Track', 'At Risk', 'Overdue', 'Completed'])
      )
      .addColumn('status_reason', 'text', (col) => col.nullable())
      .addColumn('is_manual_override', 'boolean', (col) => col.notNull().defaultTo(false))
      .addColumn('description', 'text', (col) => col.nullable())
      .addColumn('priority', 'varchar(50)', (col) =>
        col.notNull().checkInValues(['Critical', 'High', 'Medium', 'Low'])
      )
      .addColumn('external_reference', 'varchar(1000)', (col) => col.nullable())
      .addColumn('confidential', 'boolean', (col) => col.notNull().defaultTo(false))
      .addColumn('health_score', 'bigint', (col) => col.notNull())
      .addColumn('updated_at', 'bigint', (col) => col.notNull())
      .addCheckConstraint('chk_update_at_positive', col => col('updated_at').isNotNull())
      .create();

    await db.schema
      .createTable('deadline_target_watchers')
      .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(randUuid().toString()))
      .addColumn('deadline_id', 'uuid', (col) => col.notNull().references('deadline_targets.id').onDelete('cascade'))
      .addColumn('user_id', 'varchar(255)', (col) => col.notNull())
      .addColumn('project_id', 'integer', (col) => col.notNull())
      .addColumn('tenant_id', 'integer', (col) => col.notNull())
      .addColumn('added_at', 'bigint', (col) => col.notNull())
      .addColumn('source', 'varchar(50)', (col) => col.notNull().checkInValues(['manual', 'assignment']))
      .create();

    // Index for queries by owner and project
    await db.schema
      .createIndex('idx_deadline_targets_owner')
      .onTable('deadline_targets')
      .addColumn('owner_id')
      .addColumn('tenant_id')
      .addColumn('project_id')
      .addColumn('type')
      .addColumn('status')
      .execute();

    await db.schema
      .createIndex('idx_deadline_targets_target_date')
      .onTable('deadline_targets')
      .addColumn('target_date')
      .addColumn('status')
      .execute();

    // Index for watchers lookups
    await db.schema
      .createIndex('idx_deadline_watchers_deadline')
      .onTable('deadline_target_watchers')
      .addColumn('deadline_id')
      .execute();

    await db.schema
      .createIndex('idx_deadline_watchers_user')
      .onTable('deadline_target_watchers')
      .addColumn('user_id')
      .addColumn('project_id')
      .addColumn('tenant_id')
      .execute();

    // Audit and associations tables
    await db.schema
      .createTable('deadline_target_audit')
      .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(randUuid().toString()))
      .addColumn('deadline_id', 'uuid', (col) => col.notNull().references('deadline_targets.id').onDelete('cascade'))
      .addColumn('timestamp', 'bigint', (col) => col.notNull())
      .addColumn('actor_ref', 'varchar(255)', (col) => col.notNull())
      .addColumn('action', 'varchar(50)', (col) => col.notNull())
      .addColumn('field', 'varchar(255)', (col) => col.nullable())
      .addColumn('old_value', 'text', (col) => col.nullable())
      .addColumn('new_value', 'text', (col) => col.nullable())
      .addColumn('reason', 'text', (col) => col.nullable())
      .addColumn('audit_type', 'varchar(50)', (col) => col.notNull().checkInValues(['field_edit', 'status_change', 'override', 'completion']))
      .create();

    // Index for audit history
    await db.schema
      .createIndex('idx_deadline_audit_deadline')
      .onTable('deadline_target_audit')
      .addColumn('deadline_id')
      .addColumn('timestamp')
      .execute();

    await db.schema
      .createTable('deadline_target_associations')
      .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(randUuid().toString()))
      .addColumn('deadline_id', 'uuid', (col) => col.notNull().references('deadline_targets.id').onDelete('cascade'))
      .addColumn('entity_type', 'varchar(50)', (col) => col.notNull())
      .addColumn('entity_id', 'varchar(255)', (col) => col.notNull())
      .addColumn('linked_at', 'bigint', (col) => col.notNull())
      .addColumn('source', 'varchar(50)', (col) => col.notNull().checkInValues(['owner_initiated', 'system']))
      .create();

    // Index for association lookups
    await db.schema
      .createIndex('idx_deadline_association_deadline')
      .onTable('deadline_target_associations')
      .addColumn('deadline_id')
      .create();

    await db.schema
      .createIndex('idx_deadline_association_entity')
      .onTable('deadline_target_associations')
      .addColumn('entity_type')
      .addColumn('entity_id')
      .create();

    // Ping R2 health status if available
    try {
      const r2 = (globalThis as any).r2 as R2;
      if (r2) {
        await r2.get('/.health').catch(() => {});
        logger.info('[DeadlineTargets] R2 health check completed');
      }
    } catch (err) {
      logger.warn('[DeadlineTargets] R2 health check pending or not configured');
    }
  },

  down: async (db: Kysely<DB>) => {
    await db.schema.dropTable('deadline_target_associations').execute();
    await db.schema.dropTable('deadline_target_audit').execute();
    await db.schema.dropTable('deadline_target_watchers').execute();
    await db.schema.dropTable('deadline_targets').execute();
  },
};

// Use a simple random UUID generator for migrations (not cryptographically secure, but sufficient for migrations)
const randUuid = () => Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

export default migration;

// Run migration if this file is executed directly
if (import.meta.main) {
  (async () => {
    try {
      const db = new Kysely<DB>({
        dialect: {
          createAdapter: () => new PostgresDialect({}),
          createDriver: () => new PoolDriver(poolConfig),
          createPool: () => new Pool(poolConfig),
        },
      });

      const migrator = new Migrator({
        db,
        migrationTableStorageTable: new PostgresMigrationStorageTable({ db, tableName: 'migrations' }),
        migrations: [migration],
      });

      const result = await migrator.migrateToLatest({ siteId: SERVICE_NAME_KS });

      await migrator.close();
      process.exit(result.error ? 1 : 0);
    } catch (err) {
      console.error('Migration failed:', err);
      process.exit(1);
    }
  })();
}

const poolConfig: PoolConfig = {
  host: import.meta.env.POSTGRES_HOST ?? 'localhost',
  port: parseInt(import.meta.env.POSTGRES_PORT ?? '5432', 10),
  user: import.meta.env.POSTGRES_USER ?? 'postgres',
  password: import.meta.env.POSTGRES_PASSWORD ?? '',
  database: import.meta.env.POSTGRES_DB ?? 'builderforce',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
};

export { poolConfig };