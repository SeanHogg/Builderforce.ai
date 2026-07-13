import { describe, it, expect } from 'vitest';
import {
  SEVERITY_RANK,
  buildFindingTaskDraft,
  meetsSeverityThreshold,
  priorityForSeverity,
  severityRank,
  type QaFindingLike,
} from './QaFindingRouter';
import { TaskPriority } from '../../domain/shared/types';

const finding = (over: Partial<QaFindingLike> = {}): QaFindingLike => ({
  id: 'f1',
  explorationId: 'e1',
  projectId: 7,
  type: 'pageerror',
  severity: 'high',
  route: '/dashboard',
  selector: 'button[data-testid="save"]',
  message: 'Uncaught TypeError: x is not a function',
  detail: 'at handleSave (app.js:12)',
  heat: 42,
  ...over,
});

describe('severity policy', () => {
  it('ranks severities low < medium < high < critical', () => {
    expect(SEVERITY_RANK.low).toBeLessThan(SEVERITY_RANK.medium);
    expect(SEVERITY_RANK.medium).toBeLessThan(SEVERITY_RANK.high);
    expect(SEVERITY_RANK.high).toBeLessThan(SEVERITY_RANK.critical);
  });

  it('treats an unknown severity as medium', () => {
    expect(severityRank('weird')).toBe(SEVERITY_RANK.medium);
  });

  it('meetsSeverityThreshold is inclusive at the threshold', () => {
    expect(meetsSeverityThreshold('high', 'high')).toBe(true);
    expect(meetsSeverityThreshold('critical', 'high')).toBe(true);
    expect(meetsSeverityThreshold('medium', 'high')).toBe(false);
    expect(meetsSeverityThreshold('low', 'low')).toBe(true);
  });

  it('maps severity to board priority', () => {
    expect(priorityForSeverity('critical')).toBe(TaskPriority.URGENT);
    expect(priorityForSeverity('high')).toBe(TaskPriority.HIGH);
    expect(priorityForSeverity('medium')).toBe(TaskPriority.MEDIUM);
    expect(priorityForSeverity('low')).toBe(TaskPriority.LOW);
    expect(priorityForSeverity('???')).toBe(TaskPriority.MEDIUM);
  });
});

describe('buildFindingTaskDraft', () => {
  it('builds a titled, severity-priced task referencing the finding', () => {
    const draft = buildFindingTaskDraft(finding());
    expect(draft.title).toContain('[QA pageerror]');
    expect(draft.title).toContain('Uncaught TypeError');
    expect(draft.priority).toBe(TaskPriority.HIGH);
    expect(draft.description).toContain('/dashboard');
    expect(draft.description).toContain('data-testid="save"');
    expect(draft.description).toContain('Surfaced from exploration `e1`');
  });

  it('omits the route/selector/detail lines when absent', () => {
    const draft = buildFindingTaskDraft(finding({ route: null, selector: null, detail: null }));
    expect(draft.description).not.toContain('**Route:**');
    expect(draft.description).not.toContain('**Selector:**');
    expect(draft.description).not.toContain('**Detail:**');
  });

  it('truncates a very long message in the title', () => {
    const draft = buildFindingTaskDraft(finding({ message: 'x'.repeat(500) }));
    // "[QA pageerror] " prefix + 120 chars of message.
    expect(draft.title.length).toBeLessThanOrEqual('[QA pageerror] '.length + 120);
  });
});
