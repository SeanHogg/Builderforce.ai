'use client';

/**
 * A labelled progress bar. The wizard drives it with steps, the bulk import with
 * rows acknowledged by the server — the same bar, so progress looks like one
 * thing on both halves of the page.
 */
export function ImportProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label} style={{ marginBottom: 'var(--space-5)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)', marginBottom: 'var(--space-2)', fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>
        <span>{label}</span>
        <span className="ui-text-numeric">{pct}%</span>
      </div>
      <div style={{ width: '100%', height: 'var(--space-2)', background: 'var(--border-subtle)', borderRadius: 'var(--radius-full)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)', transition: 'width 0.3s ease' }} />
      </div>
    </div>
  );
}
