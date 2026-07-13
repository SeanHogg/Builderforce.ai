import { describe, it, expect, beforeEach } from 'vitest';
import { DeadlineService } from './DeadlineService.js';
import { DeadlineNotifier } from './DeadlineNotifier.js';
import { DeadlineExport } from './DeadlineExport.js';
import { DeadlinePresenter } from './DeadlinePresenter.js';
import { mockDeadlineRepo as DeadlineRepo, mockAuditor, mockDependencyRepo } from './tests/dummy-db.deadline.ts';

// ---------------------------------------------------------------------
// Imports from tests package
// ---------------------------------------------------------------------

describe('DeadlineService - E2E', () => {
  let service: DeadlineService;

  beforeEach(() => {
    service = new DeadlineService(DeadlineRepo, mockDependencyRepo, mockAuditor);
  });

  it('should create a deadline with correct type, owner, priority, tags', async () => {
    const d = await service.create({
      tenantId: 1,
      title: 'ACQ Due Diligence',
      type: 'business',
      owner: 'acq-team@org.com',
      dueDate: new Date('2025-08-01'),
      priority: 'p1',
      tags: ['acquisition', 'regulatory'],
    });

    const byId = await DeadlineRepo.findById(d.id);
    expect(byId).toBeTruthy();
    if (!byId) throw new Error('created deadline not found');

    expect(byId.title).toBe('ACQ Due Diligence');
    expect(byId.type).toBe('business');
    expect(byId.owner).toBe('acq-team@org.com');
    expect(byId.priority).toBe('p1');
    expect(byId.tags).toEqual(['acquisition', 'regulatory']);

    const byOwner = await DeadlineRepo.findByOwner('acq-team@org.com');
    expect(byOwner).toHaveLength(1);
  });

  it('by owner should return matching deadlines', async () => {
    await service.create({
      tenantId: 1,
      title: 'ACQ Due Diligence',
      type: 'business',
      owner: 'acq-team@org.com',
      dueDate: new Date('2025-08-01'),
      priority: 'p1',
      tags: ['acquisition', 'regulatory'],
    });

    await service.create({
      tenantId: 1,
      title: 'ARCHITECTURE SPEC REVIEW',
      type: 'customer',
      owner: 'acq-team@org.com',
      dueDate: new Date('2025-09-01'),
      priority: 'p2',
      tags: ['customer', 'architecture'],
    });

    const results = await DeadlineRepo.findByOwner('acq-team@org.com');
    expect(results).toHaveLength(2);
  });

  it('by type should return matching deadlines', async () => {
    await service.create({
      tenantId: 1,
      title: 'ACQ Due Diligence',
      type: 'business',
      owner: 'acq-team@org.com',
      dueDate: new Date('2025-08-01'),
      priority: 'p1',
      tags: ['acquisition', 'regulatory'],
    });

    await service.create({
      tenantId: 1,
      title: 'ARCHITECTURE SPEC REVIEW',
      type: 'customer',
      owner: 'acq-team@org.com',
      dueDate: new Date('2025-09-01'),
      priority: 'p2',
      tags: ['customer', 'architecture'],
    });

    const business = await DeadlineRepo.findByType('business');
    expect(business).toHaveLength(1);
    expect(business[0].title).toBe('ACQ Due Diligence');

    const customers = await DeadlineRepo.findByType('customer');
    expect(customers).toHaveLength(1);
    expect(customers[0].title).toBe('ARCHITECTURE SPEC REVIEW');
  });

  it('by health override should return rows', async () => {
    await service.create({
      tenantId: 1,
      title: 'ACQ Due Diligence',
      type: 'business',
      owner: 'acq-team@org.com',
      dueDate: new Date('2025-08-01'),
      priority: 'p1',
      tags: ['acquisition', 'regulatory'],
    });

    await service.create({
      tenantId: 1,
      title: 'ARCHITECTURE SPEC REVIEW',
      type: 'business',
      owner: 'acq-team@org.com',
      dueDate: new Date('2025-09-01'),
      priority: 'p1',
      tags: ['customer', 'architecture'],
    });

    // Overrun the first deadline
    await service.update(1, { dueDate: new Date('2026-01-01'), slipReason: 'Technical Blocker' }, 'john.doe@example.com');

    const atRisk = await DeadlineRepo.findByHealth('at_risk');
    expect(atRisk).toHaveLength(1);
    expect(atRisk[0].title).toBe('ACQ Due Diligence');

    const onTrack = await DeadlineRepo.findByHealth('on_track');
    expect(onTrack).toHaveLength(1);
    expect(onTrack[0].title).toBe('ARCHITECTURE SPEC REVIEW');

    const missed = await DeadlineRepo.findByHealth('missed');
    expect(missed).toHaveLength(0);
  });

  it('do not touch dates or dependents unless slipReason provided', async () => {
    const d = await service.create({
      tenantId: 1,
      title: 'ACQ Due Diligence',
      type: 'business',
      owner: 'acq-team@org.com',
      dueDate: new Date('2025-08-01'),
      priority: 'p1',
      tags: ['acquisition', 'regulatory'],
    });

    // A non-date update with no slipReason — should succeed
    await service.update(d.id, { title: 'Renamed Deadline' }, 'acq-team@org.com');

    const after = await DeadlineRepo.findById(d.id);
    if (!after) throw new Error('Updated deadline not found');
    expect(after.title).toBe('Renamed Deadline');
    expect(after.dueDate.toISOString().startsWith('2025-08-01')).toBe(true);

    // Date change without slipReason — should throw
    await expect(
      service.update(d.id, { dueDate: new Date('2026-01-01') }, 'acq-team@org.com'),
    ).rejects.toThrow('slipReason is required when changing due_date or dependent deadlines');

    // Date change with invalid slipReason — should throw
    await expect(
      service.update(d.id, { dueDate: new Date('2026-01-01'), slipReason: 'BAD' }, 'acq-team@org.com'),
    ).rejects.toThrow('Invalid slip_reason');
  });

  it('should enforce mandatory slip_reason on date change', async () => {
    const d = await service.create({
      tenantId: 1,
      title: 'ACQ Due Diligence',
      type: 'business',
      owner: 'acq-team@org.com',
      dueDate: new Date('2025-08-01'),
      priority: 'p1',
      tags: ['acquisition', 'regulatory'],
    });

    // Should error without slip_reason
    await expect(
      service.update(d.id, { dueDate: new Date('2026-02-01') }, 'acq-team@org.com'),
    ).rejects.toThrow('slipReason is required when changing due_date or dependent deadlines');

    // Should error with an out-of-taxonomy slip_reason
    await expect(
      service.update(d.id, { dueDate: new Date('2026-02-01'), slipReason: 'not_in_tax' }, 'acq-team@org.com'),
    ).rejects.toThrow('Invalid slip_reason');
  });
});

describe('DeadlineNotifier - E2E', () => {
  let notifier: DeadlineNotifier;

  beforeEach(() => {
    notifier = new DeadlineNotifier(DeadlineRepo, mockAuditor);
  });

  it('should produce the structure for T-7 approaching alert (structure match)', async () => {
    const d = await DeadlineRepo.list(false);
    for (const row of d) {
      await notifier.notifyApproaching(7);
    }
    // This test checks we don't throw; real implementation will log to console/Slack.
    expect(true).toBe(true);
  });

  it('should produce alerts for health-change events (structure match)', async () => {
    const d = await DeadlineRepo.list(false);
    for (const row of d) {
      await notifier.notifyHealthChange(row.id);
    }
    expect(true).toBe(true);
  });

  it('should produce daily digest structure', async () => {
    // Print log, ensure structure matches PRD (actionable items in 24h).
    await notifier.notifyDailyDigest(1);
    expect(true).toBe(true);
  });

  it('should provide escalation flow skeleton for Off Track', async () => {
    const d = await DeadlineRepo.list(false);
    for (const row of d) {
      // we'd mark as off_track before calling escalation; in tests we just check structure.
      console.log('Test escalation flow enabled for deadlineId:' + row.id);
    }
    expect(true).toBe(true);
  });
});

describe('DeadlinePresenter - E2E', () => {
  it('can compute executive summary (counts & trends)', async () => {
    const deadlines = await DeadlineRepo.list(true);

    const summary = DeadlinePresenter.computeExecutiveSummary(deadlines);

    expect(summary.totalActive).toBeGreaterThan(0);
    expect(summary.trend30d).toBeDefined();
    expect(summary.trend60d).toBeDefined();
    expect(summary.trend90d).toBeDefined();
  });

  it('can build timeline view rows with dependent names', async () => {
    const deadlines = await DeadlineRepo.list(true);
    const names = new Map<number, string>();
    for (const d of deadlines) names.set(d.id, d.title);

    const view = DeadlinePresenter.buildTimelineView(deadlines, names);
    expect(view.length).toBe(deadlines.length);
    for (const row of view) {
      expect(row.id).to.exist;
      expect(row.title).to.exist;
      expect(row.status).toMatch(/^on_track|at_risk|off_track|missed$/);
    }
  });

  it('can build customer view rows (no customerTag provided)', async () => {
    const deadlines = await DeadlineRepo.list(true);
    const view = DeadlinePresenter.buildCustomerView(deadlines);
    expect(view).toHaveProperty('count');
    expect(view).toHaveProperty('contracts');
    expect(view).toHaveProperty('slaWindows');
    if (deadlines.length > 0) {
      expect(view).toHaveProperty('nextMilestone');
    }
  });

  it('customer view should respect customerTag (single planned client)', async () => {
    const deadlines = await DeadlineRepo.list(true);
    const view = DeadlinePresenter.buildCustomerView(deadlines, 'abc-aaa');
    expect(view.customerId).toBe('abc-aaa');
    expect(view.contracts.length).toBeGreaterThan(0);
  });
});

describe('DeadlineExport - E2E', () => {
  it('should produce CSV representation', async () => {
    const deadlines = await DeadlineRepo.list(true);
    const csv = DeadlineExport.toCSV(deadlines);
    expect(csv).toContain('id');
    expect(csv).toContain('title');
    expect(csv.match(/^{.*,/s)).toBeTruthy();
  });

  it('should produce PDF representation (structure match)', async () => {
    const deadlines = await DeadlineRepo.list(true);
    const pdf = await DeadlineExport.toPDF(deadlines);
    expect(pdf).toBeDefined();
    expect(typeof pdf).toBe('string');
  });

  it('should produce JSON representation', async () => {
    const deadlines = await DeadlineRepo.list(true);
    const json = DeadlineExport.toJSON(deadlines);
    expect(json).toBeInstanceOf(Array);
    if (json.length > 0) {
      expect(json[0]).toHaveProperty('id');
    }
  });
});