import { AgentId, TenantId, AgentType } from '../shared/types';
import { ValidationError } from '../shared/errors';

export interface AgentProps {
  id:         AgentId;
  tenantId:   TenantId;
  name:       string;
  type:       AgentType;
  endpoint:   string;
  /** SHA-256 hash of the agent's own API key, used for result callbacks. */
  apiKeyHash: string | null;
  isActive:   boolean;
  /** Arbitrary JSON config stored as a string. */
  config:     string | null;
  createdAt:  Date;
  updatedAt:  Date;
}

/**
 * Agent entity.
 *
 * Represents a registered AI agent endpoint that can accept task executions.
 */
export class Agent {
  private constructor(private readonly props: AgentProps) {}

  static create(
    props: Omit<AgentProps, 'id' | 'createdAt' | 'updatedAt'>,
  ): Agent {
    if (!props.name.trim())     throw new ValidationError('Agent name is required');
    if (!props.endpoint.trim()) throw new ValidationError('Agent endpoint is required');
    const now = new Date();
    return new Agent({ ...props, id: 0 as AgentId, createdAt: now, updatedAt: now });
  }

  static reconstitute(props: AgentProps): Agent {
    return new Agent(props);
  }

  get id():         AgentId        { return this.props.id; }
  get tenantId():   TenantId       { return this.props.tenantId; }
  get name():       string         { return this.props.name; }
  get type():       AgentType      { return this.props.type; }
  get endpoint():   string         { return this.props.endpoint; }
  get apiKeyHash(): string | null  { return this.props.apiKeyHash; }
  get isActive():   boolean        { return this.props.isActive; }
  get config():     string | null  { return this.props.config; }
  get createdAt():  Date           { return this.props.createdAt; }
  get updatedAt():  Date           { return this.props.updatedAt; }

  deactivate(): Agent {
    return new Agent({ ...this.props, isActive: false, updatedAt: new Date() });
  }

  toPlain(): AgentProps { return { ...this.props }; }
}
