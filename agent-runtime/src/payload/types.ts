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
 * Resolved source field.
 */
export type FieldResolution = {
  /** The resolved value (null if missing) */
  value: unknown;
  /** Whether the field existed in the source */
  exists: boolean;
};

/**
 * Source field definition for field mapping.
 */
export type SourceDefinition = {
  /** JSON-path-style key path (e.g., 'user.username') */
  path: string;
  /** Default value to use if field is missing or null */
  defaultValue?: unknown;
  /** Whether the field is required (missing = error) */
  required?: boolean;
  /** Whether to resolve the field asynchronously (not implemented in this iteration) */
  async?: boolean;
};

/**
 * Type coercion options.
 */
export type TypeCoercion = {
  /** Type to coerce to */
  type: 'string' | 'number' | 'integer' | 'boolean' | 'date' | 'epoch';
  /** If true, allow null/undefined as-is after date parse (date/epoch) */
  nullable?: boolean;
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
    /** Type coercion options */
    type?: TypeCoercion;
    /** Enum mapping: object mapping internal codes to external labels */
    enumMap?: Record<string, string>;
    /** Derived function name (e.g., 'fullName') */
    derivedFunction?: string;
    /** Expression for computed values (not yet implemented) */
    expression?: string;
    /** Array transform applies a transform to each element */
    arrayTransform?: {
      /** Field to apply transform to each element (path) */
      field: string;
      /** Transform expression: 'map(prop)' or 'fn:fnName' */
      transform: string;
    };
    /** Condition: only include this field when a condition holds (path + operator + value) */
    includeIf?: {
      /** Source field name for condition */
      field: string;
      /** Operator to evaluate */
      operator: 'equals' | 'notEquals' | 'contains' | 'startsWith' | 'endsWith' | 'greaterThan' | 'lessThan' | 'exists';
      /** Value to compare against */
      value: unknown;
    };
  };
  /** Function registry name for custom implementations (key in generator.functions) */
  customFunction?: string;
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
  /** Transformation rules to apply globally (not yet implemented) */
  rules?: unknown[];
  /** JSON Schema definition for schema validation (keys: properties; properties is optional; each value: { type, enum?, required?, default?, ... }) */
  schema: Record<string, unknown>;
  /** Schema version string for migration compatibility (preserved, not used yet) */
  schemaVersion?: string;
  /** Defaults for fields (optional; most config is inline) */
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
  /** Output field name (or schema path) where error occurred */
  field: string;
  /** Schema path (JSON Pointer style, for schema errors) */
  schemaPath?: string;
  /** Validation message */
  message: string;
  /** Error type */
  type: 'required' | 'type' | 'format' | 'enum' | 'configured_default_missing';
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
 * Factory creation return type.
 */
export type PayloadGenerator = {
  /** The definition used to create this generator */
  definition: PayloadDefinition;
  /** Generate payload from input context */
  generate(context: InputContext): Result<Record<string, unknown>>;
  /** Generate with an explicit return type (helper) - same as generate but strict typing */
  generateTyped<T = Record<string, unknown>>(context: InputContext): Result<T>;
  /** Get accumulated log entries since last reset */
  getLog(): LogEntry[];
  /** Clear accumulated log entries */
  resetLog(): void;
};