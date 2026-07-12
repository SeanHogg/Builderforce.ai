/**
 * Priority Status Service API Client
 * 
 * Handles communication with the PriorityStatusService for low-priority task status management.
 * Implements the FR6 API endpoints:
 * - setStatusOnHold(taskId, note?) returns update
 * - setStatusDeferred(taskId, note?) returns update
 * - getTaskStatus(taskId) returns current status + flags
 */

import type {
  LowPriorityStatus,
  LowPriorityFlags,
  GetTaskStatusResponse,
  SetStatusRequest,
  SetStatusResponse,
} from '../types/priority-status';

interface MockTaskState {
    taskId: string;
    status: string;
    flags: { isLowPriority: boolean };
    priorityStatus?: LowPriorityStatus;
    createdAt: string;
    updatedAt: string;
    lastStatusChange: {
        status: LowPriorityStatus;
        timestamp: string;
        user: string;
        note?: string;
    } | null;
}

// In-memory storage for demo purposes
const mockTasks: Record<string, MockTaskState> = {
    'task-1': {
        taskId: 'task-1',
        status: 'in_progress',
        flags: { isLowPriority: false },
        createdAt: '2025-01-15T10:00:00Z',
        updatedAt: '2025-01-16T14:30:00Z',
        lastStatusChange: null,
    },
    'task-2': {
        taskId: 'task-2',
        status: 'on_hold',
        flags: { isLowPriority: true },
        priorityStatus: 'on_hold',
        createdAt: '2025-01-12T09:00:00Z',
        updatedAt: '2025-01-15T11:00:00Z',
        lastStatusChange: {
            status: 'on_hold',
            timestamp: '2025-01-15T11:00:00Z',
            user: 'jane@example.com',
            note: 'Waiting for API documentation review',
        },
    },
    'task-3': {
        taskId: 'task-3',
        status: 'deferred',
        flags: { isLowPriority: true },
        priorityStatus: 'deferred',
        createdAt: '2025-01-10T08:00:00Z',
        updatedAt: '2025-01-14T16:00:00Z',
        lastStatusChange: {
            status: 'deferred',
            timestamp: '2025-01-14T16:00:00Z',
            user: 'bob@example.com',
            note: 'Postponed due to resource constraints',
        },
    },
};

// Simulated API delay
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Mock PriorityStatusService implementation
 */

/**
 * Set task status to "on_hold"
 * @param taskId - The task ID
 * @param note - Optional explanatory note
 * @returns Status update response
 */
export async function setStatusOnHold(
    taskId: string,
    note?: string
): Promise<SetStatusResponse> {
    await sleep(300); // Simulate network latency

    const task = mockTasks[taskId];
    if (!task) {
        throw new Error(`Task not found: ${taskId}`);
    }

    const previousStatus = task.status;
    const currentTime = new Date().toISOString();
    const user = 'current-user@example.com'; // Would come from auth context

    // Update task state
    task.status = 'on_hold';
    task.flags = { isLowPriority: true };
    task.priorityStatus = 'on_hold';
    task.updatedAt = currentTime;
    task.lastStatusChange = {
        status: 'on_hold',
        timestamp: currentTime,
        user,
        note,
    };

    return {
        taskId,
        previousStatus,
        newStatus: 'on_hold',
        timestamp: currentTime,
        user,
        note,
    };
}

/**
 * Set task status to "deferred"
 * @param taskId - The task ID
 * @param note - Optional explanatory note
 * @returns Status update response
 */
export async function setStatusDeferred(
    taskId: string,
    note?: string
): Promise<SetStatusResponse> {
    await sleep(300); // Simulate network latency

    const task = mockTasks[taskId];
    if (!task) {
        throw new Error(`Task not found: ${taskId}`);
    }

    const previousStatus = task.status;
    const currentTime = new Date().toISOString();
    const user = 'current-user@example.com'; // Would come from auth context

    // Update task state
    task.status = 'deferred';
    task.flags = { isLowPriority: true };
    task.priorityStatus = 'deferred';
    task.updatedAt = currentTime;
    task.lastStatusChange = {
        status: 'deferred',
        timestamp: currentTime,
        user,
        note,
    };

    return {
        taskId,
        previousStatus,
        newStatus: 'deferred',
        timestamp: currentTime,
        user,
        note,
    };
}

/**
 * Get current task status including low-priority flags
 * @param taskId - The task ID
 * @returns Task status with flags
 */
export async function getTaskStatus(
    taskId: string
): Promise<GetTaskStatusResponse> {
    await sleep(100); // Simulate network latency

    const task = mockTasks[taskId];
    if (!task) {
        throw new Error(`Task not found: ${taskId}`);
    }

    const flags: LowPriorityFlags = {
        isLowPriority: task.flags.isLowPriority,
        priorityStatus: task.priorityStatus,
    };

    return {
        status: task.status,
        flags,
        taskId,
    };
}

/**
 * Type guard to check if a status is a low-priority status
 */
export function isLowPriorityStatus(status: string): status is LowPriorityStatus {
    const lowPriorityStatuses: LowPriorityStatus[] = [
        'on_hold',
        'deferred',
        'backlog',
        'todo',
        'ready',
        'in_progress',
        'in_review',
        'done',
        'blocked',
    ];
    return lowPriorityStatuses.includes(status as LowPriorityStatus);
}

/**
 * Get valid transitions from a given status
 */
export function getValidTransitions(currentStatus: string): string[] {
    // Define valid status transitions
    // These can be customized based on business rules
    
    const transitions: Record<string, string[]> = {
        on_hold: ['todo', 'deferred'],
        deferred: ['todo', 'on_hold'],
        backlog: ['ready', 'todo'],
        todo: ['ready', 'in_progress'],
        ready: ['in_progress', 'backlog'],
        in_progress: ['in_review', 'ready', 'blocked'],
        in_review: ['done', 'in_progress'],
        done: [],
        blocked: ['in_progress', 'on_hold'],
    };

    return transitions[currentStatus] || [];
}

/**
 * Check if a transition from one status to another is valid
 */
export function isValidTransition(
    fromStatus: string,
    toStatus: string
): boolean {
    const validTransitions = getValidTransitions(fromStatus);
    return validTransitions.includes(toStatus);
}