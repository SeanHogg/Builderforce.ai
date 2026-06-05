'use client';

import { useState } from 'react';
import IntegrationGrid, { type IntegrationItem } from './IntegrationGrid';
import { ViewToggle, type ViewMode } from '@/components/ViewToggle';

export interface IntegrationSection {
  title: string;
  description: string;
  items: IntegrationItem[];
  columns?: 2 | 3 | 4;
}

export default function IntegrationsView({ sections }: { sections: IntegrationSection[] }) {
  const [viewMode, setViewMode] = useState<ViewMode>('card');

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <ViewToggle value={viewMode} onChange={setViewMode} />
      </div>
      {sections.map((s) => (
        <IntegrationGrid
          key={s.title}
          title={s.title}
          description={s.description}
          items={s.items}
          columns={s.columns}
          viewMode={viewMode}
        />
      ))}
    </>
  );
}
