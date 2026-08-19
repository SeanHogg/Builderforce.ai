import { describe, it, expect } from 'vitest';
import {
  EVENT_TRIGGER_TYPES,
  extractTriggers,
  isActivatableTriggerType,
  isEventTriggerType,
  triggerNeedsToken,
  generateTriggerToken,
  configString,
  configPositiveInt,
} from './workflowTriggers';
import type { WorkflowDefinition } from './workflowGraph';

const def = (nodes: WorkflowDefinition['nodes']): WorkflowDefinition => ({ nodes, edges: [] });
const node = (id: string, kind: string, config: Record<string, unknown>) =>
  ({ id, kind, label: id, position: { x: 0, y: 0 }, config }) as WorkflowDefinition['nodes'][number];

describe('isActivatableTriggerType', () => {
  it('accepts the autonomous trigger types only', () => {
    expect(isActivatableTriggerType('schedule')).toBe(true);
    expect(isActivatableTriggerType('webhook')).toBe(true);
    expect(isActivatableTriggerType('rss')).toBe(true);
    expect(isActivatableTriggerType('inbound-email')).toBe(true);
    // The internal-event half — these rendered in the palette for releases while
    // being inactivatable, so choosing one created no registry row and nothing fired.
    for (const type of EVENT_TRIGGER_TYPES) expect(isActivatableTriggerType(type)).toBe(true);
    // `manual` stays out on purpose: it is only ever started by `POST .../run`.
    expect(isActivatableTriggerType('manual')).toBe(false);
    expect(isActivatableTriggerType(undefined)).toBe(false);
  });

  it('classifies every event type as event-driven and no transport type as one', () => {
    for (const type of EVENT_TRIGGER_TYPES) expect(isEventTriggerType(type)).toBe(true);
    for (const type of ['schedule', 'webhook', 'rss', 'inbound-email', 'manual']) {
      expect(isEventTriggerType(type)).toBe(false);
    }
  });

  it('needs no token for an internal event — nothing addresses it from outside', () => {
    for (const type of EVENT_TRIGGER_TYPES) expect(triggerNeedsToken(type)).toBe(false);
  });
});

describe('triggerNeedsToken', () => {
  it('flags inbound-addressed types', () => {
    expect(triggerNeedsToken('webhook')).toBe(true);
    expect(triggerNeedsToken('inbound-email')).toBe(true);
    expect(triggerNeedsToken('schedule')).toBe(false);
    expect(triggerNeedsToken('rss')).toBe(false);
  });
});

describe('extractTriggers', () => {
  it('returns only activatable trigger nodes', () => {
    const d = def([
      node('t1', 'trigger', { triggerType: 'schedule', cron: '0 9 * * *' }),
      node('t2', 'trigger', { triggerType: 'manual' }),
      node('t3', 'trigger', { triggerType: 'webhook' }),
      node('a1', 'agent', { role: 'code-creator' }),
    ]);
    const specs = extractTriggers(d);
    expect(specs.map((s) => s.nodeId)).toEqual(['t1', 't3']);
    expect(specs[0]?.triggerType).toBe('schedule');
    expect(specs[0]?.config.cron).toBe('0 9 * * *');
  });
  it('ignores non-trigger nodes and missing config', () => {
    const d = def([node('x', 'trigger', {})]);
    expect(extractTriggers(d)).toEqual([]);
  });
});

describe('generateTriggerToken', () => {
  it('produces a 32-char hex token that is unique per call', () => {
    const a = generateTriggerToken();
    const b = generateTriggerToken();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });
});

describe('config readers', () => {
  it('configString trims and drops blanks', () => {
    expect(configString({ a: '  hi ' }, 'a')).toBe('hi');
    expect(configString({ a: '   ' }, 'a')).toBeUndefined();
    expect(configString({ a: 5 }, 'a')).toBeUndefined();
  });
  it('configPositiveInt coerces and rejects non-positive', () => {
    expect(configPositiveInt({ n: 15 }, 'n')).toBe(15);
    expect(configPositiveInt({ n: '30' }, 'n')).toBe(30);
    expect(configPositiveInt({ n: 0 }, 'n')).toBeUndefined();
    expect(configPositiveInt({ n: -4 }, 'n')).toBeUndefined();
    expect(configPositiveInt({ n: 'x' }, 'n')).toBeUndefined();
  });
});
