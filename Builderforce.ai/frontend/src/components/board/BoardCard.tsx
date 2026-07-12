'use client'

import type { BoardCardProps } from './BoardCard.generated'

/**
 * BoardCard - Kanban-style card frontend component.
 *
 * Responsible for rendering a task in board/list views with blocked status indicators and tooltip information.
 * 1. blocked indicator (red flag/badge) is shown when task.isBlocked is true
 * 2. tooltip over the blocked badge shows the blockerReason up to 255 chars
 * 3. other card fields (title, assignee, due date, etc.) are rendered by the caller via BoardCardProps
 *
 * @example
 * ```tsx
 * < BoardCard
 *   task={task}
 *   onToggleBlocked={() => setTask(prev => ({ ...prev, isBlocked: !prev.isBlocked }))}
 * />
 * ```
 */
export function BoardCard(props: BoardCardProps) {
  // Accept validation from generated types and runtime guard
  if (!props?.task?.id || !props?.visual?.blockedIndicator) {
    return null
  }

  const task = props.task
  const isBlocked = task.isBlocked ?? false

  const tooltipText = (() => {
    if (!isBlocked) return undefined
    const reason = task.blockerReason as string | undefined
    if (!reason) return 'Blocked'
    // Enforce maxLength=255 and trim trailing spaces
    const cleanReason = reason.trim()
    return cleanReason.length <= 255 ? cleanReason : cleanReason.slice(0, 255)
  })()

  // Render main action with toggleBlocked in the primary call site (onToggleBlocked)
  // Action cannot be clicked via this component; that must be mediated by the board implementation
  return (
    <div className="BoardCard">
      {/* Restrict to the requested single indicator type */}
      {isBlocked && (
        <span className="BoardCard__blocked-indicator" title={tooltipText}>
          {props.visual.blockedIndicator}
        </span>
      )}
      {/* Other fields are rendered by the caller via BoardCardProps */}
    </div>
  )
}