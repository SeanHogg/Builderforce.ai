/**
 * One labelled `<input type="date">` with a hint, for the explicit schedule
 * dates on a record — a project's start and its deadline.
 *
 * BOTH ends of a window are edited identically: an empty value clears the
 * explicit date and the record falls back to the one derived from its children.
 * So they are one component rather than two copies that could drift on styling
 * or, worse, on the clearing rule — one field that treats empty as "leave it"
 * while its neighbour treats empty as "clear it" is a bug nobody sees until a
 * deadline silently survives being deleted.
 *
 * Presentational and hook-free, so it needs no `'use client'` of its own; it
 * renders inside whichever client component uses it.
 */
export function ScheduleDateField({ id, label, hint, value, onChange }: {
  id: string;
  label: string;
  hint: string;
  /** `YYYY-MM-DD`, or '' for "no explicit date". */
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label htmlFor={id} style={{ display: 'block', fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)', marginBottom: 4 }}>
        {label}
      </label>
      <input
        id={id}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%',
          padding: '8px 10px',
          fontSize: 'var(--font-size-small)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md)',
          background: 'var(--bg-deep)',
          color: 'var(--text-primary)',
          // The native date picker's own chrome follows this, so the calendar
          // popup is legible in whichever theme is active rather than always light.
          colorScheme: 'light dark',
        }}
      />
      <div style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)', marginTop: 4 }}>{hint}</div>
    </div>
  );
}
