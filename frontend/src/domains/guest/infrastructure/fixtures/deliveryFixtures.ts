/**
 * Wire adapters for the DELIVERY reads — projects and their tasks.
 *
 * The sample workspace (`domain/sampleWorkspace`) speaks the product's own
 * vocabulary; the API speaks JSON with `snake_case` legacy aliases and per-list
 * roll-up counts. Translating between the two is infrastructure's job, and it
 * belongs in a file per endpoint FAMILY so that when an endpoint's shape
 * changes, exactly one small module changes with it.
 */

import {
  SAMPLE_PROJECTS,
  isSampleTaskCompleted,
  type SampleProject,
  type SampleTask,
} from '../../domain/sampleWorkspace';
import { dayOffsetToIso, exact, type GuestFixture, type GuestFixtureContext } from '../../domain/guestFixture';

/** The roll-up counts the list endpoint returns alongside each project. Derived
 *  from the tasks rather than stored, so a card's totals can never disagree with
 *  the board it opens. */
function counts(project: SampleProject, now: number) {
  const tasks = project.tasks;
  const completed = tasks.filter((t) => isSampleTaskCompleted(t.status));
  const open = tasks.filter((t) => !isSampleTaskCompleted(t.status));
  return {
    taskCount: tasks.length,
    completedTaskCount: completed.length,
    openTaskCount: open.length,
    blockedTaskCount: tasks.filter((t) => t.status === 'blocked').length,
    overdueTaskCount: open.filter((t) => t.dueDayOffset != null && now + t.dueDayOffset * 86_400_000 < now).length,
  };
}

function projectRow(project: SampleProject, now: number) {
  const createdAt = dayOffsetToIso(now, project.createdDayOffset);
  return {
    id: project.id,
    key: project.key,
    name: project.name,
    description: project.description,
    status: project.status,
    modality: 'designer',
    origin: 'ide',
    // Both spellings, because the list endpoint answers both and different
    // surfaces read different ones — a fixture that picked one would work on
    // half the screens and render "Invalid Date" on the other half.
    createdAt,
    created_at: createdAt,
    updatedAt: dayOffsetToIso(now, -1),
    updated_at: dayOffsetToIso(now, -1),
    ...counts(project, now),
  };
}

function taskRow(task: SampleTask, project: SampleProject, now: number) {
  return {
    id: Number(`${project.id}${task.key.split('-')[1]}`),
    key: task.key,
    title: task.title,
    description: task.description ?? null,
    status: task.status,
    priority: task.priority,
    points: task.points ?? null,
    projectId: project.id,
    project_id: project.id,
    assignee: task.assignee,
    isEpic: task.epic ?? false,
    parentKey: task.parentKey ?? null,
    createdAt: dayOffsetToIso(now, task.createdDayOffset),
    updatedAt: dayOffsetToIso(now, task.completedDayOffset ?? task.createdDayOffset),
    completedAt: task.completedDayOffset == null ? null : dayOffsetToIso(now, task.completedDayOffset),
    dueDate: task.dueDayOffset == null ? null : dayOffsetToIso(now, task.dueDayOffset),
  };
}

function allTaskRows({ now, query }: GuestFixtureContext) {
  // `tasksApi.list` sends `project_id`; the decomposition reads send `project`.
  // Both spellings, because a fixture that honoured one of them would silently
  // return every project's tickets on a board scoped to one.
  const wanted = query.get('project_id') ?? query.get('project') ?? query.get('projectId');
  const projects = wanted ? SAMPLE_PROJECTS.filter((p) => String(p.id) === wanted) : SAMPLE_PROJECTS;
  return projects.flatMap((project) => project.tasks.map((task) => taskRow(task, project, now)));
}

export const deliveryFixtures: GuestFixture[] = [
  {
    id: 'delivery.projects',
    match: exact('/api/projects'),
    respond: ({ now }) => ({ projects: SAMPLE_PROJECTS.map((p) => projectRow(p, now)) }),
  },
  {
    id: 'delivery.tasks',
    match: exact('/api/tasks'),
    respond: (context) => ({ tasks: allTaskRows(context) }),
  },
];
