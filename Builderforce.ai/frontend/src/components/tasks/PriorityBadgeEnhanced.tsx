/**
 * Enhanced Priority Badge Component for Low-Priority Status
 * 
 * Implements FR5/FR6 Visual Indicators for on_hold and deferred statuses.
 * Provides consistent coloring (High red, Medium amber, Low gray)
 * with scale support (sm/md/lg/xl variants).
 */

import React from 'react';
import { FontAwesomeIcon, FontAwesomeIconProps } from '@fortawesome/react-fontawesome';

export interface PriorityBadgeProps {
    /**
     * Current task status
     */
    status: string;
    
    /**
     * Badge size variant
     */
    size?: 'sm' | 'md' | 'lg' | 'xl';
    
    /**
     * Whether to show icon
     */
    showIcon?: boolean;
    
    /**
     * Custom class names
     */
    className?: string;
}

/**
 * Status badge configuration
 */
const BADGE_CONFIG: Record<string, {
    color: string;
    bgColor: string;
    textColor: string;
    fontSize: string;
    icon: FontAwesomeIconProps['icon'];
}> = {
    on_hold: {
        color: 'text-amber-600',
        bgColor: 'bg-amber-50',
        textColor: 'text-amber-700',
        fontSize: 'text-xs',
        icon: 'fa-pause',
    },
    deferred: {
        color: 'text-slate-500',
        bgColor: 'bg-slate-100',
        textColor: 'text-slate-700',
        fontSize: 'text-xs',
        icon: 'fa-clock',
    },
    backlog: {
        color: 'text-slate-400',
        bgColor: 'bg-slate-50',
        textColor: 'text-slate-600',
        fontSize: 'text-xs',
        icon: 'fa-inbox',
    },
    todo: {
        color: 'text-slate-300',
        bgColor: 'bg-slate-50',
        textColor: 'text-slate-600',
        fontSize: 'text-xs',
        icon: 'fa-circle',
    },
    ready: {
        color: 'text-green-500',
        bgColor: 'bg-green-50',
        textColor: 'text-green-700',
        fontSize: 'text-xs',
        icon: 'fa-check-circle',
    },
    in_progress: {
        color: 'text-blue-500',
        bgColor: 'bg-blue-50',
        textColor: 'text-blue-700',
        fontSize: 'text-xs',
        icon: 'fa-spinner',
    },
    in_review: {
        color: 'text-purple-500',
        bgColor: 'bg-purple-50',
        textColor: 'text-purple-700',
        fontSize: 'text-xs',
        icon: 'fa-eye',
    },
    done: {
        color: 'text-emerald-600',
        bgColor: 'bg-emerald-50',
        textColor: 'text-emerald-700',
        fontSize: 'text-xs',
        icon: 'fa-circle-check',
    },
    blocked: {
        color: 'text-red-500',
        bgColor: 'bg-red-50',
        textColor: 'text-red-700',
        fontSize: 'text-xs',
        icon: 'fa-ban',
    },
};

/**
 * Size mapping
 */
const SIZE_CLASSES: Record<string, string> = {
    sm: {
        badge: 'px-2 py-0.5',
        text: 'text-[10px]',
        icon: 'text-xs',
        dot: 'w-1.5 h-1.5',
        dotSm: 'w-1 h-1',
    },
    md: {
        badge: 'px-3 py-1',
        text: 'text-xs',
        icon: 'text-sm',
        dot: 'w-2 h-2',
        dotSm: 'w-1.5 h-1.5',
    },
    lg: {
        badge: 'px-4 py-1.5',
        text: 'text-sm',
        icon: 'text-base',
        dot: 'w-2.5 h-2.5',
        dotSm: 'w-2 h-2',
    },
    xl: {
        badge: 'px-5 py-2',
        text: 'text-base',
        icon: 'text-lg',
        dot: 'w-3 h-3',
        dotSm: 'w-2.5 h-2.5',
    },
};

interface SizeClasses {
    badge: string;
    text: string;
    icon: string;
    dot: string;
    dotSm: string;
}

function getSizeClasses(size: 'sm' | 'md' | 'lg' | 'xl'): SizeClasses {
    return SIZE_CLASSES[size];
}

/**
 * Priority Badge Component
 */
export const PriorityBadge: React.FC<PriorityBadgeProps> = ({
    status,
    size = 'sm',
    showIcon = true,
    className = '',
}) => {
    const config = BADGE_CONFIG[status] || BADGE_CONFIG.todo;
    const sizeClasses = getSizeClasses(size);
    
    const badgeClasses = [
        'inline-flex items-center gap-1.5 rounded-full font-medium',
        config.bgColor,
        config.color,
        sizeClasses.badge,
    ].join(' ');

    return (
        <span className={`${badgeClasses} ${className}`}>
            {showIcon && config.icon && (
                <FontAwesomeIcon 
                    icon={config.icon} 
                    className={`${config.color} ${sizeClasses.icon} ${config.icon === 'fa-spinner' ? 'animate-spin' : ''}`}
                />
            )}
            <span className={`${config.textColor} ${sizeClasses.text}`}>
                {status.toUpperCase()}
            </span>
        </span>
    );
};

/**
 * Dot Only Variant - for compact display
 */
export interface PriorityBadgeDotProps {
    status: string;
    size?: 'sm' | 'md' | 'lg' | 'xl';
    className?: string;
}

export const PriorityBadgeDot: React.FC<PriorityBadgeDotProps> = ({
    status,
    size = 'md',
    className = '',
}) => {
    const config = BADGE_CONFIG[status] || BADGE_CONFIG.todo;
    const sizeClasses = getSizeClasses(size);
    
    const dotClasses = [
        'rounded-full',
        config.bgColor,
        config.color,
        sizeClasses.dot,
        className,
    ].join(' ');

    return (
        <span className={dotClasses}>
            {showIcon && config.icon && (
                <FontAwesomeIcon 
                    icon={config.icon} 
                    className={`${config.color} ${sizeClasses.dotSm}`}
                />
            )}
        </span>
    );
};