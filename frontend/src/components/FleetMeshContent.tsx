'use client';

import { useState, useMemo } from 'react';
import type { Claw } from '@/lib/builderforceApi';
import { dispatchApi } from '@/lib/builderforceApi';

interface FleetMeshContentProps {
  claws: Claw[];
}

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  padding: 16,
};

// Arrange claws in a circle around a central hub
function layoutNodes(claws: Claw[], cx: number, cy: number, radius: number) {
  if (claws.length === 0) return [];
  return claws.map((claw, i) => {
    const angle = (2 * Math.PI * i) / claws.length - Math.PI / 2;
    return {
      claw,
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    };
  });
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

export function FleetMeshContent({ claws }: FleetMeshContentProps) {
  const [selectedClaw, setSelectedClaw] = useState<Claw | null>(null);
  const [dispatchPayload, setDispatchPayload] = useState('{"type":"ping"}');
  const [dispatching, setDispatching] = useState(false);
  const [dispatchResult, setDispatchResult] = useState<string | null>(null);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<number | null>(null);

  const W = 480;
  const H = 300;
  const cx = W / 2;
  const cy = H / 2;
  const radius = Math.min(cx, cy) - 60;

  const nodes = useMemo(() => layoutNodes(claws, cx, cy, radius), [claws, cx, cy, radius]);

  const onlineClaws = claws.filter((c) => !!c.connectedAt);

  const handleDispatch = async () => {
    if (!selectedClaw) return;
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(dispatchPayload) as Record<string, unknown>;
    } catch {
      setDispatchError('Invalid JSON payload');
      return;
    }
    setDispatching(true);
    setDispatchResult(null);
    setDispatchError(null);
    try {
      const result = await dispatchApi.send(selectedClaw.id, payload);
      setDispatchResult(JSON.stringify(result, null, 2));
    } catch (e) {
      setDispatchError(e instanceof Error ? e.message : 'Dispatch failed');
    } finally {
      setDispatching(false);
    }
  };

  if (claws.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Mesh graph */}
      <div style={cardStyle}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          Fleet Mesh
          <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-muted)' }}>
            {onlineClaws.length}/{claws.length} online
          </span>
        </div>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          style={{ width: '100%', maxWidth: W, display: 'block', margin: '0 auto' }}
        >
          {/* Lines from hub to each node */}
          {nodes.map(({ claw, x, y }) => (
            <line
              key={`line-${claw.id}`}
              x1={cx}
              y1={cy}
              x2={x}
              y2={y}
              stroke={claw.connectedAt ? 'var(--cyan-bright, #00e5cc)' : 'var(--border-subtle)'}
              strokeWidth={hoveredId === claw.id ? 2 : 1}
              strokeDasharray={claw.connectedAt ? undefined : '4 3'}
              opacity={0.5}
            />
          ))}

          {/* Cross-claw lines (mesh edges between online claws) */}
          {nodes
            .filter(({ claw }) => claw.connectedAt)
            .map(({ claw: a, x: ax, y: ay }, i, arr) =>
              arr.slice(i + 1).map(({ claw: b, x: bx, y: by }) => (
                <line
                  key={`mesh-${a.id}-${b.id}`}
                  x1={ax}
                  y1={ay}
                  x2={bx}
                  y2={by}
                  stroke="var(--cyan-bright, #00e5cc)"
                  strokeWidth={0.5}
                  opacity={0.2}
                />
              ))
            )}

          {/* Hub */}
          <circle cx={cx} cy={cy} r={18} fill="var(--bg-elevated)" stroke="var(--coral-bright, #f4726e)" strokeWidth={2} />
          <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="middle" fontSize={9} fontWeight={700} fill="var(--coral-bright, #f4726e)">
            HUB
          </text>

          {/* Claw nodes */}
          {nodes.map(({ claw, x, y }) => {
            const online = !!claw.connectedAt;
            const isSelected = selectedClaw?.id === claw.id;
            const isHovered = hoveredId === claw.id;
            const nodeColor = online ? 'var(--cyan-bright, #00e5cc)' : 'var(--border-subtle)';
            return (
              <g
                key={claw.id}
                style={{ cursor: 'pointer' }}
                onClick={() => setSelectedClaw(isSelected ? null : claw)}
                onMouseEnter={() => setHoveredId(claw.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                <circle
                  cx={x}
                  cy={y}
                  r={isSelected ? 14 : isHovered ? 13 : 11}
                  fill={isSelected ? `${nodeColor}33` : 'var(--bg-elevated)'}
                  stroke={isSelected ? nodeColor : online ? nodeColor : 'var(--text-muted)'}
                  strokeWidth={isSelected ? 2 : 1.5}
                />
                {online && (
                  <circle cx={x + 8} cy={y - 8} r={4} fill="rgba(34,197,94,0.9)" />
                )}
                <text
                  x={x}
                  y={y + (y > cy + 20 ? 26 : y < cy - 20 ? -18 : y > cy ? 26 : -18)}
                  textAnchor="middle"
                  fontSize={9}
                  fill="var(--text-muted)"
                >
                  {truncate(claw.name, 14)}
                </text>
              </g>
            );
          })}
        </svg>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 8 }}>
          Click a node to select it for dispatch. Solid lines = online.
        </div>
      </div>

      {/* Remote dispatch panel */}
      <div style={cardStyle}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10 }}>Remote Dispatch</div>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
          Send a JSON message directly to any claw in the fleet. Use this to trigger tasks, ping agents, or forward commands.
        </p>

        {/* Target claw selector */}
        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
            Target Claw
          </label>
          <select
            value={selectedClaw?.id ?? ''}
            onChange={(e) => {
              const id = Number(e.target.value);
              setSelectedClaw(claws.find((c) => c.id === id) ?? null);
              setDispatchResult(null);
              setDispatchError(null);
            }}
            style={{
              width: '100%',
              padding: '8px 10px',
              fontSize: 13,
              background: 'var(--bg-elevated)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
            }}
          >
            <option value="">Select claw…</option>
            {claws.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}{c.connectedAt ? ' ●' : ' ○'}
              </option>
            ))}
          </select>
        </div>

        {/* Payload */}
        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
            Payload (JSON)
          </label>
          <textarea
            value={dispatchPayload}
            onChange={(e) => { setDispatchPayload(e.target.value); setDispatchResult(null); setDispatchError(null); }}
            rows={4}
            spellCheck={false}
            style={{
              width: '100%',
              padding: '8px 12px',
              fontSize: 12,
              fontFamily: 'var(--font-mono)',
              background: 'var(--bg-elevated)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              resize: 'vertical',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Presets */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {[
            { label: 'Ping', payload: '{"type":"ping"}' },
            { label: 'Status', payload: '{"type":"status"}' },
            { label: 'Chat', payload: '{"type":"chat.message","content":"Hello from fleet hub"}' },
          ].map(({ label, payload }) => (
            <button
              key={label}
              type="button"
              onClick={() => { setDispatchPayload(payload); setDispatchResult(null); setDispatchError(null); }}
              style={{
                padding: '4px 10px',
                fontSize: 11,
                fontWeight: 600,
                background: 'var(--bg-elevated)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {dispatchError && (
          <div style={{ fontSize: 12, color: 'var(--coral-bright, #f4726e)', marginBottom: 10 }}>{dispatchError}</div>
        )}

        {dispatchResult && (
          <pre
            style={{
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              background: 'var(--bg-elevated)',
              color: 'rgba(34,197,94,0.9)',
              padding: '8px 12px',
              borderRadius: 8,
              overflowX: 'auto',
              marginBottom: 10,
              maxHeight: 120,
              overflow: 'auto',
            }}
          >
            {dispatchResult}
          </pre>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={handleDispatch}
            disabled={!selectedClaw || dispatching}
            style={{
              padding: '8px 18px',
              fontSize: 13,
              fontWeight: 600,
              background: selectedClaw && !dispatching ? 'var(--coral-bright, #f4726e)' : 'var(--bg-elevated)',
              color: selectedClaw && !dispatching ? '#fff' : 'var(--text-muted)',
              border: 'none',
              borderRadius: 8,
              cursor: !selectedClaw || dispatching ? 'not-allowed' : 'pointer',
            }}
          >
            {dispatching ? 'Dispatching…' : 'Dispatch →'}
          </button>
        </div>
      </div>
    </div>
  );
}
