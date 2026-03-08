'use client';

import { ObservabilityContent } from '@/components/ObservabilityContent';

export default function ObservabilityPage() {
  return (
    <div style={{ padding: 40, maxWidth: 900 }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 24 }}>Observability</h1>
      <ObservabilityContent />
    </div>
  );
}
