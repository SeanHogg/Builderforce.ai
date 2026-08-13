/**
 * Data governance for the Creation Canvas — classification, PII, masking, and
 * the declared contract a dataset is held to.
 *
 * WHY ONE MODULE
 * Classification and the data contract are the same question asked twice: what
 * is this column ALLOWED to be. A contract that declares `email` as required and
 * unique is worthless if nothing records that the column is personal data, and a
 * PII tag is worthless if nothing enforces it on the render and export paths. So
 * the vocabulary, the detector, the masker, and the contract evaluator live
 * together and are the single source every surface reads:
 *
 *   • the Dataset importer      tags columns the moment rows land
 *   • the Table / Dataset card  masks restricted cells before they paint
 *   • `canvas_query_dataset`    refuses to hand raw restricted values to Brain
 *   • the export path           masks the same way the card does
 *   • Data quality              turns a contract into checks rather than
 *                               re-describing the same rules a second time
 *
 * DETECTION IS A PROPOSAL, NOT A VERDICT. `classifyTabular` reads names and
 * values and returns a confidence with every tag. A human (or Brain) confirms it
 * onto the object; nothing here silently decides that a column is safe.
 */

import { toNumber, type TabularCell, type TabularColumnProfile, type TabularColumnType, type TabularRow, type TabularSource } from './canvasTabularData';

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** Sensitivity ladder, least to most restricted. Order is meaningful — see
 *  {@link highestClassification}. */
export const DATA_CLASSIFICATIONS = ['public', 'internal', 'confidential', 'restricted'] as const;
export type DataClassification = typeof DATA_CLASSIFICATIONS[number];

/** What KIND of personal data a column holds. `none` is a real answer, not an
 *  absence: it is how a reviewer records "I looked, and this is not personal". */
export const PII_CATEGORIES = [
  'none', 'name', 'email', 'phone', 'address', 'government_id', 'financial',
  'health', 'credentials', 'location', 'date_of_birth', 'ip_address',
] as const;
export type PiiCategory = typeof PII_CATEGORIES[number];

/** Categories that must never render or export in the clear. */
const ALWAYS_MASKED: ReadonlySet<PiiCategory> = new Set<PiiCategory>([
  'government_id', 'financial', 'credentials', 'health',
]);

const CLASSIFICATION_RANK: Record<DataClassification, number> = {
  public: 0, internal: 1, confidential: 2, restricted: 3,
};

export function highestClassification(values: readonly DataClassification[]): DataClassification {
  return values.reduce<DataClassification>((winner, value) => CLASSIFICATION_RANK[value] > CLASSIFICATION_RANK[winner] ? value : winner, 'public');
}

export function isDataClassification(value: unknown): value is DataClassification {
  return typeof value === 'string' && (DATA_CLASSIFICATIONS as readonly string[]).includes(value);
}

export function isPiiCategory(value: unknown): value is PiiCategory {
  return typeof value === 'string' && (PII_CATEGORIES as readonly string[]).includes(value);
}

/** The classification a PII category implies when nothing stricter is declared. */
const PII_CLASSIFICATION: Record<PiiCategory, DataClassification> = {
  none: 'internal',
  name: 'confidential',
  email: 'confidential',
  phone: 'confidential',
  address: 'confidential',
  location: 'confidential',
  date_of_birth: 'restricted',
  government_id: 'restricted',
  financial: 'restricted',
  health: 'restricted',
  credentials: 'restricted',
  ip_address: 'confidential',
};

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

export type ClassificationConfidence = 'high' | 'medium' | 'low';

export interface ColumnClassification {
  column: string;
  classification: DataClassification;
  pii: PiiCategory;
  confidence: ClassificationConfidence;
  /** Machine-readable reason key. The UI localizes it; nothing here formats prose. */
  reason: 'value-match' | 'name-match' | 'default';
  /** True when the column must be masked wherever it renders. */
  masked: boolean;
}

/** Column-name signals. Ordered: the first hit wins, so put the specific
 *  patterns (ssn, card) ahead of the generic ones (id, number). */
const NAME_SIGNALS: ReadonlyArray<{ pii: PiiCategory; pattern: RegExp }> = [
  { pii: 'credentials', pattern: /(?:password|passwd|secret|api[_\s-]?key|token|credential|private[_\s-]?key)/i },
  { pii: 'government_id', pattern: /(?:\bssn\b|social[_\s-]?security|national[_\s-]?id|passport|driver'?s?[_\s-]?licen[cs]e|\btax[_\s-]?id\b|\bnino\b|\bnhs\b)/i },
  { pii: 'financial', pattern: /(?:credit[_\s-]?card|card[_\s-]?number|\bcvv\b|\biban\b|\bsort[_\s-]?code\b|account[_\s-]?number|routing[_\s-]?number|\bbank\b)/i },
  { pii: 'health', pattern: /(?:diagnosis|\bicd\b|medical|patient|prescription|blood[_\s-]?type|allerg)/i },
  { pii: 'date_of_birth', pattern: /(?:date[_\s-]?of[_\s-]?birth|\bdob\b|birth[_\s-]?date|birthday)/i },
  { pii: 'email', pattern: /(?:e[-_\s]?mail|email)/i },
  { pii: 'phone', pattern: /(?:phone|mobile|telephone|\bmsisdn\b|\bfax\b)/i },
  { pii: 'ip_address', pattern: /(?:ip[_\s-]?address|\bipv4\b|\bipv6\b|remote[_\s-]?addr)/i },
  { pii: 'address', pattern: /(?:street|address|post[_\s-]?code|\bzip\b|address[_\s-]?line)/i },
  { pii: 'location', pattern: /(?:latitude|longitude|\blat\b|\blng\b|\blon\b|geo[_\s-]?point|coordinates)/i },
  { pii: 'name', pattern: /(?:full[_\s-]?name|first[_\s-]?name|last[_\s-]?name|surname|given[_\s-]?name|customer[_\s-]?name|contact[_\s-]?name|\bfullname\b)/i },
];

/** Value signals. Stronger evidence than a name, so they are checked first. */
const VALUE_SIGNALS: ReadonlyArray<{ pii: PiiCategory; pattern: RegExp }> = [
  { pii: 'email', pattern: /^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/ },
  { pii: 'government_id', pattern: /^\d{3}-\d{2}-\d{4}$/ },
  { pii: 'financial', pattern: /^(?:\d[ -]?){13,19}$/ },
  { pii: 'ip_address', pattern: /^(?:\d{1,3}\.){3}\d{1,3}$|^[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}$/i },
  { pii: 'phone', pattern: /^\+?\d[\d\s().-]{6,17}\d$/ },
];

/** Share of non-empty sampled values that must match before a value signal is
 *  believed. Below this a stray "n/a" row would flip a whole column. */
const VALUE_SIGNAL_THRESHOLD = 0.7;
const VALUE_SAMPLE_SIZE = 200;

/**
 * Classify one column from its name and, when rows are available, its values.
 *
 * Values win over names: a column called `contact` holding real addresses is
 * email data whatever it is called, and a column called `email_opt_in` holding
 * `true`/`false` is not.
 */
export function classifyColumn(column: string, rows: readonly TabularRow[] = [], profile?: TabularColumnProfile): ColumnClassification {
  const sample: string[] = [];
  for (const row of rows.slice(0, VALUE_SAMPLE_SIZE)) {
    const text = cellText(row[column]).trim();
    if (text) sample.push(text);
  }

  if (sample.length >= 4) {
    for (const signal of VALUE_SIGNALS) {
      const hits = sample.filter((value) => signal.pattern.test(value)).length;
      if (hits / sample.length >= VALUE_SIGNAL_THRESHOLD) return tag(column, signal.pii, 'high', 'value-match');
    }
  }

  for (const signal of NAME_SIGNALS) {
    if (!signal.pattern.test(column)) continue;
    // A name match on a numeric, low-cardinality column is usually a flag or a
    // foreign key ("bank_id", "phone_verified"), not the data itself.
    const looksLikeFlag = profile ? profile.type === 'boolean' || (profile.type === 'number' && profile.distinct <= 2) : false;
    if (looksLikeFlag) continue;
    return tag(column, signal.pii, sample.length ? 'medium' : 'low', 'name-match');
  }

  return tag(column, 'none', 'low', 'default');
}

function tag(column: string, pii: PiiCategory, confidence: ClassificationConfidence, reason: ColumnClassification['reason']): ColumnClassification {
  const classification = pii === 'none' ? 'internal' : PII_CLASSIFICATION[pii];
  return { column, classification, pii, confidence, reason, masked: ALWAYS_MASKED.has(pii) };
}

/** Classify every column of a source. Profiles are optional but sharpen the
 *  flag heuristic above, so pass them when they have already been computed. */
export function classifyTabular(source: TabularSource, profiles: readonly TabularColumnProfile[] = []): ColumnClassification[] {
  const byName = new Map(profiles.map((profile) => [profile.name, profile]));
  return source.columns.map((column) => classifyColumn(column, source.rows, byName.get(column)));
}

export interface ClassificationSummary {
  total: number;
  piiColumns: number;
  maskedColumns: number;
  restricted: number;
  confidential: number;
  highest: DataClassification;
  categories: PiiCategory[];
}

export function classificationSummary(list: readonly ColumnClassification[]): ClassificationSummary {
  const categories = [...new Set(list.filter((item) => item.pii !== 'none').map((item) => item.pii))];
  return {
    total: list.length,
    piiColumns: list.filter((item) => item.pii !== 'none').length,
    maskedColumns: list.filter((item) => item.masked).length,
    restricted: list.filter((item) => item.classification === 'restricted').length,
    confidential: list.filter((item) => item.classification === 'confidential').length,
    highest: highestClassification(list.map((item) => item.classification)),
    categories,
  };
}

/** Read classifications previously confirmed onto a canvas object. Unknown
 *  values are dropped rather than coerced — a bad tag must not become a
 *  confident one. */
export function normalizeClassifications(value: unknown): ColumnClassification[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const item = raw as Record<string, unknown>;
    const column = typeof item.column === 'string' ? item.column.trim() : '';
    if (!column) return [];
    const pii = isPiiCategory(item.pii) ? item.pii : 'none';
    const classification = isDataClassification(item.classification) ? item.classification : PII_CLASSIFICATION[pii];
    const confidence: ClassificationConfidence = item.confidence === 'high' || item.confidence === 'medium' ? item.confidence : 'low';
    const reason: ColumnClassification['reason'] = item.reason === 'value-match' || item.reason === 'name-match' ? item.reason : 'default';
    return [{
      column, classification, pii, confidence, reason,
      masked: typeof item.masked === 'boolean' ? item.masked : ALWAYS_MASKED.has(pii),
    }];
  });
}

// ---------------------------------------------------------------------------
// Masking
// ---------------------------------------------------------------------------

/**
 * Mask ONE cell for its category.
 *
 * Shape is preserved where it carries meaning a reviewer needs — the domain of
 * an email, the last four of a card — because a column of identical `••••`
 * cells tells you nothing about whether the join you are about to write is
 * right. Credentials keep nothing.
 */
export function maskCell(value: TabularCell | undefined, pii: PiiCategory): TabularCell {
  const text = cellText(value);
  if (!text) return '';
  switch (pii) {
    case 'credentials': return '••••••••';
    case 'email': {
      const at = text.indexOf('@');
      return at > 0 ? `${text.slice(0, 1)}•••@${text.slice(at + 1)}` : '•••';
    }
    case 'phone':
    case 'financial':
    case 'government_id': {
      const digits = text.replace(/\D/g, '');
      return digits.length > 4 ? `••••${digits.slice(-4)}` : '••••';
    }
    case 'date_of_birth': {
      const year = text.match(/\b(19|20)\d{2}\b/);
      return year ? `${year[0]}-••-••` : '••••';
    }
    case 'name': {
      const initials = text.split(/\s+/).filter(Boolean).map((part) => part[0]?.toUpperCase() ?? '').join('');
      return initials ? `${initials}•••` : '•••';
    }
    case 'ip_address': {
      const parts = text.split('.');
      return parts.length === 4 ? `${parts[0]}.${parts[1]}.•.•` : '•••';
    }
    case 'address': return text.slice(0, 3) + '•••';
    case 'health': return '•••';
    default: return text;
  }
}

/** Columns that must be masked, as a lookup the render path can hold. */
export function maskPlan(list: readonly ColumnClassification[]): Map<string, PiiCategory> {
  return new Map(list.filter((item) => item.masked && item.pii !== 'none').map((item) => [item.column, item.pii]));
}

/**
 * Masked projection of a source. Returns the SAME object when nothing is
 * masked, so the common path costs nothing and React sees a stable reference.
 */
export function maskTabular(source: TabularSource, list: readonly ColumnClassification[]): TabularSource {
  const plan = maskPlan(list);
  if (!plan.size) return source;
  return {
    columns: source.columns,
    rows: source.rows.map((row) => {
      const next: TabularRow = { ...row };
      for (const [column, pii] of plan) {
        if (column in next) next[column] = maskCell(next[column], pii);
      }
      return next;
    }),
  };
}

// ---------------------------------------------------------------------------
// Data contract
// ---------------------------------------------------------------------------

export interface DataContractColumn {
  name: string;
  type: TabularColumnType;
  /** A required column must be present AND non-empty in every row. */
  required?: boolean;
  unique?: boolean;
  description?: string;
  /** Physical unit — "USD", "ms", "kg". Two charts cannot be compared without it. */
  unit?: string;
  allowedValues?: string[];
  min?: number;
  max?: number;
  classification?: DataClassification;
  pii?: PiiCategory;
}

export interface DataContract {
  columns: DataContractColumn[];
  primaryKey?: string[];
  rowCountMin?: number;
  rowCountMax?: number;
  /** Maximum age before the data is considered stale, in hours. */
  freshnessHours?: number;
  version?: number;
  /** ISO timestamp the contract was declared or last amended. */
  declaredAt?: string;
}

export type ContractViolationRule =
  | 'missing-column' | 'unexpected-column' | 'type-drift' | 'required-empty'
  | 'not-unique' | 'out-of-range' | 'disallowed-value' | 'row-count' | 'stale'
  | 'primary-key-empty' | 'primary-key-duplicate';

export interface ContractViolation {
  severity: 'error' | 'warning';
  rule: ContractViolationRule;
  column?: string;
  /** Counts and bounds the UI formats. Never a pre-built sentence. */
  detail: Record<string, string | number>;
}

/** Propose a contract from what a dataset currently IS. The starting point for
 *  "declare this", not a substitute for declaring it. */
export function inferDataContract(
  source: TabularSource,
  profiles: readonly TabularColumnProfile[],
  classifications: readonly ColumnClassification[] = [],
): DataContract {
  const byName = new Map(profiles.map((profile) => [profile.name, profile]));
  const tags = new Map(classifications.map((item) => [item.column, item]));
  const rowCount = source.rows.length;
  const columns: DataContractColumn[] = source.columns.map((name) => {
    const profile = byName.get(name);
    const tag = tags.get(name);
    const filled = profile?.filled ?? 0;
    const distinct = profile?.distinct ?? 0;
    const enumerable = profile && profile.type === 'text' && distinct > 0 && distinct <= 12 && filled >= distinct * 2;
    return {
      name,
      type: profile?.type ?? 'text',
      ...(rowCount > 0 && filled === rowCount ? { required: true } : {}),
      ...(rowCount > 0 && distinct === rowCount && filled === rowCount ? { unique: true } : {}),
      ...(profile && profile.type === 'number' && profile.min != null && profile.max != null ? { min: profile.min, max: profile.max } : {}),
      ...(enumerable ? { allowedValues: profile.topValues.map((entry) => entry.value) } : {}),
      ...(tag ? { classification: tag.classification, pii: tag.pii } : {}),
    };
  });
  // A single fully-populated, fully-distinct column is the natural key. Two of
  // them is ambiguous, so nothing is asserted rather than guessing wrong.
  const keyCandidates = columns.filter((column) => column.unique && column.required).map((column) => column.name);
  return {
    columns,
    ...(keyCandidates.length === 1 ? { primaryKey: keyCandidates } : {}),
    ...(rowCount ? { rowCountMin: Math.max(1, Math.floor(rowCount * 0.5)) } : {}),
    version: 1,
  };
}

export function normalizeDataContract(value: unknown): DataContract | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.columns)) return null;
  const columns = raw.columns.flatMap((item): DataContractColumn[] => {
    if (!item || typeof item !== 'object') return [];
    const column = item as Record<string, unknown>;
    const name = typeof column.name === 'string' ? column.name.trim() : '';
    if (!name) return [];
    const type = CONTRACT_TYPES.has(column.type as TabularColumnType) ? column.type as TabularColumnType : 'text';
    return [{
      name, type,
      ...(column.required === true ? { required: true } : {}),
      ...(column.unique === true ? { unique: true } : {}),
      ...(typeof column.description === 'string' && column.description.trim() ? { description: column.description.trim().slice(0, 400) } : {}),
      ...(typeof column.unit === 'string' && column.unit.trim() ? { unit: column.unit.trim().slice(0, 24) } : {}),
      ...(Array.isArray(column.allowedValues) ? { allowedValues: column.allowedValues.map((entry) => String(entry)).slice(0, 60) } : {}),
      ...(Number.isFinite(Number(column.min)) && column.min != null ? { min: Number(column.min) } : {}),
      ...(Number.isFinite(Number(column.max)) && column.max != null ? { max: Number(column.max) } : {}),
      ...(isDataClassification(column.classification) ? { classification: column.classification } : {}),
      ...(isPiiCategory(column.pii) ? { pii: column.pii } : {}),
    }];
  });
  if (!columns.length) return null;
  const known = new Set(columns.map((column) => column.name));
  const primaryKey = Array.isArray(raw.primaryKey)
    ? raw.primaryKey.map((entry) => String(entry)).filter((entry) => known.has(entry))
    : [];
  return {
    columns,
    ...(primaryKey.length ? { primaryKey } : {}),
    ...(Number.isFinite(Number(raw.rowCountMin)) && raw.rowCountMin != null ? { rowCountMin: Math.max(0, Math.floor(Number(raw.rowCountMin))) } : {}),
    ...(Number.isFinite(Number(raw.rowCountMax)) && raw.rowCountMax != null ? { rowCountMax: Math.max(0, Math.floor(Number(raw.rowCountMax))) } : {}),
    ...(Number.isFinite(Number(raw.freshnessHours)) && raw.freshnessHours != null ? { freshnessHours: Math.max(0, Number(raw.freshnessHours)) } : {}),
    version: Number.isFinite(Number(raw.version)) ? Math.max(1, Math.floor(Number(raw.version))) : 1,
    ...(typeof raw.declaredAt === 'string' ? { declaredAt: raw.declaredAt } : {}),
  };
}

const CONTRACT_TYPES = new Set<TabularColumnType>(['number', 'boolean', 'date', 'text', 'empty']);

/** Rows scanned per column when evaluating value-level rules. Uniqueness and
 *  emptiness are exact; range and allowed-values are exact too — the cap exists
 *  only so a million-row dataset cannot block the main thread indefinitely. */
const CONTRACT_SCAN_LIMIT = 200_000;

/**
 * Hold a source to its contract.
 *
 * Every violation is data, not prose: the UI localizes `rule` and formats
 * `detail`, so the same evaluation reads correctly in five languages and in a
 * Brain tool result.
 */
export function evaluateDataContract(
  source: TabularSource,
  contract: DataContract,
  context: { fetchedAt?: string | null; now?: number } = {},
): ContractViolation[] {
  const violations: ContractViolation[] = [];
  const present = new Set(source.columns);
  const rows = source.rows.length > CONTRACT_SCAN_LIMIT ? source.rows.slice(0, CONTRACT_SCAN_LIMIT) : source.rows;

  for (const column of contract.columns) {
    if (!present.has(column.name)) {
      violations.push({ severity: 'error', rule: 'missing-column', column: column.name, detail: { expected: column.type } });
      continue;
    }
    let empty = 0;
    let outOfRange = 0;
    let disallowed = 0;
    let typeMismatch = 0;
    const seen = new Set<string>();
    let duplicates = 0;
    const allowed = column.allowedValues?.length ? new Set(column.allowedValues.map((value) => value.toLowerCase())) : null;

    for (const row of rows) {
      const raw = row[column.name];
      const text = cellText(raw).trim();
      if (!text) { empty += 1; continue; }
      if (column.unique) {
        const key = text.toLowerCase();
        if (seen.has(key)) duplicates += 1; else seen.add(key);
      }
      if (allowed && !allowed.has(text.toLowerCase())) disallowed += 1;
      if (column.type === 'number') {
        const value = toNumber(raw);
        if (value == null) typeMismatch += 1;
        else if ((column.min != null && value < column.min) || (column.max != null && value > column.max)) outOfRange += 1;
      } else if (column.type === 'date' && Number.isNaN(Date.parse(text))) {
        typeMismatch += 1;
      }
    }

    if (column.required && empty) {
      violations.push({ severity: 'error', rule: 'required-empty', column: column.name, detail: { rows: empty, scanned: rows.length } });
    }
    if (column.unique && duplicates) {
      violations.push({ severity: 'error', rule: 'not-unique', column: column.name, detail: { duplicates, scanned: rows.length } });
    }
    if (typeMismatch) {
      violations.push({ severity: 'warning', rule: 'type-drift', column: column.name, detail: { expected: column.type, rows: typeMismatch, scanned: rows.length } });
    }
    if (outOfRange) {
      violations.push({
        severity: 'warning', rule: 'out-of-range', column: column.name,
        detail: { rows: outOfRange, ...(column.min != null ? { min: column.min } : {}), ...(column.max != null ? { max: column.max } : {}) },
      });
    }
    if (disallowed) {
      violations.push({ severity: 'warning', rule: 'disallowed-value', column: column.name, detail: { rows: disallowed, allowed: (column.allowedValues ?? []).slice(0, 8).join(', ') } });
    }
  }

  const declared = new Set(contract.columns.map((column) => column.name));
  for (const column of source.columns) {
    if (!declared.has(column)) {
      violations.push({ severity: 'warning', rule: 'unexpected-column', column, detail: {} });
    }
  }

  if (contract.primaryKey?.length) {
    const keys = new Set<string>();
    let blank = 0;
    let dupes = 0;
    for (const row of rows) {
      const parts = contract.primaryKey.map((column) => cellText(row[column]).trim());
      if (parts.some((part) => !part)) { blank += 1; continue; }
      const key = parts.join('\u0000').toLowerCase();
      if (keys.has(key)) dupes += 1; else keys.add(key);
    }
    if (blank) violations.push({ severity: 'error', rule: 'primary-key-empty', detail: { rows: blank, key: contract.primaryKey.join(', ') } });
    if (dupes) violations.push({ severity: 'error', rule: 'primary-key-duplicate', detail: { duplicates: dupes, key: contract.primaryKey.join(', ') } });
  }

  const count = source.rows.length;
  if (contract.rowCountMin != null && count < contract.rowCountMin) {
    violations.push({ severity: 'error', rule: 'row-count', detail: { rows: count, min: contract.rowCountMin } });
  }
  if (contract.rowCountMax != null && count > contract.rowCountMax) {
    violations.push({ severity: 'warning', rule: 'row-count', detail: { rows: count, max: contract.rowCountMax } });
  }

  if (contract.freshnessHours != null && context.fetchedAt) {
    const stamped = Date.parse(context.fetchedAt);
    if (!Number.isNaN(stamped)) {
      const ageHours = ((context.now ?? Date.now()) - stamped) / 3_600_000;
      if (ageHours > contract.freshnessHours) {
        violations.push({ severity: 'warning', rule: 'stale', detail: { ageHours: Math.round(ageHours), slaHours: contract.freshnessHours } });
      }
    }
  }

  return violations;
}

export function contractVerdict(violations: readonly ContractViolation[]): 'pass' | 'warn' | 'fail' {
  if (violations.some((violation) => violation.severity === 'error')) return 'fail';
  return violations.length ? 'warn' : 'pass';
}

function cellText(value: TabularCell | undefined): string {
  return typeof value === 'number' ? String(value) : (value ?? '').toString();
}
