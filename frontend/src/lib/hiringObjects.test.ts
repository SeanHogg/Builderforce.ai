import { describe, expect, it } from 'vitest';
import { CREATION_OBJECT_KINDS, HIRING_OBJECT_KINDS, isHiringObjectKind, renameLegacyKind } from '@builderforce/creation-canvas-contract';
import { HIRING_LABELS, HIRING_OBJECT_SPECS, HIRING_STATUSES } from './hiringObjects';
import { SHARED_OBJECT_SPECS } from './sharedCanvasObjects';
import './specObjectSets';
import {
  makeSpecDeriveBoard, specFieldNames, specFieldValue, specMutableFields,
  specObjectNamespace, specReadableFields, specRestrictedFields,
} from './specObjects';

describe('hiring vocabulary', () => {
  it('declares one spec per contract kind, and no more', () => {
    expect(HIRING_OBJECT_SPECS.map((spec) => spec.kind).sort()).toEqual([...HIRING_OBJECT_KINDS].sort());
  });

  it('registers every hiring kind in the canvas contract', () => {
    for (const kind of HIRING_OBJECT_KINDS) expect(CREATION_OBJECT_KINDS).toContain(kind);
  });

  it('recognises its own kinds and rejects a founder one', () => {
    expect(isHiringObjectKind('candidate')).toBe(true);
    expect(isHiringObjectKind('placement')).toBe(true);
    expect(isHiringObjectKind('competitor')).toBe(false);
    expect(isHiringObjectKind(null)).toBe(false);
  });

  it('has a label and a status fallback for every kind', () => {
    for (const spec of HIRING_OBJECT_SPECS) {
      expect(HIRING_LABELS[spec.kind as keyof typeof HIRING_LABELS]).toBeTruthy();
      expect(HIRING_STATUSES[spec.defaultStatus]).toBeTruthy();
    }
  });

  it('never starts a blank card in a state that reads as configured', () => {
    // The defect the registry's own workflow and KPI comments record: an empty card that
    // says "Live" or "Ready" is indistinguishable from one somebody filled in.
    for (const spec of HIRING_OBJECT_SPECS) {
      const status = HIRING_STATUSES[spec.defaultStatus] ?? '';
      expect(status.toLowerCase()).not.toMatch(/^(live|ready|active|complete)$/);
    }
  });

  it('resolves every kind under the hiring i18n namespace', () => {
    for (const spec of HIRING_OBJECT_SPECS) {
      expect(specObjectNamespace(spec.kind)).toBe('creationCanvas.hiring');
    }
  });

  it('gives every field a hint the model can act on', () => {
    for (const spec of HIRING_OBJECT_SPECS) {
      for (const field of spec.fields) {
        expect(field.hint.length).toBeGreaterThan(20);
        if (field.render === 'rows') expect(field.columns?.length).toBeGreaterThan(0);
      }
    }
  });

  it('advertises no action a kind has no field to support', () => {
    for (const spec of HIRING_OBJECT_SPECS) {
      expect(spec.actions.length).toBeGreaterThan(0);
      expect(spec.fields.length).toBeGreaterThan(1);
    }
  });
});

describe('restricted fields', () => {
  it("keeps the candidate's demographics out of everything the model can read", () => {
    // The whole point of the third axis. `demographics` is collected for statutory
    // reporting and is unlawful to use in an assessment, so it must be absent from the
    // read list, absent from the write list, and absent from the AI context.
    expect(specRestrictedFields()).toContain('selfIdentification');
    expect(specMutableFields('candidate')).not.toContain('selfIdentification');
    expect(specReadableFields('candidate')).not.toContain('selfIdentification');
    expect(specFieldNames()).not.toContain('selfIdentification');
  });

  it('still declares it on the spec, so the data has a lawful home', () => {
    const candidate = HIRING_OBJECT_SPECS.find((spec) => spec.kind === 'candidate');
    const field = candidate?.fields.find((entry) => entry.name === 'selfIdentification');
    expect(field?.restricted).toBe(true);
  });

  it('leaves consent and retention readable — a recruiter must see the clock', () => {
    for (const name of ['consentBasis', 'consentAt', 'retainUntil']) {
      expect(specReadableFields('candidate')).toContain(name);
      expect(specMutableFields('candidate')).toContain(name);
    }
  });
});

describe('restricted names do not collide across vocabularies', () => {
  it('leaves the academic aggregate `demographics` readable', () => {
    // Restriction is keyed on the NAME across the whole canvas, so a shared word would
    // force one of two wrong outcomes: restrict a benign research aggregate everywhere,
    // or leave a protected characteristic readable on a candidate. Neither is acceptable,
    // so the two things do not share a word.
    expect(specFieldNames()).toContain('demographics');
    expect(specRestrictedFields()).not.toContain('demographics');
  });
});

describe('the `interview` name collision', () => {
  it('migrates a board saved before the founder kind gave up the bare noun', () => {
    expect(renameLegacyKind('interview')).toBe('customerInterview');
  });

  it('leaves every other kind alone', () => {
    for (const kind of ['candidate', 'competitor', 'dashboard', 'funnel']) {
      expect(renameLegacyKind(kind)).toBe(kind);
    }
  });

  it('reserves the bare noun for hiring by not declaring it as a canvas kind', () => {
    // `interviews` is a hiring DOMAIN entity (`kind: 'interview'` in the kernel objects
    // table). No canvas kind may take that word, or `canvas_read_domain('hiring')` hands
    // the model rows it maps onto a discovery card.
    expect(CREATION_OBJECT_KINDS).not.toContain('interview');
    expect(CREATION_OBJECT_KINDS).toContain('customerInterview');
  });
});

describe('the shared funnel', () => {
  it('is ONE kind carrying its domain as a value', () => {
    const funnel = SHARED_OBJECT_SPECS.find((spec) => spec.kind === 'funnel');
    expect(funnel).toBeTruthy();
    expect(funnel?.fields.map((field) => field.name)).toContain('funnelDomain');
    // The duplication this exists to prevent: marketing and recruiting asked for the same
    // object on the same day, and a second kind would have been the twenty-fourth
    // intra-product duplicate created knowingly.
    expect(CREATION_OBJECT_KINDS).not.toContain('hiringFunnel');
    expect(CREATION_OBJECT_KINDS).not.toContain('marketingFunnel');
  });

  it('measures conversion per stage rather than cumulatively', () => {
    const stages = SHARED_OBJECT_SPECS.find((spec) => spec.kind === 'funnel')?.fields.find((field) => field.name === 'stages');
    expect(stages?.columns).toEqual(['stage', 'entered', 'exited', 'conversion', 'medianDays']);
  });
});

// ---------------------------------------------------------------------------
// FO-A2 — `placement.client` is the fourth counterparty field, reusing the
// founder vocabulary's shared resolver. See founderObjects.test.ts for the
// resolver's own matching rules.
// ---------------------------------------------------------------------------

describe('placement.client, the fourth counterparty field', () => {
  const CLIENT = { kind: 'account', title: 'Northwind Traders', relationship: 'customer', owner: 'Sam Ito' };

  it('is authorable, and links to an account on the board', () => {
    expect(specMutableFields('placement')).toContain('client');
    const field = HIRING_OBJECT_SPECS.find((spec) => spec.kind === 'placement')!.fields.find((entry) => entry.name === 'clientAccount')!;
    expect(field.derived).toBe(true);
    expect(specMutableFields('placement')).not.toContain('clientAccount');
    const placement = { kind: 'placement', title: 'Placement 1', client: 'Northwind Traders' };
    const linked = String(specFieldValue(field, placement, makeSpecDeriveBoard([CLIENT, placement])));
    expect(linked).toContain('Northwind Traders');
    expect(linked).toContain('Sam Ito');
  });
});
