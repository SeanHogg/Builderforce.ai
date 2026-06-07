'use client';

import { useAuth } from '@/lib/AuthContext';
import { WorkforceAgents } from '@/components/workforce/WorkforceAgents';

export default function WorkforcePage() {
  const { tenant } = useAuth();
  const tenantId = tenant?.id != null ? Number(tenant.id) : undefined;

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <div className="page-header" style={{ marginBottom: 24 }}>
        <div>
          <h1 className="page-title" style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-strong)', margin: 0 }}>Workforce</h1>
          <p className="page-sub" style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
            Create cloud agents, register remote agents, and connect them to your workspace. Publish agents to the marketplace to earn revenue.
          </p>
        </div>
      </div>

      {/* Unified agent directory — cloud agents + remote agentHosts, one grid */}
      <WorkforceAgents tenantId={tenantId} />
    </div>
  );
}
