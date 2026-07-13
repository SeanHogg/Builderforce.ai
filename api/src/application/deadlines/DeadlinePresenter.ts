// deadlinePresenter.ts

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------

export type ExecutiveSummary = ReturnType<typeof computeExecutiveSummary>;
export type TimelineView = ReturnType<typeof buildTimelineView>;
export type CustomerView = ReturnType<typeof buildCustomerView>;

/** Counters per Business/Customer by status. */
export interface StatusCounters {
  business: { on_track: number; at_risk: number; off_track: number; missed: number };
  customer: { on_track: number; at_risk: number; off_track: number; missed: number };
}

/** Snapshot for sparkline over N days up to now. */
export interface SparklineSegment {
  dayOfYear: number;
  value: number;
  label: string;
}

/** Executive summary for Portfolio ▸ Deadlines view. */
export interface ExecutiveSummary {
  counts: StatusCounters;
  trend30d: Partial<Record<'business' | 'customer', SparklineSegment[]>>;
  trend60d: Partial<Record<'business' | 'customer', SparklineSegment[]>>;
  trend90d: Partial<Record<'business' | 'customer', SparklineSegment[]>>;
  totalActive: number;
  totalBusiness: number;
  totalCustomer: number;
}

/** Filter criteria for Timeline View (FR-5.2). */
export interface TimelineFilter {
  type?: ('business' | 'customer');
  owner?: string;
  tag?: string;
  priority?: ('p1' | 'p2' | 'p3');
  dateRangeStart?: Date;
  dateRangeEnd?: Date;
  status?: ('on_track' | 'at_risk' | 'off_track' | 'missed');
}

/** Date filter window in days. */
export interface DateWindow {
  start: Date;
  end: Date;
}

/** One row in Timeline View (user-visible Gantt entry). */
export interface TimelineRow {
  id: number;
  title: string;
  type: 'business' | 'customer';
  owner: string;
  priority: 'p1' | 'p2' | 'p3';
  tags: string[];
  dueDate: Date;
  targetDate: Date;
  status: 'on_track' | 'at_risk' | 'off_track' | 'missed';
  healthOverrideReason?: string;
  healthOverrideActive: boolean;
  dependentDeadlineIds: number[];
  dependents: Array<{ deadlineId: number; title: string }>;
  startDate?: Date; // optional earliest planned start for Gantt
}

/** Customer Deadline View (FR-5.4). */
export interface CustomerView {
  customerId?: string;
  count: number;
  contracts: Array<{
    id: number;
    title: string;
    type: 'business' | 'customer';
    dueDate: Date;
    status: 'on_track' | 'at_risk' | 'off_track' | 'missed';
  }>;
  slaWindows: Array<{
    title: string;
    dueDate: Date;
    remainingDays: number;
    status: 'on_track' | 'at_risk' | 'off_track' | 'missed';
  }>;
  nextMilestone?: TimelineRow;
}

/** Original Deadline domain properties used for view building. */
export interface DeadlineEntity {
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
}

// ---------------------------------------------------------------------
// Presenter
// ---------------------------------------------------------------------

export class DeadlinePresenter {
  /** Compute executive summary for Portfolio ▸ Deadlines view (FR-5.1). */
  static computeExecutiveSummary(deadlines: DeadlineEntity[]): ExecutiveSummary {
    const counts: StatusCounters = {
      business: { on_track: 0, at_risk: 0, off_track: 0, missed: 0 },
      customer: { on_track: 0, at_risk: 0, off_track: 0, missed: 0 },
    };

    const now = new Date();

    const toSegment = (status: StatusCounters[keyof StatusCounters], day: number): SparklineSegment => ({
      dayOfYear: day,
      value: status[statusLit(status)],
      label: formatDayLabel(day),
    });

    const business30d: SparklineSegment[] = [];
    const customer30d: SparklineSegment[] = [];
    const business60d: SparklineSegment[] = [];
    const customer60d: SparklineSegment[] = [];
    const business90d: SparklineSegment[] = [];
    const customer90d: SparklineSegment[] = [];

    for (let i = 0; i < 90; ++i) {
      const day = now.getTime() - (90 - 1 - i) * 24 * 60 * 60 * 1000;
      const d = new Date(day);

      const business = counts.business as { [k in Status]: number };
      const customer = counts.customer as { [k in Status]: number };
      const bOnTrack = business.on_track;
      const bAtRisk = business.at_risk;
      const bOffTrack = business.off_track;
      const bMissed = business.missed;
      const cOnTrack = customer.on_track;
      const cAtRisk = customer.at_risk;
      const cOffTrack = customer.off_track;
      const cMissed = customer.missed;

      business30d.push(toSegment({ on_track: bOnTrack, at_risk: bAtRisk, off_track: bOffTrack, missed: bMissed }, i + 1));
      customer30d.push(toSegment({ on_track: cOnTrack, at_risk: cAtRisk, off_track: cOffTrack, missed: cMissed }, i + 1));
      business60d.push({ dayOfYear: i + 1, value: bOnTrack + bAtRisk + bOffTrack + bMissed, label: formatDayLabel(i + 1) });
      customer60d.push({ dayOfYear: i + 1, value: cOnTrack + cAtRisk + cOffTrack + cMissed, label: formatDayLabel(i + 1) });
      business90d.push({ dayOfYear: i + 1, value: bOnTrack + bAtRisk + bOffTrack + bMissed, label: formatDayLabel(i + 1) });
      customer90d.push({ dayOfYear: i + 1, value: cOnTrack + cAtRisk + cOffTrack + cMissed, label: formatDayLabel(i + 1) });
    }

    for (const d of deadlines) {
      if (d.healthOverride === 'on_track') {
        if (d.type === 'business') counts.business.on_track += 1;
        else counts.customer.on_track += 1;
      } else if (d.healthOverride === 'at_risk') {
        if (d.type === 'business') counts.business.at_risk += 1;
        else counts.customer.at_risk += 1;
      } else if (d.healthOverride === 'off_track') {
        if (d.type === 'business') counts.business.off_track += 1;
        else counts.customer.off_track += 1;
      } else if (d.healthOverride === 'missed') {
        if (d.type === 'business') counts.business.missed += 1;
        else counts.customer.missed += 1;
      } else if (d.healthOverride === null) {
        // Not overridden; skip.
      }
    }

    return {
      counts,
      trend30d: { business: business30d, customer: customer30d },
      trend60d: { business: business60d, customer: customer60d },
      trend90d: { business: business90d, customer: customer90d },
      totalActive: deadlines.length,
      totalBusiness: counts.business.on_track + counts.business.at_risk + counts.business.off_track + counts.business.missed,
      totalCustomer: counts.customer.on_track + counts.customer.at_risk + counts.customer.off_track + counts.customer.missed,
    };
  }

  /** Build Timeline View list and expose dependency names per deadline (FR-5.2). */
  static buildTimelineView(
    deadlines: DeadlineEntity[],
    dependentNames: ReadonlyMap<number, string>,
  ): TimelineView {
    const rows: TimelineRow[] = deadlines.map((d) => ({
      id: d.id,
      title: d.title,
      type: d.type,
      owner: d.owner,
      priority: d.priority,
      tags: d.tags,
      dueDate: d.dueDate,
      targetDate: d.dueDate, // Current behavior: target is dueDate; planner hook can diverge when available
      status: d.healthOverride || 'on_track',
      healthOverrideActive: d.healthOverride !== null,
      healthOverrideReason: d.healthOverrideReason || undefined,
      dependentDeadlineIds: d.dependents,
      dependents: Array.from(dependentNames.entries())
        .filter(([id]) => d.dependents.includes(id))
        .map(([id, title]) => ({ deadlineId: id, title })),
      startDate: undefined, // fetch from planner or inference extension per ticket
    }));

    return rows;
  }

  /** Build Customer Deadline View scoped to customer (FR-5.4). */
  static buildCustomerView(
    deadlines: ReadonlyArray<DeadlineEntity>,
    customerId?: string,
  ): CustomerView {
    // Group by customer anchor: tag or owner field as placeholder for customer identity
    const scoped: Array<{ deadline: DeadlineEntity; customerId: string }> = deadlines
      .filter((d) => d.type === 'customer')
      .map((d) => ({
        deadline: d,
        customerId: d.tags.find((t) => t.startsWith('customer:'))?.slice(10)?.replace(/-/g, '') || d.owner, // placeholder
      }))
      .filter((x) => x.customerId);

    if (!customerId) {
      // Show first customer or empty
      const first = scoped.find((x) => x.customerId);
      const count = scoped.length;
      const contracts = scoped.map((x) => ({
        id: x.deadline.id,
        title: x.deadline.title,
        type: x.deadline.type,
        dueDate: x.deadline.dueDate,
        status: x.deadline.healthOverride || 'on_track',
      }));
      const slaWindows = scoped.map((x) => ({
        title: 'SLA Window ' + x.deadline.id,
        dueDate: x.deadline.dueDate,
        remainingDays: Math.max(0, Math.floor((x.deadline.dueDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000))),
        status: x.deadline.healthOverride || 'on_track',
      }));
      const nextMilestone = scoped.length > 0 ? scoped[0].deadline : undefined;
      return { count, customerId: first?.customerId, contracts, slaWindows, nextMilestone };
    } else {
      const scopedCustomerId = customerId.replace(/-/g, '');
      const forCustomer = scoped.filter((x) => x.customerId === scopedCustomerId);
      const count = forCustomer.length;
      const contracts = forCustomer.map((x) => ({
        id: x.deadline.id,
        title: x.deadline.title,
        type: x.deadline.type,
        dueDate: x.deadline.dueDate,
        status: x.deadline.healthOverride || 'on_track',
      }));
      const slaWindows = forCustomer.map((x) => ({
        title: 'SLA Window ' + x.deadline.id,
        dueDate: x.deadline.dueDate,
        remainingDays: Math.max(0, Math.floor((x.deadline.dueDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000))),
        status: x.deadline.healthOverride || 'on_track',
      }));
      const nextMilestone = forCustomer.length > 0 ? forCustomer[0].deadline : undefined;
      return { count, customerId, contracts, slaWindows, nextMilestone };
    }
  }
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

type Status<'business' | 'customer'> = keyof StatusCounters[keyof StatusCounters];
let statusLev: Record<keyof StatusCounters, number> = {
  on_track: 0,
  at_risk: 1,
  off_track: 2,
  missed: 3,
};
let statusLit: Record<string, StatusCounters[keyof StatusCounters]> = {
  on_track: 'on_track' as const,
  at_risk: 'at_risk' as const,
  off_track: 'off_track' as const,
  missed: 'missed' as const,
};

/** Convert enum-like values to human-readable labels. */
function formatDayLabel(day: number): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear(), 0, day);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}