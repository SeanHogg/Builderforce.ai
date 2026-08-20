'use client';

import { useState } from 'react';
import { SkillAssignmentsContent } from './SkillAssignmentsContent';
import { PersonaAssignmentsContent } from './PersonaAssignmentsContent';
import { GovernanceContent } from './GovernanceContent';
import type { ProjectAgent } from '@/lib/builderforceApi';

// 'content' was retired with migration 0982: content blocks only ever lived in
// this browser's localStorage, so the tab could not name what it had assigned on
// any other device. Content is a Knowledge document now.
type CapabilitySection = 'skills' | 'personas' | 'governance';

const SECTIONS: { id: CapabilitySection; label: string }[] = [
  { id: 'skills', label: 'Skills' },
  { id: 'personas', label: 'Personas' },
  { id: 'governance', label: 'Governance' },
];

export interface CapabilitiesContentProps {
  scope: 'host' | 'project' | 'agent';
  scopeId: number;
  /** Required for governance editing (project ID). For agentHost scope, pass associated project id if available. */
  projectId?: number;
  /** When scope is 'agent', the agent whose governance is edited. */
  agentAssignment?: ProjectAgent;
  /**
   * @deprecated Unused. It existed only to resolve the names of localStorage
   * content blocks for the Content tab, which migration 0982 retired. Kept
   * (accepted and ignored) because callers outside this file still pass it;
   * remove the prop once every caller has dropped it.
   */
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
              fontSize: 'var(--font-size-small)',
              fontWeight: activeSection === s.id ? 700 : 500,
              color: activeSection === s.id ? 'var(--coral-bright)' : 'var(--text-muted)',
              background: activeSection === s.id ? 'rgba(255,107,53,0.08)' : 'transparent',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
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
      {activeSection === 'governance' && (
        scope === 'agent' && agentAssignment ? (
          <GovernanceContent projectId={projectId ?? 0} agentAssignment={agentAssignment} />
        ) : projectId != null ? (
          <GovernanceContent projectId={projectId} />
        ) : (
          <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', padding: 16, textAlign: 'center' }}>
            Governance rules are defined at the project level. Select or associate a project to manage governance.
          </div>
        )
      )}
    </div>
  );
}
