import { SkillId, AgentId } from '../shared/types';
import { ValidationError } from '../shared/errors';

export interface SkillProps {
  id:           SkillId;
  agentId:      AgentId;
  name:         string;
  description:  string | null;
  /** JSON Schema string for input parameters. */
  inputSchema:  string | null;
  /** JSON Schema string for output structure. */
  outputSchema: string | null;
  createdAt:    Date;
}

/**
 * Skill entity.
 *
 * A Skill is a capability advertised by an Agent – analogous to a function
 * the agent can execute.
 */
export class Skill {
  private constructor(private readonly props: SkillProps) {}

  static create(
    props: Omit<SkillProps, 'id' | 'createdAt'>,
  ): Skill {
    if (!props.name.trim()) throw new ValidationError('Skill name is required');
    return new Skill({ ...props, id: 0 as SkillId, createdAt: new Date() });
  }

  static reconstitute(props: SkillProps): Skill {
    return new Skill(props);
  }

  get id():           SkillId       { return this.props.id; }
  get agentId():      AgentId       { return this.props.agentId; }
  get name():         string        { return this.props.name; }
  get description():  string | null { return this.props.description; }
  get inputSchema():  string | null { return this.props.inputSchema; }
  get outputSchema(): string | null { return this.props.outputSchema; }
  get createdAt():    Date          { return this.props.createdAt; }

  toPlain(): SkillProps { return { ...this.props }; }
}
