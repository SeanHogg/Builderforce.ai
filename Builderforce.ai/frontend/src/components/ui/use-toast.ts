/**
 * React Hook for toast notifications
 * 
 * Provides toast feedback for status changes (FR6 requirement)
 */

import { useState, useCallback, useEffect } from 'react';

export interface ToastProps {
    id: string;
    title?: string;
    description?: string;
    variant?: 'default' | 'success' | 'warning' | 'error';
    duration?: number;
}

type Toaster = {
    toast: (props: Omit<ToastProps, 'id'>) => void;
    dismiss: (id: string) => void;
    removeAll: () => void;
    toasts: ToastProps[];
};

/**
 * React Hook for toast notifications
 */
export function useToast(): Toaster {
    const [toasts, setToasts] = useState<ToastProps[]>([]);

    const toast = useCallback((props: Omit<ToastProps, 'id'>) => {
        const id = Math.random().toString(36).substring(7);
        const newToast: ToastProps = {
            id,
            ...props,
        };
        
        setToasts((prev) => [...prev, newToast]);
        
        // Auto dismiss
        const duration = props.duration ?? 3000;
        if (duration > 0) {
            setTimeout(() => {
                setToasts((prev) => prev.filter((t) => t.id !== id));
            }, duration);
        }
        
        return id;
    }, []);

    const dismiss = useCallback((id: string) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
    }, []);

    const removeAll = useCallback(() => {
        setToasts([]);
    }, []);

    return {
        toast,
        dismiss,
        removeAll,
        toasts,
    };
}