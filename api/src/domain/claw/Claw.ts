import { ClawId, TenantId } from '../shared/types';

export type ClawStatus = 'active' | 'inactive' | 'suspended';

export interface ClawProps {
  id: ClawId;
  tenantId: TenantId;
  name: string;
  slug: string;
  status: ClawStatus;
  apiKeyHash: string | null;
  capabilities: string[] | null;
  declaredCapabilities: string[] | null;
  connectedAt: Date | null;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class Claw {
  private constructor(private readonly props: ClawProps) {}

  static reconstitute(props: ClawProps): Claw {
    return new Claw(props);
  }

  get id(): ClawId {
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

  get status(): ClawStatus {
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

  toPlain(): ClawProps {
    return { ...this.props };
  }
}
