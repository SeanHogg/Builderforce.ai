import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { AgentCapabilitiesContent } from './AgentCapabilitiesContent';
import * as api from '@/lib/api';
import * as builderforceApi from '@/lib/builderforceApi';
import type { ProjectAgent } from '@/lib/builderforceApi';

vi.mock('@/lib/api');
vi.mock('@/lib/builderforceApi');

// Isolate from the assignment tree — assert the scope/scopeId we pass down.
vi.mock('./CapabilitiesContent', () => ({
  CapabilitiesContent: ({ scope, scopeId }: { scope: string; scopeId: number }) => (
    <div data-testid="capabilities">{`${scope}:${scopeId}`}</div>
  ),
}));

const agent: ProjectAgent = {
  id: 7,
  tenantId: 1,
  projectId: 1,
  agentKind: 'registered',
  agentRef: '42',
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
    vi.spyOn(builderforceApi.projectAgents, 'list').mockResolvedValue([agent]);
  });

  it('lists project agents and switches capability scope from project to agent', async () => {
    const { getByRole, getByTestId } = render(<AgentCapabilitiesContent projectId={1} />);

    // Attached agent renders (as a target chip), capabilities default to project-wide.
    await waitFor(() => getByRole('button', { name: 'Reviewer Bot' }));
    expect(getByTestId('capabilities').textContent).toBe('project:1');

    // Selecting the agent chip scopes capabilities to project_agents.id.
    fireEvent.click(getByRole('button', { name: 'Reviewer Bot' }));
    await waitFor(() => expect(getByTestId('capabilities').textContent).toBe('agent:7'));
  });
});
