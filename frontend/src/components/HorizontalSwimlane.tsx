'use client';

import { memo } from 'react';

export interface Swimlane {
  id: string;
  title: string;
  subtitle?: React.ReactNode;
  content: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
}

export interface HorizontalSwimlaneProps {
  /** Array of swimlane items to render horizontally */
  lanes: Swimlane[];
  /** Optional minimum width for each lane (affects horizontal scroll behavior) */
  minLaneWidth?: string;
  /** Optional custom styles for the container */
  containerStyle?: React.CSSProperties;
  /** Optional custom styles for lane items */
  laneStyle?: React.CSSProperties;
}

/**
 * Responsive horizontal swimlane component for mobile and desktop.
 * Enables horizontal scrolling when lanes exceed the viewport width.
 *
 * Mobile: Scroll horizontally to see all lanes.
 * Desktop: Can fit all lanes or scroll depending on width.
 */
export function HorizontalSwimlane({
  lanes,
  minLaneWidth = '280px',
  containerStyle,
  laneStyle: laneStyleProp,
}: HorizontalSwimlaneProps) {
  const containerDefaultStyle: React.CSSProperties = {
    overflowX: 'auto',
    overflowY: 'hidden',
    whiteSpace: 'nowrap',
    display: 'flex',
    gap: 12,
    padding: '12px 8px',
    scrollbarWidth: 'thin',
    WebkitOverflowScrolling: 'touch',
    scrollSnapType: 'x mandatory',
    '-webkit-overflow-scrolling': 'touch',
    /* Hide scrollbar for cleaner look but keep functionality */
    scrollbarWidth: 'none',
    msOverflowStyle: 'none',
  };

  // Hide scrollbar via CSS in addition to inline style
  const containerAlwaysStyle: React.CSSProperties = {
    scrollbarWidth: 'none',
    msOverflowStyle: 'none',
    '-ms-overflow-style': 'none',
  };

  const laneDefaultStyle: React.CSSProperties = {
    display: 'inline-flex',
    flexDirection: 'column',
    minWidth: minLaneWidth,
    maxWidth: minLaneWidth,
    flexShrink: 0,
    width: 'fit-content',
    padding: '16px',
    background: 'var(--surface-card)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    gap: '12px',
    overflow: 'hidden',
    scrollSnapAlign: 'start',
    verticalAlign: 'top',
    userSelect: 'none',
    WebkitUserSelect: 'none',
  };

  return (
    <div
      style={{ ...containerDefaultStyle, ...containerStyle, ...containerAlwaysStyle }}
      className="horizontal-swimlane"
      aria-label="Horizontal swimlanes"
    >
      {lanes.map((lane) => (
        <div
          key={lane.id}
          style={{ ...laneDefaultStyle, ...laneStyleProp }}
          className="swimlane-item"
          tabIndex={0}
        >
          {lane.icon && (
            <div style={{ flexShrink: 0, marginBottom: 8 }}>{lane.icon}</div>
          )}
          {(lane.title || lane.subtitle) && (
            <div style={{ flexShrink: 0 }} className="swimlane-header">
              {lane.title && (
                <div
                  style={{
                    fontSize: '14px',
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                    marginBottom: 2,
                    lineHeight: '1.2',
                  }}
                >
                  {lane.title}
                </div>
              )}
              {lane.subtitle && (
                <div
                  style={{
                    fontSize: '12px',
                    color: 'var(--text-secondary)',
                    lineHeight: '1.3',
                  }}
                >
                  {lane.subtitle}
                </div>
              )}
            </div>
          )}
          <div
            style={{
              flex: 1,
              minWidth: 0, /* Essential for flex items with long content */
              overflow: 'hidden',
            }}
            className="swimlane-content"
          >
            {lane.content}
          </div>
          {lane.actions && <div style={{ flexShrink: 0 }}>{lane.actions}</div>}
        </div>
      ))}
    </div>
  );
}

// Export a memoized version for better performance with many lanes
const MemoizedHorizontalSwimlane = memo(HorizontalSwimlane);

export default MemoizedHorizontalSwimlane;