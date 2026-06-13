'use client';

/**
 * A compact load/utilization "power meter" shown above a seat. Fills with the
 * member's active-work load vs their capacity; green → yellow → red as they near
 * and exceed it. Click opens the full scorecard.
 */
export function PowerMeter({
  load,
  cap,
  onClick,
}: {
  load: number;
  cap: number;
  onClick?: () => void;
}) {
  const ratio = cap > 0 ? load / cap : (load > 0 ? 1.5 : 0);
  const pct = Math.min(100, Math.round(ratio * 100));
  const color = ratio <= 0.6 ? 'var(--success)' : ratio <= 1 ? '#eab308' : 'var(--error)';
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Load ${load}/${cap} — open scorecard`}
      style={{
        width: 64,
        padding: 0,
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
      }}
    >
      <div style={{ width: '100%', height: 6, borderRadius: 3, background: 'var(--bg-deep)', border: '1px solid var(--border-subtle)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, transition: 'width 0.2s, background 0.2s' }} />
      </div>
      <span style={{ fontSize: 9, color: 'var(--text-muted)', lineHeight: 1 }}>
        {load}/{cap}
      </span>
    </button>
  );
}
