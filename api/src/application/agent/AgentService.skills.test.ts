import { describe, expect, it, vi } from 'vitest';
import { AgentService } from './AgentService';
import type { IAgentRepository } from '../../domain/agent/IAgentRepository';
import type { ISkillRepository } from '../../domain/skill/ISkillRepository';

/**
 * `/api/skills` and `/api/agents/:id/skills` share `AgentService.listSkills`, and
 * both are tenant-scoped. `/api/skills` used to call an unscoped `findAll()` that
 * returned every workspace's legacy skills to any signed-in caller.
 */

function service(agentInTenant: boolean) {
  const agents = {
    findByIdAndTenant: vi.fn(async () => (agentInTenant ? ({ id: 5 } as never) : null)),
  } as unknown as IAgentRepository;
  const skills = {
    findAllByAgent: vi.fn(async () => []),
    findAllByTenant: vi.fn(async () => []),
  } as unknown as ISkillRepository;
  return { svc: new AgentService(agents, skills), agents, skills };
}

describe('AgentService.listSkills', () => {
  it('lists only the caller tenant’s skills when no agent is named', async () => {
    const { svc, skills } = service(true);
    await svc.listSkills(42);
    expect(skills.findAllByTenant).toHaveBeenCalledWith(42);
    expect(skills.findAllByAgent).not.toHaveBeenCalled();
  });

  it('refuses an agent from another tenant before reading its skills', async () => {
    const { svc, skills } = service(false);
    await expect(svc.listSkills(42, 5)).rejects.toThrow();
    expect(skills.findAllByAgent).not.toHaveBeenCalled();
  });

  it('reads one agent’s skills once ownership is confirmed', async () => {
    const { svc, skills } = service(true);
    await svc.listSkills(42, 5);
    expect(skills.findAllByAgent).toHaveBeenCalledWith(5);
  });
});
