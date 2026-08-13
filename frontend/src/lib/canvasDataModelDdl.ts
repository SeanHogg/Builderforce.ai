/**
 * Lowering a data model to a TARGET — SQL DDL and Mermaid.
 *
 * Split from `canvasDataModel` along the seam that matters: that module owns what
 * a model IS (parse, validate, infer, lay out); this one owns what a model
 * BECOMES. The two have different reasons to change — a new normalization rule
 * touches the model, a new database touches only this file — and keeping them
 * apart is what makes "add MySQL support" a row in {@link DIALECT_TYPES} rather
 * than a branch through the validator.
 *
 * The generator is deliberately total: {@link dataModelDdl} resolves every
 * many-to-many into a junction table first, so its output is always something a
 * database will accept rather than a diagram that has to be fixed by hand.
 */

import {
  entityKey,
  resolveManyToMany,
  type DataModel,
  type DataModelCardinality,
  type DataModelEntity,
  type DataModelType,
  type SqlDialect,
} from './canvasDataModel';

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