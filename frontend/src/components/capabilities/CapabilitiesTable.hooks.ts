'use client';

import { useCallback, useMemo } from 'react';
import { Capability } from '@/app/insights/capabilityTypes';
import { CapabilitiesTable } from './CapabilitiesTable';

export interface CapabilitiesTableHooksProps {
  capabilities: Capability[];
  setFilterStatus: (value: string) => void;
  setFilterCategory: (value: string) => void;
  setFilterHealth: (value: number | null) => void;
  className?: string;
}

export function CapabilitiesTableHooks(props: CapabilitiesTableHooksProps) {
  const { capabilities, setFilterStatus, setFilterCategory, setFilterHealth, className = '' } = props;

  const onSort = useCallback((key: string) => {
    window.location.href = `?tab=capabilities&sort=${key}&order=${props.sortOrder ?? 'asc'}`;
  }, [props.sortOrder]);

  const getPages = useMemo(() => {
    const pageSize = 20;
    const totalPages = Math.ceil(capabilities.length / pageSize);
    const entries = Array.from({ length: totalPages }, (_, i) => i + 1);
    return entries;
  }, [capabilities.length]);

  return (
    <CapabilitiesTable capabilities={capabilities} onSort={onSort} className={className}>
      <CapabilitiesTableControls
        capabilities={capabilities}
        getPages={getPages}
        setFilterStatus={setFilterStatus}
        setFilterCategory={setFilterCategory}
        setFilterHealth={setFilterHealth}
      />
    </CapabilitiesTable>
  );
}

interface CapabilitiesTableControlsProps {
  capabilities: Capability[];
  getPages: () => number[];
  setFilterStatus: (value: string) => void;
  setFilterCategory: (value: string) => void;
  setFilterHealth: (value: number | null) => void;
}

export function CapabilitiesTableControls(props: CapabilitiesTableControlsProps) {
  const { capabilities, getPages, setFilterStatus, setFilterCategory, setFilterHealth } = props;

  const statusOptions = ['shipped', 'in_progress', 'planned'];
  const categoryOptions = props.capabilities.flatMap((c) => c.category).toSorted();

  const currentPageOptions = getPages();

  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">
        Filters
      </label>
      <div className="flex flex-wrap gap-2">
        <select
          className="flex h-8 items-center rounded-md border border-slate-300 bg-white px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-600 focus:border-blue-600"
          value={''}
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
          value={''}
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
            value={''}
            onChange={(e) => setFilterHealth(Number(e.target.valueOf()) ?? null)}
          />
          <span className="text-xs text-slate-500">to</span>
          <input
            type="number"
            min="0"
            max="100"
            className="h-8 w-20 rounded-md border border-slate-300 bg-white px-1 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-600 focus:border-blue-600"
            placeholder="Max"
            value={''}
            onChange={(e) => setFilterHealth(Number(e.target.valueOf()) ?? null)}
          />
        </div>
      </div>
    </div>
  );
}