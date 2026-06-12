/**
 * Defines the structure for task-related events.
 */

// Event when a task is successfully completed.
export interface TaskCompletionEvent {
	taskId: string;
	accountId: string;
	completionTimestamp: Date;
	// Add any other relevant fields, e.g., status, result, etc.
}

// Event when a task's details are updated (could be status change, field update, etc.).
export interface TaskUpdateEvent {
	taskId: string;
	accountId: string;
	status: string; // e.g., "in_progress", "pending", "failed"
	updatedFields: Record<string, any>; // Fields that were updated
	updateTimestamp: Date;
	// Add any other relevant fields
}

// You can add more event types as needed, e.g., TaskCreatedEvent, TaskFailedEvent, etc.
