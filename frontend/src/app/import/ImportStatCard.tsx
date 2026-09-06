'use client';

import { Surface } from '@/components/ui';
import { useFormat } from '@/i18n/useFormat';

export type StatTone = 'success' | 'error' | 'neutral';

/** One number with a label — the dry-run counts and the import result share it. */
export function ImportStatCard({ label, value, tone }: { label: string; value: number; tone: StatTone }) {
  const fmt = useFormat();
  const color = tone === 'success' ? 'var(--success)' : tone === 'error' ? 'var(--danger)' : 'var(--text-primary)';
  return (
    <Surface tone="raised" padding="md" style={{ textAlign: 'center' }}>
      <div className="ui-text-numeric" style={{ fontSize: 'var(--font-size-section)', fontWeight: 700, color }}>
        {fmt.number(value)}
      </div>
      <div className="ui-text-eyebrow" style={{ marginTop: 'var(--space-1)' }}>{label}</div>
    </Surface>
  );
}
