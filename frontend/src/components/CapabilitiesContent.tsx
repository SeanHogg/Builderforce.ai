'use client';

import { useState } from 'react';
import { SkillAssignmentsContent } from './SkillAssignmentsContent';
import { PersonaAssignmentsContent } from './PersonaAssignmentsContent';
import { ContentAssignmentsContent } from './ContentAssignmentsContent';
import { GovernanceContent } from './GovernanceContent';
import type { ProjectAgent } from '@/lib/builderforceApi';

type CapabilitySection = 'skills' | 'personas' | 'content' | 'governance';

const SECTIONS: { id: CapabilitySection; label: string }[] = [
  { id: 'skills', label: 'Skills' },
  { id: 'personas', label: 'Personas' },
  { id: 'content', label: 'Content' },
  { id: 'governance', label: 'Governance' },
];

export interface CapabilitiesContentProps {
  scope: 'host' | 'project' | 'agent';
  scopeId: number;
  /** Required for governance editing (project ID). For agentHost scope, pass associated project id if available. */
  projectId?: number;
  /** When scope is 'agent', the agent whose governance is edited. */
  agentAssignment?: ProjectAgent;
  /** Tenant ID for content block name resolution. */
  tenantId?: string;
  /** Hide sections that don't apply. */
  hideSections?: CapabilitySection[];
  className?: string;
  style?: React.CSSProperties;
}

export function CapabilitiesContent({
  scope,
  scopeId,
  projectId,
  agentAssignment,
  tenantId,
  hideSections,
  className,
  style,
}: CapabilitiesContentProps) {
  const visibleSections = SECTIONS.filter((s) => !hideSections?.includes(s.id));
  const [activeSection, setActiveSection] = useState<CapabilitySection>(visibleSections[0]?.id ?? 'skills');

  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 14, ...style }}>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', borderBottom: '1px solid var(--border-subtle)', paddingBottom: 6 }}>
        {visibleSections.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setActiveSection(s.id)}
            style={{
              padding: '6px 14px',
              fontSize: 12,
              fontWeight: activeSection === s.id ? 700 : 500,
              color: activeSection === s.id ? 'var(--coral-bright)' : 'var(--text-muted)',
              background: activeSection === s.id ? 'rgba(255,107,53,0.08)' : 'transparent',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {activeSection === 'skills' && (
        <SkillAssignmentsContent scope={scope} scopeId={scopeId} />
      )}
      {activeSection === 'personas' && (
        <PersonaAssignmentsContent scope={scope} scopeId={scopeId} />
      )}
      {activeSection === 'content' && (
        <ContentAssignmentsContent scope={scope} scopeId={scopeId} tenantId={tenantId} />
      )}
      {activeSection === 'governance' && (
        scope === 'agent' && agentAssignment ? (
          <GovernanceContent projectId={projectId ?? 0} agentAssignment={agentAssignment} />
        ) : projectId != null ? (
          <GovernanceContent projectId={projectId} />
        ) : (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: 16, textAlign: 'center' }}>
            Governance rules are defined at the project level. Select or associate a project to manage governance.
          </div>
        )
      )}
    </div>
  );
}
