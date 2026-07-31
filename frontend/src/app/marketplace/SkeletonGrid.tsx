'use client';

/** Placeholder card grid shown while real cards lazy-load — the page shell + search
 *  render instantly, then the cards stream in over these skeletons. Shared by every
 *  marketplace category (listings, workforce, talent, models). */
export function SkeletonGrid({ count = 8 }: { count?: number }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="animate-pulse" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--surface-2)', flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ height: 12, width: '60%', borderRadius: 6, background: 'var(--surface-2)', marginBottom: 6 }} />
              <div style={{ height: 10, width: '40%', borderRadius: 6, background: 'var(--surface-2)' }} />
            </div>
          </div>
          <div className="animate-pulse" style={{ height: 10, width: '100%', borderRadius: 6, background: 'var(--surface-2)' }} />
          <div className="animate-pulse" style={{ height: 10, width: '85%', borderRadius: 6, background: 'var(--surface-2)' }} />
          <div className="animate-pulse" style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <div style={{ height: 18, width: 48, borderRadius: 999, background: 'var(--surface-2)' }} />
            <div style={{ height: 18, width: 60, borderRadius: 999, background: 'var(--surface-2)' }} />
          </div>
        </div>
      ))}
    </div>
  );
}
