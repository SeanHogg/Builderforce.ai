'use client';

import { useState, useEffect } from 'react';
import { claws, type Claw } from '@/lib/builderforceApi';
import { ClawDebugContent } from '@/components/ClawDebugContent';

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  padding: 16,
};

export default function DebugPage() {
  const [clawList, setClawList] = useState<Claw[]>([]);
  const [selectedClaw, setSelectedClaw] = useState<Claw | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    claws.list()
      .then((list) => {
        setClawList(list);
        const first = list.find((c) => c.connectedAt) ?? list[0] ?? null;
        setSelectedClaw(first);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ padding: '32px 40px', maxWidth: 960, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>Debug</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
          Gateway snapshots, RPC calls, and live event stream for a selected claw.
        </p>
      </div>

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading claws…</div>
      ) : clawList.length === 0 ? (
        <div style={{ ...cardStyle, fontSize: 13, color: 'var(--text-muted)' }}>
          No claws registered. Register a claw to use debug tools.
        </div>
      ) : (
        <>
          <div style={{ ...cardStyle, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 16 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', flexShrink: 0 }}>Claw</label>
            <select
              value={selectedClaw?.id ?? ''}
              onChange={(e) => {
                const found = clawList.find((c) => String(c.id) === e.target.value);
                setSelectedClaw(found ?? null);
              }}
              style={{
                flex: 1,
                maxWidth: 360,
                padding: '7px 10px',
                fontSize: 13,
                background: 'var(--bg-elevated)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 8,
              }}
            >
              {clawList.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.connectedAt ? ' (connected)' : ' (offline)'}
                </option>
              ))}
            </select>
          </div>

          {selectedClaw && (
            <ClawDebugContent clawId={selectedClaw.id} clawName={selectedClaw.name} />
          )}
        </>
      )}
    </div>
  );
}
