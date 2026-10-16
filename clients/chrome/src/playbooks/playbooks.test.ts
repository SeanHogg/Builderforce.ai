import { describe, expect, it } from 'vitest';
import { createMemoryKeyValue } from '../platform/keyValue';
import { createPlaybookStore, normalizePlaybook, PROMPT_BUDGET, renderPlaybooks, STEPS_MAX, type Playbook } from './playbooks';

const now = new Date('2026-10-16T00:00:00Z');
const pb = (over: Partial<Playbook>): Playbook => ({
  id: 'p1',
  trigger: 'file my expenses',
  steps: 'Open the expenses site.',
  site: '',
  enabled: true,
  updatedAt: now.toISOString(),
  ...over,
});

describe('playbooks', () => {
  it('normalizes what the person typed — trimmed, capped, the site reduced to an origin', () => {
    const p = normalizePlaybook({ id: 'a', trigger: '  pay rent ', steps: 'x'.repeat(STEPS_MAX + 10), site: 'bank.example/login', enabled: true }, now);
    expect(p).toMatchObject({ trigger: 'pay rent', site: 'https://bank.example' });
    expect(p!.steps).toHaveLength(STEPS_MAX);
    expect(normalizePlaybook({ id: 'b', trigger: ' ', steps: 'do it', site: '', enabled: true }, now)).toBeNull();
  });

  it('renders enabled playbooks only, the current site first, within the prompt budget', () => {
    const text = renderPlaybooks(
      [
        pb({ id: '1', trigger: 'anywhere one' }),
        pb({ id: '2', trigger: 'off one', enabled: false }),
        pb({ id: '3', trigger: 'bank one', site: 'https://bank.example' }),
      ],
      'https://bank.example/accounts',
    );
    expect(text).toContain("THE PERSON'S PLAYBOOKS");
    expect(text).not.toContain('off one');
    expect(text.indexOf('bank one')).toBeLessThan(text.indexOf('anywhere one'));
    expect(renderPlaybooks([], null)).toBe('');
    const many = Array.from({ length: 40 }, (_, i) => pb({ id: String(i), steps: 'y'.repeat(900) }));
    expect(renderPlaybooks(many, null).length).toBeLessThan(PROMPT_BUDGET + 600);
  });

  it('stores one playbook per synced item', async () => {
    const storage = createMemoryKeyValue();
    const store = createPlaybookStore(storage);
    let changes = 0;
    store.subscribe(() => changes++);
    await store.save(pb({ id: 'x' }));
    await store.save(pb({ id: 'y', trigger: 'another' }));
    expect((await store.list()).map((p) => p.id)).toEqual(['y', 'x']);
    expect(await storage.get('playbook:x')).toMatchObject({ id: 'x' });
    await store.remove('x');
    expect((await store.list()).map((p) => p.id)).toEqual(['y']);
    expect(changes).toBe(3);
  });
});
