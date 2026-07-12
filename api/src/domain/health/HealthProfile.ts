import { ProjectId, TenantId, UserId } from '../shared/types';

export interface HealthProfileProps {
  id: string; // UUID
  tenantId: TenantId;
  projectId: ProjectId;
  schemaVersion: string;
  demographics: Record<string, any>;
  medicalHistory: Record<string, any>;
  currentSymptoms: Record<string, any>;
  medications: any[];
  lifestyle: Record<string, any>;
  customFields: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

/** canonical schemav1 HealthProfile domain entity. */
export class HealthProfile {
  private constructor(private readonly props: HealthProfileProps) {}

  static create(props: Omit<HealthProfileProps, 'id' | 'createdAt' | 'updatedAt'>): HealthProfile {
    if (!props.projectId) throw new Error('Project ID is required');
    // Note: schemaVersion defaults to '1.0' in DB; validation can extend for future versions
    const now = new Date();
    return new HealthProfile({
      ...props,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    });
  }

  static reconstitute(props: HealthProfileProps): HealthProfile {
    if (!props.id) throw new Error('ID is required');
    return new HealthProfile(props);
  }

  get id(): string { return this.props.id; }
  get tenantId(): TenantId { return this.props.tenantId; }
  get projectId(): ProjectId { return Number(this.props.projectId); } // convert uuid to numeric ID for FK
  get schemaVersion(): string { return this.props.schemaVersion; }
  get demographics(): Record<string, any> { return this.props.demographics; }
  get medicalHistory(): Record<string, any> { return this.props.medicalHistory; }
  get currentSymptoms(): Record<string, any> { return this.props.currentSymptoms; }
  get medications(): any[] { return this.props.medications; }
  get lifestyle(): Record<string, any> { return this.props.lifestyle; }
  get customFields(): Record<string, any> { return this.props.customFields; }
  get createdAt(): Date { return this.props.createdAt; }
  get updatedAt(): Date { return this.props.updatedAt; }

  /** Map to a plain JSON object (API transfer). */
  toPlain(): HealthProfilePlain {
    return {
      profileId: this.props.id,
      projectId: String(this.props.projectId),
      schemaVersion: this.props.schemaVersion,
      demographics: this.props.demographics,
      medicalHistory: this.props.medicalHistory,
      currentSymptoms: this.props.currentSymptoms,
      medications: this.props.medications,
      lifestyle: this.props.lifestyle,
      customFields: this.props.customFields,
      createdAt: this.props.createdAt.toISOString(),
      updatedAt: this.props.updatedAt.toISOString(),
    };
  }
}

/** plain JSON shape for transfer (must match canonical PRD schema). */
export type HealthProfilePlain = {
  profileId: string;
  projectId: string;
  schemaVersion: string;
  demographics: Record<string, any>;
  medicalHistory: Record<string, any>;
  currentSymptoms: Record<string, any>;
  medications: any[];
  lifestyle: Record<string, any>;
  customFields: Record<string, any>;
  createdAt: string;
  updatedAt: string;
};