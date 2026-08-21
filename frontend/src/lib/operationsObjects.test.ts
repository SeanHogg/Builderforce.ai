import { describe, expect, it } from 'vitest';
import {
  CREATION_OBJECT_KINDS, defaultConfidentialityForKind, isOperationsObjectKind,
  OPERATIONS_OBJECT_KINDS,
} from '@builderforce/creation-canvas-contract';
import { OPERATIONS_LABELS, OPERATIONS_OBJECT_SPECS, OPERATIONS_STATUSES } from './operationsObjects';
import './specObjectSets';
import {
  specDerivedValues, specFieldValue, specMutableFields, specObjectNamespace, specObjectSpec,
} from './specObjects';
import en from '@/i18n/messages/en.json';

const spec = (kind: string) => {
  const found = OPERATIONS_OBJECT_SPECS.find((entry) => entry.kind === kind);
  if (!found) throw new Error(`no operations spec for ${kind}`);
  return found;
};
const field = (kind: string, name: string) => {
  const found = spec(kind).fields.find((entry) => entry.name === name);
  if (!found) throw new Error(`no ${name} field on ${kind}`);
  return found;
};

describe('operations vocabulary', () => {
  it('declares one spec per contract kind, and no more', () => {
    expect(OPERATIONS_OBJECT_SPECS.map((entry) => entry.kind).sort()).toEqual([...OPERATIONS_OBJECT_KINDS].sort());
  });

  it('registers every operations kind in the canvas contract', () => {
    for (const kind of OPERATIONS_OBJECT_KINDS) expect(CREATION_OBJECT_KINDS).toContain(kind);
  });

  it('recognises its own kinds and rejects another vocabulary’s', () => {
    expect(isOperationsObjectKind('workOrder')).toBe(true);
    expect(isOperationsObjectKind('incident')).toBe(true);
    expect(isOperationsObjectKind('candidate')).toBe(false);
    expect(isOperationsObjectKind(null)).toBe(false);
  });

  it('has a label and a status fallback for every kind', () => {
    for (const entry of OPERATIONS_OBJECT_SPECS) {
      expect(OPERATIONS_LABELS[entry.kind as keyof typeof OPERATIONS_LABELS]).toBeTruthy();
      expect(OPERATIONS_STATUSES[entry.defaultStatus]).toBeTruthy();
    }
  });

  it('never starts a blank card in a state that reads as configured', () => {
    for (const entry of OPERATIONS_OBJECT_SPECS) {
      const status = OPERATIONS_STATUSES[entry.defaultStatus] ?? '';
      expect(status.toLowerCase()).not.toMatch(/^(live|ready|active|complete|valid)$/);
    }
  });

  it('resolves every kind under the operations i18n namespace', () => {
    for (const entry of OPERATIONS_OBJECT_SPECS) {
      expect(specObjectNamespace(entry.kind)).toBe('creationCanvas.operations');
    }
  });

  it('gives every field a hint the model can act on, and every table its columns', () => {
    for (const entry of OPERATIONS_OBJECT_SPECS) {
      for (const entryField of entry.fields) {
        expect(entryField.hint.length).toBeGreaterThan(20);
        if (entryField.render === 'rows') expect(entryField.columns?.length).toBeGreaterThan(0);
      }
    }
  });

  /**
   * The failure this catches is invisible in the app and total on the card: a field
   * whose label key is missing renders as the raw key, and a `rows` column whose header
   * is missing renders as `column.unitPrice` in the middle of a priced quote.
   */
  it('has an English label for every kind, field and column it declares', () => {
    // The catalog is statically typed from the JSON, so every lookup here is a
    // string index into a literal type. The narrowing is what the assertions need.
    const catalog = en.creationCanvas.operations as unknown as {
      label: Record<string, string>;
      field: Record<string, string>;
      column: Record<string, string>;
    };
    for (const entry of OPERATIONS_OBJECT_SPECS) {
      expect(catalog.label[entry.kind]).toBeTruthy();
      for (const entryField of entry.fields) {
        expect(catalog.field[entryField.label]).toBeTruthy();
        for (const column of entryField.columns ?? []) expect(catalog.column[column]).toBeTruthy();
      }
    }
  });
});

describe('the industry is a VALUE, not a kind', () => {
  it('ships no per-industry kind', () => {
    // The whole argument of `operations.ts`: six industries share one shape, and a pack
    // per industry is six copies that drift. `discipline` is what tells them apart.
    //
    // The legal example is spelled `legalPracticeJob` and NOT `legalMatter`, which this
    // list used to name: the LEGAL vocabulary legitimately declares `legalMatter` for a
    // different thing entirely — what is being argued, with an adverse party and a filing
    // deadline — so asserting its absence turned a real kind into a failure and said
    // nothing about the per-industry duplication this test is actually for.
    for (const kind of ['hvacJob', 'propertyRepair', 'clinicAppointment', 'fleetDefect', 'legalPracticeJob']) {
      expect(CREATION_OBJECT_KINDS).not.toContain(kind);
    }
    expect(spec('workOrder').fields.map((entry) => entry.name)).toContain('discipline');
    expect(spec('serviceAsset').fields.map((entry) => entry.name)).toContain('discipline');
  });
});

describe('computed fields', () => {
  it('totals a job from its parts and its labour', () => {
    const data = {
      kind: 'workOrder',
      partsUsed: [{ part: 'Pump', quantity: 1, cost: '£180' }, { part: 'Seal kit', quantity: 2, cost: '£24' }],
      labourHours: 3,
      labourRate: '£60',
    };
    // 180 + 24 + (3 × 60) = 384. Note `cost` is summed across rows, not multiplied by
    // quantity: the column is the LINE cost, which is what an engineer records.
    expect(String(specFieldValue(field('workOrder', 'costToServe'), data))).toContain('384');
  });

  it('refuses rather than reporting zero when nothing is priced', () => {
    // A £0 job reads as "this cost us nothing", which is a confidently wrong answer.
    expect(specFieldValue(field('workOrder', 'costToServe'), { kind: 'workOrder' })).toBeUndefined();
    expect(specFieldValue(field('estimate', 'total'), { kind: 'estimate', lines: [] })).toBeUndefined();
  });

  it('totals an estimate from its own lines', () => {
    const data = { kind: 'estimate', lines: [{ description: 'Labour', amount: '$400' }, { description: 'Parts', amount: '$150' }] };
    expect(String(specFieldValue(field('estimate', 'total'), data))).toContain('550');
  });

  it('computes utilisation from the day’s capacity, and excludes n/a lines from a pass rate', () => {
    const board = { kind: 'dispatchBoard', engineers: [{ capacityHours: 8, assignedHours: 6 }, { capacityHours: 8, assignedHours: 2 }] };
    expect(specFieldValue(field('dispatchBoard', 'utilisation'), board)).toBe(50);

    const inspection = {
      kind: 'inspection',
      lines: [{ result: 'pass' }, { result: 'fail' }, { result: 'pass' }, { result: 'n/a' }],
    };
    // 2 of 3 applicable lines, NOT 2 of 4 — an n/a counted as a pass is a survey that
    // reports better than it found.
    expect(specFieldValue(field('inspection', 'passRate'), inspection)).toBe(67);
  });

  it('says whether a certification is actually valid, from its expiry', () => {
    const future = new Date(Date.now() + 400 * 86_400_000).toISOString();
    const past = new Date(Date.now() - 10 * 86_400_000).toISOString();
    expect(String(specFieldValue(field('certification', 'validity'), { kind: 'certification', expiresAt: future }))).toContain('valid');
    expect(String(specFieldValue(field('certification', 'validity'), { kind: 'certification', expiresAt: past }))).toContain('expired');
  });

  it('counts the corrective actions an incident has left open', () => {
    const data = {
      kind: 'incident',
      correctiveActions: [{ action: 'Replace guard', status: 'done' }, { action: 'Retrain crew', status: 'open' }],
    };
    expect(specFieldValue(field('incident', 'openActions'), data)).toBe(1);
  });

  it('is never authorable — a computed total the model can write is not computed', () => {
    for (const [kind, name] of [['workOrder', 'costToServe'], ['estimate', 'total'], ['dispatchBoard', 'utilisation'], ['inspection', 'passRate'], ['certification', 'validity']] as const) {
      expect(specMutableFields(kind)).not.toContain(name);
    }
  });

  it('reaches the model’s snapshot, which reading the stored object cannot', () => {
    // The mirror image of the authorable-but-unreadable drift: a number the card shows
    // and the prompt does not is a number the model answers around.
    const derived = specDerivedValues('estimate', { kind: 'estimate', lines: [{ amount: '£1,000' }] });
    expect(String(derived.total)).toContain('1,000');
    expect(specDerivedValues('estimate', { kind: 'estimate' })).toEqual({});
  });
});

describe('what operations objects hold', () => {
  it('keeps an incident off a shared board by default', () => {
    // An injury record names a person and records their harm. It is `restricted` for the
    // same reason an HR `case` is, and the rule lives with the other classifications.
    expect(defaultConfidentialityForKind('incident')).toBe('restricted');
    expect(defaultConfidentialityForKind('workOrder')).toBe('internal');
  });

  it('never lets a model assert evidence a mechanism must record', () => {
    // The `submission.mark` rule, applied to the field: a model that could write a
    // check-out time could evidence a visit that never happened — and that evidence is
    // what an invoice and an SLA credit are both argued from.
    for (const [kind, name] of [['visit', 'checkInAt'], ['visit', 'checkOutAt'], ['visit', 'signedBy'], ['estimate', 'acceptedAt'], ['purchaseOrder', 'approvedBy'], ['shipment', 'deliveredAt'], ['workOrder', 'firstTimeFix']] as const) {
      expect(field(kind, name).derived).toBe(true);
      expect(specMutableFields(kind)).not.toContain(name);
    }
  });

  it('is reachable through the registry that renders it', () => {
    for (const kind of OPERATIONS_OBJECT_KINDS) expect(specObjectSpec(kind)).toBeTruthy();
  });
});
