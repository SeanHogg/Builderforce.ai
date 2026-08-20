import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_TEMPLATES,
  TemplateError,
  documentTemplateCatalog,
  renderDocumentTemplate,
  templateParties,
} from './documentTemplates';

const FOUNDERS = [
  { name: 'Ada Okafor', email: 'ada@example.com', role: 'CTO', share: 55, contribution: 'The engine and the model work' },
  { name: 'Bo Lindqvist', email: 'bo@example.com', role: 'CEO', share: 45, contribution: 'Fundraising and the first ten customers' },
];

/** ONE value set that satisfies EVERY template's required variables.
 *
 *  Deliberately one and not seven: the "renders every declared template" case below
 *  is what catches a template added with a required variable nobody can supply, and
 *  it can only catch that if adding a template means adding to this object. */
const FULL = {
  companyName: 'Northwind Labs, Inc.',
  jurisdiction: 'Delaware',
  effectiveDate: '2026-08-19',
  vestingYears: 4,
  cliffMonths: 12,
  counterparty: 'Meridian Ventures',
  // The commercial half's own required fields.
  scope: 'Design and build the ingest pipeline described in the attached brief.',
  title: 'Staff Engineer',
  startDate: '2026-09-14',
  salary: '$185,000 per year',
  parties: FOUNDERS,
};

describe('the document templates', () => {
  it('renders every declared template from one complete value set', () => {
    for (const template of DOCUMENT_TEMPLATES) {
      const document = renderDocumentTemplate(template.key, FULL);
      expect(document.title, template.key).toBe(template.title);
      expect(document.body.length, template.key).toBeGreaterThan(400);
      // The disclaimer belongs in the DOCUMENT, not only in the module comment: the
      // person who needs to read it is the founder signing it.
      expect(document.body, template.key).toContain('not legal advice');
    }
  });

  it('refuses a missing required variable BY NAME rather than rendering a placeholder', () => {
    // Rendering "—" into a founders' agreement and letting somebody sign it is worse
    // than an error, because it produces a document that looks finished.
    expect(() => renderDocumentTemplate('founders-agreement', { companyName: 'Northwind Labs, Inc.' }))
      .toThrowError(/parties/);
    try {
      renderDocumentTemplate('founders-agreement', { companyName: 'Northwind Labs, Inc.' });
    } catch (error) {
      expect((error as TemplateError).status).toBe(400);
      expect((error as TemplateError).message).toContain('effectiveDate');
    }
  });

  it('refuses an unknown template and says what exists', () => {
    try {
      renderDocumentTemplate('non-compete', FULL);
      throw new Error('should have refused');
    } catch (error) {
      expect((error as TemplateError).status).toBe(404);
      expect((error as TemplateError).message).toContain('founders-agreement');
    }
  });

  it('says so out loud when the declared holdings do not total 100', () => {
    const document = renderDocumentTemplate('founders-agreement', {
      ...FULL,
      parties: [{ ...FOUNDERS[0]!, share: 40 }, { ...FOUNDERS[1]!, share: 40 }],
    });
    expect(document.body).toContain('total 80%, not 100%');
  });

  it('does not complain when they do', () => {
    expect(renderDocumentTemplate('founders-agreement', FULL).body).not.toContain('not 100%');
  });

  it('carries the vesting terms into the schedule rather than assuming them', () => {
    const document = renderDocumentTemplate('founder-vesting', { ...FULL, vestingYears: 3, cliffMonths: 6 });
    expect(document.body).toContain('3 years (36 months)');
    expect(document.body).toContain('Cliff:** 6 months');
    // 6/36 of the holding vests on the cliff.
    expect(document.body).toContain('16.67%');
  });

  it('assigns everything not carved out, and says that in the document', () => {
    const document = renderDocumentTemplate('ip-assignment', FULL);
    expect(document.body).toContain('Anything not listed here is assigned');
  });

  it('takes the signers from the document itself', () => {
    const document = renderDocumentTemplate('founders-agreement', FULL);
    expect(document.parties.map((party) => party.email)).toEqual(['ada@example.com', 'bo@example.com']);
  });

  it('drops a party row with no name rather than signing an empty seat', () => {
    expect(templateParties({ parties: [...FOUNDERS, { name: '  ', email: 'ghost@example.com' }] as never })).toHaveLength(2);
  });

  it('survives a caller that sends something other than party rows', () => {
    expect(templateParties({ parties: 'Ada and Bo' })).toEqual([]);
    expect(templateParties({ parties: [1, null, 'x'] as never })).toEqual([]);
  });

  it('states the data room’s own controls inside the NDA it gates', () => {
    // FO-E2: the recipient is told access is logged and may be watermarked BEFORE
    // they agree, which is the only moment saying so is worth anything.
    const document = renderDocumentTemplate('mutual-nda', FULL);
    expect(document.body).toContain('Access is logged');
    expect(document.body).toContain('watermark');
    expect(document.intent).toBe('sign');
    expect(document.category).toBe('nda');
  });

  it('publishes a catalogue with no renderers in it', () => {
    const catalogue = documentTemplateCatalog();
    expect(catalogue).toHaveLength(DOCUMENT_TEMPLATES.length);
    for (const entry of catalogue) {
      expect(entry).not.toHaveProperty('render');
      expect(entry.variables.length).toBeGreaterThan(0);
      // Every variable documents itself, because the hint is what a form label and a
      // model prompt BOTH read — one description, never two.
      for (const variable of entry.variables) expect(variable.hint.length, `${entry.key}.${variable.name}`).toBeGreaterThan(10);
    }
  });

  it('gives the founders’ agreement first place, because it comes before everything else', () => {
    expect(DOCUMENT_TEMPLATES[0]?.key).toBe('founders-agreement');
  });
});

describe('the commercial half (FO-G3)', () => {
  it('binds a statement of work to the MSA rather than restating its terms', () => {
    const document = renderDocumentTemplate('sow', FULL);
    expect(document.body).toContain('Master Services Agreement');
    expect(document.body).toContain('Design and build the ingest pipeline');
    expect(document.contractType).toBe('sow');
  });

  it('refuses a statement of work with no scope, by name', () => {
    // The clause a dispute turns on. A SOW rendered with an empty scope is the one
    // document in this registry that would look most finished and mean least.
    expect(() => renderDocumentTemplate('sow', { ...FULL, scope: '' })).toThrowError(/scope/);
  });

  it('states the MSA payment terms rather than leaving them to convention', () => {
    expect(renderDocumentTemplate('msa', { ...FULL, paymentTermsDays: 45 }).body).toContain('45 days');
    // And still says a number when nobody supplied one, because "as agreed" in a
    // signed MSA is a future argument.
    expect(renderDocumentTemplate('msa', FULL).body).toContain('30 days');
  });

  it('omits the equity section from an offer with no grant, and renumbers around it', () => {
    // An offer letter that carries an empty "Equity" heading implies a grant that
    // was never agreed — the one thing a candidate reads hardest.
    const without = renderDocumentTemplate('offer-letter', FULL);
    expect(without.body).not.toContain('## 3. Equity');
    expect(without.body).toContain('## 3. Probation and notice');

    const with_ = renderDocumentTemplate('offer-letter', { ...FULL, equity: '20,000 options vesting over four years' });
    expect(with_.body).toContain('## 3. Equity');
    expect(with_.body).toContain('## 4. Probation and notice');
  });

  it('writes a zero probation as a real answer rather than a default', () => {
    const document = renderDocumentTemplate('offer-letter', { ...FULL, probationMonths: 0 });
    expect(document.body).toContain('There is no probationary period');
  });

  it('sends the offer to the candidate the document names', () => {
    const document = renderDocumentTemplate('offer-letter', {
      ...FULL,
      parties: [{ name: 'Rae Nakamura', email: 'rae@example.com', role: 'Staff Engineer', share: null, contribution: '' }],
    });
    expect(document.parties).toHaveLength(1);
    expect(document.parties[0]?.email).toBe('rae@example.com');
    expect(document.body).toContain('rae@example.com');
    expect(document.category).toBe('employment');
  });
});
