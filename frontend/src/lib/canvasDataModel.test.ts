/**
 * The data model's contract: what "create me an ERD" is allowed to produce.
 *
 * These assertions are the verdict a change to the model, the validator or the
 * DDL generator has to pass — the point of the whole feature is that the output
 * is EXECUTABLE, so the tests care about the SQL as much as about the shape.
 */
import { describe, expect, it } from 'vitest';
import {
  dataModelFromIntrospection,
  dataModelFromTabular,
  dataModelSummary,
  entityKey,
  normalizeDataModel,
  resolveManyToMany,
  validateDataModel,
} from './canvasDataModel';
import { dataModelDdl, dataModelMermaid } from './canvasDataModelDdl';
import { profileTabular } from './canvasTabularData';

const CUSTOMERS_ORDERS = {
  entities: [
    { name: 'customer', attributes: [
      { name: 'id', type: 'uuid', primaryKey: true },
      { name: 'email', type: 'string', unique: true, pii: 'email', classification: 'confidential' },
      { name: 'signed_up_at', type: 'timestamp' },
    ] },
    { name: 'order', attributes: [
      { name: 'id', type: 'uuid', primaryKey: true },
      { name: 'customer_id', type: 'uuid', references: { entity: 'customer', attribute: 'id' } },
      { name: 'total', type: 'decimal', unit: 'USD' },
      { name: 'status', type: 'enum', enumValues: ['pending', 'paid', 'refunded'] },
    ] },
  ],
  relationships: [],
};

describe('normalizeDataModel', () => {
  it('folds attribute foreign keys into relationships', () => {
    const model = normalizeDataModel(CUSTOMERS_ORDERS);
    expect(model.entities).toHaveLength(2);
    expect(model.relationships).toHaveLength(1);
    expect(model.relationships[0]).toMatchObject({
      from: { entity: 'order', attributes: ['customer_id'] },
      to: { entity: 'customer', attributes: ['id'] },
      cardinality: 'many-to-one',
    });
  });

  it('drops relationships that name an entity the model does not have', () => {
    const model = normalizeDataModel({
      ...CUSTOMERS_ORDERS,
      relationships: [{ from: { entity: 'order' }, to: { entity: 'warehouse' }, cardinality: 'many-to-one' }],
    });
    expect(model.relationships.every((relationship) => relationship.to.entity !== 'warehouse')).toBe(true);
  });

  it('refuses identifiers that would need quoting, rather than emitting broken DDL', () => {
    const model = normalizeDataModel({ entities: [{ name: 'order lines; DROP TABLE x', attributes: [{ name: 'id', type: 'uuid', primaryKey: true }] }] });
    expect(model.entities[0]!.name).toBe('order_lines_DROP_TABLE_x');
  });

  it('folds unknown physical types onto the canonical set instead of dropping the column', () => {
    const model = normalizeDataModel({ entities: [{ name: 't', attributes: [
      { name: 'a', type: 'character varying' },
      { name: 'b', type: 'int8' },
      { name: 'c', type: 'timestamptz' },
      { name: 'd', type: 'something_unheard_of' },
    ] }] });
    expect(model.entities[0]!.attributes.map((attribute) => attribute.type)).toEqual(['string', 'bigint', 'timestamp', 'string']);
  });
});

describe('validateDataModel', () => {
  it('is silent on a well-formed model', () => {
    const issues = validateDataModel(normalizeDataModel(CUSTOMERS_ORDERS));
    expect(issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('reports an entity with no primary key', () => {
    const model = normalizeDataModel({ entities: [{ name: 'event', attributes: [{ name: 'name', type: 'string' }] }] });
    expect(validateDataModel(model).map((issue) => issue.rule)).toContain('no-primary-key');
  });

  it('reports a repeating group — the classic 1NF violation', () => {
    const model = normalizeDataModel({ entities: [{ name: 'contact', attributes: [
      { name: 'id', type: 'uuid', primaryKey: true },
      { name: 'phone_1', type: 'string' },
      { name: 'phone_2', type: 'string' },
    ] }] });
    const issue = validateDataModel(model).find((candidate) => candidate.rule === 'repeating-group');
    expect(issue?.detail.stem).toBe('phone');
  });

  it('flags a nullable primary key as an error, not a warning', () => {
    const model = normalizeDataModel({ entities: [{ name: 'x', attributes: [{ name: 'id', type: 'uuid', primaryKey: true, nullable: true }] }] });
    expect(validateDataModel(model).find((issue) => issue.rule === 'nullable-key')?.severity).toBe('error');
  });

  it('flags personal data that carries no classification', () => {
    const model = normalizeDataModel({ entities: [{ name: 'p', attributes: [
      { name: 'id', type: 'uuid', primaryKey: true },
      { name: 'email', type: 'string', pii: 'email' },
    ] }] });
    expect(validateDataModel(model).map((issue) => issue.rule)).toContain('unclassified-pii');
  });
});

describe('resolveManyToMany', () => {
  it('creates a junction entity with a composite key of both sides', () => {
    const model = normalizeDataModel({
      entities: [
        { name: 'student', attributes: [{ name: 'id', type: 'uuid', primaryKey: true }] },
        { name: 'course', attributes: [{ name: 'id', type: 'uuid', primaryKey: true }] },
      ],
      relationships: [{ from: { entity: 'student' }, to: { entity: 'course' }, cardinality: 'many-to-many' }],
    });
    const resolved = resolveManyToMany(model);
    const junction = resolved.entities.find((entity) => entity.name === 'student_course');
    expect(junction).toBeDefined();
    expect(entityKey(junction!)).toEqual(['student_id', 'course_id']);
    // The unresolvable relationship is gone; two resolvable ones replace it.
    expect(resolved.relationships.some((relationship) => relationship.cardinality === 'many-to-many')).toBe(false);
    expect(resolved.relationships).toHaveLength(2);
  });
});

describe('dataModelDdl', () => {
  it('emits executable postgres DDL with keys, foreign keys and enum checks', () => {
    const ddl = dataModelDdl(normalizeDataModel(CUSTOMERS_ORDERS), 'postgres');
    expect(ddl).toContain('CREATE TABLE "customer"');
    expect(ddl).toContain('CONSTRAINT "pk_customer" PRIMARY KEY ("id")');
    expect(ddl).toContain('FOREIGN KEY ("customer_id") REFERENCES "customer" ("id")');
    expect(ddl).toContain(`CHECK ("status" IN ('pending', 'paid', 'refunded'))`);
    // Governance survives the trip from model to database.
    expect(ddl).toContain('COMMENT ON COLUMN "customer"."email"');
    expect(ddl).toContain('PII: email');
  });

  it('orders parents before children so the script runs top to bottom', () => {
    const ddl = dataModelDdl(normalizeDataModel(CUSTOMERS_ORDERS), 'postgres');
    expect(ddl.indexOf('CREATE TABLE "customer"')).toBeLessThan(ddl.indexOf('CREATE TABLE "order"'));
  });

  it('omits constraints BigQuery does not enforce rather than emitting DDL that fails', () => {
    const ddl = dataModelDdl(normalizeDataModel(CUSTOMERS_ORDERS), 'bigquery');
    expect(ddl).toContain('`customer`');
    expect(ddl).toContain('STRING');
    expect(ddl).not.toContain('PRIMARY KEY');
    expect(ddl).not.toContain('FOREIGN KEY');
  });

  it('resolves a many-to-many into a real table before generating', () => {
    const ddl = dataModelDdl(normalizeDataModel({
      entities: [
        { name: 'student', attributes: [{ name: 'id', type: 'uuid', primaryKey: true }] },
        { name: 'course', attributes: [{ name: 'id', type: 'uuid', primaryKey: true }] },
      ],
      relationships: [{ from: { entity: 'student' }, to: { entity: 'course' }, cardinality: 'many-to-many' }],
    }), 'postgres');
    expect(ddl).toContain('CREATE TABLE "student_course"');
  });

  it('quotes string defaults and passes through function defaults untouched', () => {
    const ddl = dataModelDdl(normalizeDataModel({ entities: [{ name: 't', attributes: [
      { name: 'id', type: 'uuid', primaryKey: true, defaultValue: 'gen_random_uuid()' },
      { name: 'state', type: 'string', defaultValue: 'new' },
    ] }] }), 'postgres');
    expect(ddl).toContain('DEFAULT gen_random_uuid()');
    expect(ddl).toContain("DEFAULT 'new'");
  });
});

describe('dataModelMermaid', () => {
  it('marks keys and foreign keys', () => {
    const mermaid = dataModelMermaid(normalizeDataModel(CUSTOMERS_ORDERS));
    expect(mermaid.startsWith('erDiagram')).toBe(true);
    expect(mermaid).toContain('uuid id PK');
    expect(mermaid).toContain('uuid customer_id FK');
    expect(mermaid).toContain('order }o--|| customer');
  });
});

describe('dataModelFromTabular', () => {
  it('reads types, nullability and the natural key off real rows', () => {
    const source = {
      columns: ['user_id', 'email', 'age', 'note'],
      rows: [
        { user_id: 'u1', email: 'a@example.com', age: 31, note: 'x' },
        { user_id: 'u2', email: 'b@example.com', age: 42, note: '' },
      ],
    };
    const model = dataModelFromTabular('people', profileTabular(source), source.rows.length);
    const entity = model.entities[0]!;
    expect(entity.name).toBe('people');
    expect(entityKey(entity)).toEqual(['user_id']);
    expect(entity.attributes.find((attribute) => attribute.name === 'age')?.type).toBe('decimal');
    // `note` is empty on one row, so it is nullable — inferred, not assumed.
    expect(entity.attributes.find((attribute) => attribute.name === 'note')?.nullable).toBe(true);
  });

  it('asserts no key when no column is a candidate, so the validator can say so', () => {
    const source = { columns: ['city'], rows: [{ city: 'Detroit' }, { city: 'Detroit' }] };
    const model = dataModelFromTabular('places', profileTabular(source), 2);
    expect(entityKey(model.entities[0]!)).toEqual([]);
    expect(validateDataModel(model).map((issue) => issue.rule)).toContain('no-primary-key');
  });
});

describe('dataModelFromIntrospection', () => {
  it('builds a model from a live schema, keys and foreign keys included', () => {
    const model = dataModelFromIntrospection(
      [
        { name: 'customer', schema: 'public', columns: [{ name: 'id', type: 'uuid', primaryKey: true }, { name: 'email', type: 'character varying', nullable: true }] },
        { name: 'order', schema: 'public', columns: [{ name: 'id', type: 'uuid', primaryKey: true }, { name: 'customer_id', type: 'uuid' }] },
      ],
      [{ fromTable: 'order', fromColumn: 'customer_id', toTable: 'customer', toColumn: 'id' }],
    );
    expect(model.origin).toBe('introspection');
    expect(dataModelSummary(model).entities).toBe(2);
    expect(model.relationships).toHaveLength(1);
    expect(model.entities.find((entity) => entity.name === 'customer')!.attributes[1]!.type).toBe('string');
  });
});
