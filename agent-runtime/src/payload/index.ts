/**
 * Payload Generation Module
 * Centralized payload generation with declarative field mapping, business rules,
 * transformation, and validation.
 */

export type {
  InputContext,
  SourceDefinition,
  TransformationRule,
  OutputField,
  PayloadDefinition,
  LogEntry,
  ValidationError,
  Result,
  FieldResolution,
} from './types.js';

export { createPayloadGenerator, type PayloadEngineLog } from './engine.js';
export type { PayloadGenerator } from './engine.js';

/**
 * Helper to construct a simple payload definition.
 * Shortcuts for common fields to reduce boilerplate.
 */
export function createPayloadDefinition<T extends Record<string, unknown>>(params: {
  id: string;
  name: string;
  fields: Array<{
    name: string;
    source path: string;
    alias?: string;
    transform?: {
      type?: 'string' | 'number' | 'integer' | 'boolean' | 'date' | 'epoch' | 'enum';
      enumMap?: Record<string, string>;
    };
    includeIf?: {
      field: string;
      operator: Parameters<OutputField['includeIf']['operator']>[0];
      value: unknown;
    };
    source?: { defaultValue?: unknown; required?: boolean };
  }>;
  schema: Record<string, unknown>;
  schemaVersion?: string;
}): PayloadDefinition {
  const payloadFields: OutputField[] = params.fields.map((f) => {
    const base = {
      name: f.name,
      source: {
        path: f['source path'],
        defaultValue: f.source?.defaultValue,
        required: f.source?.required,
      },
      alias: f.alias,
      transform: !!f.transform
        ? ({
            type: f.transform?.type,
            enumMap: f.transform?.enumMap,
          } as OutputField['transform'])
        : undefined,
      includeIf: f.includeIf
        ? ({
            field: f.includeIf.field,
            operator: f.includeIf.operator,
            value: f.includeIf.value,
          } as OutputField['includeIf'])
        : undefined,
    };
    return base as OutputField;
  });

  return {
    id: params.id,
    name: params.name,
    fields: payloadFields,
    schema: params.schema,
    schemaVersion: params.schemaVersion,
  };
}