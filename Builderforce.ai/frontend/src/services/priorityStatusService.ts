import type {
    GetTaskStatusResponse,
    LowPriorityFlags,
    SetStatusRequest,
    SetStatusResponse,
    StatusTransition
} from '@/types/priority-status';

// Re-export types for convenience
export type { GetTaskStatusResponse, LowPriorityFlags, SetStatusRequest, SetStatusResponse, StatusTransition, LowPriorityStatus };

/**
 * Service for managing task priority (low-priority) status transitions.
 * In production, this would call a real REST API endpoint.
 */

// In-memory mock storage for demo (replace with real database in production)
const mockTaskStatuses = new Map<string, {
    status: string;
    isLowPriority: boolean;
    priorityStatus?: LowPriorityStatus;
    history: StatusTransition[];
}>();

const mockUser = 'current-user';

/**
 * Set a task's status to "on_hold" with optional note.
 *
 * @param taskId - The task identifier
 * @param note - Optional audit note explaining why the task is on hold
 * @returns Object with previous status, new status, and audit information
 *
 * @example
 * await PriorityStatusService.setStatusOnHold('task-1', 'Waiting for API documentation review');
 */
export async function setStatusOnHold(taskId: string, note?: string): Promise<SetStatusResponse> {
    // Validate input
    if (!taskId) {
        throw new Error('Task ID is required');
    }

    // Simulate network delay (replace with real API call)
    await new Promise(resolve => setTimeout(resolve, 300));

    // Get current state or initialize
    const current = mockTaskStatuses.get(taskId) || {
        status: 'todo',
        isLowPriority: false,
        history: []
    };

    // Validate transition: can only go to on_hold from certain states
    if (!isValidTransition(current.status, 'on_hold')) {
        throw new Error(`Cannot transition from ${current.status} to on_hold`);
    }

    // Create status transition record
    const transition: StatusTransition = {
        taskId,
        previousStatus: current.status,
        newStatus: 'on_hold',
        timestamp: new Date().toISOString(),
        user: mockUser,
        note
    };

    // Update state
    current.status = 'on_hold';
    current.isLowPriority = true;
    current.priorityStatus = 'on_hold';
    current.history.push(transition);
    mockTaskStatuses.set(taskId, current);

    // Simulate API response
    return {
        taskId,
        previousStatus: current.status,
        newStatus: 'on_hold',
        timestamp: transition.timestamp,
        user: mockUser,
        note
    };
}

/**
 * Set a task's status to "deferred" with optional note.
 *
 * @param taskId - The task identifier
 * @param note - Optional audit note explaining why the task is deferred
 * @returns Object with previous status, new status, and audit information
 *
 * @example
 * await PriorityStatusService.setStatusDeferred('task-1', 'Backend API not available yet');
 */
export async function setStatusDeferred(taskId: string, note?: string): Promise<SetStatusResponse> {
    // Validate input
    if (!taskId) {
        throw new Error('Task ID is required');
    }

    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 300));

    // Get current state or initialize
    const current = mockTaskStatuses.get(taskId) || {
        status: 'todo',
        isLowPriority: false,
        history: []
    };

    // Validate transition: can only go to deferred from certain states
    if (!isValidTransition(current.status, 'deferred')) {
        throw new Error(`Cannot transition from ${current.status} to deferred`);
    }

    // Create status transition record
    const transition: StatusTransition = {
        taskId,
        previousStatus: current.status,
        newStatus: 'deferred',
        timestamp: new Date().toISOString(),
        user: mockUser,
        note
    };

    // Update state
    current.status = 'deferred';
    current.isLowPriority = true;
    current.priorityStatus = 'deferred';
    current.history.push(transition);
    mockTaskStatuses.set(taskId, current);

    // Simulate API response
    return {
        taskId,
        previousStatus: current.status,
        newStatus: 'deferred',
        timestamp: transition.timestamp,
        user: mockUser,
        note
    };
}

/**
 * Get current status and flags for a task.
 *
 * @param taskId - The task identifier
 * @returns Object with status and flags (including isLowPriority)
 *
 * @example
 * const { flags, taskId } = await PriorityStatusService.getTaskStatus('task-1');
 * if (flags.isLowPriority) {
 *     console.log(`Task is ${flags.priorityStatus}`);
 * }
 */
export async function getTaskStatus(taskId: string): Promise<GetTaskStatusResponse> {
    // Validate input
    if (!taskId) {
        throw new Error('Task ID is required');
    }

    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 300));

    // Get current state or initialize with defaults
    const current = mockTaskStatuses.get(taskId);

    const flags: LowPriorityFlags = {
        isLowPriority: current?.isLowPriority || false,
        priorityStatus: current?.priorityStatus
    };

    // Simulate API response
    return {
        taskId,
        status: current?.status || 'todo',
        flags
    };
}

/**
 * Type guard for LowPriorityStatus
 */
export function isLowPriorityStatus(status: string): status is LowPriorityStatus {
    const lowPriorityValues: LowPriorityStatus[] = ['on_hold', 'deferred'];
    return lowPriorityValues.includes(status as LowPriorityStatus);
}

/**
 * Get list of valid transitions from a given status
 */
export function getValidTransitions(currentStatus: LowPriorityStatus): LowPriorityStatus[] {
    const validTransitions: Record<LowPriorityStatus, LowPriorityStatus[]> = {
        'on_hold': ['todo', 'deferred'],
        'deferred': ['todo', 'on_hold'],
        backlog: ['todo', 'ready'],
        todo: ['ready', 'in_progress', 'on_hold', 'deferred'],
        ready: ['in_progress', 'backlog', 'on_hold', 'deferred'],
        'in_progress': ['in_review', 'ready', 'blocked', 'on_hold', 'deferred'],
        'in_review': ['done', 'in_progress'],
        done: [],
        blocked: ['in_progress', 'on_hold']
    };

    return validTransitions[currentStatus] || [];
}

/**
 * Check if a transition from one status to another is valid
 */
export function isValidTransition(fromStatus: string, toStatus: LowPriorityStatus): boolean {
    const current = fromStatus as LowPriorityStatus;
    const validTransitionsForCurrent = getValidTransitions(current);
    return validTransitionsForCurrent.includes(toStatus);
}

/**
 * Helper to safely parse task ID from context
 */
export function parseTaskId(taskIdOrId: string | number): string {
    if (typeof taskIdOrId === 'number') {
        return String(taskIdOrId);
    }
    return taskIdOrId.trim();
}

/**
 * Get history for a task (best for debugging)
 */
export function getTaskHistory(taskId: string): StatusTransition[] {
    const current = mockTaskStatuses.get(taskId);
    return current?.history || [];
}

// Export the full type
export type LowPriorityStatus = 'on_hold' | 'deferred' | 'backlog' | 'todo' | 'ready' | 'in_progress' | 'in_review' | 'done' | 'blocked';