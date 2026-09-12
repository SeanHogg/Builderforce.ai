import { describe, expect, it } from 'vitest';
import { FOUNDER_OBJECT_KINDS, isFounderObjectKind, CREATION_OBJECT_KINDS } from '@builderforce/creation-canvas-contract';
import {
  FOUNDER_BOOKKEEPING_FIELDS, FOUNDER_FIELD_NAMES, FOUNDER_NAMESPACE, FOUNDER_OBJECT_SPECS,
  capTablePercentBalance, counterpartyAccountField, founderMutableFields,
} from './founderObjects';
import {
  makeSpecDeriveBoard, specFieldGuidance, specFieldValue, specObjectSpec, specSetGuidance, specValueInEnglish,
} from './specObjects';
import {
  createDefaultCreationData, creationObjectAiContext, creationObjectContentFields,
  creationObjectDefinition, creationObjectMutableFields, emptyShellProblem,
} from '@/components/creation-canvas/creationObjectRegistry';
import en from '@/i18n/messages/en.json';
import zh from '@/i18n/messages/zh.json';
import es from '@/i18n/messages/es.json';
import fr from '@/i18n/messages/fr.json';
import de from '@/i18n/messages/de.json';

const CATALOGS = { en, zh, es, fr, de } as const;
const at = (catalog: unknown, path: readonly string[]): unknown =>
  path.reduce<unknown>((node, key) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined), catalog);

/** A resolved field value as the MODEL reads it. A worded derivation returns a verdict
 *  descriptor so the card can translate it; the prompt gets it formatted in English,
 *  through the same formatter — which is what these assertions read. */
const english = (value: unknown): string => String(specValueInEnglish(value, FOUNDER_NAMESPACE));

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
        // A `derive`d field is skipped for the SAME reason one line up, arrived at
        // from the other direction: it is computed from the fields beside it, so an
        // authored value would be a total that disagrees with its own rows —
        // `capTable.ownershipCheck` over the folded holdings, `equityGrant.unvested`
        // over its own vested figure. `specMutableFields` already excludes both
        // flags; this assertion simply had not caught up when the second one landed.
        if (!field.derived && !field.derive) {
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

describe('the cap table percent column', () => {
  const fieldOn = (kind: string, name: string) => specObjectSpec(kind)!.fields.find((entry) => entry.name === name)!;
  const table = (holders: Array<Record<string, unknown>>, poolUnallocated: number) => ({
    kind: 'capTable', title: 'Cap table', fullyDiluted: 1_000, poolUnallocated, holders,
  });

  it('balances only when holders plus the unallocated pool reach ~100', () => {
    const holders = [{ shares: 600, percent: 60 }, { shares: 300, percent: 30 }];
    expect(capTablePercentBalance(holders, 100, 1_000)).toMatchObject({ balanced: true, total: 100 });
    // The same rows with the pool misreported: the shares still add up, the percentages do not.
    expect(capTablePercentBalance(holders, 0, 1_000)).toMatchObject({ balanced: false, total: 90 });
    // A board saved before the column existed is not judged.
    expect(capTablePercentBalance([{ shares: 600 }], 100, 1_000)).toBeNull();
  });

  it('says on the card when the percentages do not balance, rather than adjusting one', () => {
    const check = fieldOn('capTable', 'ownershipCheck');
    const balanced = english(specFieldValue(check, table([{ shares: 600, percent: 60 }, { shares: 300, percent: 30 }], 100)));
    expect(balanced).not.toContain('do not balance');
    const skewed = english(specFieldValue(check, table([{ shares: 600, percent: 55 }, { shares: 300, percent: 30 }], 100)));
    expect(skewed).toContain('percent column totals 95%');
    expect(skewed).toContain('do not balance');
  });
});

describe('model-facing guidance', () => {
  /** A spec kind sent as a shell is answered with its own field contract — the moment
   *  it was authored wrong is the moment the model needs exactly this kind's shape. */
  it('teaches a spec kind its shape when it arrives as an empty shell', () => {
    const problem = emptyShellProblem('competitor', { title: 'Rival' });
    expect(problem).toContain('empty shell');
    expect(problem).toContain(specFieldGuidance('competitor'));
    // A hand-declared kind gets the shell verdict alone: it has no registry contract to teach.
    expect(emptyShellProblem('note', { title: 'Untitled' })).not.toContain('•');
  });

  /** The snapshot for a spec kind carries only ITS readable fields: another
   *  vocabulary's slot never appears on it, even when the data carries the name. */
  it('narrows a spec object\'s AI context to the fields its own kind declares', () => {
    const invoice = creationObjectAiContext({ kind: 'invoice', title: 'INV-1', customer: 'Acme', marks: [{ learner: 'x' }] } as never);
    expect(invoice).toHaveProperty('customer');
    expect(invoice).not.toHaveProperty('marks');
    // A hand-declared name is never narrowed away — it means one thing everywhere.
    expect(creationObjectAiContext({ kind: 'invoice', title: 'INV-1', status: 'sent' } as never)).toHaveProperty('status');
  });

  it('documents every field of a kind', () => {
    const guidance = specFieldGuidance('competitor');
    for (const field of specObjectSpec('competitor')!.fields) expect(guidance).toContain(field.name);
  });

  it('names the geocoder on the field that needs real coordinates', () => {
    // A guessed lat/lng puts a rival in the ocean and silently poisons every coverage gap.
    expect(specFieldGuidance('competitor')).toContain('builtin_geo_geocode');
  });

  it('points the live metric at the tool that refreshes it', () => {
    expect(specFieldGuidance('liveMetric')).toContain('canvas_refresh_live_metric');
  });

  it('covers every kind in the combined guidance', () => {
    const all = specSetGuidance('founder');
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
  // The resolver is reached the way the board reaches it: through the derived field
  // `counterpartyAccountField` declares, evaluated against a real board.
  const resolveVia = (customer: string) => specFieldValue(counterpartyAccountField('customer'), { kind: 'invoice', title: 'INV-1', customer }, makeSpecDeriveBoard([ACME]));

  it('matches an account by title, case- and space-insensitively', () => {
    expect(english(resolveVia('  acme holdings ltd  '))).toContain('Linked to `account` "Acme Holdings Ltd"');
  });

  it('falls back to an alias in alsoKnownAs', () => {
    expect(english(resolveVia('Acme'))).toContain('Linked to `account` "Acme Holdings Ltd"');
  });

  it('resolves nothing for an empty label or an unmatched name', () => {
    expect(resolveVia('')).toBeUndefined();
    expect(english(resolveVia('Some Other Company'))).toContain('No `account` matches');
  });

  it('is never authorable — the resolution is read-only', () => {
    const HOSTS = [
      { sourceField: 'customer', hostKind: 'invoice' },
      { sourceField: 'vendor', hostKind: 'bill' },
      { sourceField: 'counterparty', hostKind: 'contract' },
    ] as const;
    for (const { sourceField, hostKind } of HOSTS) {
      const field = specObjectSpec(hostKind)!.fields.find((entry) => entry.name === `${sourceField}Account`);
      expect(field?.derived, `${hostKind}.${sourceField}Account must be derived`).toBe(true);
      expect(founderMutableFields(hostKind)).not.toContain(`${sourceField}Account`);
    }
  });

  it('reports what it linked to, and nudges to author the account when nothing matches', () => {
    const invoice = { kind: 'invoice', title: 'INV-1', customer: 'Acme Holdings Ltd' };
    const field = specObjectSpec('invoice')!.fields.find((entry) => entry.name === 'customerAccount')!;
    expect(english(specFieldValue(field, invoice, makeSpecDeriveBoard([ACME, invoice])))).toContain('Acme Holdings Ltd');
    expect(english(specFieldValue(field, invoice, makeSpecDeriveBoard([ACME, invoice])))).toContain('Jane Lee');
    expect(english(specFieldValue(field, { ...invoice, customer: 'Nobody Ltd' }, makeSpecDeriveBoard([ACME])))).toContain('author one');
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
    const field = specObjectSpec('bill')!.fields.find((entry) => entry.name === 'vendorAccount')!;
    const legacyBill = { kind: 'bill', title: 'B-1', vendor: 'Some Supplier Inc' };
    expect(english(specFieldValue(field, legacyBill, makeSpecDeriveBoard([legacyBill])))).toContain('No `account` matches');
  });
});

// ---------------------------------------------------------------------------
// FO-G2 — a contract's obligations, and the invoices and bills raised against
// them. The half that turns `obligations` from prose in a table into something
// the board can actually check.
// ---------------------------------------------------------------------------

describe('contract obligations', () => {
  const MSA = {
    kind: 'contract',
    title: 'Acme MSA',
    reference: 'MSA-ACME-2026',
    counterparty: 'Acme Holdings Ltd',
    currency: 'USD',
    obligations: [
      { reference: 'SUPPORT-Q', obligation: 'Quarterly support fee', kind: 'receivable', owner: 'Jane Lee', due: '2026-09-30', cadence: 'quarterly', amount: 12000, status: 'pending' },
      { reference: 'HOSTING-M', obligation: 'Monthly hosting pass-through', kind: 'payable', owner: 'Sam Ortiz', due: '2026-09-15', cadence: 'monthly', amount: 800, status: 'pending' },
      // A REPORT moves no money. It must never be counted as un-invoiced revenue,
      // which is the whole reason `kind` is a column rather than an inference.
      { reference: 'SLA-REPORT', obligation: 'Monthly SLA report', kind: 'report', owner: 'Sam Ortiz', due: '2026-09-05', cadence: 'monthly', status: 'pending' },
    ],
  };
  const SUPPORT_INVOICE = {
    kind: 'invoice', title: 'INV-101', invoiceNumber: 'INV-101', currency: 'USD',
    contractRef: 'MSA-ACME-2026', obligationRef: 'SUPPORT-Q', amount: 12000, dueAt: '2026-09-30',
  };
  const HOSTING_BILL = {
    kind: 'bill', title: 'Acme hosting', reference: 'ACME-77', currency: 'USD',
    contractRef: 'MSA-ACME-2026', obligationRef: 'HOSTING-M', amount: 800, dueAt: '2026-09-15', recurring: 'monthly',
  };
  const STRAY_BILL = {
    kind: 'bill', title: 'Acme onboarding', reference: 'ACME-78', currency: 'USD',
    contractRef: 'MSA-ACME-2026', obligationRef: 'ONBOARDING', amount: 5000, dueAt: '2026-09-20', recurring: 'none',
  };

  const fieldOn = (kind: string, name: string) => specObjectSpec(kind)!.fields.find((entry) => entry.name === name)!;
  const coverage = (objects: readonly Record<string, unknown>[]) =>
    english(specFieldValue(fieldOn('contract', 'obligationCoverage'), MSA, makeSpecDeriveBoard([...objects])) ?? '');

  it('models an obligation as a row with an identity, a direction and a cadence', () => {
    const obligations = fieldOn('contract', 'obligations');
    expect(obligations.render).toBe('rows');
    expect(obligations.columns).toEqual(['reference', 'obligation', 'kind', 'owner', 'due', 'cadence', 'amount', 'status']);
  });

  it('resolves an obligation that has an invoice against it', () => {
    const verdict = coverage([MSA, SUPPORT_INVOICE, HOSTING_BILL]);
    expect(verdict).toContain('2 of 2 billable obligations');
    expect(verdict).not.toContain('Nothing raised yet');
  });

  it('says plainly which obligations have nothing raised against them', () => {
    const verdict = coverage([MSA]);
    expect(verdict).toContain('0 of 2 billable obligations');
    expect(verdict).toContain('Nothing raised yet for: Quarterly support fee, Monthly hosting pass-through');
  });

  it('never counts a non-monetary obligation as un-invoiced', () => {
    // Three obligation rows, two of them billable. A report showing up as un-invoiced
    // revenue would be a receivable the company does not have.
    expect(coverage([MSA])).toContain('of 2 billable');
    expect(coverage([MSA])).not.toContain('Monthly SLA report');
  });

  it('names a document that points here and matches no obligation', () => {
    const verdict = coverage([MSA, SUPPORT_INVOICE, HOSTING_BILL, STRAY_BILL]);
    // One stray document, so the sentence is singular — an ICU plural now, which is also
    // what fixed "1 document names this contract and match…".
    expect(verdict).toContain('matches no obligation on it');
    expect(verdict).toContain('ACME-78');
  });

  /**
   * The binding is EXPLICIT. Two agreements with one company is the normal case, so a
   * document that names the counterparty and not the contract must resolve to nothing —
   * inferring the join from the counterparty is the string match FO-A1/FO-A2 removed.
   */
  it('ignores a document that names the counterparty but not the contract', () => {
    const byNameOnly = { kind: 'invoice', title: 'INV-102', invoiceNumber: 'INV-102', customer: 'Acme Holdings Ltd', amount: 12000 };
    expect(coverage([MSA, byNameOnly])).toContain('0 of 2 billable obligations');
  });

  it('flags a bill whose obligation does not exist on the contract it names', () => {
    const verdict = english(specFieldValue(fieldOn('bill', 'contractObligation'), STRAY_BILL, makeSpecDeriveBoard([MSA, STRAY_BILL])));
    expect(verdict).toContain('charge with no matching obligation');
    expect(verdict).toContain('Acme MSA');
  });

  it('confirms a bill that matches on amount, date and cadence', () => {
    const verdict = english(specFieldValue(fieldOn('bill', 'contractObligation'), HOSTING_BILL, makeSpecDeriveBoard([MSA, HOSTING_BILL])));
    expect(verdict).toContain('Discharges obligation "Monthly hosting pass-through"');
    expect(verdict).toContain('cadence');
  });

  it('names every axis a bill disagrees with the obligation on', () => {
    const wrong = { ...HOSTING_BILL, amount: 900, dueAt: '2026-09-22', recurring: 'annual' };
    const verdict = english(specFieldValue(fieldOn('bill', 'contractObligation'), wrong, makeSpecDeriveBoard([MSA, wrong])));
    expect(verdict).toContain('the amount is 900 where the obligation says 800');
    expect(verdict).toContain('7 days after');
    expect(verdict).toContain('recurs annual where the obligation says monthly');
  });

  it('tells an invoice which obligation it discharges', () => {
    const verdict = english(specFieldValue(fieldOn('invoice', 'contractObligation'), SUPPORT_INVOICE, makeSpecDeriveBoard([MSA, SUPPORT_INVOICE])));
    expect(verdict).toContain('Discharges obligation "Quarterly support fee"');
    // An invoice declares no recurrence, so the confirming sentence must not claim a
    // cadence agreed that nothing on the card states.
    expect(verdict).not.toContain('cadence');
  });

  it('asks for an obligationRef when a document names only the contract', () => {
    const vague = { ...SUPPORT_INVOICE, obligationRef: '' };
    const verdict = english(specFieldValue(fieldOn('invoice', 'contractObligation'), vague, makeSpecDeriveBoard([MSA, vague])));
    expect(verdict).toContain('SUPPORT-Q');
    expect(verdict).toContain('HOSTING-M');
  });

  it('gives the same honest not-found sentence the counterparty resolver gives', () => {
    // The half `boardRefField` exists to keep identical: a reference that resolves to
    // nothing must SAY so on every kind, never draw an empty section.
    const orphan = { ...SUPPORT_INVOICE, contractRef: 'MSA-NOBODY' };
    const verdict = english(specFieldValue(fieldOn('invoice', 'contractObligation'), orphan, makeSpecDeriveBoard([orphan])));
    expect(verdict).toBe('No `contract` matches "MSA-NOBODY" yet — author one to link this.');
  });

  it('draws nothing at all on a document with no contract behind it', () => {
    const standalone = { kind: 'invoice', title: 'INV-103', invoiceNumber: 'INV-103', amount: 50 };
    expect(specFieldValue(fieldOn('invoice', 'contractObligation'), standalone, makeSpecDeriveBoard([standalone]))).toBeUndefined();
  });

  /**
   * The half that makes the repository LIVE rather than inspectable. `obligationCoverage`
   * answers "has anything been raised against this" when somebody opens the card;
   * `nextObligationAt` is the date a `trigger` binds to, so the board says the support fee
   * is due before it is missed rather than after. It reads through the trigger engine's
   * own `nextOpenObligation`, which is what lets the nightly sweep see the same date.
   */
  it('counts down to the earliest obligation still owed', () => {
    const field = fieldOn('contract', 'nextObligationAt');
    expect(field.deadline).toBe(true);
    // 2026-09-05 (the SLA report) is earlier than either billable row. A commitment is a
    // commitment whether or not money moves — `kind` decides what may be INVOICED, not
    // what is owed.
    expect(specFieldValue(field, MSA, makeSpecDeriveBoard([MSA]))).toBe('2026-09-05');
    expect(founderMutableFields('contract')).not.toContain('nextObligationAt');
  });

  it('has no obligation clock once every row is met or waived', () => {
    const settled = { ...MSA, obligations: MSA.obligations.map((row) => ({ ...row, status: 'met' })) };
    expect(specFieldValue(fieldOn('contract', 'nextObligationAt'), settled, makeSpecDeriveBoard([settled]))).toBeUndefined();
  });

  it('keeps every resolver read-only and every reference authorable', () => {
    for (const kind of ['invoice', 'bill'] as const) {
      expect(founderMutableFields(kind)).toContain('contractRef');
      expect(founderMutableFields(kind)).toContain('obligationRef');
      expect(founderMutableFields(kind)).not.toContain('contractObligation');
      expect(fieldOn(kind, 'contractObligation').derived).toBe(true);
    }
    expect(founderMutableFields('contract')).not.toContain('obligationCoverage');
    expect(founderMutableFields('contract')).toContain('obligations');
  });

  it('stops telling a bill to write "no matching contract" into risks by hand', () => {
    // Log-then-fix: the hint named the case and nothing computed it. Now that
    // `contractObligation` does, an authored chip beside it is a staler second answer.
    expect(fieldOn('bill', 'risks').hint).toContain('contractObligation');
    expect(fieldOn('bill', 'risks').hint).not.toContain('a charge with no matching contract,');
  });
});

describe('founder localisation', () => {
  it('has a real translation for every founder field and column in all five catalogs', () => {
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      for (const spec of FOUNDER_OBJECT_SPECS) {
        expect(at(catalog, ['creationCanvas', 'object', spec.kind]), `${locale}.object.${spec.kind}`).toBeTruthy();
        for (const field of spec.fields) {
          expect(at(catalog, ['creationCanvas', 'founder', 'field', field.label]), `${locale}.field.${field.label}`).toBeTruthy();
          for (const column of field.columns ?? []) {
            expect(at(catalog, ['creationCanvas', 'founder', 'column', column]), `${locale}.column.${column}`).toBeTruthy();
          }
        }
      }
    }
  });
});
