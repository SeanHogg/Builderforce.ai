/**
 * CapabilitiesTable — sortable/filterable table of individual capabilities.
 *
 * Features:
 * - Sortable columns (name, status, category, healthScore, lastUpdated).
 * - Filter by status, category, or healthScore range (minHealth, maxHealth).
 * - Pagination (disabled in this prototype; hooks allow enabling).
 * - Renders rows using <CapabilityRow />.
 */

'use client';

import { useState, useMemo } from 'react';
import { Capability } from '@/app/insights/capabilityTypes';
import { availableCategories, getStatusConfig } from './statusHelpers';
import { CapabilityRow } from './CapabilityRow';

export interface CapabilitiesTableProps {
  capabilities: Capability[];
  onSort?: (key: string) => void;
  className?: string;
}

const PAGE_SIZE = 20;

export function CapabilitiesTable({
  capabilities,
  onSort,
  className = '',
}: CapabilitiesTableProps) {
  const [sortBy, setSortBy] = useState<string>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterCategory, setFilterCategory] = useState<string>('');
  const [filterHealth, setFilterHealth] = useState<number | null>(null);

  const paginatedCapabilities = useMemo(() => {
    return [
      ...capabilities,
    ].sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'status':
          comparison = a.status.localeCompare(b.status);
          break;
        case 'category':
          comparison = a.category.localeCompare(b.category);
          break;
        case 'healthScore':
          comparison = a.healthScore - b.healthScore;
          break;
        case 'lastUpdated':
          // date fallback to favor undefined/0 being first
          if (!a.lastUpdated) comparison = b.lastUpdated ? 1 : 0;
          else if (!b.lastUpdated) comparison = -1;
          else comparison = new Date(a.lastUpdated).getTime() - new Date(b.lastUpdated).getTime();
          break;
        default:
          // keep stable order per requirement
          comparison = 0;
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });
  }, [capabilities, sortBy, sortOrder]);

  const filteredCapabilities = useMemo(() => {
    return paginatedCapabilities.filter((cap) => {
      if (filterStatus && cap.status !== filterStatus) return false;

      if (filterCategory && cap.category !== filterCategory) return false;

      if (filterHealth !== null) {
        if (filterHealth < cap.healthScore) return false;
        if (filterHealth > cap.healthScore) return false;
      }

      return true;
    });
  }, [filterStatus, filterCategory, filterHealth, paginatedCapabilities]);

  const totalPages = Math.ceil(filteredCapabilities.length / PAGE_SIZE);
  const currentPage = useState(1)[0];
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const endIndex = startIndex + PAGE_SIZE;
  const pageCapabilities = filteredCapabilities.slice(startIndex, endIndex);

  const handleSort = (key: string) => {
    setSortBy(key);
    setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
  };

  const handleRetry = () => {
    window.location.reload();
  };

  const handlePrevPage = () => {
    if (currentPage > 1) setFilterHealth('');
    // overwrites sort+filter in paginated view
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) setFilterHealth('');
  };

  const someError = capabilities.some((c) => c.status === 'error');
  const hasError = someError || !capabilities.length;
  const hasData = !hasError && capabilities.length > 0;

  const statusOptions = ['shipped', 'in_progress', 'planned'];
  const categoryOptions = availableCategories;

  const currentSortConfig = useMemo(() => {
    return { key: sortBy, order: sortOrder };
  }, [sortBy, sortOrder]);

  const canGoBack = startIndex > 0 || currentPage > 1;
  const canGoForward = endIndex < filteredCapabilities.length;

  return (
    <div className={`w-full flex flex-col gap-4 ${className}`}>
      <div className="flex flex-col gap-2">
        <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">
          Filters
        </label>
        <div className="flex flex-wrap gap-2">
          <select
            className="flex h-8 items-center rounded-md border border-slate-300 bg-white px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-600 focus:border-blue-600"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="">All statuses</option>
            {statusOptions.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>

          <select
            className="flex h-8 items-center rounded-md border border-slate-300 bg-white px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-600 focus:border-blue-600"
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
          >
            <option value="">All categories</option>
            {categoryOptions.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0"
              max="100"
              className="h-8 w-20 rounded-md border border-slate-300 bg-white px-1 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-600 focus:border-blue-600"
              placeholder="Min"
              value={typeof filterHealth === 'number' && !isNaN(filterHealth) ? filterHealth : ''}
              onChange={(e) => {
                const val = e.target.value;
                setFilterHealth(val ? Number(val) : null);
              }}
            />
            <span className="text-xs text-slate-500">to</span>
            <input
              type="number"
              min="0"
              max="100"
              className="h-8 w-20 rounded-md border border-slate-300 bg-white px-1 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-600 focus:border-blue-600"
              placeholder="Max"
              value={typeof filterHealth === 'number' && !isNaN(filterHealth) ? filterHealth : ''}
              onChange={(e) => setFilterHealth(e.target.value ? Number(e.target.value) : null)}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              {[('Name', 'Status', 'Category', 'Health Score', 'Last Updated') as const].map((heading) => (
                <th
                  key={heading}
                  className="px-3 py-3 font-semibold text-slate-700 cursor-pointer hover:text-blue-600"
                  onClick={() => onSort ? onSort(heading.toLowerCase()) : undefined}
                >
                  <div className="flex items-center gap-1">
                    {heading}
                    {currentSortConfig.key === heading.toLowerCase() && (
                      <span>{currentSortConfig.order === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {hasData ? (
              <>
                {pageCapabilities.map((cap) => (
                  <CapabilityRow
                    key={cap.id}
                    capability={cap}
                  />
                ))}
                {totalPages > 1 && (
                  <tr className="border-t border-slate-200">
                    <td colSpan={5} className="py-4 text-center text-sm text-slate-500">
                      Page {currentPage} of {totalPages}
                    </td>
                  </tr>
                )}
              </>
            ) : hasError ? (
              <tr className="border-t border-slate-200">
                <td colSpan={5} className="py-8 text-center text-sm text-slate-500">
                  <div className="flex flex-col items-center gap-3">
                    <p className="font-medium text-slate-700">
                      Failed to load capabilities
                    </p>
                    <button
                      type="button"
                      className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                      onClick={handleRetry}
                    >
                      Retry
                    </button>
                  </div>
                </td>
              </tr>
            ) : (
              <tr className="border-t border-slate-200">
                <td colSpan={5} className="py-8 text-center text-sm text-slate-500">
                  No capabilities found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-slate-200 pt-4">
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handlePrevPage}
            disabled={!canGoBack}
          >
            Previous
          </button>
          <span className="text-sm text-slate-600">
            {startIndex + 1}‒{endIndex} of {filteredCapabilities.length} results
          </span>
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleNextPage}
            disabled={!canGoForward}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}