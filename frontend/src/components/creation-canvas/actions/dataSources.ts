/** Connected data sources and data use — declare a dataset's purpose, promote it to a training corpus, list/add/query sources. */
import type { BrainAction } from '@seanhogg/builderforce-brain-embedded';
import { CANVAS_CORPUS_ACCOUNT_GATE, DATA_PURPOSES, type DataPurpose, type DataUsePolicy, LAWFUL_BASES, type LawfulBasis } from '@builderforce/creation-canvas-contract';
import { sanitizeCreationObjectPatch } from '../creationObjectRegistry';
import { profileTabular, tabularFromObject } from '@/lib/canvasTabularData';
import { evaluateDatasetUse, normalizeClassifications, normalizeUsePolicy } from '@/lib/canvasDataGovernance';
import { getStoredTenantToken } from '@/lib/auth';
import { canvasProjectId } from '@/lib/canvasProjectRef';
import { importCanvasDataset } from '@/lib/api';
import { toolErrorMessage } from '@/lib/toolErrorMessage';
import { dataSourceApi, type DataSourceSummary, resolveDataSource } from '@/lib/dataSourceApi';
import { dataModelFromIntrospection, dataModelSummary, validateDataModel } from '@/lib/canvasDataModel';
import { dataModelDdl, dataModelMermaid } from '@/lib/canvasDataModelDdl';
import { lineagePatch } from '@/lib/canvasLineage';
import type { CanvasActionContext } from './context';

export function canvasDataSourceActions(ctx: CanvasActionContext): BrainAction[] {
  const { canEdit, openAccountGate, sessionId, stage, t } = ctx;
  return [  {
    name: 'canvas_set_data_use',
    description: 'Declare what a dataset may be USED for: its permitted purposes, its lawful basis, and how long the rows may be kept. This is a restriction, not a description — canvas_classify_dataset says what the rows ARE, and this says what may be done with them. Once purposes are declared, a use outside them is refused: a dataset whose purposes exclude "training" cannot become a fine-tune corpus, and rows past their retention window cannot be used at all. Set this whenever a dataset holds personal data.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['datasetId'],
      properties: {
        datasetId: { type: 'string', description: 'Dataset to govern.' },
        purposes: { type: 'array', items: { type: 'string', enum: [...DATA_PURPOSES] }, description: 'What these rows may be used for. Omit to leave the dataset unrestricted.' },
        lawfulBasis: { type: 'string', enum: [...LAWFUL_BASES], description: 'GDPR Article 6 basis. Required before the rows may be used for training or sharing.' },
        retentionDays: { type: 'number', description: 'Days the rows may be kept from collectedAt. Omit or 0 for no declared limit.' },
        collectedAt: { type: 'string', description: 'ISO date the rows were collected — the clock retention is measured from.' },
      },
    },
    mutates: () => true,
    run: (raw: unknown) => {
      const args = raw as { datasetId?: string; purposes?: string[]; lawfulBasis?: string; retentionDays?: number; collectedAt?: string };
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const target = stage.nodes().find((node) => node.id === args.datasetId);
      if (!target) return { error: `No object with id ${args.datasetId} is on this canvas.` };

      const dataUse: DataUsePolicy = {
        ...(args.purposes?.length ? { purposes: args.purposes.filter((purpose): purpose is DataPurpose => (DATA_PURPOSES as readonly string[]).includes(purpose)) } : {}),
        ...(args.lawfulBasis && (LAWFUL_BASES as readonly string[]).includes(args.lawfulBasis) ? { lawfulBasis: args.lawfulBasis as LawfulBasis } : {}),
        ...(Number(args.retentionDays) > 0 ? { retentionDays: Math.trunc(Number(args.retentionDays)) } : {}),
        ...(args.collectedAt ? { collectedAt: args.collectedAt } : {}),
      };
      const patch = sanitizeCreationObjectPatch(target.data.kind, {
        dataUse,
        summary: `Use restricted to: ${dataUse.purposes?.join(', ') || 'any purpose'}${dataUse.lawfulBasis ? ` · basis: ${dataUse.lawfulBasis}` : ''}${dataUse.retentionDays ? ` · retained ${dataUse.retentionDays} days` : ''}.`,
      });
      stage.updateObject('Declare data use', target.id, patch);
      return { ok: true, proposed: true, objectId: target.id, dataUse };
    },
  },   {
    /**
     * THE CANVAS → FINE-TUNE DOOR, and the half the governance gate had been missing.
     *
     * A classification that cannot travel is a classification that cannot refuse. Until
     * this existed, the only way to make a training corpus was `POST /datasets/generate`,
     * which synthesises instruction pairs from a prompt — nothing personal, nothing to
     * classify — so every corpus the platform could build was, correctly, ungoverned. The
     * corpora that NEED a policy are made of real rows somebody uploaded and then
     * classified on this board, and there was no path that carried the classification
     * across. This is that path: the rows, the tags and the policy in ONE call, because a
     * corpus created in one request and classified in a second is a corpus somebody can
     * train on in between.
     *
     * The column mapping is required rather than guessed. A fine-tune corpus is
     * {instruction, input, output} and a canvas dataset is an arbitrary table; picking the
     * columns by name would quietly train a model on the wrong two, which is the class of
     * mistake that only surfaces after the weights exist.
     */
    name: 'canvas_promote_dataset_to_corpus',
    description: 'Turn a dataset on this canvas into a fine-tune training corpus in a project, carrying its column classifications and its declared data-use policy with it. Use this when asked to train, fine-tune or build an adapter on data that is already on the board. The rows are mapped to instruction/output pairs by the columns you name. If the dataset declares a policy that does not permit training, or holds personal data with no lawful basis, the training run is refused later by the server — so set the policy with canvas_set_data_use first rather than after.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['datasetId', 'instructionColumn', 'outputColumn'],
      properties: {
        datasetId: { type: 'string', description: 'Canvas id of the dataset object to promote.' },
        instructionColumn: { type: 'string', description: 'Column holding the prompt/instruction for each example.' },
        outputColumn: { type: 'string', description: 'Column holding the ideal answer for each example.' },
        inputColumn: { type: 'string', description: 'Optional column holding extra context for each example.' },
        projectId: { type: 'number', description: 'Project to file the corpus under. Omit when exactly one project object is on the canvas.' },
        name: { type: 'string', description: 'Name for the corpus. Defaults to the dataset title.' },
      },
    },
    run: async (raw: unknown) => {
      const args = raw as { datasetId?: string; instructionColumn?: string; outputColumn?: string; inputColumn?: string; projectId?: number; name?: string };
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const target = ctx.nodes().find((node) => node.id === args.datasetId);
      if (!target) return { error: `No object with id ${args.datasetId} is on this canvas.` };
      const source = tabularFromObject(target.data as Record<string, unknown>);
      if (!source.rows.length) return { error: `${String(target.data.title)} has no imported rows. Import the data before promoting it — a corpus of nothing cannot train anything.` };

      const missing = [args.instructionColumn, args.outputColumn, args.inputColumn]
        .filter((column): column is string => !!column)
        .filter((column) => !source.columns.includes(column));
      if (missing.length) return { error: `That dataset has no column named ${missing.join(' or ')}. Its columns are: ${source.columns.join(', ')}.` };

      // Refuse HERE as well as at the server, and for a different reason: the server gate
      // is what makes the rule true, and this one is what makes it legible — a refusal at
      // the moment of promotion names the card to fix, where a 403 on a later training
      // press names a dataset id.
      const gate = evaluateDatasetUse(
        'training',
        normalizeClassifications((target.data as { classifications?: unknown }).classifications),
        normalizeUsePolicy((target.data as { dataUse?: DataUsePolicy }).dataUse),
      );
      if (!gate.allowed) return { error: gate.reason };

      // BEFORE the project lookup, because a guest fails that lookup for the wrong
      // reason: they have no project because they have no workspace, and "put the project
      // on the canvas" is advice that cannot work and hides the one thing that would.
      // Gated on CREDENTIALS rather than a saved board — the corpus POST carries the
      // tenant token, so a signed-in user promotes from an unsaved canvas for real.
      if (!getStoredTenantToken()) {
        return openAccountGate('canvas_promote_dataset_to_corpus', 'corpus', t('gateCorpusTitle'), t('gateCorpusBody'), CANVAS_CORPUS_ACCOUNT_GATE);
      }
      const projectNode = ctx.nodes().find((node) => node.data.kind === 'project' && canvasProjectId(node.data) != null);
      const projectId = args.projectId ?? (projectNode ? canvasProjectId(projectNode.data) : null);
      if (projectId == null) return { error: 'No project to file this corpus under. Put the project on the canvas, or name its id.' };

      const cell = (row: Record<string, unknown>, column: string | undefined): string =>
        column ? String((row as Record<string, unknown>)[column] ?? '').trim() : '';
      const examples = source.rows
        .map((row) => ({
          instruction: cell(row as Record<string, unknown>, args.instructionColumn),
          input: cell(row as Record<string, unknown>, args.inputColumn),
          output: cell(row as Record<string, unknown>, args.outputColumn),
        }))
        .filter((example) => example.instruction && example.output);
      if (!examples.length) return { error: 'Every row was empty in the instruction or the output column, so there is nothing to train on.' };

      try {
        const dataset = await importCanvasDataset({
          projectId,
          name: args.name?.trim() || String(target.data.title || 'Canvas corpus'),
          examples,
          classifications: normalizeClassifications((target.data as { classifications?: unknown }).classifications),
          usePolicy: normalizeUsePolicy((target.data as { dataUse?: DataUsePolicy }).dataUse),
          sourceSessionId: sessionId ?? undefined,
          sourceObjectId: target.id,
        });
        return {
          ok: true,
          corpus: { id: dataset.id, exampleCount: dataset.example_count, projectId },
          skipped: source.rows.length - examples.length,
        };
      } catch (error) {
        return { error: toolErrorMessage(error, 'That dataset could not be promoted to a training corpus.') };
      }
    },
  },   {
    name: 'canvas_list_data_sources',
    description: 'List the live databases and warehouses this workspace has connected — Postgres/Neon, ClickHouse, BigQuery and others — and what each can do here. Call this before canvas_add_data_source or canvas_query_data_source when the user has not named one.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    run: async () => {
      const { sources } = await dataSourceApi.list().catch(() => ({ sources: [] as DataSourceSummary[] }));
      if (!sources.length) {
        return { sources: [], error: 'No data source is connected to this workspace. Connect one in Integrations, or attach a CSV to work with a file instead.' };
      }
      return { sources };
    },
  },   {
    /**
     * REAL → model: reverse-engineer a live database.
     *
     * The other direction of "create me an ERD". Everything on a canvas used to
     * arrive by file upload; this reads the actual schema — tables, columns,
     * nullability, primary keys and foreign keys — so a model of production is
     * the truth rather than someone's recollection of it.
     */
    name: 'canvas_add_data_source',
    description: 'Put a connected database or warehouse on the canvas as a LIVE source, reading its real schema. Use this when asked to look at, explore, document, diagram or model an actual database. Set buildModel to also produce a validated ERD of the real schema — this is how "draw the ERD for our production database" is answered truthfully rather than from guesswork.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        sourceId: { type: 'string', description: 'Connection id from canvas_list_data_sources. Omit when exactly one is connected.' },
        name: { type: 'string', description: 'Connection name, as an alternative to sourceId.' },
        dataset: { type: 'string', description: 'BigQuery only: the dataset whose schema to read. Required there, ignored elsewhere.' },
        buildModel: { type: 'boolean', description: 'Also create a validated ERD object from the real schema.' },
        title: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' },
      },
    },
    mutates: true,
    run: async (raw: unknown) => {
      if (!canEdit) return { error: 'The current session role cannot edit this canvas' };
      const args = raw as { sourceId?: string; name?: string; dataset?: string; buildModel?: boolean; title?: string; x?: number; y?: number };
      const { sources } = await dataSourceApi.list().catch(() => ({ sources: [] as DataSourceSummary[] }));
      const resolved = resolveDataSource(sources, { id: args.sourceId ?? null, name: args.name ?? null });
      if (!resolved.ok) return { error: `${resolved.error} Connect one in Integrations.` };
      const source = resolved.source;
      if (!source.canIntrospect) {
        return { error: `${source.providerLabel} cannot have its schema read from here${source.note ? ` — ${source.note}` : '.'}` };
      }

      let schema: Awaited<ReturnType<typeof dataSourceApi.schema>>;
      try {
        schema = await dataSourceApi.schema(source.id, args.dataset);
      } catch (error) {
        return { error: toolErrorMessage(error, 'That data source could not be read.') };
      }
      if (!schema.tables.length) return { error: `${source.name} reported no tables${args.dataset ? ` in dataset "${args.dataset}"` : ''}.` };

      const fetchedAt = new Date().toISOString();
      const title = (args.title || source.name).trim().slice(0, 160);
      const node = stage.createObject('datasource', args);
      node.data = { ...node.data, ...sanitizeCreationObjectPatch('datasource', {
        title, tables: schema.tables, relationships: schema.relationships, scanned: schema.scanned,
        status: `${schema.tables.length} tables`,
        summary: `${schema.tables.length} tables and ${schema.relationships.length} foreign keys in ${schema.scanned.join(', ') || source.providerLabel}.`,
        fetchedAt,
      }), connectionId: source.id, provider: source.provider, providerLabel: source.providerLabel };
      stage.addObject(`Add data source “${title}”`, node);

      const payload = {
        ok: true, proposed: true,
        object: { id: node.id, kind: 'datasource', title },
        provider: source.providerLabel,
        tables: schema.tables.map((table) => ({ name: table.name, columns: table.columns.length })),
        relationships: schema.relationships.length,
        scanned: schema.scanned,
      };
      if (!args.buildModel) return payload;

      const model = dataModelFromIntrospection(schema.tables, schema.relationships);
      const issues = validateDataModel(model);
      const summary = dataModelSummary(model, issues);
      const modelTitle = `${title} schema`;
      const modelNode = stage.createObject('erd', { x: node.position.x + 460, y: node.position.y });
      modelNode.data = { ...modelNode.data, ...sanitizeCreationObjectPatch('erd', {
        title: modelTitle, dataModel: model, dialect: 'postgres', ddl: dataModelDdl(model, 'postgres'), mermaid: dataModelMermaid(model), issues,
        status: `${summary.entities} entities`,
        summary: `Reverse-engineered from ${source.providerLabel}: ${summary.entities} entities, ${summary.relationships} relationships.`,
        ...lineagePatch([node.id], { engine: 'import' }, { producedAt: fetchedAt }),
      }) };
      modelNode.style = { width: 760, height: 560 };
      stage.addObject(`Model “${modelTitle}”`, modelNode);
      stage.addConnection(
        `Schema of ${title}`,
        { id: crypto.randomUUID(), source: node.id, target: modelNode.id, type: 'smoothstep', animated: true, label: 'schema of', data: { connectionKind: 'data' } },
      );
      return { ...payload, model: { id: modelNode.id, kind: 'erd', title: modelTitle, entities: summary.entities, issues } };
    },
  },   {
    name: 'canvas_query_data_source',
    description: 'Run ONE read-only SQL query against a connected database and put the real result on the canvas as a Table, Chart, KPI or Dataset. Use this for any question about live data rather than an uploaded file. Only SELECT (and WITH … SELECT) is accepted — a canvas data source cannot write. Materializing as "dataset" is the right choice when further analysis will follow, because every later canvas_query_dataset call then runs over the returned rows without another round trip.',
    parameters: {
      type: 'object', required: ['sql'], additionalProperties: false,
      properties: {
        sourceId: { type: 'string', description: 'Connection id from canvas_list_data_sources. Omit when exactly one is connected.' },
        name: { type: 'string', description: 'Connection name, as an alternative to sourceId.' },
        sql: { type: 'string', description: 'A single SELECT statement. A LIMIT is added when you omit one.' },
        limit: { type: 'number', description: 'Row ceiling, up to 500.' },
        materializeAs: { type: 'string', enum: ['none', 'dataset', 'table', 'chart', 'kpi'], description: 'Defaults to table.' },
        title: { type: 'string' },
      },
    },
    mutates: (raw: unknown) => (raw as { materializeAs?: unknown })?.materializeAs !== 'none',
    run: async (raw: unknown) => {
      const args = raw as { sourceId?: string; name?: string; sql?: string; limit?: number; materializeAs?: string; title?: string };
      const { sources } = await dataSourceApi.list().catch(() => ({ sources: [] as DataSourceSummary[] }));
      const resolved = resolveDataSource(sources, { id: args.sourceId ?? null, name: args.name ?? null });
      if (!resolved.ok) return { error: `${resolved.error} Connect one in Integrations.` };
      if (!resolved.source.canQuery) return { error: `${resolved.source.providerLabel} does not accept SQL from a canvas.` };

      let result: Awaited<ReturnType<typeof dataSourceApi.query>>;
      try {
        result = await dataSourceApi.query(resolved.source.id, String(args.sql ?? ''), args.limit);
      } catch (error) {
        return { error: toolErrorMessage(error, 'That query could not be run.') };
      }
      const payload = {
        ok: true, source: result.source, sql: result.sql,
        columns: result.columns, rows: result.rows.slice(0, 20),
        rowCount: result.rowCount, truncated: result.truncated,
        readFromLiveSource: true,
      };
      const materializeAs = ['dataset', 'table', 'chart', 'kpi'].includes(String(args.materializeAs ?? 'table'))
        ? String(args.materializeAs ?? 'table') as 'dataset' | 'table' | 'chart' | 'kpi'
        : null;
      if (!materializeAs) return payload;
      if (!canEdit) return { ...payload, error: 'The current session role cannot edit this canvas' };
      if (!result.rows.length) return { ...payload, error: 'That query returned no rows, so nothing was added to the canvas.' };

      const all = stage.nodes();
      const fetchedAt = new Date().toISOString();
      const title = (args.title || `${result.source.name} query`).trim().slice(0, 160);
      const bound = all.find((node) => node.data.kind === 'datasource' && node.data.connectionId === result.source.id);
      const provenance = lineagePatch(bound ? [bound.id] : [], { engine: 'sql', sql: result.sql, rowsOut: result.rowCount }, { columns: result.columns, producedAt: fetchedAt });
      const numeric = result.columns.find((column) => result.rows.some((row) => typeof row[column] === 'number'));

      const fields: Record<string, unknown> = materializeAs === 'chart'
        ? {
          title, chartTitle: title, status: 'Live',
          xAxisLabel: result.columns[0] ?? '', yAxisLabel: numeric ?? '',
          chartLabels: result.rows.map((row) => String(row[result.columns[0] ?? ''] ?? '')),
          chartValues: result.rows.map((row) => Number(row[numeric ?? ''] ?? 0)),
          summary: t('materializeRowsFrom', { rows: result.rowCount, source: result.source.name }),
        }
        : materializeAs === 'kpi'
          ? {
            title, value: String(Object.values(result.rows[0] ?? {})[0] ?? ''), status: 'Live',
            summary: t('materializeReadFrom', { source: result.source.name }),
          }
          : {
            title, columns: result.columns, rows: result.rows, rowCount: result.rowCount,
            sampleRows: result.rows.slice(0, 8),
            status: t('materializeRows', { rows: result.rowCount }),
            summary: t('materializeRowsFrom', { rows: result.rowCount, source: result.source.name }),
            ...(materializeAs === 'dataset' ? { profile: profileTabular({ columns: result.columns, rows: result.rows }) } : {}),
          };

      const node = stage.createObject(materializeAs, bound ? { x: bound.position.x + 460, y: bound.position.y + 300 } : {});
      node.data = { ...node.data, ...sanitizeCreationObjectPatch(materializeAs, { ...fields, ...provenance, fetchedAt }) };
      if (materializeAs === 'table' || materializeAs === 'dataset') node.style = { width: 720, height: 460 };
      stage.addObject(`Add ${materializeAs} “${title}”`, node);
      if (bound) {
        stage.addConnection(
          `Queried ${bound.data.title}`,
          { id: crypto.randomUUID(), source: bound.id, target: node.id, type: 'smoothstep', animated: true, label: 'query', data: { connectionKind: 'data' } },
        );
      }
      return { ...payload, proposed: true, materialized: { id: node.id, kind: materializeAs, title } };
    },
  }];
}
