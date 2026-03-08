import { Skill } from './Skill';
import { SkillId, AgentId } from '../shared/types';

export interface ISkillRepository {
  findById(id: SkillId): Promise<Skill | null>;
  findAllByAgent(agentId: AgentId): Promise<Skill[]>;
  findAll(): Promise<Skill[]>;
  save(skill: Skill): Promise<Skill>;
}
