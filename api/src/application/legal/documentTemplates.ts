/**
 * THE document templates — the text a company signs before it has counsel.
 *
 * ── WHAT THIS CLOSES ─────────────────────────────────────────────────────────
 * FO-D5's paperwork half: two founders could find each other (`cofounder_profiles`,
 * the scorer, `/cofounder`) and had nowhere to record what they agreed. No
 * founders' agreement, no IP assignment, no founder vesting. The signature engine
 * already existed and `canvas_request_signature` already routed authored text
 * through it — what was missing was the TEXT, and the register said so exactly:
 * "this is a TEMPLATE plus a `contract` routed through it".
 *
 * FO-E2 needed the same thing from the other end. `data_rooms.nda_required` could
 * not be enforced without an NDA to send, and a second NDA body written inside the
 * data-room module would have been the duplicate the no-technical-debt rule
 * forbids. So the NDA is an entry in this registry, and the data room renders it
 * the same way the co-founder flow renders a founders' agreement.
 *
 * ── WHY A REGISTRY OF DATA AND NOT SEVEN FUNCTIONS ───────────────────────────
 * A template is: a title, a category, a declared variable list and a renderer. That
 * makes "which templates exist" answerable by reading one array — which is what the
 * canvas tool advertises to the model, what the co-founder surface draws its form
 * from, and what a future "add a mutual non-solicit" is: one entry. Nothing
 * branches on the key.
 *
 * ── WHAT THESE ARE NOT ───────────────────────────────────────────────────────
 * Product defaults, not advice from counsel. Every rendered document carries that
 * sentence in its own body rather than only in this comment, because the person
 * who needs to read it is the founder signing it, not the developer reading the
 * module — the same reasoning `defaultLegalDocuments.ts` applies to the platform's
 * own terms.
 */

export class TemplateError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'TemplateError';
  }
}

/**
 * The kinds of value a template asks for.
 *
 * `parties` is the one non-scalar, and it earns that because every formation
 * document is fundamentally a table of people and what each of them gets — a
 * founders' agreement, a vesting schedule and an IP assignment all take the same
 * rows, which is why they are one kind rather than three bespoke shapes.
 */
export const TEMPLATE_VARIABLE_KINDS = ['text', 'longText', 'date', 'number', 'parties'] as const;
export type TemplateVariableKind = typeof TEMPLATE_VARIABLE_KINDS[number];

export interface TemplateVariable {
  name: string;
  label: string;
  kind: TemplateVariableKind;
  required: boolean;
  /** What a good answer looks like. Shown on the form AND handed to the model, so
   *  the two never describe the same field differently. */
  hint: string;
}

/** One person the document binds. `share` is a percentage; `contribution` is what
 *  they are bringing, which is the field a co-founder dispute actually turns on. */
export interface TemplateParty {
  name: string;
  email: string;
  role: string;
  share: number | null;
  contribution: string;
}

export interface TemplateValues {
  [name: string]: string | number | TemplateParty[] | null | undefined;
}

export interface DocumentTemplate {
  key: string;
  title: string;
  /** One line: what this document is FOR. Read by a founder choosing between them. */
  purpose: string;
  /** `legal_document_files.category`, so an executed copy filed later lands under
   *  the same word the template was drafted under. */
  category: 'nda' | 'ip_assignment' | 'formation' | 'employment' | 'other';
  /** `contract.contractType` on the canvas object this renders into. */
  contractType: 'nda' | 'formation' | 'employment' | 'vendor' | 'msa' | 'sow';
  /** The signature engine's `intent`. An NDA is signed; a policy is acknowledged. */
  intent: 'sign' | 'acknowledge';
  variables: readonly TemplateVariable[];
  render: (values: TemplateValues) => string;
}

// ---------------------------------------------------------------------------
// Rendering helpers — shared so four documents cannot format a party list three
// different ways
// ---------------------------------------------------------------------------

const text = (values: TemplateValues, name: string, fallback = ''): string => {
  const value = values[name];
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number') return String(value);
  return fallback;
};

/**
 * A numeric variable, or the template's own default.
 *
 * The empty case is the one that matters: `Number('')` is 0, not NaN, so a naive
 * read returns ZERO for a variable nobody supplied — and a Master Services
 * Agreement that says "payable within 0 days", or a vesting schedule with a
 * 0-month cliff, is a document that looks deliberate and says something nobody
 * agreed. An absent or blank value takes the fallback; an explicit 0 is honoured,
 * because "no probationary period" is a real answer.
 */
const num = (values: TemplateValues, name: string, fallback: number): number => {
  const value = values[name];
  if (value == null || (typeof value === 'string' && !value.trim())) return fallback;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : fallback;
};

export function templateParties(values: TemplateValues, name = 'parties'): TemplateParty[] {
  const raw = values[name];
  if (!Array.isArray(raw)) return [];
  // Read as `unknown` rows deliberately: the declared type is what a well-formed
  // caller sends, and this function's whole job is to be safe against one that is not.
  return (raw as unknown[])
    .map((row) => {
      const record = row && typeof row === 'object' ? row as Record<string, unknown> : {};
      const share = Number(record.share);
      return {
        name: String(record.name ?? '').trim().slice(0, 200),
        email: String(record.email ?? '').trim().slice(0, 320),
        role: String(record.role ?? '').trim().slice(0, 120),
        share: Number.isFinite(share) ? Math.round(share * 100) / 100 : null,
        contribution: String(record.contribution ?? '').trim().slice(0, 500),
      };
    })
    .filter((party) => party.name.length > 0);
}

/** The party table every formation document opens with. Totals the shares and says
 *  so when they do not reach 100 — an equity split that does not add up is the one
 *  defect a founders' agreement must not hide behind prose. */
function partyTable(parties: TemplateParty[]): string {
  if (!parties.length) return '_No founders were supplied._';
  const rows = parties.map((party) => {
    const share = party.share == null ? '—' : `${party.share}%`;
    return `| ${party.name} | ${party.role || '—'} | ${share} | ${party.contribution || '—'} |`;
  });
  const total = parties.reduce((sum, party) => sum + (party.share ?? 0), 0);
  const rounded = Math.round(total * 100) / 100;
  const note = parties.some((party) => party.share != null) && Math.abs(rounded - 100) > 0.01
    ? `\n\n> **The declared holdings total ${rounded}%, not 100%.** This document records what the parties stated; the difference is either an unissued pool or an error, and it must be resolved before signature.`
    : '';
  return [
    '| Founder | Role | Holding | Contribution |',
    '| --- | --- | --- | --- |',
    ...rows,
  ].join('\n') + note;
}

const NOT_ADVICE = '_This document was assembled from a product template. It is not legal advice, and it has not been reviewed by counsel for the parties’ jurisdiction, tax position, or existing obligations. Have a lawyer read it before you rely on it._';

const signatureBlock = (parties: TemplateParty[]): string => [
  '## Signatures',
  '',
  'Each party signs electronically through the request that carries this document. The'
  + ' signature record — who signed, when, and what they were shown — is held against this'
  + ' exact text; a later edit does not change what was signed.',
  '',
  ...parties.map((party) => `- **${party.name}**${party.email ? ` (${party.email})` : ''}${party.role ? ` — ${party.role}` : ''}`),
].join('\n');

// ---------------------------------------------------------------------------
// The templates
// ---------------------------------------------------------------------------

const PARTIES_VARIABLE: TemplateVariable = {
  name: 'parties',
  label: 'Founders',
  kind: 'parties',
  required: true,
  hint: 'One row per founder: name, email, role, holding as a percentage, and what they are contributing. Real names and real addresses — these are the people the signature request goes to.',
};

const COMPANY_VARIABLE: TemplateVariable = {
  name: 'companyName',
  label: 'Company',
  kind: 'text',
  required: true,
  hint: 'The legal or intended name of the company being formed — "Northwind Labs, Inc.".',
};

const JURISDICTION_VARIABLE: TemplateVariable = {
  name: 'jurisdiction',
  label: 'Governing law',
  kind: 'text',
  required: true,
  hint: 'The state or country whose law governs — "Delaware", "England and Wales".',
};

const EFFECTIVE_VARIABLE: TemplateVariable = {
  name: 'effectiveDate',
  label: 'Effective date',
  kind: 'date',
  required: true,
  hint: 'ISO date the agreement takes effect. Backdating it to when the work actually started is a decision to make deliberately, not by default.',
};

const FOUNDERS_AGREEMENT: DocumentTemplate = {
  key: 'founders-agreement',
  title: 'Founders’ Agreement',
  purpose: 'Who owns what, who decides what, and what happens when one of you leaves. The document that comes before every other document.',
  category: 'formation',
  contractType: 'formation',
  intent: 'sign',
  variables: [
    COMPANY_VARIABLE,
    PARTIES_VARIABLE,
    EFFECTIVE_VARIABLE,
    JURISDICTION_VARIABLE,
    { name: 'vestingYears', label: 'Vesting period (years)', kind: 'number', required: false, hint: 'Total years over which each founder’s holding vests. Four is the convention; state it rather than assuming it.' },
    { name: 'cliffMonths', label: 'Cliff (months)', kind: 'number', required: false, hint: 'Months before anything vests. Twelve is the convention.' },
    { name: 'decisionRule', label: 'How decisions are made', kind: 'longText', required: false, hint: 'What needs unanimity, what needs a majority, and what one founder can do alone. The clause that is worth writing while you still agree.' },
    { name: 'departureRule', label: 'What happens on departure', kind: 'longText', required: false, hint: 'Good leaver / bad leaver, repurchase rights, and notice. Unwritten, this is decided during the argument it exists to prevent.' },
  ],
  render: (values) => {
    const parties = templateParties(values);
    const company = text(values, 'companyName', 'the Company');
    const years = num(values, 'vestingYears', 4);
    const cliff = num(values, 'cliffMonths', 12);
    return [
      `# Founders’ Agreement — ${company}`,
      '',
      `**Effective date:** ${text(values, 'effectiveDate', '—')}  `,
      `**Governing law:** ${text(values, 'jurisdiction', '—')}`,
      '',
      NOT_ADVICE,
      '',
      '## 1. The parties and what each holds',
      '',
      partyTable(parties),
      '',
      `The parties above are the founders of ${company}. Each holding is stated as a percentage of the`
      + ' founders’ equity at the effective date, before any option pool, investment or other issuance.',
      '',
      '## 2. Vesting',
      '',
      `Each founder’s holding vests over **${years} year${years === 1 ? '' : 's'}** from the effective date,`
      + ` with a **${cliff}-month cliff**: nothing vests before the cliff, the portion accrued to the cliff vests`
      + ' on that date, and the remainder vests in equal monthly instalments thereafter.',
      '',
      'Unvested holdings are subject to repurchase by the Company at the lower of cost and fair value if the'
      + ' founder ceases to be actively engaged, subject to section 5.',
      '',
      '## 3. Roles and commitment',
      '',
      ...parties.map((party) => `- **${party.name}** — ${party.role || 'role not stated'}. ${party.contribution || 'Contribution not stated.'}`),
      '',
      'A founder who materially reduces their commitment without the other founders’ written agreement is'
      + ' treated as having ceased active engagement for the purposes of section 2.',
      '',
      '## 4. Decisions',
      '',
      text(values, 'decisionRule',
        'Decisions in the ordinary course are taken by a majority of the founders. The following require the'
        + ' unanimous written agreement of all founders: issuing equity, taking on debt, changing this'
        + ' agreement, selling the business or substantially all of its assets, and removing a founder.'),
      '',
      '## 5. Departure',
      '',
      text(values, 'departureRule',
        'A founder who leaves voluntarily or is removed for cause keeps only what has vested at the date of'
        + ' departure. A founder who leaves because of death, permanent incapacity, or removal without cause'
        + ' keeps what has vested plus twelve months of accelerated vesting. In every case the departing'
        + ' founder assigns to the Company all intellectual property covered by section 6 and returns'
        + ' Company property and confidential information.'),
      '',
      '## 6. Intellectual property',
      '',
      `Each founder assigns to ${company} all right, title and interest in every invention, work of authorship,`
      + ' design, mark, dataset, model and other intellectual property they create in connection with the'
      + ' business of the Company, whether before or after the effective date, and will sign anything'
      + ' reasonably needed to record that assignment. Intellectual property a founder owned before the'
      + ' effective date and is NOT assigning must be listed in writing before signature; anything not'
      + ' listed is assigned.',
      '',
      '## 7. Confidentiality',
      '',
      'Each founder will keep the Company’s non-public information confidential, use it only for the'
      + ' Company, and continue to do so after they leave.',
      '',
      '## 8. Disputes',
      '',
      `This agreement is governed by the law of ${text(values, 'jurisdiction', 'the stated jurisdiction')}. The`
      + ' founders will attempt to resolve a dispute between themselves in good faith before starting'
      + ' proceedings.',
      '',
      signatureBlock(parties),
    ].join('\n');
  },
};

const IP_ASSIGNMENT: DocumentTemplate = {
  key: 'ip-assignment',
  title: 'Founder IP Assignment',
  purpose: 'Moves everything each founder has already built into the company. The document an investor asks for and a founder has usually never signed.',
  category: 'ip_assignment',
  contractType: 'formation',
  intent: 'sign',
  variables: [
    COMPANY_VARIABLE,
    PARTIES_VARIABLE,
    EFFECTIVE_VARIABLE,
    JURISDICTION_VARIABLE,
    { name: 'excluded', label: 'Prior work NOT being assigned', kind: 'longText', required: false, hint: 'List anything a founder owned before and is keeping — a prior open-source project, a side product. Anything not listed here is assigned.' },
  ],
  render: (values) => {
    const parties = templateParties(values);
    const company = text(values, 'companyName', 'the Company');
    const excluded = text(values, 'excluded');
    return [
      `# Intellectual Property Assignment — ${company}`,
      '',
      `**Effective date:** ${text(values, 'effectiveDate', '—')}  `,
      `**Governing law:** ${text(values, 'jurisdiction', '—')}`,
      '',
      NOT_ADVICE,
      '',
      '## 1. Assignment',
      '',
      `Each person named below assigns to ${company}, with effect from the earlier of the effective date and`
      + ' the date they began work on the business, all right, title and interest worldwide in:',
      '',
      '- inventions, discoveries, improvements and know-how;',
      '- source code, models, weights, prompts, datasets and documentation;',
      '- designs, user interfaces, brand names, logos and domain names;',
      '- and every other work of authorship or intellectual property,',
      '',
      'created by them alone or with others in connection with the business of the Company.',
      '',
      '## 2. Moral rights and further assurance',
      '',
      'Each person waives any moral rights in the assigned material to the extent the law allows, and will'
      + ' sign, at the Company’s expense, anything reasonably needed to record, register or enforce the'
      + ' assignment — including after they stop working with the Company.',
      '',
      '## 3. Prior work that is NOT assigned',
      '',
      excluded || 'None stated. **Anything not listed here is assigned by section 1.** A founder with prior'
        + ' work to carve out must list it before signing; a carve-out added afterwards is a negotiation, not'
        + ' a correction.',
      '',
      '## 4. Third-party and open-source material',
      '',
      'Each person confirms that the assigned material does not knowingly include anything owned by a former'
      + ' employer or a third party, and that any open-source component included in it is used consistently'
      + ' with its licence.',
      '',
      signatureBlock(parties),
    ].join('\n');
  },
};

const FOUNDER_VESTING: DocumentTemplate = {
  key: 'founder-vesting',
  title: 'Founder Vesting Schedule',
  purpose: 'The cliff, the term and the acceleration, written down per founder — so "we agreed four-year vesting" has a document behind it.',
  category: 'formation',
  contractType: 'formation',
  intent: 'sign',
  variables: [
    COMPANY_VARIABLE,
    PARTIES_VARIABLE,
    EFFECTIVE_VARIABLE,
    { name: 'vestingYears', label: 'Vesting period (years)', kind: 'number', required: true, hint: 'Total years. Four is the convention.' },
    { name: 'cliffMonths', label: 'Cliff (months)', kind: 'number', required: true, hint: 'Months before anything vests. Twelve is the convention.' },
    { name: 'acceleration', label: 'Acceleration', kind: 'longText', required: false, hint: 'What happens on a sale or a termination without cause — single trigger, double trigger, or none. Say which; "standard" means nothing.' },
  ],
  render: (values) => {
    const parties = templateParties(values);
    const company = text(values, 'companyName', 'the Company');
    const years = num(values, 'vestingYears', 4);
    const cliff = num(values, 'cliffMonths', 12);
    const months = Math.max(1, Math.round(years * 12));
    const cliffShare = Math.round((Math.min(cliff, months) / months) * 10000) / 100;
    return [
      `# Founder Vesting Schedule — ${company}`,
      '',
      `**Effective date:** ${text(values, 'effectiveDate', '—')}  `,
      `**Term:** ${years} year${years === 1 ? '' : 's'} (${months} months) · **Cliff:** ${cliff} months`,
      '',
      NOT_ADVICE,
      '',
      '## 1. Holdings covered',
      '',
      partyTable(parties),
      '',
      '## 2. How it vests',
      '',
      `Nothing vests before month ${cliff}. On the cliff date, **${cliffShare}%** of each holding vests in one`
      + ` step. The remainder vests in ${Math.max(0, months - cliff)} equal monthly instalments, so the whole`
      + ` holding is vested at month ${months}.`,
      '',
      '| Milestone | Vested |',
      '| --- | --- |',
      `| Effective date | 0% |`,
      `| Month ${cliff} (cliff) | ${cliffShare}% |`,
      `| Month ${Math.round(months / 2)} | ${Math.round((Math.min(Math.round(months / 2), months) / months) * 10000) / 100}% |`,
      `| Month ${months} | 100% |`,
      '',
      '## 3. Unvested holdings',
      '',
      'A holding that has not vested when a founder ceases active engagement may be repurchased by the'
      + ' Company at the lower of the price paid for it and its fair value, exercisable for ninety days'
      + ' after departure.',
      '',
      '## 4. Acceleration',
      '',
      text(values, 'acceleration',
        'No acceleration. Vesting continues on the schedule above regardless of a change of control. If the'
        + ' founders want single- or double-trigger acceleration, it must be stated here — an unstated'
        + ' acceleration does not exist.'),
      '',
      signatureBlock(parties),
    ].join('\n');
  },
};

const MUTUAL_NDA: DocumentTemplate = {
  key: 'mutual-nda',
  title: 'Mutual Non-Disclosure Agreement',
  purpose: 'What a data room requires before it opens. Mutual, because diligence runs in both directions.',
  category: 'nda',
  contractType: 'nda',
  intent: 'sign',
  variables: [
    { name: 'companyName', label: 'Disclosing company', kind: 'text', required: true, hint: 'Your company’s legal name — the party opening the data room.' },
    { name: 'counterparty', label: 'Receiving party', kind: 'text', required: true, hint: 'The firm being given access, by its legal name.' },
    { name: 'purpose', label: 'Purpose', kind: 'text', required: false, hint: 'What the information may be used for — "evaluating a possible investment". Narrow is better than broad.' },
    { name: 'termYears', label: 'Term (years)', kind: 'number', required: false, hint: 'How long the obligations last after disclosure. Two to three years is usual for a fundraise.' },
    JURISDICTION_VARIABLE,
  ],
  render: (values) => {
    const company = text(values, 'companyName', 'the Disclosing Party');
    const counterparty = text(values, 'counterparty', 'the Receiving Party');
    const purpose = text(values, 'purpose', 'evaluating a possible investment in, or transaction with, the Company');
    const term = num(values, 'termYears', 3);
    return [
      `# Mutual Non-Disclosure Agreement`,
      '',
      `**Between:** ${company} and ${counterparty}  `,
      `**Purpose:** ${purpose}  `,
      `**Governing law:** ${text(values, 'jurisdiction', '—')}`,
      '',
      NOT_ADVICE,
      '',
      '## 1. Confidential information',
      '',
      'Confidential information is any non-public information either party discloses to the other in'
      + ' connection with the purpose, in any form, whether or not it is marked confidential — including'
      + ' financial information, metrics, forecasts, customer and investor lists, product plans, source'
      + ' code, models and the existence and terms of the discussions themselves.',
      '',
      '## 2. Obligations',
      '',
      'The receiving party will use the confidential information only for the purpose, keep it confidential'
      + ' with at least the care it applies to its own confidential information, and disclose it only to'
      + ' those of its personnel and professional advisers who need it for the purpose and are bound by'
      + ' equivalent obligations. It will not copy, publish, or use it to compete.',
      '',
      '## 3. Exclusions',
      '',
      'These obligations do not apply to information that is or becomes public without breach, was already'
      + ' lawfully known without a duty of confidence, is independently developed without use of the'
      + ' confidential information, or is lawfully received from a third party free to disclose it.',
      '',
      '## 4. Required disclosure',
      '',
      'A party may disclose confidential information where the law or a court requires it, having first given'
      + ' the other party notice where it is legally permitted to do so.',
      '',
      '## 5. Term and return',
      '',
      `These obligations last **${term} year${term === 1 ? '' : 's'}** from the date the information is`
      + ' disclosed. On request the receiving party will return or destroy the confidential information,'
      + ' except for copies retained in routine backups or required by law, which remain subject to this'
      + ' agreement.',
      '',
      '## 6. No licence and no obligation',
      '',
      'Nothing here transfers ownership, grants a licence, or obliges either party to proceed with any'
      + ' transaction. Each party gives the information as-is, with no warranty as to its accuracy.',
      '',
      '## 7. Access to the data room',
      '',
      `Access to ${company}’s data room is granted on acceptance of this agreement, is personal to`
      + ` ${counterparty}, and may be withdrawn at any time. Access is logged, and documents may carry a`
      + ' watermark identifying the recipient.',
      '',
      '## Signature',
      '',
      'Signing this request records acceptance of the terms above against this exact text.',
    ].join('\n');
  },
};

// ---------------------------------------------------------------------------
// The COMMERCIAL half (FO-G3) — the paperwork a company signs with somebody who
// is not a founder
// ---------------------------------------------------------------------------

const COUNTERPARTY_VARIABLE: TemplateVariable = {
  name: 'counterparty',
  label: 'Counterparty',
  kind: 'text',
  required: true,
  hint: 'The other side, by legal name. Use the `account` on the board where one exists, so the agreement and its invoices join to the same party rather than to two spellings.',
};

const SIGNERS_VARIABLE: TemplateVariable = {
  name: 'parties',
  label: 'Signatories',
  kind: 'parties',
  required: true,
  hint: 'Who signs, on both sides: name, email, role. Real addresses only — these are the people the signature request goes to. Leave the holding blank; it is not an equity document.',
};

const MSA: DocumentTemplate = {
  key: 'msa',
  title: 'Master Services Agreement',
  purpose: 'The standing terms every piece of work with this customer runs under, so each engagement is a statement of work and not a renegotiation.',
  category: 'other',
  contractType: 'msa',
  intent: 'sign',
  variables: [
    COMPANY_VARIABLE,
    COUNTERPARTY_VARIABLE,
    SIGNERS_VARIABLE,
    EFFECTIVE_VARIABLE,
    JURISDICTION_VARIABLE,
    { name: 'paymentTermsDays', label: 'Payment terms (days)', kind: 'number', required: false, hint: 'Days from invoice to payment. 30 is the convention; say it rather than assuming it.' },
    { name: 'liabilityCap', label: 'Liability cap', kind: 'text', required: false, hint: 'What each side’s liability is limited to — "fees paid in the preceding 12 months". The clause a reviewer actually turns to.' },
    { name: 'noticeDays', label: 'Termination notice (days)', kind: 'number', required: false, hint: 'Days of notice to end the agreement for convenience.' },
  ],
  render: (values) => {
    const parties = templateParties(values);
    const company = text(values, 'companyName', 'the Supplier');
    const counterparty = text(values, 'counterparty', 'the Customer');
    const days = num(values, 'paymentTermsDays', 30);
    const notice = num(values, 'noticeDays', 30);
    return [
      `# Master Services Agreement — ${company} and ${counterparty}`,
      '',
      `**Effective date:** ${text(values, 'effectiveDate', '—')}  `,
      `**Governing law:** ${text(values, 'jurisdiction', '—')}`,
      '',
      NOT_ADVICE,
      '',
      '## 1. What this covers',
      '',
      `This agreement sets the standing terms between ${company} and ${counterparty}. The WORK is described`
      + ' in one or more statements of work, each of which incorporates these terms. Where a statement of'
      + ' work conflicts with this agreement, the statement of work governs for that engagement only.',
      '',
      '## 2. Fees and payment',
      '',
      `Fees are set in each statement of work. Invoices are payable within **${days} days**. Undisputed`
      + ' amounts unpaid after that may accrue interest at the statutory rate. A disputed amount must be'
      + ' raised in writing before the due date, and the undisputed remainder paid on time.',
      '',
      '## 3. Intellectual property',
      '',
      `${counterparty} owns the deliverables described in a statement of work on payment in full.`
      + ` ${company} retains everything it brought to the engagement and everything general it develops —`
      + ' tools, methods, know-how and reusable components — and grants a perpetual, non-exclusive licence'
      + ' to use those as embedded in the deliverables.',
      '',
      '## 4. Confidentiality',
      '',
      'Each party will keep the other’s non-public information confidential, use it only to perform this'
      + ' agreement, and disclose it only to personnel and advisers who need it and are bound equivalently.'
      + ' These duties survive termination.',
      '',
      '## 5. Warranties',
      '',
      `${company} will perform with reasonable skill and care and in accordance with the statement of work.`
      + ' Except as stated here, neither party gives any other warranty, express or implied.',
      '',
      '## 6. Liability',
      '',
      text(values, 'liabilityCap',
        'Each party’s total liability under this agreement is capped at the fees paid or payable in the'
        + ' twelve months before the claim. Neither party is liable for indirect or consequential loss.'
        + ' Nothing limits liability for death or personal injury caused by negligence, for fraud, or for'
        + ' anything else that cannot lawfully be limited.'),
      '',
      '## 7. Term and termination',
      '',
      `Either party may end this agreement on **${notice} days’** written notice, or immediately for a`
      + ' material breach that is not remedied within thirty days of notice. Statements of work already'
      + ' running continue until completed or separately terminated, and work performed up to termination'
      + ' is payable.',
      '',
      '## 8. General',
      '',
      `This agreement is governed by the law of ${text(values, 'jurisdiction', 'the stated jurisdiction')}.`
      + ' Neither party may assign it without the other’s consent, except to a successor of its business.'
      + ' It is the entire agreement on its subject and may be changed only in writing signed by both.',
      '',
      signatureBlock(parties),
    ].join('\n');
  },
};

const SOW: DocumentTemplate = {
  key: 'sow',
  title: 'Statement of Work',
  purpose: 'One engagement: what is being delivered, by when, for how much, and what "done" means. Runs under an MSA where there is one.',
  category: 'other',
  contractType: 'sow',
  intent: 'sign',
  variables: [
    COMPANY_VARIABLE,
    COUNTERPARTY_VARIABLE,
    SIGNERS_VARIABLE,
    EFFECTIVE_VARIABLE,
    { name: 'scope', label: 'Scope', kind: 'longText', required: true, hint: 'What is actually being built or done, in the terms the customer would use. The clause a dispute turns on — write what is IN and what is explicitly OUT.' },
    { name: 'deliverables', label: 'Deliverables and acceptance', kind: 'longText', required: false, hint: 'One line per deliverable with what makes it accepted. "A working X" is not acceptance criteria; "passes the agreed test plan" is.' },
    { name: 'fees', label: 'Fees', kind: 'text', required: false, hint: 'The amount and the shape — fixed price, day rate, or capped time and materials. Say which; "TBC" in a signed document is a future argument.' },
    { name: 'timeline', label: 'Timeline', kind: 'text', required: false, hint: 'Start, key dates, end. A date nobody committed to should not be written here.' },
  ],
  render: (values) => {
    const parties = templateParties(values);
    const company = text(values, 'companyName', 'the Supplier');
    const counterparty = text(values, 'counterparty', 'the Customer');
    return [
      `# Statement of Work — ${counterparty}`,
      '',
      `**Supplier:** ${company}  `,
      `**Effective date:** ${text(values, 'effectiveDate', '—')}  `,
      `**Fees:** ${text(values, 'fees', 'as agreed in writing before work starts')}  `,
      `**Timeline:** ${text(values, 'timeline', 'as agreed in writing before work starts')}`,
      '',
      NOT_ADVICE,
      '',
      '## 1. Scope',
      '',
      text(values, 'scope'),
      '',
      '## 2. Deliverables and acceptance',
      '',
      text(values, 'deliverables',
        'The deliverables are those described in the scope above. Each is accepted when it meets the'
        + ' criteria agreed in writing, or ten working days after delivery if no written objection has been'
        + ' raised. An objection must say what specifically does not meet the criteria.'),
      '',
      '## 3. Changes',
      '',
      'A change to the scope, the fees or the timeline takes effect only when both parties agree it in'
      + ' writing. Work outside this scope is a new statement of work, not an extension of this one.',
      '',
      '## 4. Dependencies',
      '',
      `${counterparty} will provide the access, information, environments and decisions this work depends`
      + ' on, within the timescales agreed. Where a dependency is late, the timeline moves by the delay.',
      '',
      '## 5. Terms',
      '',
      `This statement of work runs under the Master Services Agreement between ${company} and`
      + ` ${counterparty} where one is in force. Where none is, the MSA terms attached to it apply to this`
      + ' engagement alone.',
      '',
      signatureBlock(parties),
    ].join('\n');
  },
};

const OFFER_LETTER: DocumentTemplate = {
  key: 'offer-letter',
  title: 'Offer of Employment',
  purpose: 'The offer a candidate signs. Renders from the `offer` card’s own fields, so what is sent is what the board already says.',
  category: 'employment',
  contractType: 'employment',
  intent: 'sign',
  variables: [
    COMPANY_VARIABLE,
    {
      name: 'parties',
      label: 'Candidate',
      kind: 'parties',
      required: true,
      hint: 'ONE row: the candidate’s name, real email, and the role in `role`. Their real address — this is who the offer goes to.',
    },
    { name: 'title', label: 'Job title', kind: 'text', required: true, hint: 'The title on the offer. Take it from the `offer` card rather than re-typing it.' },
    { name: 'startDate', label: 'Start date', kind: 'date', required: true, hint: 'ISO date they begin. Take it from the `offer` card’s startDate.' },
    { name: 'salary', label: 'Salary', kind: 'text', required: true, hint: 'The amount and the currency and the period — "£85,000 per year". Take it from the `offer` card’s compensation fields; never round it.' },
    { name: 'equity', label: 'Equity', kind: 'text', required: false, hint: 'The grant as agreed — number of options or a percentage, plus the vesting. Take it from the `offer` card’s equity field. Leave blank rather than implying a grant that was not agreed.' },
    { name: 'location', label: 'Location / working pattern', kind: 'text', required: false, hint: 'Where they work and how often — "London, three days a week in the office", "fully remote (UK)".' },
    { name: 'probationMonths', label: 'Probation (months)', kind: 'number', required: false, hint: 'Months of probation. Zero is a real answer and should be written as one.' },
    { name: 'contingencies', label: 'Conditions', kind: 'longText', required: false, hint: 'What the offer is conditional on — right to work, references, background check. An unstated condition applied later is a withdrawn offer, not a condition.' },
    JURISDICTION_VARIABLE,
  ],
  render: (values) => {
    const parties = templateParties(values);
    const candidate = parties[0];
    const company = text(values, 'companyName', 'the Company');
    const probation = num(values, 'probationMonths', 3);
    return [
      `# Offer of Employment — ${company}`,
      '',
      `**To:** ${candidate?.name ?? '—'}${candidate?.email ? ` (${candidate.email})` : ''}  `,
      `**Role:** ${text(values, 'title', '—')}  `,
      `**Start date:** ${text(values, 'startDate', '—')}  `,
      `**Governing law:** ${text(values, 'jurisdiction', '—')}`,
      '',
      NOT_ADVICE,
      '',
      `## 1. The offer`,
      '',
      `${company} is pleased to offer you the role of **${text(values, 'title', '—')}**, starting on`
      + ` **${text(values, 'startDate', '—')}**. ${text(values, 'location') ? `You will work ${text(values, 'location')}.` : ''}`,
      '',
      '## 2. Pay',
      '',
      `Your salary will be **${text(values, 'salary', '—')}**, paid in accordance with the Company’s normal`
      + ' payroll, subject to deductions required by law. It will be reviewed at least annually; a review is'
      + ' not a promise of an increase.',
      '',
      ...(text(values, 'equity') ? [
        '## 3. Equity',
        '',
        `${text(values, 'equity')}`,
        '',
        'Any grant is subject to the Company’s plan rules and to board approval, and vests on the schedule'
        + ' stated above. Nothing here grants shares by itself.',
        '',
      ] : []),
      `## ${text(values, 'equity') ? '4' : '3'}. Probation and notice`,
      '',
      probation > 0
        ? `Your first **${probation} month${probation === 1 ? '' : 's'}** are a probationary period, during`
          + ' which either side may end the employment on one week’s notice. After that, the notice period'
          + ' is as set out in your contract of employment.'
        : 'There is no probationary period. Notice is as set out in your contract of employment.',
      '',
      `## ${text(values, 'equity') ? '5' : '4'}. Conditions`,
      '',
      text(values, 'contingencies',
        'This offer is conditional on your right to work in the jurisdiction stated above and on'
        + ' satisfactory references. If either is not met, the offer may be withdrawn.'),
      '',
      `## ${text(values, 'equity') ? '6' : '5'}. Confidentiality and intellectual property`,
      '',
      `You will keep ${company}’s confidential information confidential, and everything you create in`
      + ' connection with your employment belongs to the Company. Your contract of employment sets these'
      + ' out in full and prevails over this summary.',
      '',
      '## Acceptance',
      '',
      'Signing this offer records your acceptance of the terms above. It is not itself the contract of'
      + ' employment, which will be provided separately and will govern your employment.',
    ].join('\n');
  },
};

/**
 * Every template, in the order a company needs them.
 *
 * The founders' agreement first, because it is the one document that comes before
 * every other document — which is the whole reason FO-D5 exists.
 */
export const DOCUMENT_TEMPLATES: readonly DocumentTemplate[] = [
  FOUNDERS_AGREEMENT,
  IP_ASSIGNMENT,
  FOUNDER_VESTING,
  MUTUAL_NDA,
  // The commercial half (FO-G3): the paperwork a company signs with somebody who
  // is not a founder. Each is one entry — no renderer registry, no branch.
  MSA,
  SOW,
  OFFER_LETTER,
];

const BY_KEY: ReadonlyMap<string, DocumentTemplate> = new Map(DOCUMENT_TEMPLATES.map((template) => [template.key, template]));

export const documentTemplate = (key: string): DocumentTemplate | null => BY_KEY.get(key) ?? null;

export interface RenderedDocument {
  key: string;
  title: string;
  category: DocumentTemplate['category'];
  contractType: DocumentTemplate['contractType'];
  intent: DocumentTemplate['intent'];
  /** The rendered markdown. What a signer is shown and what the signature record
   *  freezes — see `signatureEngine`'s note on why the body is copied. */
  body: string;
  /** Who the document names, when it names anyone. The signature request's parties
   *  are taken from HERE rather than supplied separately, so the people who sign
   *  are the people the document binds. */
  parties: TemplateParty[];
}

/**
 * Render one template, refusing rather than guessing.
 *
 * A missing required variable is a 400 that NAMES the variable. The alternative —
 * rendering "—" into a founders' agreement and letting somebody sign it — is the
 * failure mode this whole registry exists to remove, and it is worse than an error
 * because it produces a document that looks finished.
 */
export function renderDocumentTemplate(key: string, values: TemplateValues): RenderedDocument {
  const template = documentTemplate(key);
  if (!template) {
    throw new TemplateError(`No document template named "${key}". Available: ${DOCUMENT_TEMPLATES.map((t) => t.key).join(', ')}.`, 404);
  }

  const missing = template.variables
    .filter((variable) => {
      if (!variable.required) return false;
      const value = values[variable.name];
      if (variable.kind === 'parties') return templateParties(values, variable.name).length === 0;
      return value == null || String(value).trim() === '';
    })
    .map((variable) => variable.name);

  if (missing.length) {
    throw new TemplateError(
      `${template.title} needs ${missing.join(', ')} before it can be drafted. Ask for the missing detail — never fill a formation document with a placeholder.`,
      400,
    );
  }

  return {
    key: template.key,
    title: template.title,
    category: template.category,
    contractType: template.contractType,
    intent: template.intent,
    body: template.render(values),
    parties: templateParties(values),
  };
}

/** The catalogue, without the renderers — what a surface or a tool advertises. */
export const documentTemplateCatalog = () => DOCUMENT_TEMPLATES.map((template) => ({
  key: template.key,
  title: template.title,
  purpose: template.purpose,
  category: template.category,
  contractType: template.contractType,
  intent: template.intent,
  variables: template.variables,
}));
