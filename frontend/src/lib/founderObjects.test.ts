import { describe, expect, it } from 'vitest';
import { FOUNDER_OBJECT_KINDS, isFounderObjectKind, CREATION_OBJECT_KINDS } from '@builderforce/creation-canvas-contract';
import {
  FOUNDER_BOOKKEEPING_FIELDS, FOUNDER_FIELD_NAMES, FOUNDER_OBJECT_SPECS,
  allFounderFieldGuidance, founderFieldGuidance, founderMutableFields, founderObjectSpec,
  resolveCounterpartyAccount,
} from './founderObjects';
import { makeSpecDeriveBoard, specFieldValue } from './specObjects';
import {
  createDefaultCreationData, creationObjectAiContext, creationObjectContentFields,
  creationObjectDefinition, creationObjectMutableFields, emptyShellProblem,
} from '@/components/creation-canvas/creationObjectRegistry';

describe('the founder spec covers the contract', () => {
  it('specs every declared founder kind, and nothing else', () => {
    expect(FOUNDER_OBJECT_SPECS.map((spec) => spec.kind).sort()).toEqual([...FOUNDER_OBJECT_KINDS].sort());
  });

  it('declares every founder kind in the canvas object contract', () => {
    for (const kind of FOUNDER_OBJECT_KINDS) expect(CREATION_OBJECT_KINDS).toContain(kind);
  });

  it('recognises its own kinds and rejects others', () => {
    expect(isFounderObjectKind('competitor')).toBe(true);
    expect(isFounderObjectKind('liveMetric')).toBe(true);
    expect(isFounderObjectKind('dashboard')).toBe(false);
    expect(isFounderObjectKind(null)).toBe(false);
  });

  /**
   * `metric` belongs to the data-architecture set — the semantic-layer DEFINITION of a
   * number. `liveMetric` is one bound reading of such a number. Collapsing them would
   * make "how ARR is calculated" and "ARR right now" the same object.
   */
  it('keeps liveMetric distinct from the semantic-layer metric', () => {
    expect(FOUNDER_OBJECT_KINDS).toContain('liveMetric');
    expect(FOUNDER_OBJECT_KINDS).not.toContain('metric');
    expect(isFounderObjectKind('metric')).toBe(false);
  });
});

describe('the registry is derived, so the lists cannot drift', () => {
  /**
   * THE REGRESSION THIS FILE EXISTS FOR. `value`, `target`, `unit` and `trend` were
   * authorable on a `kpi` and missing from `CONTEXT_FIELDS`, so Brain could write a
   * number onto the board and was then blind to it. Every founder field must be BOTH
   * authorable and readable.
   */
  it('makes every founder field authorable AND readable', () => {
    for (const spec of FOUNDER_OBJECT_SPECS) {
      const mutable = creationObjectMutableFields(spec.kind);
      for (const field of spec.fields) {
        // A `derived` field is READABLE and deliberately NOT writable — the whole
        // point of the flag. `account.history` is the case that made this explicit:
        // it holds the account's real invoices, bills and contract, synced from the
        // domains that own them, and an authored row there is an invented receivable
        // somebody would chase a real company for. Asserting it authorable would
        // demand exactly the hole `derived` exists to close, so the readability half
        // below still runs for it and only the mutability half is skipped.
        if (!field.derived) {
          expect(mutable, `${spec.kind}.${field.name} must be authorable`).toContain(field.name);
        }
        // Readability is checked through the adapter itself rather than the private
        // field list: a value written to the object must survive into the AI context.
        const context = creationObjectAiContext({ kind: spec.kind, title: 'x', [field.name]: 'probe' });
        expect(context, `${spec.kind}.${field.name} must survive into the AI context`).toHaveProperty(field.name);
      }
    }
  });

  it('closes the same gap for the KPI fields that first exposed it', () => {
    const context = creationObjectAiContext({ kind: 'kpi', title: 'Runway', value: '4.5', target: '6', unit: 'months', trend: '-1.2' });
    expect(context).toMatchObject({ value: '4.5', target: '6', unit: 'months', trend: '-1.2' });
  });

  it('registers every founder kind with an icon, group and blank shape', () => {
    for (const kind of FOUNDER_OBJECT_KINDS) {
      const definition = creationObjectDefinition(kind);
      expect(definition.icon).toBeTruthy();
      expect(definition.label).toBeTruthy();
      const blank = createDefaultCreationData(kind);
      expect(blank.kind).toBe(kind);
      expect(blank.status).toBeTruthy();
    }
  });

  /** A blank card must never assert it is tracking something — the defect the registry's
   *  own workflow and KPI comments record. */
  it('never gives a blank founder card a "live" or "ready" status', () => {
    for (const kind of FOUNDER_OBJECT_KINDS) {
      const status = String(createDefaultCreationData(kind).status ?? '').toLowerCase();
      expect(status).not.toBe('live');
      expect(status).not.toBe('ready');
    }
  });

  it('advertises only actions the spec declares', () => {
    for (const spec of FOUNDER_OBJECT_SPECS) {
      const actions = creationObjectDefinition(spec.kind).actions;
      for (const action of spec.actions) expect(actions).toContain(action);
    }
  });
});

describe('the empty-shell rule', () => {
  it('refuses a founder object that carries only a title', () => {
    for (const kind of FOUNDER_OBJECT_KINDS) {
      const problem = emptyShellProblem(kind, { title: 'Acme' });
      expect(problem, `${kind} must refuse a title-only patch`).toBeTruthy();
    }
  });

  it('accepts one that carries real content', () => {
    expect(emptyShellProblem('competitor', { title: 'Acme', weaknesses: ['No Gulf Coast coverage'] })).toBeNull();
    expect(emptyShellProblem('battlecard', { title: 'vs Acme', wedge: 'No Gulf Coast coverage' })).toBeNull();
  });

  /**
   * Bookkeeping fields are written by the refresh and the evaluator, not authored. A
   * trigger carrying only the state its own evaluation stamped on it is still a shell.
   */
  it('does not count bookkeeping fields as authored work', () => {
    expect(FOUNDER_BOOKKEEPING_FIELDS).toContain('state');
    expect(FOUNDER_BOOKKEEPING_FIELDS).toContain('series');
    expect(emptyShellProblem('trigger', { title: 'Runway alarm', state: 'armed', lastEvaluatedAt: '2026-08-13' })).toBeTruthy();
    expect(emptyShellProblem('liveMetric', { title: 'Runway', series: [{ at: 'x', value: 1 }], fetchedAt: '2026-08-13' })).toBeTruthy();
    // …and the real content still passes.
    expect(emptyShellProblem('liveMetric', { title: 'Runway', binding: 'finance.runway_months' })).toBeNull();
  });

  it('excludes bookkeeping from the content fields', () => {
    expect(creationObjectContentFields('trigger')).not.toContain('state');
    expect(creationObjectContentFields('trigger')).toContain('threshold');
  });
});

describe('model-facing guidance', () => {
  it('documents every field of a kind', () => {
    const guidance = founderFieldGuidance('competitor');
    for (const field of founderObjectSpec('competitor')!.fields) expect(guidance).toContain(field.name);
  });

  it('names the geocoder on the field that needs real coordinates', () => {
    // A guessed lat/lng puts a rival in the ocean and silently poisons every coverage gap.
    expect(founderFieldGuidance('competitor')).toContain('builtin_geo_geocode');
  });

  it('points the live metric at the tool that refreshes it', () => {
    expect(founderFieldGuidance('liveMetric')).toContain('canvas_refresh_live_metric');
  });

  it('covers every kind in the combined guidance', () => {
    const all = allFounderFieldGuidance();
    for (const kind of FOUNDER_OBJECT_KINDS) expect(all).toContain(kind);
  });

  it('exposes each field name exactly once in the deduplicated list', () => {
    expect(new Set(FOUNDER_FIELD_NAMES).size).toBe(FOUNDER_FIELD_NAMES.length);
  });

  it('always includes content as an authorable field', () => {
    for (const kind of FOUNDER_OBJECT_KINDS) expect(founderMutableFields(kind)).toContain('content');
  });
});

describe('render specs', () => {
  it('gives every rows field its columns', () => {
    for (const spec of FOUNDER_OBJECT_SPECS) {
      for (const field of spec.fields) {
        if (field.render === 'rows') {
          expect(field.columns, `${spec.kind}.${field.name} renders a table and needs columns`).toBeTruthy();
          expect(field.columns!.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('gives every field a label key', () => {
    for (const spec of FOUNDER_OBJECT_SPECS) {
      for (const field of spec.fields) expect(field.label).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// FO-A2 — the counterparty resolver `invoice.customer`, `bill.vendor` and
// `contract.counterparty` bind through. `placement.client` reuses the same
// resolver from the hiring vocabulary — see hiringObjects.test.ts.
// ---------------------------------------------------------------------------

describe('the counterparty resolver', () => {
  const ACME = { kind: 'account', title: 'Acme Holdings Ltd', relationship: 'customer', owner: 'Jane Lee', alsoKnownAs: ['Acme', 'Acme Holdings'] };

  it('matches an account by title, case- and space-insensitively', () => {
    const board = makeSpecDeriveBoard([ACME]);
    expect(resolveCounterpartyAccount('  acme holdings ltd  ', board)).toBe(ACME);
  });

  it('falls back to an alias in alsoKnownAs', () => {
    const board = makeSpecDeriveBoard([ACME]);
    expect(resolveCounterpartyAccount('Acme', board)).toBe(ACME);
  });

  it('resolves nothing for an empty label or an unmatched name', () => {
    const board = makeSpecDeriveBoard([ACME]);
    expect(resolveCounterpartyAccount('', board)).toBeNull();
    expect(resolveCounterpartyAccount('Some Other Company', board)).toBeNull();
  });

  it('is never authorable — the resolution is read-only', () => {
    const HOSTS = [
      { sourceField: 'customer', hostKind: 'invoice' },
      { sourceField: 'vendor', hostKind: 'bill' },
      { sourceField: 'counterparty', hostKind: 'contract' },
    ] as const;
    for (const { sourceField, hostKind } of HOSTS) {
      const field = founderObjectSpec(hostKind)!.fields.find((entry) => entry.name === `${sourceField}Account`);
      expect(field?.derived, `${hostKind}.${sourceField}Account must be derived`).toBe(true);
      expect(founderMutableFields(hostKind)).not.toContain(`${sourceField}Account`);
    }
  });

  it('reports what it linked to, and nudges to author the account when nothing matches', () => {
    const invoice = { kind: 'invoice', title: 'INV-1', customer: 'Acme Holdings Ltd' };
    const field = founderObjectSpec('invoice')!.fields.find((entry) => entry.name === 'customerAccount')!;
    expect(String(specFieldValue(field, invoice, makeSpecDeriveBoard([ACME, invoice])))).toContain('Acme Holdings Ltd');
    expect(String(specFieldValue(field, invoice, makeSpecDeriveBoard([ACME, invoice])))).toContain('Jane Lee');
    expect(String(specFieldValue(field, { ...invoice, customer: 'Nobody Ltd' }, makeSpecDeriveBoard([ACME])))).toContain('author one');
    // No counterparty authored yet — no section to draw.
    expect(specFieldValue(field, { kind: 'invoice', title: 'INV-2' }, makeSpecDeriveBoard([ACME]))).toBeUndefined();
  });

  it('survives into the AI context under the same name Brain sees on the card', () => {
    const board = makeSpecDeriveBoard([ACME]);
    const context = creationObjectAiContext({ kind: 'invoice', title: 'INV-1', customer: 'Acme Holdings Ltd' }, board);
    expect(String(context.customerAccount)).toContain('Acme Holdings Ltd');
  });

  it('reads a board saved before this field existed without losing the counterparty', () => {
    // The read-time fallback the roadmap calls for: a plain string with no account on
    // the board yet still renders the honest "not linked" state rather than throwing
    // or silently omitting the section.
    const field = founderObjectSpec('bill')!.fields.find((entry) => entry.name === 'vendorAccount')!;
    const legacyBill = { kind: 'bill', title: 'B-1', vendor: 'Some Supplier Inc' };
    expect(String(specFieldValue(field, legacyBill, makeSpecDeriveBoard([legacyBill])))).toContain('No `account` matches');
  });
});
