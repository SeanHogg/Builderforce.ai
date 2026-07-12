/**
 * Low Priority Status Management Types
 * 
 * Defines the type system for low-priority task status transitions
 * in the Priority Alignment Initiative (FR6)
 */

/**
 * Low priority task statuses
 * extending from existing task statuses to maintain consistency
 */
export type LowPriorityStatus = 
    | "on_hold"           // Temporary pause pending external dependencies
    | "deferred"          // postponed to a later time
    | "backlog"           // Not yet started
    | "todo"              // Not yet started
    | "ready"             // Ready to start
    | "in_progress"       // Being worked on
    | "in_review"         // Under review
    | "done"              // Completed
    | "blocked";          // Blockers preventing progress

/**
 * Flags for low-priority status
 */
export interface LowPriorityFlags {
    /**
     * Whether this task is currently in a low-priority state
     */
    isLowPriority: boolean;
    
    /**
     * Current priority status (if low priority)
     */
    priorityStatus?: LowPriorityStatus;
}

/**
 * API response for getTaskStatus
 */
export interface GetTaskStatusResponse {
    /**
     * Current task status
     */
    status: string;
    
    /**
     * Low priority flags
     */
    flags: LowPriorityFlags;
    
    /**
     * Task metadata included for context
     */
    taskId: string;
}

/**
 * Status transition request
 */
export interface SetStatusRequest {
    /**
     * Optional note explaining the status change
     * Used for auditability and transparency
     */
    note?: string;
    
    /**
     * Reason for the status change
     * Optional structured reason classification
     */
    reason?: 'external_dependency' | 'resource_prioritization' | 'unknown';
}

/**
 * Status transition response
 */
export interface SetStatusResponse {
    /**
     * Task ID that was updated
     */
    taskId: string;
    
    /**
     * Previous status
     */
    previousStatus: string;
    
    /**
     * New status
     */
    newStatus: string;
    
    /**
     * Timestamp of the transition
     */
    timestamp: string;
    
    /**
     * User who initiated the transition (for audit)
     */
    user: string;
    
    /**
     * Optional note attached to the change
     */
    note?: string;
}