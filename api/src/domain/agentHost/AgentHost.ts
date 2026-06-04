import { AgentHostId, TenantId } from '../shared/types';

export type AgentHostStatus = 'active' | 'inactive' | 'suspended';

export interface AgentHostProps {
  id: AgentHostId;
  tenantId: TenantId;
  name: string;
  slug: string;
  status: AgentHostStatus;
  apiKeyHash: string | null;
  capabilities: string[] | null;
  declaredCapabilities: string[] | null;
  connectedAt: Date | null;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class AgentHost {
  private constructor(private readonly props: AgentHostProps) {}

  static reconstitute(props: AgentHostProps): AgentHost {
    return new AgentHost(props);
  }

  get id(): AgentHostId {
    return this.props.id;
  }

  get tenantId(): TenantId {
    return this.props.tenantId;
  }

  get name(): string {
    return this.props.name;
  }

  get slug(): string {
    return this.props.slug;
  }

  get status(): AgentHostStatus {
    return this.props.status;
  }

  get apiKeyHash(): string | null {
    return this.props.apiKeyHash;
  }

  get capabilities(): string[] | null {
    return this.props.capabilities;
  }

  get declaredCapabilities(): string[] | null {
    return this.props.declaredCapabilities;
  }

  get connectedAt(): Date | null {
    return this.props.connectedAt;
  }

  get lastSeenAt(): Date | null {
    return this.props.lastSeenAt;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  toPlain(): AgentHostProps {
    return { ...this.props };
  }
}
