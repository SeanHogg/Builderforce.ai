/**
 * Generated types for front-end board components.
 *
 * This file is auto-generated from PRD definitions to provide generated component interfaces.
 * Adjustments should be kept in sync with the PRD (see board-features.md and the Blocked Items PRD).
 */

/**
 * BoardCardProps - Props to render a Kanban-style card.
 *
 * @see {link: https://prds.builderforce.ai/prd-blocked-items}
 */
export interface BoardCardProps {
  /** Unique task identifier. */
  task: {
    id: number
    title: string
    status: string
    /** Is the task currently blocked? */
    isBlocked: boolean
    /* Blocker reason text, when blocked; must not exceed 255 characters. */
    blockerReason?: string
    assignee?: {
      id: string
      name: string
    }
    dueDate?: string
    priority?: string
    /**
     * Custom blocked indicator icon; kept here for allowed types and usage.
     * Allowed values: "🚫" (default), other unicode flags, or custom Marker icons.
     */
    blockedIndicator?: string
    /* Other documented fields such as project, epic, tags, etc. */
    projectId?: number
    epicId?: number
    tags?: string[]
  }
  /** Visual rendering options for the blocked indicator. */
  visual: {
    /** The rendering leaf of marker/rendering to produce the icon. */
    blockedIndicator: string
  }
  /** Callback to toggle blocked status for the card (untriggered from this component). */
  onToggleBlocked?: (task: BoardCardProps['task']) => void
}

/**
 * BlockerBadgeProps - Props to render a reusable blocked status badge.
 *
 * @see {link: https://prds.builderforce.ai/prd-blocked-items}
 */
export interface BlockerBadgeProps {
  /** Is the task blocked? */
  isBlocked: boolean
  /** The reason why the task is blocked (max 255 characters). */
  blockerReason?: string
  /** Custom marker icon; default is '🚫'. */
  indicator?: string
  /** Tooltip placement. Defaults to 'top'. */
  tooltipPlacement?: 'top' | 'bottom' | 'left' | 'right'
}

/**
 * BlockerDrawerProps - Props to render a block/unblock UI in task detail.
 *
 * @see {link: https://prds.builderforce.ai/prd-blocked-items}
 */
export interface BlockerDrawerProps {
  /** Task being managed. */
  task: {
    id: number
    title: string
    isBlocked: boolean
    blockerReason?: string
    projectId?: number
  }
  /** Callback to update the task after blocking state change. */
  onUpdate: (updated: { id: number; isBlocked: boolean; blockerReason?: string | null }) => void
  /** Whether the field is read-only. Defaults to false. */
  disabled?: boolean
}