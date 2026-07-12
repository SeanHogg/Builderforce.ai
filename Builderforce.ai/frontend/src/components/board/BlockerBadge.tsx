'use client'

import type { BlockerBadgeProps } from './BlockerBadge.generated'

/**
 * BlockerBadge - reusable hovered blocked indicator.
 *
 * Displays the blocked status adjacent to the card and shows the blockerReason in a tooltip.
 *
 * @example
 * ```tsx
 * < BlockerBadge
 *   isBlocked={task.isBlocked ?? false}
 *   blockerReason={task.blockerReason as string}
 *   indicator="🚫"
 *   tooltipPlacement="top"
 * />
 * ```
 */
export function BlockerBadge(props: BlockerBadgeProps) {
  // Runtime guard on API-contracted props
  if (typeof props?.isBlocked !== 'boolean' || !props?.indicator) {
    return null
  }

  const { isBlocked, blockerReason, indicator, tooltipPlacement } = props

  const tooltipText = (() => {
    if (!isBlocked) return undefined
    const reason = blockerReason as string | undefined
    if (!reason) return 'Blocked'
    // maxLength=255 enforced; trim and truncate
    const cleanReason = reason.trim()
    return cleanReason.length <= 255 ? cleanReason : cleanReason.slice(0, 255)
  })()

  if (!isBlocked) return null

  return (
    <span className="BlockerBadge" title={tooltipText}>
      {indicator}
    </span>
  )
}