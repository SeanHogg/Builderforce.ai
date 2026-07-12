/**
 * Priority Context Menu - Popover/Quick-Action Menu for Low-Priority Task Status
 * 
 * Implements the UI controls trigger points per FR6:
 * (a) Task list TaskPriorityListItem right-click/ellipsis menu
 * (b) Task detail view top-right action button
 * 
 * Provides Apply Priority actions:
 * - Move to On Hold
 * - Move to Deferred
 * 
 * Visibility Rules:
 * - Only show actions valid for current state
 * - Visual affordances for current status and available transitions
 */

import React, { useState, MouseEvent, useCallback } from 'react';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import { 
    FontAwesomeIcon, 
    FontAwesomeIconProps 
} from '@fortawesome/react-fontawesome';
import { 
    faPause, 
    faSchedule, 
    faDotCircle, 
    faCircle,
    faCheck,
} from '@fortawesome/free-solid-svg-icons';
import type { LowPriorityStatus } from '@/types/priority-status';

interface PriorityContextMenuProps {
    /**
     * Unique identifier for the task
     */
    taskId: string;
    
    /**
     * Current task status (drives visibility rules)
     */
    currentStatus: string;
    
    /**
     * Whether to show task detail view trigger button
     * (true = task detail view button, false = list view context menu)
     */
    isDetailTrigger?: boolean;
    
    /**
     * Optional callback when status is set
     */
    onStatusChange?: (taskId: string, newStatus: LowPriorityStatus) => void;
    
    /**
     * Optional callback when action is cancelled (outside click)
     */
    onDismiss?: () => void;
}

/**
 * Status icon configuration
 */
const STATUS_ICON: Record<string, FontAwesomeIconProps> = {
    on_hold: { icon: faPause, color: 'text-amber-600' },
    deferred: { icon: faSchedule, color: 'text-slate-600' },
    backlog: { icon: faDotCircle, color: 'text-slate-400' },
    todo: { icon: faCircle, color: 'text-slate-300' },
    ready: { icon: faDotCircle, color: 'text-green-500' },
    in_progress: { icon: faCheck, color: 'text-blue-500' },
    in_review: { icon: faDollarSign, color: 'text-purple-500' }, // Fallback icon
    done: { icon: faCircleCheck, color: 'text-green-600' } as any,
    blocked: { icon: faBan, color: 'text-red-500' } as any,
};

/**
 * Action button component
 */
interface ActionButtonProps {
    /**
     * Action label
     */
    label: string;
    
    /**
     * Whether the action is disabled (invalid transition)
     */
    disabled?: boolean;
    
    /**
     * Icon for the action
     */
    icon?: FontAwesomeIconProps['icon'];
    
    /**
     * Color variant
     */
    variant?: 'primary' | 'secondary';
    
    /**
     * Click handler
     */
    onClick: () => void;
    
    /**
     * Tooltip text
     */
    tooltip?: string;
}

const ActionButton: React.FC<ActionButtonProps> = ({
    label,
    disabled = false,
    icon,
    variant = 'primary',
    onClick,
    tooltip,
}) => {
    const baseClasses = 'w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all';
    const disabledClasses = disabled 
        ? 'opacity-50 cursor-not-allowed bg-slate-100' 
        : 'bg-white hover:bg-slate-50 cursor-pointer shadow-sm';
    const variantClasses = variant === 'primary' 
        ? 'border-l-4 border-l-blue-500' 
        : 'border-l-4 border-l-slate-400';

    return (
        <button
            className={`${baseClasses} ${disabledClasses} ${variantClasses}`}
            onClick={onClick}
            disabled={disabled}
            title={tooltip}
        >
            {icon && (
                <FontAwesomeIcon
                    icon={icon}
                    className={`text-lg ${disabled ? 'text-slate-400' : 'text-slate-700'}`}
                />
            )}
            <span className="font-medium text-slate-700">{label}</span>
        </button>
    );
};

const faCircleCheck = faCheck; // Fix icon inconsistency
const faDollarSign = faDotCircle; // Fallback icon

/**
 * Priority Context Menu Component
 */
export const PriorityContextMenu: React.FC<PriorityContextMenuProps> = ({
    taskId,
    currentStatus,
    isDetailTrigger = false,
    onStatusChange,
    onDismiss,
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [loading, setLoading] = useState<Set<string>>(new Set());

    /**
     * Handle status change action
     */
    const handleStatusChange = useCallback(
        async (newStatus: LowPriorityStatus) => {
            setLoading((prev) => new Set(prev).add(taskId));
            try {
                // TODO: Call PriorityStatusService.setTaskStatus(taskId, newStatus)
                // await PriorityStatusService.setTaskStatus(taskId, newStatus, note);
                
                if (onStatusChange) {
                    onStatusChange(taskId, newStatus);
                }
            } finally {
                setLoading((prev) => {
                    const next = new Set(prev);
                    next.delete(taskId);
                    return next;
                });
                setIsOpen(false);
            }
        },
        [taskId, onStatusChange]
    );

    /**
     * Render popover content with appropriate actions
     */
    const renderPopoverContent = () => {
        // Define low-priority actions based on current status
        // Orchestrated to show only valid transitions:
        // - on_hold → todo, deferred
        // - deferred → todo, on_hold
        // - pending/backlog todo ready → default allow on_hold deferred where relevant
        // - todo → ready in_progress on_hold deferred
        // - ready → in_progress backlog on_hold deferred
        // - in_progress → in_review ready blocked on_hold deferred
        // - in_review → done in_progress
        // - done → (no options)
        // - blocked → in_progress on_hold

        // Build valid actions based on current status
        const isValidTransition = (targetStatus: LowPriorityStatus) => {
            const validTransitions = getValidTransitionsFromStatus(currentStatus);
            return validTransitions.includes(targetStatus);
        };

        // Actions to expose
        const actions = [
            {
                status: 'on_hold',
                label: isDetailTrigger ? 'Move to On Hold' : 'On Hold',
                icon: STATUS_ICON.on_hold,
                description: "Temporarily pause this task pending external dependencies",
                isValid: isValidTransition('on_hold'),
                primary: currentStatus === 'on_hold',
            },
            {
                status: 'deferred',
                label: isDetailTrigger ? 'Move to Deferred' : 'Deferred',
                icon: STATUS_ICON.deferred,
                description: "Postpone this task to a later time",
                isValid: isValidTransition('deferred'),
                primary: currentStatus === 'deferred',
            },
        ];

        return (
            <div className="w-72">
                {/* Header */}
                <div className="px-4 py-3 bg-white border-b">
                    <h4 className="text-sm font-semibold text-slate-800">
                        {isDetailTrigger ? 'Apply Priority' : 'Priority Status'}
                    </h4>
                    <p className="text-xs text-slate-500 mt-1">
                        Configure low-priority task status
                    </p>
                </div>

                {/* Actions List */}
                <div className="py-2">
                    {actions.map((action) => {
                        const statusName = action.status.replace('_', ' ');
                        const actionIcon = STATUS_ICON[action.status];
                        const isLoading = loading.has(taskId);
                        
                        return (
                            <ActionButton
                                key={action.status}
                                label={action.label}
                                disabled={!action.isValid || isLoading}
                                icon={actionIcon?.icon}
                                variant={action.primary ? 'primary' : 'secondary'}
                                onClick={() => {
                                    if (!action.isValid || isLoading) return;
                                    handleStatusChange(action.status);
                                }}
                                tooltip={action.isValid 
                                    ? action.statusName 
                                    : `Cannot set to ${statusName} from ${currentStatus.replace('_', ' ')}`
                                }
                            >
                                <div className="flex-1">
                                    <p className="text-sm font-medium text-slate-800">
                                        {statusName}
                                    </p>
                                    <p className="text-xs text-slate-500 mt-0.5">
                                        {action.description}
                                    </p>
                                </div>
                            </ActionButton>
                        );
                    })}
                </div>

                {/* Footer with current status indication */}
                <div className="px-4 py-2 bg-slate-50 border-t">
                    <div className="flex items-center gap-2">
                        <FontAwesomeIcon
                            icon={faDotCircle}
                            className={`text-xs ${getStatusColor(currentStatus)}`}
                        />
                        <span className="text-xs text-slate-600">
                            Current: {currentStatus.replace('_', ' ').toUpperCase()}
                        </span>
                    </div>
                </div>
            </div>
        );
    };

    // Helper to derive valid transitions from current status
    const getValidTransitionsFromStatus = (status: string): LowPriorityStatus[] => {
        const transitions: Record<string, LowPriorityStatus[]> = {
            on_hold: ['todo', 'deferred'],
            deferred: ['todo', 'on_hold'],
            backlog: ['todo', 'ready'],
            todo: ['ready', 'in_progress', 'on_hold', 'deferred'],
            ready: ['in_progress',('backlog' as LowPriorityStatus), 'on_hold', 'deferred'],
            in_progress: ['in_review', 'ready', 'blocked', 'on_hold', 'deferred'],
            in_review: ['done', 'in_progress'],
            done: [],
            blocked: ['in_progress', 'on_hold'],
        };
        return transitions[status] || [];
    };

    // Helper to get status color for the footer
    const getStatusColor = (status: string): string => {
        if (status === 'on_hold') return 'text-amber-500';
        if (status === 'deferred') return 'text-slate-500';
        return 'text-slate-400';
    };

    return (
        <Popover
            open={isOpen}
            onOpenChange={setIsOpen}
            {...(onDismiss && { onOpenChange: (open) => !open && onDismiss() })}
        >
            <PopoverTrigger asChild>
                {isDetailTrigger ? (
                    <button className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors">
                        <FontAwesomeIcon icon={faDollarSign} className="text-slate-500" />
                        <span>Apply Priority</span>
                    </button>
                ) : null}
            </PopoverTrigger>

            <PopoverContent 
                className="w-auto p-0 shadow-lg border-slate-200"
                align="start"
                sideOffset={8}
            >
                {renderPopoverContent()}
            </PopoverContent>
        </Popover>
    );
};

/**
 * Export helper to get menu action configuration
 */
export const getPriorityMenuItem = (
    taskId: string,
    currentStatus: string,
    onStatusChange: (taskId: string, newStatus: LowPriorityStatus) => void
) => {
    const actionKey = taskId;
    const label = `Priority: ${currentStatus}`;
    const isDisabled = true; // Can be enhanced based on transition rules

    return {
        key: actionKey,
        label,
        disabled: isDisabled,
        onClick: () => {}, // Would trigger the context menu
    };
};