/**
 * Payload Generation Types
 * Centralized type definitions for the payload generation module.
 */

/**
 * Input context provided by callers containing all available source data.
 * May contain nested objects, arrays, and primitive values.
 */
export type InputContext = Record<string, unknown>;

/**
 * Source field definition for field mapping.
 */
export type SourceDefinition = {
  /** JSON-path-style key path */
  path: string;
  /** Optional nested path separator (defaults to '.') */
  separator?: '.' | '/' | '[ ]';
  /** Default value to use if field is missing or null */
  defaultValue?: unknown;
  /** Whether the field is required (missing = error) */
  required?: boolean;
  /** Whether to resolve the field asynchronously (e.g., via async lookup) */
  async?: boolean;
};

/**
 * Transformation rule type.
 */
export type TransformationRule = {
  /** Unique identifier */
  id: string;
  /** When to apply this rule */
  conditions?: {
    /** Field name to evaluate */
    field: string;
    /** Operator: 'exists', 'equals', 'notEquals', 'contains', 'startsWith', 'endsWith', 'greaterThan', 'lessThan', 'in' */
    operator: 'exists' | 'equals' | 'notEquals' | 'contains' | 'startsWith' | 'endsWith' | 'greaterThan' | 'lessThan' | 'in';
    /** Value(s) to compare against */
    value: unknown;
  };
  /** When TRUE, apply the transformation */
  whenTrue?: string;
  /** When FALSE, apply the alternative transformation */
  whenFalse?: string;
};

/**
 * Output field definition.
 */
export type OutputField = {
  /** Output field name */
  name: string;
  /** Source field definition */
  source: SourceDefinition;
  /** Alias: different output name than source */
  alias?: string;
  /** Transformation rules to apply */
  transform?: {
    /** Type coercion (e.g., "string", "number", "integer", "boolean", "date") */
    type?: 'string' | 'number' | 'integer' | 'boolean' | 'date' | 'epoch' | 'enum' | 'json';
    /** Derived field: pre-defined mapping or a transform expression */
    derived?: string;
    /** Derived function name (e.g., "fullName") */
    derivedFunction?: string;
    /** Custom function name (if using user-provided functions) */
    customFunction?: string;
    /** Enum mapping: object mapping internal codes to external labels */
    enumMap?: Record<string, string>;
    /** Expression for computed values (e.g., 'firstName + " " + lastName') */
    expression?: string;
    /** Array mapping for collections */
    arrayTransform?: {
      /** Field to apply transform to each element */
      field: string;
      /** Transform to apply */}
      transform: string;
    };
  };
  /** Whether to include in output (conditional) */
  includeIf?: {
    field: string;
    operator: Parameters<TransformationRule['conditions']>[0]['operator'];
    value: unknown;
  };
};

/**
 * Payload type definition.
 */
export type PayloadDefinition = {
  /** Unique identifier for this payload type */
  id: string;
  /** Human-readable name */
  name: string;
  /** Output fields configuration */
  fields: OutputField[];
  /** Transformation rules to apply globally */
  rules?: TransformationRule[];
  /** JSON Schema definition for output validation */
  schema: Record<string, unknown>;
  /** Schema version for migration compatibility */
  schemaVersion?: string;
  /** Defaults for fields defined in schema or inline */
  defaults?: Record<string, unknown>;
};

/**
 * Log entry structure.
 */
export type LogEntry = {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  contextId: string;
  field?: string;
  ruleId?: string;
  reason: string;
  inputState?: Record<string, unknown>;
};

/**
 * Validation error structure.
 */
export type ValidationError = {
  /** Output field name where error occurred */
  field: string;
  /** Schema path (JSON Pointer style) */
  schemaPath?: string;
  /** Validation message */
  message: string;
  /** Error type */
  type: 'required' | 'type' | 'format' | 'enum' | 'custom' | 'configured_default_missing';
  /** Input value that caused error (if applicable) */
  input?: unknown;
};

/**
 * Result wrapper for payload generation.
 */
export type Result<T = unknown> = {
  success: true;
  data: T;
} | {
  success: false;
  errors: ValidationError[];
};

/**
 * Field resolution result.
 */
export type FieldResolution = {
  value: unknown;
  exists: boolean;
};