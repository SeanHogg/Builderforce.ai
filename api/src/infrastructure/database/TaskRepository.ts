import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";
import type { Env } from "../../env";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  or,
} from "drizzle-orm";

export type Db = NeonHttpDatabase<typeof schema>;

export function buildDatabase(env: Env): Db {
  const url = env.NEON_DATABASE_URL;
  if (!url || typeof url !== "string" || !url.trim()) {
    throw new Error(
      "NEON_DATABASE_URL is not set. Set it with: wrangler secret put NEON_DATABASE_URL (in the api/ directory)"
    );
  }
  const sql = neon(url);
  return drizzle(sql, { schema });
}

export const tasks = schema.tasks;
export const projects = schema.projects;
export const users = schema.users;
export const tenantMembers = schema.tenantMembers;

// Constants for pagination
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

// Helper to handle NULL values in Drizzle ORDER BY
function orderByAscOrNull(column: any) {
  const columnStr = column.sql;
  return `${columnStr} ASC`;
}

/**
 * List unassigned, high-priority tasks for a tenant with pagination and optional project filter.
 *
 * @param sql - Database connection
 * @param tenantId - Tenant ID
 * @param projectId - Optional project ID filter
 * @param page - Page number (default: 1)
 * @param pageSize - Items per page (default: 50, max: 100)
 * @returns Paginated list of unassigned high-priority tasks
 */
export async function listUnassignedHighPriorityTasks(
  sql: ReturnType<typeof neon>,
  tenantId: number,
  projectId?: number,
  page: number = 1,
  pageSize: number = DEFAULT_PAGE_SIZE
): Promise<{
  tasks: Array<Record<string, unknown>>;
  total: number;
}> {
  const parsedPage = Math.max(1, parseInt(String(page), 10));
  const parsedPageSize = Math.min(
    Math.max(1, parseInt(String(pageSize), 10)),
    MAX_PAGE_SIZE
  );

  const offset = (parsedPage - 1) * parsedPageSize;
  const now = new Date().toISOString();

  // Build adapter-only clauses (tenant), plus project if provided; never pursue schema-level fns here.
  const whereClause = [
    eq(projects.tenantId, tenantId),
    eq(tasks.assignedUserId, null),
    inArray(tasks.priority, ["high", "critical"]),
    eq(tasks.archived, false),
    or(
      eq(tasks.status, "backlog"),
      eq(tasks.status, "todo"),
      eq(tasks.status, "in_progress")
    ),
  ];

  if (projectId !== undefined) {
    whereClause.push(eq(tasks.projectId, projectId));
  }

  // For the count: use Drizzle’s native clause builder.
  const countWhere = and(...whereClause);
  const countResult = await sql<{ total: number }[]>`
    SELECT COUNT(*) as total
    FROM tasks
    WHERE ${countWhere}
  `;
  const total = (countResult[0]?.total ?? 0);

  // For the list: explicit column projection in pure SQL for clarity and repeatability.
  const listColumns = [
    "id",
    "project_id",
    "key",
    "title",
    "description",
    "status",
    "priority",
    "task_type",
    "assigned_user_id",
    "assigned_agent_ref",
    "due_date",
    "created_at",
    "updated_at",
    "archived",
    "last_key_seq",
  ];

  const listQuery = sql<{ tasks: Record<string, unknown>[] }[]>`
    SELECT ${sql.unsafe(listColumns.join(", "))}
    FROM tasks
    WHERE ${and(...whereClause)}
    ORDER BY ${asc(tasks.dueDate)}
    LIMIT ${parsedPageSize}
    OFFSET ${offset}
  `;

  const result = await listQuery;
  return {
    tasks: result[0]?.tasks || [],
    total,
  };
}