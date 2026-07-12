/**
 * FR5: Visual Priority Indicators Component
 *
 * Displays consistent visual priority cues across all task list/Kanban components.
 *
 * Color coding:
 * - High: red (severity)
 * - Medium: amber (warning)
 * - Low: gray (information)
 *
 * AC4: 100% of tasks display consistent visual indicators.
 */

export type Priority = 'high' | 'medium' | 'low';

export interface PriorityBadgeProps {
  priority: Priority;
  label?: string;
  size?: 'sm' | 'md' | 'lg';
}

export const PRIORITY_CONFIG: Record<
  Priority,
  {
    label: string;
    color: string; // Tailwind CSS color
    bg: string; // Tailwind CSS background
    textColor: string; // Tailwind text color
    borderColor?: string;
  }
> = {
  high: {
    label: 'High Priority',
    color: 'red-600',
    bg: 'bg-red-50',
    textColor: 'text-red-700',
    borderColor: 'border-red-200',
  },
  medium: {
    label: 'Medium Priority',
    color: 'amber-600',
    bg: 'bg-amber-50',
    textColor: 'text-amber-700',
    borderColor: 'border-amber-200',
  },
  low: {
    label: 'Low Priority',
    color: 'gray-600',
    bg: 'bg-gray-50',
    textColor: 'text-gray-700',
    borderColor: 'border-gray-200',
  },
};

/**
 * Primary PriorityBadge component
 */
export function PriorityBadge({ priority, label, size = 'md' }: PriorityBadgeProps) {
  const config = PRIORITY_CONFIG[priority];

  // Size variants
  const sizeClasses = {
    sm: 'px-2 py-1 text-xs',
    md: 'px-3 py-1 text-sm',
    lg: 'px-4 py-1.5 text-base',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border ${config.bg} ${config.textColor} ${config.borderColor} ${config.color} ${sizeClasses[size]}`}
      title={label || config.label}
    >
      <PriorityDot priority={priority} size={size as 'sm' | 'md' | 'lg'} />
      {label || config.label}
    </span>
  );
}

/**
 * Compact dot variant for inline use
 */
export function PriorityDot({
  priority,
  size = 'md',
}: {
  priority: Priority;
  size?: 'sm' | 'md' | 'lg';
}) {
  const config = PRIORITY_CONFIG[priority];

  // Size variants
  const sizeClasses = {
    sm: 'w-2 h-2',
    md: 'w-2.5 h-2.5',
    lg: 'w-3 h-3',
  };

  return (
    <span
      className={`rounded-full ${sizeClasses[size]}`}
      style={{
        backgroundColor: `var(--color-${config.color})`,
      }}
    />
  );
}

/**
 * Priority icon for Kanban boards and task cards
 */
export function PriorityIcon({ priority, size = 'md' }: PriorityBadgeProps) {
  const config = PRIORITY_CONFIG[priority];

  // Size-based icon rendering
  const icons = {
    sm: (
      <svg className={`w-3 h-3`} viewBox="0 0 16 16">
        <circle cx="8" cy="8" r="7" fill={`var(--color-${config.color})`} opacity="0.2" />
        <circle cx="8" cy="8" r="4" fill={`var(--color-${config.color})`} />
      </svg>
    ),
    md: (
      <svg className={`w-4 h-4`} viewBox="0 0 20 20">
        <circle cx="10" cy="10" r="9" fill={`var(--color-${config.color})`} opacity="0.2" />
        <circle cx="10" cy="10" r="6" fill={`var(--color-${config.color})`} />
        <path
          d="M10 5L12 9H16L13 12L14 16L10 13L6 16L7 12L4 9H8L10 5Z"
          fill={`var(--color-${config.color}-600)`}
        />
      </svg>
    ),
    lg: (
      <svg className={`w-5 h-5`} viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="11" fill={`var(--color-${config.color})`} opacity="0.2" />
        <circle cx="12" cy="12" r="8" fill={`var(--color-${config.color})`} />
        <path
          d="M12 6L14.5 10.5H19.5L15.5 13.5L17 18L12 15L7 18L8.5 13.5L4.5 10.5H9.5L12 6Z"
          fill={`var(--color-${config.color}-600)`}
        />
      </svg>
    ),
  };

  return icons[size];
}

/**
 * Priority header for lists and dashboards
 */
export function PriorityHeader({ priority }: { priority: Priority }) {
  const config = PRIORITY_CONFIG[priority];

  return (
    <div className={`flex items-center gap-2 ${config.textColor}`}>
      <div
        className={`w-2 h-2 rounded-full ${config.color}`}
        style={{ backgroundColor: `var(--color-${config.color})` }}
      />
      <span className={`font-semibold ${config.color}`}>{config.label}</span>
    </div>
  );
}

// CSS variable definitions for dynamic coloring
export const priorityCssVariables = `
:root {
  --color-red-600: #dc2626;
  --color-red-600: #991b1b;
  --color-amber-600: #d97706;
  --color-amber-600: #92400e;
  --color-gray-600: #4b5563;
  --color-gray-600: #374151;
}
`;

if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = priorityCssVariables;
  document.head.appendChild(style);
}