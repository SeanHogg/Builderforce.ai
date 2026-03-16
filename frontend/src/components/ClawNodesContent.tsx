'use client';

import { useState, useEffect } from 'react';
import { clawNodesApi, type ClawNode } from '@/lib/builderforceApi';

interface ClawNodesContentProps {
  clawId: number;
}

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  padding: 16,
};

export function ClawNodesContent({ clawId }: ClawNodesContentProps) {
  const [nodes, setNodes] = useState<ClawNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unpairing, setUnpairing] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    clawNodesApi
      .list(clawId)
      .then(setNodes)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [clawId]);

  const handleUnpair = async (node: ClawNode) => {
    if (!confirm(`Unpair node "${node.name}"? This will disconnect it.`)) return;
    setUnpairing(node.id);
    try {
      await clawNodesApi.unpair(clawId, node.id);
      setNodes((prev) => prev.filter((n) => n.id !== node.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unpair failed');
    } finally {
      setUnpairing(null);
    }
  };

  if (loading) return <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading nodes…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
          Cluster Nodes ({nodes.length})
        </div>
        <button
          type="button"
          onClick={load}
          style={{
            padding: '5px 10px',
            fontSize: 11,
            fontWeight: 600,
            background: 'var(--bg-elevated)',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          Refresh
        </button>
      </div>

      {error && (
        <div style={{ ...cardStyle, color: 'var(--coral-bright)', fontSize: 13 }}>Error: {error}</div>
      )}

      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
        Nodes are individual claw instances that form this cluster. Multi-node deployments allow horizontal scaling of task execution.
      </p>

      {nodes.length === 0 ? (
        <div style={{ ...cardStyle, fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
          No cluster nodes found. This claw is running as a single-node instance.
        </div>
      ) : (
        nodes.map((node) => {
          const online = node.status === 'connected';
          return (
            <div
              key={node.id}
              style={{
                ...cardStyle,
                display: 'flex',
                alignItems: 'center',
                gap: 14,
              }}
            >
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: online ? 'rgba(34,197,94,0.9)' : 'var(--text-muted)',
                  flexShrink: 0,
                }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
                  {node.name}
                  <span
                    style={{
                      marginLeft: 8,
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      padding: '2px 6px',
                      borderRadius: 4,
                      background: online ? 'rgba(34,197,94,0.12)' : 'var(--bg-elevated)',
                      color: online ? 'rgba(34,197,94,0.9)' : 'var(--text-muted)',
                    }}
                  >
                    {node.status}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                  ID: <span style={{ fontFamily: 'var(--font-mono)' }}>{node.id}</span>
                </div>
                {node.capabilities.length > 0 && (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {node.capabilities.map((cap) => (
                      <span
                        key={cap}
                        style={{
                          fontSize: 10,
                          padding: '2px 6px',
                          borderRadius: 4,
                          background: 'var(--bg-elevated)',
                          color: 'var(--text-secondary)',
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        {cap}
                      </span>
                    ))}
                  </div>
                )}
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  {node.lastSeenAt ? `Last seen ${new Date(node.lastSeenAt).toLocaleString()}` : 'Never connected'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleUnpair(node)}
                disabled={unpairing === node.id}
                style={{
                  padding: '5px 10px',
                  fontSize: 11,
                  fontWeight: 600,
                  background: 'none',
                  color: 'var(--coral-bright, #f4726e)',
                  border: '1px solid var(--coral-bright, #f4726e)',
                  borderRadius: 6,
                  cursor: unpairing === node.id ? 'wait' : 'pointer',
                  flexShrink: 0,
                  opacity: unpairing === node.id ? 0.5 : 1,
                }}
              >
                {unpairing === node.id ? '…' : 'Unpair'}
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}
