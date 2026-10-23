import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { AgentCapabilitiesContent } from './AgentCapabilitiesContent';
import * as api from '@/lib/api';
import * as builderforceApi from '@/lib/builderforceApi';
import type { AgentAssignment } from '@/lib/builderforceApi';

vi.mock('@/lib/api');
vi.mock('@/lib/builderforceApi');

// Isolate from the assignment tree — assert the scope/scopeId we pass down.
vi.mock('./CapabilitiesContent', () => ({
  CapabilitiesContent: ({ scope, scopeId }: { scope: string; scopeId: number }) => (
    <div data-testid="capabilities">{`${scope}:${scopeId}`}</div>
  ),
}));

// Observability is its own component (own data deps) — isolate it here.
vi.mock('./ObservabilityContent', () => ({
  ObservabilityContent: () => <div data-testid="observability" />,
}));

const agent: AgentAssignment = {
  id: '5b2f6a3e-0000-4000-8000-000000000007',
  agentHandle: 7,
  agentKind: 'registered',
  agentRef: '42',
  scope: 'project',
  scopeId: '1',
  projectId: 1,
  executionScope: 'project',
  name: 'Reviewer Bot',
  role: 'default',
  governance: null,
  addedBy: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe('AgentCapabilitiesContent', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // The shared agent pool now draws from the tenant's own + purchased agents.
    vi.spyOn(api, 'listMyAgents').mockResolvedValue([]);
    vi.spyOn(api, 'listPurchasedAgents').mockResolvedValue([]);
    vi.spyOn(builderforceApi.registeredAgents, 'list').mockResolvedValue([]);
    vi.spyOn(builderforceApi.agentAssignmentsApi, 'listForProject').mockResolvedValue([agent]);
  });

  it('lists project agents and switches capability scope from project to agent', async () => {
    const { getByRole, getByTestId } = render(<AgentCapabilitiesContent projectId={1} />);

    // Attached agent renders (as a target chip), capabilities default to project-wide.
    await waitFor(() => getByRole('button', { name: 'Reviewer Bot' }));
    expect(getByTestId('capabilities').textContent).toBe('project:1');

    // Selecting the agent chip scopes capabilities to the assignment's integer handle.
    fireEvent.click(getByRole('button', { name: 'Reviewer Bot' }));
    await waitFor(() => expect(getByTestId('capabilities').textContent).toBe('agent:7'));
  });
});
