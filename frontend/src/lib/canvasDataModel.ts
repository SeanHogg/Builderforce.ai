/**
 * The Creation Canvas data model — entities, attributes, keys, relationships.
 *
 * THE POINT: IDEA → REAL.
 * A drawn diagram is a picture; a MODEL is something you can validate, generate
 * DDL from, and diff against a live database. This module is the model. "Create
 * me an ERD" ends with executable `CREATE TABLE` statements and a normalization
 * verdict, not a box-and-line drawing that has to be retyped by a human before
 * anything exists.
 *
 * It is deliberately dialect-neutral in the middle and dialect-aware only at the
 * edges: one canonical logical type per attribute, one `dataModelDdl(model,
 * dialect)` that lowers it. A new dialect is a row in {@link DIALECT_TYPES}, not
 * a branch through the generator.
 *
 * THREE WAYS A MODEL COMES INTO EXISTENCE, all landing on the same shape:
 *   • authored      — Brain writes entities/relationships from a description
 *   • inferred      — {@link dataModelFromTabular} reads an uploaded dataset
 *   • reverse-engineered — {@link dataModelFromIntrospection} reads a live
 *                          database's schema through the data-source port
 *
 * The governance vocabulary is IMPORTED, never restated: an attribute's
 * classification is the same `DataClassification` a dataset column carries, so a
 * PII tag survives the trip from CSV → model → DDL comment.
 */

import { isDataClassification, isPiiCategory, type DataClassification, type PiiCategory } from './canvasDataGovernance';
import type { TabularColumnProfile } from './canvasTabularData';

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** Canonical logical types. Physical types are a dialect concern — see
 *  {@link DIALECT_TYPES}. */
export const DATA_MODEL_TYPES = [
  'uuid', 'string', 'text', 'integer', 'bigint', 'decimal', 'float',
  'boolean', 'date', 'timestamp', 'json', 'enum', 'binary',
] as const;
export type DataModelType = typeof DATA_MODEL_TYPES[number];

export const SQL_DIALECTS = ['postgres', 'mysql', 'sqlite', 'bigquery'] as const;
export type SqlDialect = typeof SQL_DIALECTS[number];

export const DATA_MODEL_CARDINALITIES = ['one-to-one', 'one-to-many', 'many-to-one', 'many-to-many'] as const;
export type DataModelCardinality = typeof DATA_MODEL_CARDINALITIES[number];

export interface DataModelAttribute {
  name: string;
  type: DataModelType;
  /** Absent means NOT NULL. Modelling defaults to required, because a nullable
   *  column is a decision and should read as one. */
  nullable?: boolean;
  primaryKey?: boolean;
  unique?: boolean;
  description?: string;
  /** Physical unit — "USD", "ms". Carried into the DDL as a comment. */
  unit?: string;
  enumValues?: string[];
  defaultValue?: string;
  classification?: DataClassification;
  pii?: PiiCategory;
  /** Foreign key target. The relationship list is derived from these when the
   *  author does not state relationships separately. */
  references?: { entity: string; attribute: string };
}

export interface DataModelEntity {
  name: string;
  description?: string;
  attributes: DataModelAttribute[];
  /** Composite key. A single-attribute key is expressed with `primaryKey` on
   *  the attribute instead; both are honoured, and {@link entityKey} is the one
   *  reader so nothing has to check twice. */
  primaryKey?: string[];
  classification?: DataClassification;
}

export interface DataModelRelationship {
  name?: string;
  from: { entity: string; attributes: string[] };
  to: { entity: string; attributes: string[] };
  cardinality: DataModelCardinality;
  /** True when the child side may be absent (a nullable FK). */
  optional?: boolean;
  description?: string;
}

export interface DataModel {
  entities: DataModelEntity[];
  relationships: DataModelRelationship[];
  dialect?: SqlDialect;
  /** Where the model came from: authored, an uploaded dataset, or a live schema. */
  origin?: 'authored' | 'dataset' | 'introspection';
  notes?: string;
}

export const EMPTY_DATA_MODEL: DataModel = { entities: [], relationships: [] };

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const TYPE_ALIASES: Readonly<Record<string, DataModelType>> = {
  // The spellings a model or a live schema actually produces, folded onto the
  // canonical set. An unrecognized type becomes `string`, never a silent drop.
  varchar: 'string', 'character varying': 'string', char: 'string', nvarchar: 'string', str: 'string',
  int: 'integer', int4: 'integer', integer: 'integer', smallint: 'integer', serial: 'integer', int2: 'integer',
  int8: 'bigint', bigserial: 'bigint', long: 'bigint',
  numeric: 'decimal', money: 'decimal', number: 'decimal',
  real: 'float', float4: 'float', float8: 'float', double: 'float', 'double precision': 'float',
  bool: 'boolean',
  datetime: 'timestamp', 'timestamp without time zone': 'timestamp', 'timestamp with time zone': 'timestamp', timestamptz: 'timestamp',
  jsonb: 'json', object: 'json', record: 'json', struct: 'json',
  bytea: 'binary', blob: 'binary', bytes: 'binary',
  clob: 'text', longtext: 'text', string: 'string',
};

export function normalizeDataModelType(value: unknown): DataModelType {
  const raw = String(value ?? '').trim().toLowerCase().replace(/\(.*$/, '').trim();
  if ((DATA_MODEL_TYPES as readonly string[]).includes(raw)) return raw as DataModelType;
  return TYPE_ALIASES[raw] ?? 'string';
}

/** SQL-safe identifier. Nothing downstream quotes for us, so the model itself
 *  refuses to hold a name that would need it. */
export function normalizeIdentifier(value: unknown, fallback: string): string {
  const cleaned = String(value ?? '').trim().replace(/[^A-Za-z0-9_ .-]/g, '').replace(/[\s.-]+/g, '_').replace(/^_+|_+$/g, '');
  if (!cleaned) return fallback;
  return (/^\d/.test(cleaned) ? `_${cleaned}` : cleaned).slice(0, 63);
}

const MAX_ENTITIES = 60;
const MAX_ATTRIBUTES = 80;
const MAX_RELATIONSHIPS = 200;

function text(value: unknown, max: number): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function attributeNames(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((entry) => normalizeIdentifier(entry, '')).filter(Boolean);
  const single = normalizeIdentifier(value, '');
  return single ? [single] : [];
}

/**
 * Parse anything into a valid model.
 *
 * Total and forgiving on purpose: this is what a language model's JSON lands
 * in. Unknown fields are dropped, unknown types fold to `string`, relationships
 * pointing at entities that do not exist are removed — a model that survives
 * this is one the DDL generator cannot choke on.
 */
export function normalizeDataModel(value: unknown): DataModel {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return EMPTY_DATA_MODEL;
  const raw = value as Record<string, unknown>;
  const rawEntities = Array.isArray(raw.entities) ? raw.entities : Array.isArray(raw.tables) ? raw.tables : [];

  const entities: DataModelEntity[] = [];
  const usedNames = new Set<string>();
  for (const item of rawEntities.slice(0, MAX_ENTITIES)) {
    if (!item || typeof item !== 'object') continue;
    const entity = item as Record<string, unknown>;
    let name = normalizeIdentifier(entity.name ?? entity.table, '');
    if (!name) continue;
    while (usedNames.has(name.toLowerCase())) name = `${name}_2`;
    usedNames.add(name.toLowerCase());

    const rawAttributes = Array.isArray(entity.attributes) ? entity.attributes : Array.isArray(entity.columns) ? entity.columns : [];
    const attributes: DataModelAttribute[] = [];
    const usedAttributes = new Set<string>();
    for (const attributeItem of rawAttributes.slice(0, MAX_ATTRIBUTES)) {
      if (!attributeItem || typeof attributeItem !== 'object') continue;
      const attribute = attributeItem as Record<string, unknown>;
      const attributeName = normalizeIdentifier(attribute.name ?? attribute.column, '');
      if (!attributeName || usedAttributes.has(attributeName.toLowerCase())) continue;
      usedAttributes.add(attributeName.toLowerCase());
      const references = attribute.references && typeof attribute.references === 'object'
        ? attribute.references as Record<string, unknown>
        : null;
      const referenceEntity = references ? normalizeIdentifier(references.entity ?? references.table, '') : '';
      const referenceAttribute = references ? normalizeIdentifier(references.attribute ?? references.column, '') : '';
      const enumValues = Array.isArray(attribute.enumValues)
        ? attribute.enumValues.map((entry) => String(entry).trim()).filter(Boolean).slice(0, 40)
        : [];
      attributes.push({
        name: attributeName,
        type: enumValues.length ? 'enum' : normalizeDataModelType(attribute.type),
        ...(attribute.nullable === true ? { nullable: true } : {}),
        ...(attribute.primaryKey === true || attribute.pk === true ? { primaryKey: true } : {}),
        ...(attribute.unique === true ? { unique: true } : {}),
        ...(text(attribute.description, 400) ? { description: text(attribute.description, 400)! } : {}),
        ...(text(attribute.unit, 24) ? { unit: text(attribute.unit, 24)! } : {}),
        ...(enumValues.length ? { enumValues } : {}),
        ...(text(attribute.defaultValue, 120) ? { defaultValue: text(attribute.defaultValue, 120)! } : {}),
        ...(isDataClassification(attribute.classification) ? { classification: attribute.classification } : {}),
        ...(isPiiCategory(attribute.pii) ? { pii: attribute.pii } : {}),
        ...(referenceEntity && referenceAttribute ? { references: { entity: referenceEntity, attribute: referenceAttribute } } : {}),
      });
    }
    if (!attributes.length) continue;

    const declaredKey = attributeNames(entity.primaryKey).filter((key) => attributes.some((attribute) => attribute.name === key));
    entities.push({
      name,
      ...(text(entity.description, 600) ? { description: text(entity.description, 600)! } : {}),
      attributes,
      ...(declaredKey.length ? { primaryKey: declaredKey } : {}),
      ...(isDataClassification(entity.classification) ? { classification: entity.classification } : {}),
    });
  }

  const known = new Map(entities.map((entity) => [entity.name.toLowerCase(), entity]));
  const rawRelationships = Array.isArray(raw.relationships) ? raw.relationships : [];
  const relationships: DataModelRelationship[] = [];
  for (const item of rawRelationships.slice(0, MAX_RELATIONSHIPS)) {
    if (!item || typeof item !== 'object') continue;
    const relationship = item as Record<string, unknown>;
    const parsed = parseRelationshipSide(relationship.from, known) ;
    const target = parseRelationshipSide(relationship.to, known);
    if (!parsed || !target) continue;
    const cardinality = (DATA_MODEL_CARDINALITIES as readonly string[]).includes(String(relationship.cardinality))
      ? relationship.cardinality as DataModelCardinality
      : 'one-to-many';
    relationships.push({
      ...(text(relationship.name, 120) ? { name: text(relationship.name, 120)! } : {}),
      from: parsed, to: target, cardinality,
      ...(relationship.optional === true ? { optional: true } : {}),
      ...(text(relationship.description, 400) ? { description: text(relationship.description, 400)! } : {}),
    });
  }

  // Foreign keys declared on an attribute are relationships too. Folding them in
  // here means an author can use either style and the ERD renders the same.
  for (const entity of entities) {
    for (const attribute of entity.attributes) {
      if (!attribute.references) continue;
      const target = known.get(attribute.references.entity.toLowerCase());
      if (!target || !target.attributes.some((candidate) => candidate.name === attribute.references!.attribute)) continue;
      const already = relationships.some((relationship) =>
        relationship.from.entity === entity.name && relationship.from.attributes.includes(attribute.name)
        && relationship.to.entity === target.name);
      if (already) continue;
      relationships.push({
        from: { entity: entity.name, attributes: [attribute.name] },
        to: { entity: target.name, attributes: [attribute.references.attribute] },
        cardinality: attribute.unique ? 'one-to-one' : 'many-to-one',
        ...(attribute.nullable ? { optional: true } : {}),
      });
    }
  }

  const dialect = (SQL_DIALECTS as readonly string[]).includes(String(raw.dialect)) ? raw.dialect as SqlDialect : undefined;
  const origin = raw.origin === 'dataset' || raw.origin === 'introspection' || raw.origin === 'authored' ? raw.origin : undefined;
  return {
    entities, relationships,
    ...(dialect ? { dialect } : {}),
    ...(origin ? { origin } : {}),
    ...(text(raw.notes, 2_000) ? { notes: text(raw.notes, 2_000)! } : {}),
  };
}

function parseRelationshipSide(value: unknown, known: Map<string, DataModelEntity>): DataModelRelationship['from'] | null {
  if (typeof value === 'string') {
    const entity = known.get(normalizeIdentifier(value, '').toLowerCase());
    return entity ? { entity: entity.name, attributes: entityKey(entity) } : null;
  }
  if (!value || typeof value !== 'object') return null;
  const side = value as Record<string, unknown>;
  const entity = known.get(normalizeIdentifier(side.entity ?? side.table, '').toLowerCase());
  if (!entity) return null;
  const attributes = attributeNames(side.attributes ?? side.attribute ?? side.columns ?? side.column)
    .filter((name) => entity.attributes.some((attribute) => attribute.name === name));
  return { entity: entity.name, attributes: attributes.length ? attributes : entityKey(entity) };
}

/** THE reader of an entity's key, whichever way it was declared. */
export function entityKey(entity: DataModelEntity): string[] {
  if (entity.primaryKey?.length) return entity.primaryKey;
  const flagged = entity.attributes.filter((attribute) => attribute.primaryKey).map((attribute) => attribute.name);
  return flagged;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type DataModelIssueRule =
  | 'no-primary-key' | 'dangling-reference' | 'many-to-many-needs-junction'
  | 'unresolved-relationship' | 'duplicate-attribute' | 'orphan-entity'
  | 'repeating-group' | 'nullable-key' | 'untyped-enum' | 'unclassified-pii';

export interface DataModelIssue {
  severity: 'error' | 'warning' | 'info';
  rule: DataModelIssueRule;
  entity?: string;
  attribute?: string;
  /** Values the UI interpolates. Never a pre-built sentence — this travels to
   *  five locales and to a Brain tool result. */
  detail: Record<string, string | number>;
}

/** Columns like `phone_1`, `phone_2`, `address2` — the classic 1NF violation. */
const REPEATING_SUFFIX = /^(.*?)[ _-]?(\d{1,2})$/;

/**
 * Structural + normalization review of a model.
 *
 * This is the half that makes an ERD a deliverable rather than a drawing: it
 * says which table has no key, which foreign key points at nothing, and which
 * many-to-many still needs a junction table before any DDL can exist.
 */
export function validateDataModel(model: DataModel): DataModelIssue[] {
  const issues: DataModelIssue[] = [];
  const byName = new Map(model.entities.map((entity) => [entity.name.toLowerCase(), entity]));

  for (const entity of model.entities) {
    const key = entityKey(entity);
    if (!key.length) {
      issues.push({ severity: 'error', rule: 'no-primary-key', entity: entity.name, detail: {} });
    }
    for (const name of key) {
      const attribute = entity.attributes.find((candidate) => candidate.name === name);
      if (attribute?.nullable) {
        issues.push({ severity: 'error', rule: 'nullable-key', entity: entity.name, attribute: name, detail: {} });
      }
    }

    const seen = new Map<string, number>();
    for (const attribute of entity.attributes) {
      seen.set(attribute.name.toLowerCase(), (seen.get(attribute.name.toLowerCase()) ?? 0) + 1);
      if (attribute.references && !byName.has(attribute.references.entity.toLowerCase())) {
        issues.push({
          severity: 'error', rule: 'dangling-reference', entity: entity.name, attribute: attribute.name,
          detail: { target: attribute.references.entity },
        });
      }
      if (attribute.type === 'enum' && !attribute.enumValues?.length) {
        issues.push({ severity: 'warning', rule: 'untyped-enum', entity: entity.name, attribute: attribute.name, detail: {} });
      }
      if (attribute.pii && attribute.pii !== 'none' && !attribute.classification) {
        issues.push({ severity: 'warning', rule: 'unclassified-pii', entity: entity.name, attribute: attribute.name, detail: { pii: attribute.pii } });
      }
    }
    for (const [name, count] of seen) {
      if (count > 1) issues.push({ severity: 'error', rule: 'duplicate-attribute', entity: entity.name, attribute: name, detail: { count } });
    }

    // 1NF: repeating groups. Two or more same-stem numbered attributes is a
    // list flattened into columns, which is exactly what a child table is for.
    const stems = new Map<string, string[]>();
    for (const attribute of entity.attributes) {
      const match = REPEATING_SUFFIX.exec(attribute.name);
      if (!match?.[1]) continue;
      const stem = match[1].toLowerCase();
      stems.set(stem, [...(stems.get(stem) ?? []), attribute.name]);
    }
    for (const [stem, names] of stems) {
      if (names.length >= 2) {
        issues.push({ severity: 'warning', rule: 'repeating-group', entity: entity.name, detail: { stem, columns: names.join(', ') } });
      }
    }
  }

  for (const relationship of model.relationships) {
    const from = byName.get(relationship.from.entity.toLowerCase());
    const to = byName.get(relationship.to.entity.toLowerCase());
    if (!from || !to) {
      issues.push({
        severity: 'error', rule: 'unresolved-relationship',
        detail: { from: relationship.from.entity, to: relationship.to.entity },
      });
      continue;
    }
    if (relationship.cardinality === 'many-to-many') {
      issues.push({
        severity: 'warning', rule: 'many-to-many-needs-junction',
        detail: { from: from.name, to: to.name, junction: junctionName(from.name, to.name) },
      });
    }
  }

  const connected = new Set(model.relationships.flatMap((relationship) => [relationship.from.entity, relationship.to.entity]));
  if (model.entities.length > 1) {
    for (const entity of model.entities) {
      if (!connected.has(entity.name)) {
        issues.push({ severity: 'info', rule: 'orphan-entity', entity: entity.name, detail: {} });
      }
    }
  }

  return issues;
}

export function junctionName(left: string, right: string): string {
  return normalizeIdentifier(`${left}_${right}`, 'junction');
}

/**
 * Resolve every many-to-many into a real junction entity.
 *
 * This is the fix half of the warning above, and it is what lets "create me an
 * ERD" end in DDL that actually runs: a many-to-many cannot be expressed as a
 * table, so the model is rewritten before it is lowered.
 */
export function resolveManyToMany(model: DataModel): DataModel {
  const many = model.relationships.filter((relationship) => relationship.cardinality === 'many-to-many');
  if (!many.length) return model;
  const byName = new Map(model.entities.map((entity) => [entity.name.toLowerCase(), entity]));
  const entities = [...model.entities];
  const relationships = model.relationships.filter((relationship) => relationship.cardinality !== 'many-to-many');

  for (const relationship of many) {
    const from = byName.get(relationship.from.entity.toLowerCase());
    const to = byName.get(relationship.to.entity.toLowerCase());
    if (!from || !to) continue;
    const name = junctionName(from.name, to.name);
    if (entities.some((entity) => entity.name.toLowerCase() === name.toLowerCase())) continue;
    const leftKey = keyAttributes(from);
    const rightKey = keyAttributes(to);
    if (!leftKey.length || !rightKey.length) continue;
    const attributes: DataModelAttribute[] = [
      ...leftKey.map((attribute) => junctionAttribute(from.name, attribute)),
      ...rightKey.map((attribute) => junctionAttribute(to.name, attribute)),
    ];
    entities.push({
      name,
      description: `Junction resolving ${from.name} ↔ ${to.name}.`,
      attributes,
      primaryKey: attributes.map((attribute) => attribute.name),
    });
    relationships.push(
      { from: { entity: name, attributes: leftKey.map((attribute) => junctionAttributeName(from.name, attribute)) }, to: { entity: from.name, attributes: leftKey.map((attribute) => attribute.name) }, cardinality: 'many-to-one' },
      { from: { entity: name, attributes: rightKey.map((attribute) => junctionAttributeName(to.name, attribute)) }, to: { entity: to.name, attributes: rightKey.map((attribute) => attribute.name) }, cardinality: 'many-to-one' },
    );
  }
  return { ...model, entities, relationships };
}

function keyAttributes(entity: DataModelEntity): DataModelAttribute[] {
  const key = entityKey(entity);
  return entity.attributes.filter((attribute) => key.includes(attribute.name));
}

function junctionAttributeName(entityName: string, attribute: DataModelAttribute): string {
  return normalizeIdentifier(`${entityName}_${attribute.name}`, 'ref');
}

function junctionAttribute(entityName: string, attribute: DataModelAttribute): DataModelAttribute {
  return {
    name: junctionAttributeName(entityName, attribute),
    type: attribute.type,
    primaryKey: true,
    references: { entity: entityName, attribute: attribute.name },
  };
}

// ---------------------------------------------------------------------------
// DDL
// ---------------------------------------------------------------------------

/** Physical type per dialect. A new dialect is one row here. */
const DIALECT_TYPES: Record<SqlDialect, Record<DataModelType, string>> = {
  postgres: {
    uuid: 'UUID', string: 'VARCHAR(255)', text: 'TEXT', integer: 'INTEGER', bigint: 'BIGINT',
    decimal: 'NUMERIC(18,2)', float: 'DOUBLE PRECISION', boolean: 'BOOLEAN', date: 'DATE',
    timestamp: 'TIMESTAMPTZ', json: 'JSONB', enum: 'TEXT', binary: 'BYTEA',
  },
  mysql: {
    uuid: 'CHAR(36)', string: 'VARCHAR(255)', text: 'TEXT', integer: 'INT', bigint: 'BIGINT',
    decimal: 'DECIMAL(18,2)', float: 'DOUBLE', boolean: 'TINYINT(1)', date: 'DATE',
    timestamp: 'DATETIME', json: 'JSON', enum: 'VARCHAR(64)', binary: 'BLOB',
  },
  sqlite: {
    uuid: 'TEXT', string: 'TEXT', text: 'TEXT', integer: 'INTEGER', bigint: 'INTEGER',
    decimal: 'NUMERIC', float: 'REAL', boolean: 'INTEGER', date: 'TEXT',
    timestamp: 'TEXT', json: 'TEXT', enum: 'TEXT', binary: 'BLOB',
  },
  bigquery: {
    uuid: 'STRING', string: 'STRING', text: 'STRING', integer: 'INT64', bigint: 'INT64',
    decimal: 'NUMERIC', float: 'FLOAT64', boolean: 'BOOL', date: 'DATE',
    timestamp: 'TIMESTAMP', json: 'JSON', enum: 'STRING', binary: 'BYTES',
  },
};

/** BigQuery has no primary or foreign keys that are enforced, and no CHECK. Stating
 *  that once here keeps the generator honest instead of emitting DDL that fails. */
const SUPPORTS_CONSTRAINTS: Record<SqlDialect, boolean> = {
  postgres: true, mysql: true, sqlite: true, bigquery: false,
};

function quote(name: string, dialect: SqlDialect): string {
  if (dialect === 'mysql' || dialect === 'bigquery') return `\`${name}\``;
  return `"${name}"`;
}

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Lower a model to executable DDL.
 *
 * Many-to-many is resolved first, so the output is always something a database
 * will accept. Entities are emitted in dependency order where one exists, so the
 * script runs top to bottom without forward references.
 */
export function dataModelDdl(model: DataModel, dialect: SqlDialect = model.dialect ?? 'postgres'): string {
  const resolved = resolveManyToMany(model);
  if (!resolved.entities.length) return '';
  const types = DIALECT_TYPES[dialect];
  const constraints = SUPPORTS_CONSTRAINTS[dialect];
  const ordered = orderByDependency(resolved);
  const statements: string[] = [];

  for (const entity of ordered) {
    const key = entityKey(entity);
    const lines: string[] = [];
    for (const attribute of entity.attributes) {
      const parts = [`  ${quote(attribute.name, dialect)} ${types[attribute.type]}`];
      // A single-attribute key is inlined; a composite one becomes a table
      // constraint below, so the two never both claim the key.
      if (!attribute.nullable || key.includes(attribute.name)) parts.push('NOT NULL');
      if (attribute.defaultValue) parts.push(`DEFAULT ${/^[A-Za-z_][A-Za-z0-9_]*\(/.test(attribute.defaultValue) || /^-?\d/.test(attribute.defaultValue) ? attribute.defaultValue : sqlLiteral(attribute.defaultValue)}`);
      if (constraints && attribute.unique && !key.includes(attribute.name)) parts.push('UNIQUE');
      if (constraints && attribute.type === 'enum' && attribute.enumValues?.length) {
        parts.push(`CHECK (${quote(attribute.name, dialect)} IN (${attribute.enumValues.map(sqlLiteral).join(', ')}))`);
      }
      lines.push(parts.join(' '));
    }
    if (constraints && key.length) {
      lines.push(`  CONSTRAINT ${quote(`pk_${entity.name}`, dialect)} PRIMARY KEY (${key.map((name) => quote(name, dialect)).join(', ')})`);
    }
    if (constraints) {
      for (const relationship of resolved.relationships) {
        if (relationship.from.entity !== entity.name || !relationship.from.attributes.length) continue;
        if (!relationship.to.attributes.length) continue;
        lines.push(
          `  CONSTRAINT ${quote(`fk_${entity.name}_${relationship.to.entity}`, dialect)} `
          + `FOREIGN KEY (${relationship.from.attributes.map((name) => quote(name, dialect)).join(', ')}) `
          + `REFERENCES ${quote(relationship.to.entity, dialect)} (${relationship.to.attributes.map((name) => quote(name, dialect)).join(', ')})`,
        );
      }
    }
    const header = entity.description ? `-- ${entity.description}\n` : '';
    statements.push(`${header}CREATE TABLE ${quote(entity.name, dialect)} (\n${dedupe(lines).join(',\n')}\n);`);
  }

  // Column documentation, including the governance tags. Postgres is the only
  // dialect here with COMMENT ON; the others carry it as a leading comment so
  // the intent is never lost, just expressed differently.
  const comments: string[] = [];
  for (const entity of ordered) {
    for (const attribute of entity.attributes) {
      const note = [attribute.description, attribute.unit ? `Unit: ${attribute.unit}` : '', attribute.pii && attribute.pii !== 'none' ? `PII: ${attribute.pii}` : '', attribute.classification ? `Classification: ${attribute.classification}` : '']
        .filter(Boolean).join(' · ');
      if (!note) continue;
      comments.push(dialect === 'postgres'
        ? `COMMENT ON COLUMN ${quote(entity.name, dialect)}.${quote(attribute.name, dialect)} IS ${sqlLiteral(note)};`
        : `-- ${entity.name}.${attribute.name}: ${note}`);
    }
  }

  const preamble = dialect === 'bigquery'
    ? '-- BigQuery does not enforce primary or foreign keys; relationships are documented below.\n'
    : '';
  return [preamble + statements.join('\n\n'), comments.join('\n')].filter(Boolean).join('\n\n') + '\n';
}

function dedupe(lines: string[]): string[] {
  return [...new Set(lines)];
}

/** Parents before children, so the DDL script runs in one pass. Cycles keep
 *  their declared order rather than looping forever. */
function orderByDependency(model: DataModel): DataModelEntity[] {
  const byName = new Map(model.entities.map((entity) => [entity.name, entity]));
  const dependencies = new Map<string, Set<string>>(model.entities.map((entity) => [entity.name, new Set<string>()]));
  for (const relationship of model.relationships) {
    if (relationship.from.entity === relationship.to.entity) continue;
    dependencies.get(relationship.from.entity)?.add(relationship.to.entity);
  }
  const ordered: DataModelEntity[] = [];
  const placed = new Set<string>();
  const visiting = new Set<string>();
  const visit = (name: string) => {
    if (placed.has(name) || visiting.has(name)) return;
    visiting.add(name);
    for (const dependency of dependencies.get(name) ?? []) {
      if (byName.has(dependency)) visit(dependency);
    }
    visiting.delete(name);
    const entity = byName.get(name);
    if (entity) { ordered.push(entity); placed.add(name); }
  };
  for (const entity of model.entities) visit(entity.name);
  return ordered;
}

/** Mermaid `erDiagram` source — the portable picture of the same model. */
export function dataModelMermaid(model: DataModel): string {
  const lines = ['erDiagram'];
  for (const relationship of model.relationships) {
    const notation = MERMAID_CARDINALITY[relationship.cardinality];
    const label = relationship.name ?? relationship.cardinality.replace(/-/g, ' ');
    lines.push(`  ${relationship.from.entity} ${notation} ${relationship.to.entity} : "${label.replace(/"/g, "'")}"`);
  }
  for (const entity of model.entities) {
    const key = entityKey(entity);
    lines.push(`  ${entity.name} {`);
    for (const attribute of entity.attributes) {
      const marks = [key.includes(attribute.name) ? 'PK' : '', attribute.references ? 'FK' : '', attribute.unique && !key.includes(attribute.name) ? 'UK' : ''].filter(Boolean).join(',');
      lines.push(`    ${attribute.type} ${attribute.name}${marks ? ` ${marks}` : ''}`);
    }
    lines.push('  }');
  }
  return lines.join('\n');
}

const MERMAID_CARDINALITY: Record<DataModelCardinality, string> = {
  'one-to-one': '||--||',
  'one-to-many': '||--o{',
  'many-to-one': '}o--||',
  'many-to-many': '}o--o{',
};

// ---------------------------------------------------------------------------
// Inference — the two REAL → model directions
// ---------------------------------------------------------------------------

const PROFILE_TYPE: Record<string, DataModelType> = {
  number: 'decimal', boolean: 'boolean', date: 'timestamp', text: 'string', empty: 'string',
};

/**
 * Infer an entity from an uploaded dataset's profile.
 *
 * The bridge from "I dropped a CSV on the board" to a model that can be
 * normalized, reviewed, and turned into tables — which is the whole IDEA → REAL
 * path for someone who starts with a spreadsheet rather than a description.
 */
export function dataModelFromTabular(
  entityName: string,
  profiles: readonly TabularColumnProfile[],
  rowCount: number,
  classifications: ReadonlyArray<{ column: string; classification?: DataClassification; pii?: PiiCategory }> = [],
): DataModel {
  const tags = new Map(classifications.map((item) => [item.column, item]));
  const attributes: DataModelAttribute[] = profiles.map((profile) => {
    const tag = tags.get(profile.name);
    const unique = rowCount > 0 && profile.distinct === rowCount && profile.filled === rowCount;
    const enumerable = profile.type === 'text' && profile.distinct > 0 && profile.distinct <= 12 && profile.filled >= profile.distinct * 2;
    return {
      name: normalizeIdentifier(profile.name, 'column'),
      type: enumerable ? 'enum' : (PROFILE_TYPE[profile.type] ?? 'string'),
      ...(profile.filled < rowCount ? { nullable: true } : {}),
      ...(unique ? { unique: true } : {}),
      ...(enumerable ? { enumValues: profile.topValues.map((entry) => entry.value) } : {}),
      ...(tag?.classification ? { classification: tag.classification } : {}),
      ...(tag?.pii ? { pii: tag.pii } : {}),
    };
  });
  // The first unique, fully-populated column is the natural key; an `id`-shaped
  // name wins over any other. Nothing is invented when neither exists — that is
  // exactly the `no-primary-key` issue the review is supposed to raise.
  const keyed = attributes.find((attribute) => attribute.unique && /(^|_)id$/i.test(attribute.name))
    ?? attributes.find((attribute) => attribute.unique && !attribute.nullable);
  if (keyed) { keyed.primaryKey = true; delete keyed.unique; }
  return normalizeDataModel({
    entities: [{ name: normalizeIdentifier(entityName, 'imported_data'), attributes }],
    relationships: [],
    origin: 'dataset',
  });
}

/** One table as the data-source port reports it. Mirrors `DataSourceTable`
 *  server-side; declared here so the frontend has no import across the boundary. */
export interface IntrospectedTable {
  name: string;
  schema?: string;
  columns: Array<{ name: string; type: string; nullable?: boolean; primaryKey?: boolean }>;
}

export interface IntrospectedRelationship {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
}

/** REAL → model: build an ERD from a live database's schema. */
export function dataModelFromIntrospection(
  tables: readonly IntrospectedTable[],
  relationships: readonly IntrospectedRelationship[] = [],
): DataModel {
  return normalizeDataModel({
    origin: 'introspection',
    entities: tables.map((table) => ({
      name: table.name,
      ...(table.schema && table.schema !== 'public' ? { description: `Schema: ${table.schema}` } : {}),
      attributes: table.columns.map((column) => ({
        name: column.name,
        type: normalizeDataModelType(column.type),
        ...(column.nullable ? { nullable: true } : {}),
        ...(column.primaryKey ? { primaryKey: true } : {}),
      })),
    })),
    relationships: relationships.map((relationship) => ({
      from: { entity: relationship.fromTable, attributes: [relationship.fromColumn] },
      to: { entity: relationship.toTable, attributes: [relationship.toColumn] },
      cardinality: 'many-to-one',
    })),
  });
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

export interface DataModelLayoutEntity {
  entity: DataModelEntity;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DataModelLayout {
  entities: DataModelLayoutEntity[];
  edges: Array<{ relationship: DataModelRelationship; from: DataModelLayoutEntity; to: DataModelLayoutEntity }>;
  width: number;
  height: number;
}

const CARD_WIDTH = 208;
const ROW_HEIGHT = 17;
const HEADER_HEIGHT = 30;
const GAP_X = 60;
const GAP_Y = 40;

/**
 * Deterministic grid layout for the ERD card.
 *
 * Deterministic matters: the diagram must not reshuffle every render, and two
 * people looking at the same board must see the same picture.
 */
export function dataModelLayout(model: DataModel, maxWidth = 1_000): DataModelLayout {
  const columns = Math.max(1, Math.min(4, Math.floor(maxWidth / (CARD_WIDTH + GAP_X)) || 1));
  const placed: DataModelLayoutEntity[] = [];
  const columnHeights = new Array(columns).fill(0) as number[];
  for (const entity of model.entities) {
    const height = HEADER_HEIGHT + Math.max(1, entity.attributes.length) * ROW_HEIGHT + 8;
    let shortest = 0;
    for (let index = 1; index < columns; index += 1) {
      if ((columnHeights[index] ?? 0) < (columnHeights[shortest] ?? 0)) shortest = index;
    }
    placed.push({
      entity,
      x: shortest * (CARD_WIDTH + GAP_X),
      y: columnHeights[shortest] ?? 0,
      width: CARD_WIDTH,
      height,
    });
    columnHeights[shortest] = (columnHeights[shortest] ?? 0) + height + GAP_Y;
  }
  const byName = new Map(placed.map((item) => [item.entity.name, item]));
  const edges = model.relationships.flatMap((relationship) => {
    const from = byName.get(relationship.from.entity);
    const to = byName.get(relationship.to.entity);
    return from && to && from !== to ? [{ relationship, from, to }] : [];
  });
  return {
    entities: placed,
    edges,
    width: Math.min(columns, Math.max(1, placed.length)) * (CARD_WIDTH + GAP_X) - GAP_X,
    height: Math.max(0, ...columnHeights.map((height) => height - GAP_Y)),
  };
}

export interface DataModelSummary {
  entities: number;
  attributes: number;
  relationships: number;
  keyed: number;
  errors: number;
  warnings: number;
  piiAttributes: number;
}

export function dataModelSummary(model: DataModel, issues: readonly DataModelIssue[] = validateDataModel(model)): DataModelSummary {
  return {
    entities: model.entities.length,
    attributes: model.entities.reduce((total, entity) => total + entity.attributes.length, 0),
    relationships: model.relationships.length,
    keyed: model.entities.filter((entity) => entityKey(entity).length > 0).length,
    errors: issues.filter((issue) => issue.severity === 'error').length,
    warnings: issues.filter((issue) => issue.severity === 'warning').length,
    piiAttributes: model.entities.reduce((total, entity) => total + entity.attributes.filter((attribute) => attribute.pii && attribute.pii !== 'none').length, 0),
  };
}

/** Read a model off a canvas object, whichever field it was written to. */
export function readDataModel(data: Record<string, unknown>): DataModel {
  return normalizeDataModel(data.dataModel ?? data.model ?? data);
}
