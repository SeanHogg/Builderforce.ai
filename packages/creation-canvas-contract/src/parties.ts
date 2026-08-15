/**
 * THE counterparty vocabulary — one list of roles a party can hold, read by the
 * canvas, the API and the kernel.
 *
 * ── WHAT THIS EXISTS TO PREVENT ──────────────────────────────────────────────────
 * `party_roles` (kernel) has always carried exactly one row per (tenant, party kind,
 * party ref, role), with a unique index proving it. Its `role` column is a
 * `varchar(48)` documented by a comment listing the values — and a comment is not a
 * vocabulary. So the canvas, which had no counterparty object at all, matched a buyer
 * by TYPED STRING: `invoice.customer` said "match it to a `company`, `salesContact` or
 * `contract` on the board where one exists", `bill.vendor` said "match it to a
 * `contract` on the board", and joining a contract to its invoices was a comparison of
 * two hand-typed names.
 *
 * The fix is NOT a second customer store. The kernel already holds the counterparty;
 * what did not exist was a shared NAME for the roles it holds them under, so a canvas
 * `account`, a `deals.account_ref` and a `party_roles.role` could mean the same thing
 * on purpose rather than by coincidence. Declaring it here — in the package both the
 * frontend and the API already import — is what makes that structural.
 *
 * ── WHY `equity_holder` AND `investor` ARE TWO ROLES ─────────────────────────────
 * They are the two sides of the same cheque and they are asked about separately.
 * `investor` is a firm or angel in the RAISE — a name in a pipeline, with a stage and
 * a next step, who may never wire anything. `equity_holder` is somebody who owns
 * shares TODAY, which is a cap-table fact with a share class and a certificate behind
 * it. A founder holds `equity_holder` and was never an `investor`; a fund that passed
 * holds `investor` and no equity. One role for both would make "who owns this company"
 * and "who are we pitching" the same query, and the cap table would inherit every
 * tyre-kicker in the pipeline.
 */

/**
 * Every role a party may hold, and the ONE place the list is written.
 *
 * Ordered from the commercial relationships a company has most of, outward. Adding a
 * role is one entry here — it is a column VALUE, never a table, which is the same rule
 * `party_roles` was consolidated under.
 */
export const PARTY_ROLES = [
  /** An account you have WON — the thing every commercial reference points at. */
  'customer',
  /** Somebody you buy from. The counterparty on a `bill`. */
  'vendor',
  /** A firm or angel in the raise. Not yet, and possibly never, a shareholder. */
  'investor',
  /** Owns shares today. The cap table's own row — see the note above. */
  'equity_holder',
  'partner',
  'candidate',
  'employee',
  'freelancer',
  'recruiter',
  'seller',
  /** Known to us and not yet any of the above. The honest default. */
  'contact',
] as const;

export type PartyRole = typeof PARTY_ROLES[number];

const PARTY_ROLE_SET: ReadonlySet<string> = new Set<string>(PARTY_ROLES);

export function isPartyRole(value: unknown): value is PartyRole {
  return typeof value === 'string' && PARTY_ROLE_SET.has(value);
}

/**
 * The roles a canvas `account` object may declare.
 *
 * A subset, deliberately. `candidate`, `employee` and `freelancer` are PEOPLE roles
 * with their own canvas kinds (`candidate`, `employee`) and their own confidentiality
 * defaults; letting an `account` claim one would put a person's employment record on a
 * commercial card that shares by default. This set is the commercial half — the
 * relationships an account can be in.
 */
export const ACCOUNT_RELATIONSHIPS = ['customer', 'vendor', 'investor', 'equity_holder', 'partner', 'contact'] as const;
export type AccountRelationship = typeof ACCOUNT_RELATIONSHIPS[number];

export function isAccountRelationship(value: unknown): value is AccountRelationship {
  return typeof value === 'string' && (ACCOUNT_RELATIONSHIPS as readonly string[]).includes(value);
}

/** 'person' | 'company' — what kind of party holds the role. */
export const PARTY_KINDS = ['person', 'company'] as const;
export type PartyKind = typeof PARTY_KINDS[number];

export function isPartyKind(value: unknown): value is PartyKind {
  return typeof value === 'string' && (PARTY_KINDS as readonly string[]).includes(value);
}

/**
 * The stable reference a counterparty is addressed by across the platform.
 *
 * `party_roles.party_ref` is a `varchar(64)` with no format rule, which is fine for a
 * column and useless as a contract: two surfaces writing "Acme" and "acme" produce two
 * counterparties for one company, which is the string-matching defect this whole module
 * removes, one level down. So a ref is DERIVED from the party's display name, once,
 * here — and every writer calls this rather than inventing its own slug.
 *
 * Deterministic and idempotent: `partyRef(partyRef(name)) === partyRef(name)`, so a ref
 * that has already been normalised survives a second pass unchanged. That property is
 * what lets a caller normalise defensively without needing to know whether the value it
 * holds is a name or a ref.
 */
export function partyRef(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}
