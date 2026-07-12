'use client';

import { Filter as FilterIcon } from 'lucide-react';
import type { FC } from 'react';

interface BlockerFilterProps {
  /** Current filter state */
  isBlockedFilterActive: boolean;
  /** Callback when filter is toggled */
  onToggleFilter: () => void;
  /** Optional text for filter label */
  label?: string;
  /** Optional count of blocked tasks */
  blockedCount?: number;
}

/**
 * BlockerFilter - UI component for filtering blocked tasks.
 *
 * Provides a clickable toggle to show/hide only blocked tasks.
 * Displays the number of blocked tasks when that count is provided.
 *
 * @example
 * ```tsx
 * <BlockerFilter
 *   isBlockedFilterActive={false}
 *   onToggleFilter={() => setFilterActive(!filterActive)}
 *   blockedCount={5}
 * />
 * ```
 */
export const BlockerFilter: FC<BlockerFilterProps> = ({
  isBlockedFilterActive,
  onToggleFilter,
  label = 'Show only blocked tasks',
  blockedCount,
}) => {
  return (
    <button
      type="button"
      onClick={onToggleFilter}
      className={`
        flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors
        ${isBlockedFilterActive
          ? 'bg-red-50 text-red-700 border border-red-200 hover:bg-red-100'
          : 'bg-gray-100 text-gray-700 border border-gray-200 hover:bg-gray-200'
        }
      `}
      title={isBlockedFilterActive ? 'Hide blocked tasks' : 'Show only blocked tasks'}
    >
      <FilterIcon className="w-4 h-4" />
      <span>{label}</span>
      {blockedCount !== undefined && (
        <span className={`
          px-1.5 py-0.5 rounded-full text-xs font-semibold
          ${isBlockedFilterActive ? 'bg-red-200 text-red-900' : 'bg-gray-300 text-gray-700'}
        `}>
          {blockedCount}
        </span>
      )}
    </button>
  );
};

export default BlockerFilter;