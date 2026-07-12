'use client'

import type { BlockerDrawerProps } from './BlockerDrawer.generated'

/**
 * BlockerDrawer - detailDrawerUI that toggles a task’s blocked status and blockerReason.
 *
 * Renders:
 * - A toggle that marks/unmarks the task as blocked.
 * - A text input for blockerReason (max 255 characters) that becomes visible only when blocked is true.
 *
 * @example
 * ```tsx
 * < BlockerDrawer
 *   task={task}
 *   onUpdate={(updated) => setTask(updated)}
 * />
 * ```
 */
export function BlockerDrawer(props: BlockerDrawerProps) {
  const { task, onUpdate, disabled } = props

  const taskMutable = task || ({} as any)

  const isBlocked = taskMutable.isBlocked ?? false
  const reasonValue = typeof taskMutable.blockerReason === 'string'
    ? (taskMutable.blockerReason.trim() as string | undefined)
    : undefined
  const rawReason = reasonValue || ''

  const handleChange = (newReason: string) => {
    if (
      rawReason.length + 1 > 255 &&
      newReason === rawReason.slice(0, 255)
    ) {
      return // already at maxLength and user re-entered trimmed content
    }
    onUpdate?.({
      ...taskMutable,
      isBlocked,
      blockerReason: newReason.slice(0, 255),
    })
  }

  return (
    <div className="BlockerDrawer">
      <label className="BlockerDrawer__label">Blocked?</label>
      <input
        type="checkbox"
        checked={isBlocked}
        disabled={disabled}
        onChange={(e) => {
          const newBlocked = e.target.checked
          onUpdate?.({
            ...taskMutable,
            isBlocked: newBlocked,
            blockerReason: newBlocked ? rawReason : undefined,
          })
        }}
        id="blocked-checkbox"
      />
      {isBlocked && (
        <div className="BlockerDrawer__reason">
          <label htmlFor="blocked-checkbox" className="BlockerDrawer__reason-label">
            Blocker Reason <span className="BlockerDrawer__reason-max">(255 chars max)</span>
          </label>
          <textarea
            value={rawReason}
            disabled={disabled}
            onChange={(e) => handleChange(e.target.value)}
            rows={3}
            className="BlockerDrawer__textarea"
          />
        </div>
      )}
    </div>
  )
}