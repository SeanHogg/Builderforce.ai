import { describe, expect, it } from 'vitest';
import { CREATION_OBJECT_KINDS, DEADLINE_FIELD_NAMES, LEGAL_OBJECT_KINDS, isLegalObjectKind } from '@builderforce/creation-canvas-contract';
import {
  LEGAL_LABELS, LEGAL_NAMESPACE, LEGAL_OBJECT_SPECS, LEGAL_STATUSES,
} from './legalObjects';
import {
  isSpecObjectKind, makeSpecDeriveBoard, specDeadlineFields, specFieldValue, specMutableFields,
  specObjectNamespace,
} from './specObjects';
import {
  ipAssetFieldsFrom, legalEntityFieldsFrom, legalMatterFieldsFrom, registrationRowsFor,
} from './canvasLegalRecordTools';
import {
  CREATION_PALETTE_GROUPS, createDefaultCreationData, creationObjectAiContext,
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

const spec = (kind: string) => LEGAL_OBJECT_SPECS.find((candidate) => candidate.kind === kind)!;

describe('the legal vocabulary covers the contract', () => {
  it('specs every declared legal kind, and nothing else', () => {
    expect(LEGAL_OBJECT_SPECS.map((entry) => entry.kind).sort()).toEqual([...LEGAL_OBJECT_KINDS].sort());
  });

  it('declares every legal kind in the canvas object contract', () => {
    for (const kind of LEGAL_OBJECT_KINDS) {
      expect(CREATION_OBJECT_KINDS).toContain(kind);
      expect(isLegalObjectKind(kind)).toBe(true);
      expect(isSpecObjectKind(kind)).toBe(true);
      expect(specObjectNamespace(kind)).toBe(LEGAL_NAMESPACE);
    }
  });

  /**
   * THE COLLISION. `api/src/application/domains/legal/entities.ts` registers
   * `legal_matters` in the kernel `objects` table under `kind: 'matter'`. A canvas kind
   * spelled the same way is the `interview` defect exactly — `canvas_read_domain('legal')`
   * would hand the model domain rows it maps onto a canvas card. The founder set gave up
   * the bare noun for `customerInterview`; this set gives it up for the same reason.
   */
  it('reserves the bare noun `matter` for the legal domain entity', () => {
    expect(CREATION_OBJECT_KINDS).not.toContain('matter');
    expect(CREATION_OBJECT_KINDS).toContain('legalMatter');
    // `legalEntity` and `ipAsset` need no qualifier: their domain kinds are
    // `legal_entity` and `ip_asset`, which no camelCase canvas kind can collide with.
    expect(CREATION_OBJECT_KINDS).toContain('legalEntity');
    expect(CREATION_OBJECT_KINDS).toContain('ipAsset');
  });

  it('registers each kind with an icon, a label and a reachable palette group', () => {
    const placeable = new Set(CREATION_PALETTE_GROUPS.flatMap((group) => group.items.map((item) => item.kind)));
    for (const kind of LEGAL_OBJECT_KINDS) {
      const definition = creationObjectDefinition(kind);
      expect(definition.icon).toBeTruthy();
      expect(definition.label).toBeTruthy();
      expect(LEGAL_LABELS[kind]).toBeTruthy();
      // A kind whose group is not in `CREATION_PALETTE_GROUPS` is registered,
      // authorable by Brain and unreachable by a person — see the palette's own note.
      expect(placeable, `${kind} must be reachable from the palette`).toContain(kind);
    }
  });

  it('never lets a blank record card claim a state it has not read', () => {
    for (const kind of ['legalEntity', 'ipAsset', 'legalMatter'] as const) {
      const blank = createDefaultCreationData(kind);
      expect(blank.status).toBe(LEGAL_STATUSES.unsynced);
      expect(String(blank.status).toLowerCase()).not.toBe('active');
      expect(String(blank.status).toLowerCase()).not.toBe('open');
    }
  });
});

describe('the three record kinds are projections, not prose', () => {
  it('marks every field bookkeeping except the authored summary and the derivations', () => {
    for (const kind of ['legalEntity', 'ipAsset', 'legalMatter'] as const) {
      for (const field of spec(kind).fields) {
        if (field.name === 'summary' || field.derive) continue;
        expect(field.bookkeeping, `${kind}.${field.name} must be a projection`).toBe(true);
      }
    }
  });

  it('lets an empty record card exist, because the sync is what fills it', () => {
    // The alternative — refusing the shell — would push the model into filling the card
    // to satisfy the rule, which is the invented record the whole design refuses.
    for (const kind of ['legalEntity', 'ipAsset', 'legalMatter'] as const) {
      expect(emptyShellProblem(kind, { title: 'Acme Inc' })).toBeNull();
    }
  });

  it('keeps every projected field writable by the sync and readable by Brain', () => {
    for (const kind of ['legalEntity', 'ipAsset', 'legalMatter'] as const) {
      const mutable = creationObjectMutableFields(kind);
      for (const field of spec(kind).fields) {
        if (!field.derived && !field.derive) {
          // `canvas_sync_legal` writes through `sanitizeCreationObjectPatch`, which
          // filters to the mutable list — a field missing from it is one the sync
          // silently drops.
          expect(mutable, `${kind}.${field.name} must survive the patch sanitizer`).toContain(field.name);
        }
        const context = creationObjectAiContext({ kind, title: 'x', [field.name]: 'probe' });
        expect(context, `${kind}.${field.name} must survive into the AI context`).toHaveProperty(field.name);
      }
    }
  });

  it('never names a spec field `status`', () => {
    // `status` is the COMMON card-subtitle field every kind already owns. A spec field
    // of the same name would draw the same information twice — `contract` resolved this
    // fork as `signatureState`, `legalDocument` as `documentStatus`.
    for (const entry of LEGAL_OBJECT_SPECS) {
      expect(entry.fields.map((field) => field.name)).not.toContain('status');
    }
  });

  it('never puts a tax id on a card that gets shared and exported', () => {
    expect(spec('legalEntity').fields.map((field) => field.name)).not.toContain('taxId');
  });
});

describe('exactly one deadline per record kind, and the server can resolve it', () => {
  it('marks the date each record is judged against', () => {
    expect(specDeadlineFields('legalEntity')).toEqual(['renewsAt']);
    expect(specDeadlineFields('ipAsset')).toEqual(['renewsAt']);
    expect(specDeadlineFields('legalMatter')).toEqual(['nextActionAt']);
    expect(specDeadlineFields('legalDocument')).toEqual([]);
  });

  it('names every one of them where the nightly sweep can find it', () => {
    // A flag the sweep cannot resolve is a trigger that reports armed on screen and
    // never fires — the `payRun.paidAt` failure, which is why this is asserted here too.
    for (const name of ['renewsAt', 'nextActionAt']) expect(DEADLINE_FIELD_NAMES).toContain(name);
  });
});

describe('the derivations', () => {
  it('reports unassigned IP as the finding it is', () => {
    const field = spec('ipAsset').fields.find((entry) => entry.name === 'assignment')!;
    const unassigned = { kind: 'ipAsset', title: 'BUILDERFORCE word mark' };
    expect(String(specFieldValue(field, unassigned))).toContain('NOT ASSIGNED');
    expect(String(specFieldValue(field, { ...unassigned, assignedFrom: 'Sean Hogg', assignedAt: '2026-02-01' })))
      .toBe('Assigned from Sean Hogg on 2026-02-01.');
    expect(String(specFieldValue(field, { ...unassigned, assignedFrom: 'Sean Hogg' })))
      .toContain('NO execution date recorded');
  });

  it('sets a matter\'s spend against what it could cost', () => {
    const field = spec('legalMatter').fields.find((entry) => entry.name === 'spendAgainstExposure')!;
    expect(String(specFieldValue(field, { spendToDate: '15000', exposureAmount: '60000' }))).toBe('Spend to date is 25% of the estimated exposure.');
    expect(String(specFieldValue(field, { spendToDate: '70000', exposureAmount: '60000' }))).toContain('settlement conversation');
    // No denominator is not a rate. Nothing is drawn rather than a fabricated 0%.
    expect(specFieldValue(field, { spendToDate: '15000' })).toBeUndefined();
  });

  it('joins a matter\'s counterparty to the account the rest of the board joins to', () => {
    const field = spec('legalMatter').fields.find((entry) => entry.name === 'counterpartyAccount')!;
    const acme = { kind: 'account', title: 'Acme Holdings Ltd', relationship: 'customer', owner: 'Jane Lee' };
    const matter = { kind: 'legalMatter', title: 'Acme MSA dispute', counterparty: 'Acme Holdings Ltd' };
    expect(String(specFieldValue(field, matter, makeSpecDeriveBoard([acme, matter])))).toContain('Acme Holdings Ltd');
    expect(String(specFieldValue(field, matter, makeSpecDeriveBoard([matter])))).toContain('No `account` matches');
    expect(specMutableFields('legalMatter')).not.toContain('counterpartyAccount');
  });
});

describe('canvas_sync_legal projects the real rows', () => {
  const ENTITY_ROW = {
    id: 7, legalName: 'Builderforce Inc', entityType: 'c-corp', jurisdiction: 'Delaware',
    registrationNumber: 'DE-8812', taxId: '88-1234567', formedAt: '2024-03-11',
    registeredAgent: 'CSC', registeredAddress: '251 Little Falls Drive', renewsAt: '2027-03-01',
    status: 'good-standing', isParent: true, parentId: null, notes: 'Franchise tax due annually.',
  };
  const REGISTRATIONS = [
    { id: 1, entityId: 7, jurisdiction: 'California', kind: 'foreign-qualification', reference: 'CA-9', renewsAt: '2027-01-15', status: 'active' },
    { id: 2, entityId: 7, jurisdiction: 'Florida', kind: 'sales-tax', reference: 'FL-4', renewsAt: '2026-11-01', status: 'active' },
    { id: 3, entityId: 9, jurisdiction: 'Texas', kind: 'licence', reference: 'TX-1', renewsAt: '2026-10-01', status: 'lapsed' },
  ];
  const names = new Map([['7', 'Builderforce Inc']]);

  it('projects an entity onto the card and leaves the tax id in the row', () => {
    const fields = legalEntityFieldsFrom(ENTITY_ROW, REGISTRATIONS, names);
    expect(fields.recordId).toBe('7');
    expect(fields.title).toBe('Builderforce Inc');
    expect(fields.entityStatus).toBe('good-standing');
    expect(fields.renewsAt).toBe('2027-03-01');
    expect(fields).not.toHaveProperty('taxId');
    // An empty projected value is omitted rather than written as '', so a partial row
    // never looks like a correction to what the card already holds.
    expect(fields).not.toHaveProperty('parentEntity');
  });

  it('gives an entity only its own registrations, soonest renewal first', () => {
    expect(registrationRowsFor('7', REGISTRATIONS).map((row) => row.reference)).toEqual(['FL-4', 'CA-9']);
    expect(registrationRowsFor('9', REGISTRATIONS).map((row) => row.reference)).toEqual(['TX-1']);
  });

  it('projects an IP asset with the entity that holds it named, not numbered', () => {
    const fields = ipAssetFieldsFrom({
      id: 21, kind: 'trademark', title: 'BUILDERFORCE', jurisdiction: 'US', classification: '42',
      registrationNumber: '7712345', filedAt: '2025-06-02', grantedAt: '2026-04-18', renewsAt: '2036-04-18',
      status: 'registered', assignedFrom: 'Sean Hogg', assignedAt: '2025-06-01', ownerRef: 'sean', entityId: 7,
    }, names);
    expect(fields.recordId).toBe('21');
    expect(fields.ipKind).toBe('trademark');
    expect(fields.entityName).toBe('Builderforce Inc');
    expect(fields.ipStatus).toBe('registered');
  });

  it('projects a matter with the counterparty NAME the account resolver can match', () => {
    const fields = legalMatterFieldsFrom({
      id: 33, kind: 'dispute', title: 'Acme MSA dispute', counterpartyRef: 'acme-holdings-ltd',
      counterpartyName: 'Acme Holdings Ltd', counsel: 'Fenwick', ownerRef: 'jane', status: 'open',
      exposure: 'high', exposureAmount: '60000.00', spendToDate: '15000.00', currency: 'USD',
      openedAt: '2026-05-04', nextActionAt: '2026-09-12', closedAt: null,
      timeline: [{ at: '2026-05-04', event: 'Letter received', note: 'Alleged breach of SLA' }, 'not an entry'],
    }, names);
    // The slug would resolve to nothing while looking like a value; the display name is
    // what `counterpartyAccountField` matches an `account` title on.
    expect(fields.counterparty).toBe('Acme Holdings Ltd');
    expect(fields.nextActionAt).toBe('2026-09-12');
    expect(fields.timeline).toEqual([{ at: '2026-05-04', event: 'Letter received', note: 'Alleged breach of SLA' }]);
    expect(fields).not.toHaveProperty('closedAt');
  });
});

describe('legal localisation', () => {
  const namespacePath = LEGAL_NAMESPACE.split('.');

  it('has a real translation for every legal label in all five catalogs', () => {
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      for (const kind of LEGAL_OBJECT_KINDS) {
        expect(at(catalog, [...namespacePath, 'label', kind]), `${locale}.label.${kind}`).toBeTruthy();
        expect(at(catalog, ['creationCanvas', 'object', kind]), `${locale}.object.${kind}`).toBeTruthy();
      }
    }
  });

  it('has a label for every field and every column the specs declare', () => {
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      for (const entry of LEGAL_OBJECT_SPECS) {
        for (const field of entry.fields) {
          expect(at(catalog, [...namespacePath, 'field', field.label]), `${locale}.field.${field.label}`).toBeTruthy();
          for (const column of field.columns ?? []) {
            expect(at(catalog, [...namespacePath, 'column', column]), `${locale}.column.${column}`).toBeTruthy();
          }
        }
      }
    }
  });

  it('has the scalars the shared body renders', () => {
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      for (const key of ['empty', 'emptyHint', 'meterLabel', 'freshJustNow', 'freshMinutes', 'freshHours', 'freshDays']) {
        expect(at(catalog, [...namespacePath, key]), `${locale}.${key}`).toBeTruthy();
      }
    }
  });

  it('is genuinely translated rather than English copied into four files', () => {
    const english = String(at(en, [...namespacePath, 'label', 'legalMatter']));
    for (const locale of ['zh', 'es', 'fr', 'de'] as const) {
      expect(String(at(CATALOGS[locale], [...namespacePath, 'label', 'legalMatter'])), locale).not.toBe(english);
    }
  });
});
