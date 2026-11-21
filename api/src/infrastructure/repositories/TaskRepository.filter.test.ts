/**
 * `taskFilterWhere` rendered to SQL — one assertion per filter field, the open/closed
 * rule (agent-loop's TASK_CLOSED_STATUSES, trimmed like JS `trim`), LIKE escaping, the
 * tenant predicate on the fan-out EXISTS, and the service-only state constraints.
 */
import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { TASK_CLOSED_STATUSES } from '@builderforce/agent-loop';
import type { TaskListFilter, TaskQueryState } from '../../domain/task/ITaskRepository';
import { taskFilterWhere } from './TaskRepository';

const dialect = new PgDialect();
const render = (f: Partial<TaskListFilter>, state?: TaskQueryState) =>
  dialect.sqlToQuery(taskFilterWhere(7, { scope: 'all', ...f }, state));

describe('taskFilterWhere', () => {
  it('always scopes to the tenant, and scope "all" adds nothing else', () => {
    const q = render({});
    expect(q.sql).toBe('"tasks"."tenant_id" = $1');
    expect(q.params).toEqual([7]);
  });

  it('open = not archived AND not a closed lane; closed = archived OR a closed lane', () => {
    const open = render({ scope: 'open' });
    expect(open.sql).toContain('"tasks"."archived" = $2');
    expect(open.sql).toMatch(/not lower\(regexp_replace\("tasks"\."status", \$\d+, '', 'g'\)\) in \(/);
    expect(open.params).toEqual(expect.arrayContaining([false, '^[[:space:]]+|[[:space:]]+$', ...TASK_CLOSED_STATUSES]));

    const closed = render({ scope: 'closed' });
    expect(closed.sql).toMatch(/\("tasks"\."archived" = \$2 or lower\(regexp_replace\("tasks"\."status"/);
    expect(closed.params).toEqual(expect.arrayContaining([true, ...TASK_CLOSED_STATUSES]));
  });

  it('renders each equality / range field', () => {
    const q = render({
      projectId: 3, status: 'todo', parentTaskId: 9, taskType: 'bug',
      createdBefore: new Date('2026-11-01T00:00:00Z'), createdAfter: new Date('2026-10-01T00:00:00Z'),
    });
    expect(q.sql).toContain('"tasks"."project_id" = $');
    expect(q.sql).toContain('"tasks"."status" = $');
    expect(q.sql).toContain('"tasks"."parent_task_id" = $');
    expect(q.sql).toContain('"tasks"."task_type"::text = $');
    expect(q.sql).toContain('"tasks"."created_at" < $');
    expect(q.sql).toContain('"tasks"."created_at" > $');
    expect(q.params).toEqual(expect.arrayContaining([3, 'todo', 9, 'bug']));
  });

  it('topLevelOnly is parent IS NULL', () => {
    expect(render({ topLevelOnly: true }).sql).toContain('"tasks"."parent_task_id" is null');
  });

  it('titlePrefix / titleMatch are ILIKE with escaped wildcards', () => {
    const q = render({ titlePrefix: '100%_[QA]', titleMatch: 'a\\b' });
    expect(q.sql).toContain('"tasks"."title" ilike $');
    expect(q.params).toEqual(expect.arrayContaining(['100\\%\\_[QA]%', '%a\\\\b%']));
  });

  it('assigned none / any test all three owner columns, empty strings counting as none', () => {
    const none = render({ assigned: 'none' }).sql;
    expect(none).toContain(`nullif("tasks"."assigned_user_id", '') is null`);
    expect(none).toContain(`nullif("tasks"."assigned_agent_ref", '') is null`);
    expect(none).toContain('"tasks"."assigned_agent_host_id" is null');
    expect(render({ assigned: 'any' }).sql).toMatch(/not \(nullif\("tasks"\."assigned_user_id"/);
  });

  it('isFanoutCopy is a tenant-scoped EXISTS over ticket_participants.child_task_id', () => {
    const yes = render({ isFanoutCopy: true });
    expect(yes.sql).toMatch(/exists \(select 1 from "ticket_participants" where \("ticket_participants"\."tenant_id" = \$\d+ and "ticket_participants"\."child_task_id" = "tasks"\."id"\)\)/);
    expect(yes.params.filter((p) => p === 7)).toHaveLength(2);
    expect(render({ isFanoutCopy: false }).sql).toContain('not exists (select 1 from "ticket_participants"');
  });

  it('applies the service state: a pinned archived flag and excluded task types', () => {
    const q = render({}, { archived: false, excludeTaskTypes: ['security'] });
    expect(q.sql).toContain('"tasks"."archived" = $');
    expect(q.sql).toContain('"tasks"."task_type"::text not in ($');
    expect(q.params).toEqual(expect.arrayContaining([false, 'security']));
  });
});
