'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { MambaAgentState, MambaStateSnapshot } from '@/lib/types';
import { MambaEngine } from '@/lib/mamba-engine';

interface AgentStateViewerProps {
  projectId: string | number;
  agentId?: string;
}

/** Compute a simple visual heatmap row from a slice of state values */
function stateHeatmap(data: number[], count: number): number[] {
  if (data.length === 0) return new Array(count).fill(0);
  const step = Math.max(1, Math.floor(data.length / count));
  const result: number[] = [];
  for (let i = 0; i < count; i++) {
    const val = data[i * step] ?? 0;
    result.push(val);
  }
  const max = Math.max(...result.map(Math.abs), 1e-8);
  return result.map(v => v / max);
}

export function AgentStateViewer({ projectId, agentId }: AgentStateViewerProps) {
  const [state, setState] = useState<MambaAgentState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [replayInput, setReplayInput] = useState('');
  const [isReplaying, setIsReplaying] = useState(false);
  const [replayLog, setReplayLog] = useState<string[]>([]);
  const engineRef = useRef<MambaEngine | null>(null);
  const replayEndRef = useRef<HTMLDivElement>(null);

  const effectiveAgentId = agentId ?? `project-${projectId}`;

  const loadState = useCallback(async () => {
    setIsLoading(true);
    try {
      const engine = new MambaEngine(effectiveAgentId, projectId);
      await engine.init();
      const found = await engine.loadFromIndexedDB();
      engineRef.current = engine;
      if (found) {
        setState(engine.getState());
      } else {
        setState(null);
      }
    } catch {
      setState(null);
    } finally {
      setIsLoading(false);
    }
  }, [effectiveAgentId, projectId]);

  useEffect(() => { void loadState(); }, [loadState]);

  useEffect(() => {
    replayEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [replayLog]);

  const handleReplay = useCallback(async () => {
    const sequences = replayInput
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean);
    if (sequences.length === 0) return;

    setIsReplaying(true);
    setReplayLog([]);

    const engine = new MambaEngine(`replay-${effectiveAgentId}`, projectId);
    await engine.init();
    // Load base state to replay from
    if (engineRef.current) {
      const snap = engineRef.current.getSnapshot();
      engine.loadFromSnapshot(snap);
    }

    for (const seq of sequences) {
      const ctx = await engine.step(seq);
      const snap = engine.getSnapshot();
      setReplayLog(prev => [
        ...prev,
        `[step ${snap.step}] "${seq.slice(0, 50)}" → ${ctx}`,
      ]);
    }
    setIsReplaying(false);
  }, [replayInput, effectiveAgentId, projectId]);

  const handleReset = useCallback(async () => {
    if (!confirm('Reset Mamba state for this agent? This cannot be undone.')) return;
    const engine = new MambaEngine(effectiveAgentId, projectId);
    await engine.init();
    await engine.save(); // saves fresh zero state
    engineRef.current = engine;
    setState(engine.getState());
  }, [effectiveAgentId, projectId]);

  const snap: MambaStateSnapshot | null = state?.snapshot ?? null;
  const heatmap = snap ? stateHeatmap(snap.data, 32) : [];

  return (
    <div
      style={{
        height: '100%', display: 'flex', flexDirection: 'column',
        background: 'var(--bg-base)', color: 'var(--text-primary)',
        fontSize: '0.8rem',
      }}
    >
      {/* Header */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 700 }}>🔬 Agent State Viewer</span>
        <button
          onClick={loadState}
          disabled={isLoading}
          style={{
            marginLeft: 'auto', fontSize: '0.7rem', padding: '2px 8px', borderRadius: 5,
            background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
            color: 'var(--text-secondary)', cursor: 'pointer',
          }}
        >
          {isLoading ? '⏳' : '🔄 Refresh'}
        </button>
        {state && (
          <button
            onClick={handleReset}
            style={{
              fontSize: '0.7rem', padding: '2px 8px', borderRadius: 5,
              background: 'rgba(220,38,38,0.15)', border: '1px solid rgba(220,38,38,0.4)',
              color: '#f87171', cursor: 'pointer',
            }}
          >
            Reset
          </button>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
        {!state && !isLoading && (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '48px 16px' }}>
            <div style={{ fontSize: '2rem', marginBottom: 8 }}>🧬</div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 4 }}>No Mamba state found</p>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Enable Memory in the AI Chat or run Memory Training to create state.
            </p>
          </div>
        )}

        {state && snap && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Summary cards */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {[
                { label: 'Step', value: snap.step },
                { label: 'Channels', value: snap.channels },
                { label: 'Order', value: snap.order },
                { label: 'Dim', value: snap.dim },
              ].map(({ label, value }) => (
                <div key={label} style={{
                  background: 'var(--bg-elevated)', borderRadius: 6, padding: '8px 10px',
                  border: '1px solid var(--border-subtle)',
                }}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'monospace' }}>{value}</div>
                </div>
              ))}
            </div>

            {/* State heatmap */}
            <div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Memory State Heatmap
              </div>
              <div style={{ display: 'flex', gap: 2, height: 36 }}>
                {heatmap.map((v, i) => {
                  const intensity = Math.abs(v);
                  const isPos = v >= 0;
                  const alpha = 0.2 + intensity * 0.8;
                  return (
                    <div
                      key={i}
                      title={`Channel group ${i}: ${v.toFixed(3)}`}
                      style={{
                        flex: 1,
                        borderRadius: 2,
                        background: isPos
                          ? `rgba(99,102,241,${alpha})`
                          : `rgba(239,68,68,${alpha})`,
                      }}
                    />
                  );
                })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: 3 }}>
                <span>← channel 0</span>
                <span>channel {snap.channels * snap.order - 1} →</span>
              </div>
            </div>

            {/* Updated at */}
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              Updated: {new Date(state.updatedAt).toLocaleString()}
            </div>

            {/* Interaction history */}
            {state.history.length > 0 && (
              <div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Recent History ({state.history.length} entries)
                </div>
                <div style={{ background: 'var(--bg-surface)', borderRadius: 6, padding: '6px 8px', maxHeight: 100, overflowY: 'auto', border: '1px solid var(--border-subtle)' }}>
                  {state.history.slice(-10).map((entry, i) => (
                    <div key={i} style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', padding: '2px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                      {entry.slice(0, 80)}{entry.length > 80 ? '…' : ''}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Sequence replay */}
            <div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Replay Sequences
              </div>
              <textarea
                value={replayInput}
                onChange={e => setReplayInput(e.target.value)}
                placeholder="Enter sequences to replay (one per line)…"
                rows={3}
                style={{
                  width: '100%', background: 'var(--bg-surface)', color: 'var(--text-primary)',
                  border: '1px solid var(--border-subtle)', borderRadius: 5, padding: '6px 8px',
                  fontSize: '0.72rem', resize: 'vertical', outline: 'none', boxSizing: 'border-box',
                }}
              />
              <button
                onClick={handleReplay}
                disabled={isReplaying || !replayInput.trim()}
                style={{
                  marginTop: 6, width: '100%', padding: '6px 0', fontSize: '0.75rem',
                  fontWeight: 600, borderRadius: 5, cursor: 'pointer', border: 'none',
                  background: isReplaying ? 'var(--bg-elevated)' : '#4f46e5',
                  color: '#fff', opacity: isReplaying || !replayInput.trim() ? 0.5 : 1,
                }}
              >
                {isReplaying ? '⏳ Replaying…' : '▶ Replay'}
              </button>
            </div>

            {/* Replay log */}
            {replayLog.length > 0 && (
              <div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Replay Output
                </div>
                <div style={{
                  background: '#0a0a0f', borderRadius: 5, padding: '6px 8px',
                  fontFamily: 'monospace', fontSize: '0.65rem', color: '#4ade80',
                  maxHeight: 120, overflowY: 'auto', border: '1px solid var(--border-subtle)',
                }}>
                  {replayLog.map((line, i) => <div key={i}>{line}</div>)}
                  <div ref={replayEndRef} />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
