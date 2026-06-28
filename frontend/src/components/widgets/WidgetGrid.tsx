'use client';

import type { CSSProperties } from 'react';
import { getWidget } from '@/lib/widgets/registry';
import type { WidgetSize } from '@/lib/widgets/types';
import { WidgetCard } from './WidgetCard';

/**
 * Lay out a list of widget ids in a responsive grid, honouring each widget's
 * size hint. Unknown ids (e.g. a pinned widget whose surface was removed) are
 * skipped so a stale pin never breaks the dashboard. Shared by the home
 * dashboard, every tab dashboard, and the custom-dashboard builder so widgets
 * read identically everywhere.
 */

const SPAN: Record<WidgetSize, CSSProperties> = {
  sm: {},
  md: { gridColumn: 'span 2' },
  lg: { gridColumn: '1 / -1' },
};

export function WidgetGrid({ ids, days, showDrill = true }: { ids: string[]; days: number; showDrill?: boolean }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16, alignItems: 'stretch' }}>
      {ids.map((id) => {
        const def = getWidget(id);
        if (!def) return null;
        return (
          <div key={id} style={SPAN[def.size ?? 'sm']}>
            <WidgetCard def={def} days={days} showDrill={showDrill} />
          </div>
        );
      })}
    </div>
  );
}
