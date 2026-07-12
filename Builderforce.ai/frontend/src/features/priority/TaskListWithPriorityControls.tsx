/**
 * Task List with Low-Priority Controls Integration Example
 *
 * Demonstrates integration of PriorityContextMenu and PriorityBadgeEnhanced
 * for managing low-priority task status in a task list view.
 *
 * This component shows how to:
 * 1. Display tasks with visual priority indicators
 * 2. Provide quick-action menus for status changes
 * 3. Show toasts for user feedback on status changes
 * 4. Use PriorityStatusService for status transitions
 */

import React, { useState, useCallback } from 'react';
import { PriorityContextMenu } from '@/components/tasks/PriorityContextMenu';
import { PriorityBadge, PriorityBadgeDot } from '@/components/tasks/PriorityBadgeEnhanced';
import { PriorityStatusService } from '@/services/priorityStatusService';
import { useToast } from '@/components/ui/use-toast';
import type { LowPriorityStatus } from '@/types/priority-status';

/**
 * Mock task data for demonstration
 */
interface MockTask {
    id: string;
    title: string;
    status: string;
    priority: 'high' | 'medium' | 'low';
    assignee?: {
        name: string;
        avatar: string;
    };
}

const mockTasks: MockTask[] = [
    {
        id: 'task-1',
        title: 'Implement authentication flow',
        status: 'in_progress',
        priority: 'high',
        assignee: {
            name: 'Jane Doe',
            avatar: 'J',
        },
    },
    {
        id: 'task-2',
        title: 'Fix API documentation issues',
        status: 'on_hold',
        priority: 'low',
        assignee: {
            name: 'Bob Smith',
            avatar: 'B',
        },
    },
    {
        id: 'task-3',
        title: 'Update user profile pages',
        status: 'deferred',
        priority: 'low',
        assignee: {
            name: 'Alice Johnson',
            avatar: 'A',
        },
    },
    {
        id: 'task-4',
        title: 'Refactor database query layer',
        status: 'in_review',
        priority: 'medium',
        assignee: {
            name: 'Charlie Brown',
            avatar: 'C',
        },
    },
    {
        id: 'task-5',
        title: 'Add unit tests for service layer',
        status: 'in_progress',
        priority: 'high',
        assignee: {
            name: 'Dana White',
            avatar: 'D',
        },
    },
];

/**
 * Task List Row Component with Priority Controls
 */
interface TaskRowProps {
    task: MockTask;
}

export const TaskRow: React.FC<TaskRowProps> = ({ task }) => {
    const [hovered, setHovered] = useState(false);
    const { toast } = useToast();

    const handleStatusChange = useCallback(
        async (taskId: string, newStatus: LowPriorityStatus) => {
            try {
                // Call the PriorityStatusService
                const response = await PriorityStatusService.setTaskStatus(taskId, newStatus);

                // Show success toast
                toast({
                    title: 'Status Updated',
                    description: `Task ${taskId} marked as ${response.newStatus.replace('_', ' ')}`,
                    variant: 'success',
                    duration: 4000,
                });

                // Refresh task status (would come from API in production)
                await refreshTaskStatus(taskId);
            } catch (error) {
                console.error('Failed to update status:', error);
                toast({
                    title: 'Update Failed',
                    description: 'There was an error updating the task status',
                    variant: 'error',
                    duration: 4000,
                });
            }
        },
        [toast]
    );

    const refreshTaskStatus = async (taskId: string) => {
        // In production, this would:
        // 1. Call PriorityStatusService.getTaskStatus(taskId)
        // 2. Update local state with returned status
        // 3. Trigger parent to refresh
        console.log(`Refreshing status for task ${taskId}`);
    };

    return (
        <div
            className={`flex items-center gap-4 p-3 rounded-lg border transition-all ${
                hovered
                    ? 'bg-slate-50 border-slate-300 shadow-sm'
                    : 'bg-white border-slate-200 hover:border-slate-300'
            }`}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            {/* Task Check */}
            <div className="w-5 h-5 border-2 border-slate-300 rounded-full" />

            {/* Task ID */}
            <span className="text-sm font-mono text-slate-500">
                {task.id}
            </span>

            {/* Task Title */}
            <div className="flex-1">
                <p className="text-sm font-medium text-slate-800">
                    {task.title}
                </p>
                <div className="flex items-center gap-2 mt-1">
                    {/* Status Badge */}
                    <PriorityBadge
                        status={task.status}
                        size="sm"
                        showIcon={true}
                    />

                    {/* Priority Badge */}
                    <span className="text-xs text-slate-500">
                        Priority: {task.priority}
                    </span>
                </div>
            </div>

            {/* Assignee Avatar */}
            {task.assignee && (
                <div
                    className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-sm font-medium text-slate-600"
                >
                    {task.assignee.avatar}
                </div>
            )}

            {/* Priority Context Menu - Quick Action Trigger */}
            <PriorityContextMenu
                taskId={task.id}
                currentStatus={task.status}
                onStatusChange={handleStatusChange}
            />

            {/* Dot indicator for low-priority status (muted styling) */}
            {['on_hold', 'deferred'].includes(task.status) && (
                <PriorityBadgeDot status={task.status} size="sm" />
            )}
        </div>
    );
};

/**
 * Task List with Priority Controls (Main Integration Example)
 */
interface TaskListWithPriorityControlsProps {
    tasks?: MockTask[];
}

export const TaskListWithPriorityControls: React.FC<TaskListWithPriorityControlsProps> = ({
    tasks = mockTasks,
}) => {
    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
    const [refreshKey, setRefreshKey] = useState(0);

    const handleTaskSelection = useCallback((taskId: string) => {
        setSelectedTaskId(taskId);
    }, []);

    /**
     * Refresh all tasks when status changes
     */
    const handleStatusUpdate = useCallback(() => {
        setRefreshKey(prev => prev + 1);
    }, []);

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-semibold text-slate-900">
                        Task List with Priority Controls
                    </h2>
                    <p className="text-sm text-slate-600 mt-1">
                        Manage low-priority status transitions with quick actions
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <PriorityBadgeDot status="on_hold" size="lg" />
                    <PriorityBadgeDot status="deferred" size="lg" />
                    <span className="text-sm text-slate-500">
                        Low-Priority Indicators
                    </span>
                </div>
            </div>

            {/* Task List */}
            <div className="space-y-2">
                {tasks.map((task) => (
                    <TaskRow
                        key={task.id}
                        task={task}
                        onSelect={() => handleTaskSelection(task.id)}
                    />
                ))}
            </div>

            {/* Legend */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <h3 className="text-sm font-semibold text-slate-800 mb-3">
                    Legend
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="flex items-center gap-2">
                        <PriorityBadgeDot status="on_hold" size="md" />
                        <span className="text-sm text-slate-600">
                            On Hold - Temporarily paused
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <PriorityBadgeDot status="deferred" size="md" />
                        <span className="text-sm text-slate-600">
                            Deferred - Postponed to later
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <PriorityBadgeDot status="in_progress" size="md" />
                        <span className="text-sm text-slate-600">
                            In Progress - Currently working
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <PriorityBadgeDot status="done" size="md" />
                        <span className="text-sm text-slate-600">
                            Done - Completed
                        </span>
                    </div>
                </div>

                {/* Interaction Hint */}
                <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <div className="flex items-start gap-2">
                        <span className="text-amber-600">
                            <strong>ℹ️</strong>
                        </span>
                        <div className="text-xs text-amber-800">
                            <p className="font-medium mb-1">How to Use:</p>
                            <ol className="list-decimal list-inside space-y-1">
                                <li>Click the priority badge in the right column</li>
                                <li>Choose "On Hold" or "Deferred" from the menu</li>
                                <li>View confirmation toast notification</li>
                                <li>Status updates are audited with timestamp and user</li>
                            </ol>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

/**
 * Task Detail View Component with Priority Controls
 *
 * Shows high-level example of how to integrate PriorityContextMenu
 * into a task detail view.
 */

export const TaskDetailWithPriority: React.FC = () => {
    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
    const { toast } = useToast();

    // In production, this would fetch task detail from API
    const selectedTask = mockTasks.find(
        (t) => t.id === selectedTaskId
    );

    const handleStatusChange = useCallback(
        async (taskId: string, newStatus: LowPriorityStatus) => {
            try {
                const response = await PriorityStatusService.setTaskStatus(taskId, newStatus);

                toast({
                    title: 'Task Status Updated',
                    description: `Status changed to ${response.newStatus.replace('_', ' ')}`,
                    variant: 'success',
                    duration: 4000,
                });

                // Refresh task detail
                // await refreshTaskDetail(taskId);
            } catch (error) {
                console.error('Failed to update status:', error);
                toast({
                    title: 'Update Failed',
                    description: 'There was an error updating the task status',
                    variant: 'error',
                    duration: 4000,
                });
            }
        },
        [toast]
    );

    return (
        <div className="max-w-4xl mx-auto space-y-6 p-4">
            {/* Task Header */}
            <div className="flex items-start justify-between">
                <div>
                    <h2 className="text-2xl font-semibold text-slate-900">
                        Task Detail with Priority Controls
                    </h2>
                    <p className="text-sm text-slate-600 mt-1">
                        Example integration for task detail views
                    </p>
                </div>

                {/* Priority Context Menu - Top Right Action Button */}
                <PriorityContextMenu
                    taskId={selectedTaskId || 'task-1'}
                    currentStatus={selectedTask?.status || 'in_progress'}
                    isDetailTrigger={true}
                    onStatusChange={handleStatusChange}
                />
            </div>

            {/* Selected Task Detail */}
            {selectedTask && (
                <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                    <div className="flex items-start justify-between">
                        <div>
                            <p className="text-sm font-mono text-slate-500 mb-2">
                                {selectedTask.id}
                            </p>
                            <h3 className="text-xl font-semibold text-slate-900 mb-4">
                                {selectedTask.title}
                            </h3>

                            <div className="flex items-center gap-4">
                                {/* Status Badge */}
                                <PriorityBadge
                                    status={selectedTask.status}
                                    size="lg"
                                    showIcon={true}
                                />

                                {/* Priority Badge */}
                                <span className="px-3 py-1 rounded-full bg-slate-100 text-sm font-medium text-slate-700">
                                    Priority: {selectedTask.priority}
                                </span>
                            </div>

                            {/* Assignee */}
                            {selectedTask.assignee && (
                                <div className="mt-4 flex items-center gap-3">
                                    <div
                                        className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center text-sm font-medium text-slate-600"
                                    >
                                        {selectedTask.assignee.avatar}
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium text-slate-800">
                                            {selectedTask.assignee.name}
                                        </p>
                                        <p className="text-xs text-slate-500">
                                            Assigned Developer
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Visual Status Indicator */}
                        <PriorityBadgeDot
                            status={selectedTask.status}
                            size="xl"
                            className="border-4 border-slate-200"
                        />
                    </div>

                    {/* Status History Section (example) */}
                    <div className="mt-6 pt-6 border-t border-slate-200">
                        <h4 className="text-sm font-semibold text-slate-700 mb-3">
                            Status History
                        </h4>
                        <div className="space-y-2">
                            <div className="flex items-center gap-3 p-2 bg-slate-50 rounded-lg">
                                <span className="text-xs text-slate-500">
                                    Jan 15, 2025, 2:30 PM
                                </span>
                                <span className="text-sm text-slate-700">
                                    Changed to <strong>On Hold</strong>
                                </span>
                                <span className="text-xs text-slate-500 ml-auto">
                                    jane@example.com
                                </span>
                            </div>
                            <div className="flex items-center gap-3 p-2 bg-slate-50 rounded-lg">
                                <span className="text-xs text-slate-500">
                                    Jan 12, 2025, 10:00 AM
                                </span>
                                <span className="text-sm text-slate-700">
                                    Created
                                </span>
                                <span className="text-xs text-slate-500 ml-auto">
                                    system
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Usage Instructions */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <h3 className="text-sm font-semibold text-slate-800 mb-2">
                    Integration Guide
                </h3>
                <div className="text-sm text-slate-600 space-y-2">
                    <p>
                        This example demonstrates the integration of PriorityContextMenu
                        into task list and detail views. For production use:
                    </p>
                    <ul className="list-disc list-inside space-y-1 ml-4">
                        <li>Replace mock data with real API calls</li>
                        <li>Add proper error handling and loading states</li>
                        <li>Implement proper user authentication context</li>
                        <li>Add validation for status transitions</li>
                        <li>Set up proper state management for task list</li>
                    </ul>
                </div>
            </div>
        </div>
    );
};

// Export priority status service for integration
export const PriorityStatusService = PriorityStatusService;