/**
 * Workflow-definition import as a registered IMPORTER — a hand-authored YAML/JSON
 * document → a new workflow definition.
 *
 * `POST /api/workflow-definitions/import` (the builder's import) and
 * `POST /api/import/workflow-definition` are both this importer through the one
 * import sequence. `dryRun` now previews too: the parsed + validated graph,
 * nothing saved — which the route never offered, so a malformed document could
 * only be discovered by creating it.
 */
import { TenantRole } from '../../domain/shared/types';
import { validateDefinition, yamlToDefinition, type WorkflowDefinition } from '../../domain/workflowGraph';
import type { Importer, ImportParse } from '../import/importer';
import { coerceRunTarget, createWorkflowDefinition } from './definitionStore';

export interface DefinitionImportInput {
  name: string;
  definition: WorkflowDefinition;
}

export function parseDefinitionImport(body: Record<string, unknown>): ImportParse<DefinitionImportInput> {
  const yaml = typeof body.yaml === 'string' ? body.yaml : '';
  if (!yaml.trim()) return { ok: false, error: 'yaml is required' };
  let definition: WorkflowDefinition;
  try {
    definition = yamlToDefinition(yaml);
  } catch (e) {
    return { ok: false, error: `Could not parse YAML: ${e instanceof Error ? e.message : String(e)}` };
  }
  const invalid = validateDefinition(definition);
  if (invalid) return { ok: false, error: invalid };
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'Imported workflow';
  return { ok: true, input: { name, definition } };
}

/** Any workspace member may import — the builder's create path is ungated too. */
export const workflowDefinitionImporter: Importer<DefinitionImportInput> = {
  kind: 'workflow-definition',
  label: 'Workflow definition (YAML)',
  input: 'document',
  minRole: TenantRole.VIEWER,
  parse: parseDefinitionImport,
  async preview(_ctx, input) {
    return { status: 'previewed', body: { name: input.name, definition: input.definition } };
  },
  async commit(ctx, input) {
    const row = await createWorkflowDefinition(ctx.db, ctx.env, {
      tenantId: ctx.tenantId,
      segmentId: ctx.segmentId,
      name: input.name,
      description: null,
      definition: input.definition,
      target: coerceRunTarget({}),
    });
    return { status: 'committed', body: row };
  },
};
