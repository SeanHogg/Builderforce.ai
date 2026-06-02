import { TaskStatus } from '../../domain/shared/types';

export interface DefaultSwimlaneSeed {
  key: string;
  name: string;
  position: number;
  isTerminal: boolean;
  gate: 'auto' | 'human';
}

/**
 * Default swimlanes seeded when a board is first created.
 *
 * They mirror the task board's kanban columns 1:1 — each `key` is exactly a
 * {@link TaskStatus} value — so the Board-configuration panel shows the same
 * lanes the user already sees on the board, and agent-per-lane mapping on the
 * board is an exact key match rather than a name heuristic.
 *
 * Order matches the kanban column order. `done` is terminal; `in_review` gates
 * on a human by default (review is the natural approval point).
 */
export const DEFAULT_SWIMLANES: DefaultSwimlaneSeed[] = [
  { key: TaskStatus.BACKLOG, name: 'Backlog', position: 0, isTerminal: false, gate: 'auto' },
  { key: TaskStatus.TODO, name: 'To Do', position: 1, isTerminal: false, gate: 'auto' },
  { key: TaskStatus.READY, name: 'Ready', position: 2, isTerminal: false, gate: 'auto' },
  { key: TaskStatus.IN_PROGRESS, name: 'In Progress', position: 3, isTerminal: false, gate: 'auto' },
  { key: TaskStatus.IN_REVIEW, name: 'In Review', position: 4, isTerminal: false, gate: 'human' },
  { key: TaskStatus.BLOCKED, name: 'Blocked', position: 5, isTerminal: false, gate: 'auto' },
  { key: TaskStatus.DONE, name: 'Done', position: 6, isTerminal: true, gate: 'auto' },
];
