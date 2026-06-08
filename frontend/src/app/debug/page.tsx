'use client';

import { useState, useEffect } from 'react';
import { agentHosts, type AgentHost } from '@/lib/builderforceApi';
import { AgentHostDebugContent } from '@/components/AgentHostDebugContent';
import PageContainer from '@/components/PageContainer';

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  padding: 16,
};

export default function DebugPage() {
  const [agentHostList, setAgentHostList] = useState<AgentHost[]>([]);
  const [selectedAgentHost, setSelectedAgentHost] = useState<AgentHost | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    agentHosts.list()
      .then((list) => {
        setAgentHostList(list);
        const first = list.find((c) => c.online) ?? list[0] ?? null;
        setSelectedAgentHost(first);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <PageContainer width="readable" style={{ padding: '32px 40px' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>Debug</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
          Gateway snapshots, RPC calls, and live event stream for a selected agentHost.
        </p>
      </div>

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading agentHosts…</div>
      ) : agentHostList.length === 0 ? (
        <div style={{ ...cardStyle, fontSize: 13, color: 'var(--text-muted)' }}>
          No agentHosts registered. Register a agentHost to use debug tools.
        </div>
      ) : (
        <>
          <div style={{ ...cardStyle, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 16 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', flexShrink: 0 }}>AgentHost</label>
            <select
              value={selectedAgentHost?.id ?? ''}
              onChange={(e) => {
                const found = agentHostList.find((c) => String(c.id) === e.target.value);
                setSelectedAgentHost(found ?? null);
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
              {agentHostList.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.online ? ' (connected)' : ' (offline)'}
                </option>
              ))}
            </select>
          </div>

          {selectedAgentHost && (
            <AgentHostDebugContent agentHostId={selectedAgentHost.id} agentHostName={selectedAgentHost.name} />
          )}
        </>
      )}
    </PageContainer>
  );
}
