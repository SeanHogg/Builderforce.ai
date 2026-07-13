import React from 'react';

/**
 * PriorityBadge - Visual priority indicator component
 * 
 * Variants for displaying task priority consistently across all views:
 * - Badge: Text badge with background color
 * - Dot: Compact dot indicator
 * - Icon: Icon with optional text
 * - Header: Full header-style badge with more emphasis
 * 
 * Color mapping based on priority level (consistent with PriorityAlignmentDashboard):
 * - High (urgent): red danger
 * - Medium (high): amber warn
 * - Low (medium/low): gray default or muted
 */

export type PriorityVariant = 'badge' | 'dot' | 'icon' | 'header';
export type PriorityScale = 'sm' | 'md' | 'lg';

export interface PriorityBadgeProps {
  priority: string;
  variant: PriorityVariant;
  scale?: PriorityScale;
  label?: string;
  icon?: React.ReactNode;
  className?: string;
  showLabel?: boolean;
  link?: boolean;
}

const COLORS = {
  high: {
    bg: 'rgba(239, 68, 68, 0.15)',
    text: '#ef4444',
    border: '#ef4444',
    dot: '#ef4444',
  },
  medium: {
    bg: 'rgba(245, 158, 11, 0.15)',
    text: '#f59e0b',
    border: '#f59e0b',
    dot: '#f59e0b',
  },
  low: {
    bg: 'transparent',
    text: '#6b7280',
    border: 'transparent',
    dot: '#9ca3af',
  },
} as const;

const SIZES = {
  sm: { base: 'text-xs', padding: '1.5px 8px', fontSize: '10px', borderWidth: '0.5px' },
  md: { base: 'text-sm', padding: '2px 10px', fontSize: '12px', borderWidth: '1px' },
  lg: { base: 'text-base', padding: '3px 12px', fontSize: '14px', borderWidth: '1px' },
};

function getPriorityInfo(priority: string) {
  const p = priority.toLowerCase().replace(/[^a-z]/g, '');
  
  if (p === 'urgent' || p === 'high') {
    return { level: 'high', label: 'High' };
  }
  if (p === 'medium') {
    return { level: 'medium', label: 'Medium' };
  }
  if (p === 'low') {
    return { level: 'low', label: 'Low' };
  }
  return { level: 'low', label: 'None' };
}

export function PriorityBadge({
  priority,
  variant,
  scale = 'md',
  label,
  icon,
  className = '',
  showLabel = true,
  link = false,
}: PriorityBadgeProps) {
  const { level, labelText } = getPriorityInfo(priority);
  const labels = label ?? labelText;
  const color = COLORS[level];
  const size = SIZES[scale];
  
  if (variant === 'dot') {
    return (
      <span
        className={className}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 2,
        }}
      >
        <span
          style={{
            width: size.borderWidth === '0.5px' ? 4 : 6,
            height: size.borderWidth === '0.5px' ? 4 : 6,
            borderRadius: 2,
            backgroundColor: color.dot,
            flexShrink: 0,
          }}
          aria-hidden="true"
        />
        {showLabel && labels && (
          <span
            style={{
              fontSize: size.fontSize,
              color: color.text,
            }}
          >
            {labels}
          </span>
        )}
      </span>
    );
  }

  if (variant === 'icon') {
    return (
      <span
        className={className}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        {icon && (
          <span
            style={{
              fontSize: size.fontSize,
              color: color.text,
              display: 'flex',
              alignItems: 'center',
            }}
            aria-hidden="true"
          >
            {icon}
          </span>
        )}
        {showLabel && labels && (
          <span
            style={{
              fontSize: size.fontSize,
              color: color.text,
            }}
          >
            {labels}
          </span>
        )}
      </span>
    );
  }

  const baseStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: size.borderWidth === '0.5px' ? 2 : 4,
    padding: size.padding,
    borderRadius: size.borderWidth === '0.5px' ? 12 : 999,
    backgroundColor: variant === 'header' ? color.bg : 'transparent',
    border: `${size.borderWidth} solid ${color.border}`,
    color: color.text,
    fontSize: size.fontSize,
    fontWeight: variant === 'header' ? 600 : 'normal',
    whiteSpace: 'nowrap',
    ...(link && { cursor: 'pointer' }),
  };

  if (variant === 'badge') {
    return (
      <span className={className} style={baseStyle}>
        {showLabel && labels && (
          <span style={{ fontWeight: variant === 'header' ? 600 : 500 }}>{labels}</span>
        )}
      </span>
    );
  }

  if (variant === 'header') {
    return (
      <span
        className={className}
        style={{
          ...baseStyle,
          padding: size.padding.replace(/\s+/g, ' ').split(' ').map((v, i) => `${v} ${i === 1 ? size.padding.split(' ')[2] : ''}`.trim()).join(' '),
          gap: variant === 'header' ? 8 : 4,
        }}
      >
        {labels && <span style={{ fontWeight: 600 }}>{labels}</span>}
      </span>
    );
  }

  return null;
}

/**
 * PriorityBadgeList - Renders priority indicators for multiple items
 * Useful for lists where multiple priorities need to be displayed compactly
 */
export interface PriorityBadgeListProps<T extends { priority?: string }> {
  items: T[];
  variant?: PriorityVariant;
  scale?: PriorityScale;
  compact?: boolean;
  renderItem: (item: T, priority: string | undefined) => React.ReactNode;
}

export function PriorityBadgeList<T extends { priority?: string }>({
  items,
  variant = 'dot',
  scale = 'sm',
  compact = false,
  renderItem,
}: PriorityBadgeListProps<T>) {
  if (compact && items.length > 1) {
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {items.slice(0, 3).map((item, i) => {
          const priority = item.priority;
          const { level } = getPriorityInfo(priority);
          const color = COLORS[level];
          
          return (
            <span
              key={i}
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: color.dot,
                flexShrink: 0,
              }}
              title={priority}
              aria-hidden="true"
            />
          );
        })}
        {items.length > 3 && (
          <span style={{ fontSize: '10px', color: '#9ca3af' }}>
            +{items.length - 3}
          </span>
        )}
      </span>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 1 : 2 }}>
      {items.map((item, i) => {
        const priority = item.priority;
        const { level } = getPriorityInfo(priority);
        const color = COLORS[level];
        
        return (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: '12px',
            }}
          >
            <div
              style={{
                width: compact ? 4 : 6,
                height: compact ? 4 : 6,
                borderRadius: compact ? 2 : 3,
                backgroundColor: color.dot,
                flexShrink: 0,
              }}
            />
            <div style={{ flex: 1 }}>
              {renderItem(item, priority)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * PriorityBadgeColumn - Shows priority distribution in a column
 */
export interface PriorityBadgeColumnProps {
  items: { priority: string; label?: string; icon?: React.ReactNode }[];
}

export function PriorityBadgeColumn({ items }: PriorityBadgeColumnProps) {
  const total = items.length;
  if (total === 0) return null;
  
  const distribution = items.reduce((acc, item) => {
    const level = getPriorityInfo(item.priority).level;
    acc[level] = (acc[level] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  
  const max = Math.max(...Object.values(distribution));
  
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {Object.entries(COLORS).map(([level, color], i) => {
        const count = distribution[level];
        if (!count) return null;
        
        const percentage = (count / max) * 100;
        
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: color.dot,
                flexShrink: 0,
              }}
              aria-hidden="true"
            />
            <span
              style={{
                fontSize: '12px',
                fontWeight: 500,
                minWidth: 50,
                flex: 1,
              }}
            >
              {capitalizeFirstLetter(level)}
            </span>
            <div
              style={{
                flex: 1,
                height: 8,
                borderRadius: 4,
                overflow: 'hidden',
                backgroundColor: 'rgba(0,0,0,0.05)',
              }}
            >
              <div
                style={{
                  width: `${percentage}%`,
                  height: '100%',
                  backgroundColor: color.dot,
                  transition: 'width 0.5s ease',
                }}
              />
            </div>
            <span style={{ fontSize: '12px', fontWeight: 600, minWidth: 20, textAlign: 'right' }}>
              {count}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function capitalizeFirstLetter(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}