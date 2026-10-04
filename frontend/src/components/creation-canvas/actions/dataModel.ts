/** The data model — author one from the board's datasets, export it as DDL. */
import type { BrainAction } from '@seanhogg/builderforce-brain-embedded';
import { DATA_MODEL_CARDINALITIES, DATA_MODEL_TYPES, type DataModel, dataModelFromTabular, dataModelSummary, entityKey, normalizeDataModel, readDataModel, SQL_DIALECTS, type SqlDialect, validateDataModel } from '@/lib/canvasDataModel';
import { classifyTabular, DATA_CLASSIFICATIONS, normalizeClassifications, PII_CATEGORIES } from '@/lib/canvasDataGovernance';
import { profileTabular, tabularFromObject } from '@/lib/canvasTabularData';
import { dataModelDdl, dataModelMermaid } from '@/lib/canvasDataModelDdl';
import { lineagePatch } from '@/lib/canvasLineage';
import { sanitizeCreationObjectPatch } from '../creationObjectRegistry';
import type { CanvasActionContext } from './context';

export function canvasDataModelActions(ctx: CanvasActionContext): BrainAction[] {
  const { canEdit, stage } = ctx;
  return [  {
    /**
     * "Create me an ERD" — the headline of IDEA → REAL for data.
     *
     * A dedicated tool rather than `canvas_add_object` with hand-authored fields,
     * for the same reason `canvas_add_inbox` is: what comes back must be REAL. The
     * model authors entities and relationships; this validates them, resolves every
     * many-to-many into a junction table, and generates executable DDL — so the
     * answer to "create me an ERD" is a diagram AND the statements that build it,
     * not a picture someone still has to translate by hand.
     */
    name: 'canvas_create_data_model',
    description: 'Author a REAL entity-relationship model on the canvas: entities, attributes, keys, and relationships. Use this for any request to design, draw, model or diagram a database, schema, data model or ERD — never canvas_add_object with kind "diagram", which produces a picture that cannot be validated or executed. The result is validated (missing keys, dangling foreign keys, repeating groups, unresolved many-to-many) and lowered to executable DDL in the chosen dialect. Set sourceDatasetId instead of authoring entities to infer the model from a dataset already on the board.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        title: { type: 'string', description: 'Name of the model, e.g. "Order management schema".' },
        dialect: { type: 'string', enum: [...SQL_DIALECTS], description: 'SQL dialect the DDL is generated for. Defaults to postgres.' },
        objectId: { type: 'string', description: 'Amend the ERD object with this id instead of creating one. Read it with canvas_read_object first and send the WHOLE model — entities omitted here are removed.' },
        sourceDatasetId: { type: 'string', description: 'Infer a single entity from this dataset/table object instead of authoring entities. Column types, nullability, keys and PII tags come from the real rows.' },
        notes: { type: 'string', description: 'Design notes: assumptions, out-of-scope areas, open questions.' },
        entities: {
          type: 'array',
          description: 'The tables. Give every entity a primary key — an entity without one is reported as an error.',
          items: {
            type: 'object', required: ['name', 'attributes'], additionalProperties: false,
            properties: {
              name: { type: 'string', description: 'snake_case table name, e.g. "order_line".' },
              description: { type: 'string' },
              primaryKey: { type: 'array', items: { type: 'string' }, description: 'Composite key. For a single-column key set primaryKey:true on the attribute instead.' },
              attributes: {
                type: 'array',
                items: {
                  type: 'object', required: ['name', 'type'], additionalProperties: false,
                  properties: {
                    name: { type: 'string' },
                    type: { type: 'string', enum: [...DATA_MODEL_TYPES] },
                    nullable: { type: 'boolean', description: 'Omit for NOT NULL. Modelling defaults to required.' },
                    primaryKey: { type: 'boolean' },
                    unique: { type: 'boolean' },
                    description: { type: 'string' },
                    unit: { type: 'string', description: 'Physical unit — "USD", "ms", "kg".' },
                    enumValues: { type: 'array', items: { type: 'string' } },
                    defaultValue: { type: 'string' },
                    classification: { type: 'string', enum: [...DATA_CLASSIFICATIONS] },
                    pii: { type: 'string', enum: [...PII_CATEGORIES], description: 'Tag personal data here — it is carried into the DDL as a column comment and shown on the diagram.' },
                    references: {
                      type: 'object', required: ['entity', 'attribute'], additionalProperties: false,
                      description: 'Foreign key target. Declaring it here creates the relationship; you need not also list it in relationships.',
                      properties: { entity: { type: 'string' }, attribute: { type: 'string' } },
                    },
                  },
                },
              },
            },
          },
        },
        relationships: {
          type: 'array',
          description: 'Relationships not already expressed as attribute foreign keys. A many-to-many is resolved into a junction table automatically before DDL is generated.',
          items: {
            type: 'object', required: ['from', 'to', 'cardinality'], additionalProperties: false,
            properties: {
              name: { type: 'string' },
              from: { type: 'object', required: ['entity'], additionalProperties: false, properties: { entity: { type: 'string' }, attributes: { type: 'array', items: { type: 'string' } } } },
              to: { type: 'object', required: ['entity'], additionalProperties: false, properties: { entity: { type: 'string' }, attributes: { type: 'array', items: { type: 'string' } } } },
              cardinality: { type: 'string', enum: [...DATA_MODEL_CARDINALITIES] },
              optional: { type: 'boolean' },
              description: { type: 'string' },
            },
          },
        },
        x: { type: 'number' }, y: { type: 'number' },
      },
    },
    mutates: true,
    run: (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as {
        title?: string; dialect?: string; objectId?: string; sourceDatasetId?: string; notes?: string;
        entities?: unknown; relationships?: unknown; x?: number; y?: number;
      };
      const dialect = (SQL_DIALECTS as readonly string[]).includes(String(args.dialect)) ? args.dialect as SqlDialect : 'postgres';
      const all = stage.nodes();

      // Two ways in. Inferring from real rows is not a lesser path: types,
      // nullability and the natural key come from what is ACTUALLY there, which
      // is more truthful than the same model authored from the column names.
      let model: DataModel;
      let inferredFrom: { id: string; title: string } | null = null;
      if (args.sourceDatasetId) {
        const dataset = all.find((node) => node.id === args.sourceDatasetId);
        if (!dataset) return { error: `No object with id "${args.sourceDatasetId}" is on this canvas.` };
        const source = tabularFromObject(dataset.data as Record<string, unknown>);
        if (!source.columns.length) return { error: `${dataset.data.title} has no columns to model.` };
        const classifications = normalizeClassifications(dataset.data.classifications).length
          ? normalizeClassifications(dataset.data.classifications)
          : classifyTabular(source, profileTabular(source));
        model = dataModelFromTabular(String(args.title || dataset.data.title), profileTabular(source), source.rows.length, classifications);
        inferredFrom = { id: dataset.id, title: String(dataset.data.title) };
      } else {
        model = normalizeDataModel({ entities: args.entities, relationships: args.relationships, dialect, origin: 'authored', notes: args.notes });
      }
      if (!model.entities.length) {
        return { error: 'A data model needs at least one entity with at least one attribute. Author `entities`, or set `sourceDatasetId` to infer one from a dataset on the board.' };
      }
      model = { ...model, dialect };

      const issues = validateDataModel(model);
      const summary = dataModelSummary(model, issues);
      const ddl = dataModelDdl(model, dialect);
      const title = String(args.title || 'Data model').trim().slice(0, 160) || 'Data model';
      const fields = {
        title, dataModel: model, dialect, ddl, mermaid: dataModelMermaid(model), issues,
        ...(args.notes ? { notes: String(args.notes).slice(0, 2_000) } : {}),
        ...(inferredFrom ? { sourceObjectId: inferredFrom.id, ...lineagePatch([inferredFrom.id], { engine: 'import' }) } : {}),
        status: summary.errors ? `${summary.errors} to resolve` : `${summary.entities} entities · ${summary.relationships} relationships`,
        summary: `${summary.entities} entities, ${summary.attributes} attributes, ${summary.relationships} relationships. ${summary.keyed} of ${summary.entities} keyed.`,
      };
      const patch = sanitizeCreationObjectPatch('erd', fields);

      const existing = args.objectId ? all.find((node) => node.id === args.objectId && node.data.kind === 'erd') : undefined;
      if (args.objectId && !existing) return { error: `No ERD object with id "${args.objectId}" is on this canvas.` };

      const payload = {
        ok: true, proposed: true, dialect,
        model: { entities: model.entities.map((entity) => ({ name: entity.name, attributes: entity.attributes.length, key: entityKey(entity) })), relationships: summary.relationships },
        issues, ddl,
        ...(inferredFrom ? { inferredFrom } : {}),
      };
      if (existing) {
        stage.updateObject(`Update data model “${title}”`, existing.id, patch);
        return { ...payload, object: { id: existing.id, kind: 'erd', title, updated: true } };
      }
      const anchor = inferredFrom ? all.find((node) => node.id === inferredFrom.id) : undefined;
      const node = stage.createObject('erd', anchor ? { x: anchor.position.x + 460, y: anchor.position.y } : args);
      node.data = { ...node.data, ...patch };
      node.style = { width: 760, height: 560 };
      stage.addObject(`Create data model “${title}”`, node);
      if (anchor) {
        stage.addConnection(
          `Model ${anchor.data.title}`,
          { id: crypto.randomUUID(), source: anchor.id, target: node.id, type: 'smoothstep', animated: true, label: 'modelled as', data: { connectionKind: 'data' } },
        );
      }
      return { ...payload, object: { id: node.id, kind: 'erd', title, created: true } };
    },
  },   {
    /** The model IS the source; DDL and Mermaid are renderings of it. Putting the
     *  DDL on the board as a `code` object is what makes it copyable and runnable
     *  rather than something buried in a tool result. */
    name: 'canvas_export_data_model',
    description: 'Generate executable DDL or a Mermaid erDiagram from a data model already on the canvas, and optionally put the DDL on the board as a Code object. Use this when asked for the SQL, the CREATE TABLE statements, the migration, or a portable diagram of a model that already exists.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        objectId: { type: 'string', description: 'The ERD object. Omit when the canvas holds exactly one.' },
        format: { type: 'string', enum: ['ddl', 'mermaid'], description: 'Defaults to ddl.' },
        dialect: { type: 'string', enum: [...SQL_DIALECTS], description: 'Overrides the model\'s own dialect for this export.' },
        materialize: { type: 'boolean', description: 'Put the result on the board as a Code object connected to the model.' },
      },
    },
    mutates: (raw: unknown) => (raw as { materialize?: unknown })?.materialize === true,
    run: (raw: unknown) => {
      const args = raw as { objectId?: string; format?: string; dialect?: string; materialize?: boolean };
      const all = stage.nodes();
      const models = all.filter((node) => node.data.kind === 'erd');
      const target = args.objectId ? models.find((node) => node.id === args.objectId) : models.length === 1 ? models[0] : undefined;
      if (!target) {
        return { error: models.length ? `Say which model: ${models.map((node) => `${node.id} (${node.data.title})`).join(', ')}` : 'There is no data model on this canvas yet. Create one with canvas_create_data_model.' };
      }
      const model = readDataModel(target.data as Record<string, unknown>);
      if (!model.entities.length) return { error: `${target.data.title} has no entities yet.` };
      const dialect = (SQL_DIALECTS as readonly string[]).includes(String(args.dialect)) ? args.dialect as SqlDialect : (model.dialect ?? 'postgres');
      const format = args.format === 'mermaid' ? 'mermaid' : 'ddl';
      const output = format === 'mermaid' ? dataModelMermaid(model) : dataModelDdl(model, dialect);
      const issues = validateDataModel(model);
      const payload = { ok: true, format, dialect, output, issues: issues.filter((issue) => issue.severity === 'error') };
      if (!args.materialize) return payload;
      if (!canEdit) return { ...payload, error: 'The current session role cannot edit this canvas' };
      const title = `${target.data.title} ${format === 'mermaid' ? 'diagram source' : `DDL (${dialect})`}`;
      const node = stage.createObject('code', { x: target.position.x + 800, y: target.position.y });
      node.data = { ...node.data, ...sanitizeCreationObjectPatch('code', {
        title, code: output, language: format === 'mermaid' ? 'mermaid' : 'sql',
        status: format === 'mermaid' ? 'Diagram source' : `${model.entities.length} tables`,
        ...lineagePatch([target.id], { engine: 'tabular' }),
      }) };
      stage.addObject(`Export ${title}`, node);
      stage.addConnection(
        `Generated from ${target.data.title}`,
        { id: crypto.randomUUID(), source: target.id, target: node.id, type: 'smoothstep', animated: true, label: 'generates', data: { connectionKind: 'data' } },
      );
      return { ...payload, proposed: true, object: { id: node.id, kind: 'code', title } };
    },
  }];
}
