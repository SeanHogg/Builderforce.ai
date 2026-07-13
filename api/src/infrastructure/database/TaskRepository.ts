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
  like,
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

// Pagination constants
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

export async function listUnassignedHighPriorityTasks(
  sql: ReturnType<typeof neon>,
  callerTenantId: number,
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

  // Base query: find unassigned (assignedUserId IS NULL) and high/critical priority
  let baseQuery = sql`
    SELECT
      t.id,
      t.project_id,
      t.key,
      t.title,
      t.description,
      t.status,
      t.priority,
      t.task_type,
      t.assigned_user_id,
      t.assigned_agent_ref,
      t.due_date,
      t.created_at,
      t.updated_at,
      t.archived,
      t.last_key_seq
    FROM tasks t
    INNER JOIN projects p
      ON t.project_id = p.id
    WHERE
      p.tenant_id = ${callerTenantId}
      AND t.assigned_user_id IS NULL
      AND t.priority IN ('high', 'critical')
      AND t.archived = false
      AND (t.status NOT IN ('done', 'completed'))
  `;

  const baseWhereClause = [
    eq(p.tenantId, callerTenantId),
    eq(tasks.assignedUserId, null),
    inArray(tasks.priority, ["high", "critical"]),
    eq(tasks.archived, false),
    or(
      notEq(tasks.status, "done"),
      notEq(tasks.status, "completed")
    ),
  ];

  // Apply optional project filter
  if (projectId !== undefined) {
    baseWhereClause.push(eq(tasks.projectId, projectId));
  }

  const countQuery = sql`
    SELECT COUNT(*) as total
    FROM tasks t
    INNER JOIN projects p
      ON t.project_id = p.id
    WHERE ${and(...baseWhereClause)}
  `;

  const tasksQuery = sql`
    ${baseQuery}
    ORDER BY ${asc(tasks.dueDate)}
      ${!(dueDate === null) || 'ASC'}
    LIMIT ${parsedPageSize}
    OFFSET ${offset}
  `;

  const countResult = await sql(countQuery);
  const total = countResult[0]?.total || 0;

  const result = await sql(tasksQuery);

  return {
    tasks: result as Array<Record<string, unknown>>,
    total,
  };
}

export const tasks = schema.tasks;
export const projects = schema.projects;
export const users = schema.users;
export const tenantMembers = schema.tenantMembers;