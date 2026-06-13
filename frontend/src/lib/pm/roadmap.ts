import { segmentTrackerClient, type TrackerRow } from '@/lib/builderforceApi';

/**
 * Shared roadmap tracker client + constants — one source of truth for the roadmap
 * surface (timeline, gantt, and the create/edit panel all import from here so the
 * API base, horizons, and statuses never drift across the three views).
 */
export const roadmapClient = segmentTrackerClient('/api/product/roadmap');

export const ROADMAP_HORIZONS: Array<{ key: string; label: string }> = [
  { key: 'now', label: 'Now' },
  { key: 'next', label: 'Next' },
  { key: 'later', label: 'Later' },
];

export const ROADMAP_STATUSES = ['planned', 'in_progress', 'shipped', 'cancelled'];

/** Read a string field off a roadmap TrackerRow (values are loosely typed). */
export function rstr(row: TrackerRow, key: string): string {
  const v = row[key];
  return typeof v === 'string' ? v : '';
}
