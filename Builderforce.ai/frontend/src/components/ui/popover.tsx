/**
 * Popover Component
 * 
 * Minimal UI component for popovers and menus.
 * This is a simplified implementation for the PriorityContextMenu component.
 */

import React, { ReactNode } from 'react';

export interface PopoverProps {
    /**
     * Whether the popover is open
     */
    open: boolean;
    
    /**
     * Callback when popover state changes
     */
    onOpenChange?: (open: boolean) => void;
    
    /**
     * Child elements to render (triggers + content)
     */
    children: ReactNode;
    
    /**
     * Additional class names
     */
    className?: string;
    
    /**
     * Additional props to pass to content wrapper
     */
    contentProps?: Record<string, unknown>;
}

interface PopoverContentProps extends Record<string, unknown> {
    children?: ReactNode;
    className?: string;
    align?: 'start' | 'center' | 'end';
    sideOffset?: number;
}

interface PopoverTriggerProps extends Record<string, unknown> {
    children?: ReactNode;
    asChild?: boolean;
}

/**
 * Popover Content Component
 */
export const PopoverContent: React.FC<PopoverContentProps> = ({
    children,
    className = '',
    align = 'center',
    sideOffset = 4,
    ...props
}) => {
    const baseClasses = `
        relative z-50 w-auto rounded-lg border border-slate-200 
        bg-white shadow-lg focus:outline-none
        animate-in fade-in zoom-in-95 duration-200
        dark:border-slate-800 dark:bg-slate-900
    `;
    
    const alignClasses: Record<string, string> = {
        start: 'origin-top-left',
        center: 'origin-top',
        end: 'origin-top-right',
    };

    return (
        <div
            className={`${baseClasses} ${alignClasses[align]} ${className}`}
            {...props}
        >
            {children}
        </div>
    );
};

/**
 * Popover Trigger Component
 */
export const PopoverTrigger: React.FC<PopoverTriggerProps> = ({
    children,
    asChild = false,
    ...props
}) => {
    if (asChild) {
        return <>{children}</>;
    }
    
    return (
        <button
            type="button"
            className="inline-flex"
            {...props}
        >
            {children}
        </button>
    );
};

/**
 * Popover Component
 */
export const Popover: React.FC<PopoverProps> = ({
    open,
    onOpenChange,
    children,
    className = '',
    ...props
}) => {
    return (
        <div className={`relative ${className}`}>
            {React.Children.map(children, (child) => {
                if (!React.isValidElement(child)) return child;
                
                if (child.type === PopoverTrigger) {
                    // Trigger is rendered outside the popover wrapper
                    const { asChild, ...triggerProps } = child.props;
                    React.cloneElement(child, {
                        ...triggerProps,
                        onClick: (e: React.MouseEvent) => {
                            triggerProps.onClick?.(e);
                            onOpenChange?.(!open);
                        },
                    });
                }
                
                if (child.type === PopoverContent) {
                    // Content is only rendered when open
                    if (open) {
                        const { align, sideOffset, ...contentProps } = child.props;
                        return (
                            <div
                                className="fixed left-0 right-0 top-0 bottom-0 z-40"
                                onClick={() => onOpenChange?.(false)}
                            >
                                <div
                                    style={{ margin: `${sideOffset}px` }}
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <PopoverContent
                                        {...contentProps}
                                        align={align}
                                    >
                                        {child.props.children}
                                    </PopoverContent>
                                </div>
                            </div>
                        );
                    }
                }
                
                return child;
            })}
        </div>
    );
};