export const mockDependencyRepo = {
  link(_dependencyId: number, _dependeeId: number): Promise<void> {
    return Promise.resolve();
  },
  unlink(_dependencyId: number, _dependeeId: number): Promise<void> {
    return Promise.resolve();
  },
  findUpstream(_deadlineId: number): Promise<number[]> {
    return Promise.resolve([]);
  },
  findDependents(_deadlineId: number): Promise<number[]> {
    return Promise.resolve([]);
  },
};

// ---------------------------------------------------------------------
// Audit stub
// ---------------------------------------------------------------------
export interface AuditLogEntry {
  deadlineId: number;
  field: string;
  oldValue: any;
  newValue: any;
  actor: string;
  slipReason?: string | null;
  note?: string | null;
}

export const mockAuditor = {
  add: (_entry: AuditLogEntry): void => {
    return;
  },
  exportByDeadlineId(_deadlineId: number): AuditLogEntry[] {
    return [];
  },
  exportByField(_field: string): AuditLogEntry[] {
    return [];
  },
  exportByActor(_actor: string, _lookbackHours: number): AuditLogEntry[] {
    return [];
  },
};

// ---------------------------------------------------------------------
// Minimal DeadlineRepository stub to unblock e2e
// ---------------------------------------------------------------------
export type DeadlineEntity = {
  id: number;
  tenantId: number;
  projectId?: number;
  title: string;
  type: 'business' | 'customer';
  owner: string;
  dueDate: Date;
  priority: 'p1' | 'p2' | 'p3';
  tags: string[];
  description?: string | null;
  dependents: number[];
  healthOverride?: 'on_track' | 'at_risk' | 'off_track' | 'missed' | null;
  healthOverrideReason?: string | null;
  createdAt: Date;
  updatedAt: Date;
  syncedFromSource?: string | null;
  externalSystem?: string | null;
};

export const mockDeadlineRepo = {
  deadlines: new Map<number, DeadlineEntity>(),

  create(dto: DeadlineEntity): DeadlineEntity {
    const id = Math.max(...Array.from(this.deadlines.keys()), 0) + 1;
    const now = new Date();
    const entity: DeadlineEntity = {
      ...dto,
      id,
      dependents: dto.dependents || [],
      createdAt: now,
      updatedAt: now,
      syncedFromSource: dto.syncedFromSource || null,
      externalSystem: dto.externalSystem || null,
    };
    this.deadlines.set(id, entity);
    return entity;
  },

  findById(id: number): DeadlineEntity | undefined {
    return this.deadlines.get(id);
  },

  list(skipInactive?: boolean): DeadlineEntity[] {
    return Array.from(this.deadlines.values());
  },

  updateProps(id: number, updates: Partial<DeadlineEntity>): DeadlineEntity | undefined {
    const existing = this.deadlines.get(id);
    if (!existing) return undefined;
    const next: DeadlineEntity = {
      ...existing,
      ...updates,
      updatedAt: new Date(),
    };
    this.deadlines.set(id, next);
    return next;
  },

  delete(id: number): boolean {
    return this.deadlines.delete(id);
  },

  findByOwner(owner: string): DeadlineEntity[] {
    return Array.from(this.deadlines.values()).filter((d) => d.owner === owner);
  },

  findByType(type: 'business' | 'customer'): DeadlineEntity[] {
    return Array.from(this.deadlines.values()).filter((d) => d.type === type);
  },

  findByHealth(health: 'on_track' | 'at_risk' | 'off_track' | 'missed'): DeadlineEntity[] {
    return Array.from(this.deadlines.values()).filter((d) => d.healthOverride === health);
  },

  auditLogByDeadlineId(_deadlineId: number): any[] {
    return [];
  },

  auditLogForDeadlineOnDate(_deadlineId: number, _startDate: string | null, _endDate: string | null): any[] {
    return [];
  },
};

const DeadlineRepo = mockDeadlineRepo;