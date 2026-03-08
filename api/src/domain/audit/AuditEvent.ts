import { TenantId, AuditEventType } from '../shared/types';

export interface AuditEventProps {
  id:           number;
  tenantId:     TenantId | null;
  userId:       string | null;
  eventType:    AuditEventType;
  resourceType: string | null;
  resourceId:   string | null;
  /** Arbitrary JSON metadata serialised as string. */
  metadata:     string | null;
  createdAt:    Date;
}

/**
 * AuditEvent – immutable record of an action taken in the system.
 *
 * Audit events are append-only; they are never updated or deleted.
 */
export class AuditEvent {
  private constructor(private readonly props: AuditEventProps) {}

  static create(props: Omit<AuditEventProps, 'id' | 'createdAt'>): AuditEvent {
    return new AuditEvent({ ...props, id: 0, createdAt: new Date() });
  }

  static reconstitute(props: AuditEventProps): AuditEvent {
    return new AuditEvent(props);
  }

  get id():           number             { return this.props.id; }
  get tenantId():     TenantId | null    { return this.props.tenantId; }
  get userId():       string | null      { return this.props.userId; }
  get eventType():    AuditEventType     { return this.props.eventType; }
  get resourceType(): string | null      { return this.props.resourceType; }
  get resourceId():   string | null      { return this.props.resourceId; }
  get metadata():     string | null      { return this.props.metadata; }
  get createdAt():    Date               { return this.props.createdAt; }

  toPlain(): AuditEventProps { return { ...this.props }; }
}
