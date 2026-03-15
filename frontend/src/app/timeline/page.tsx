'use client';

import { ObservabilityContent } from '@/components/ObservabilityContent';

export default function TimelinePage() {
  return (
    <div style={{ padding: 40, maxWidth: 1200 }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 24 }}>Execution Timeline</h1>
      <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>
        View tool audit events and workflow timelines across your claws.
      </p>
      <ObservabilityContent initialView="timeline" />
    </div>
  );
}
