/**
 * The built-in tools that are PLATFORM-INTERNAL — shown and run only for the platform
 * operator (`tenant/platformOperator`). Pure data with no imports, so the entitlement
 * filter (`builtinToolEntitlements`) can read it without loading a tool catalog and
 * the catalog graph behind it (which reaches `builtinMcpService` and would cycle).
 */

/** Platform-internal tool ids. */
export const PLATFORM_OPERATOR_TOOL_IDS: readonly string[] = ['deploy.status'];

/** The run-time refusal a non-operator caller reads. */
export const PLATFORM_OPERATOR_REFUSAL =
  'This tool is platform-internal: it reports which commit Builderforce\'s own Workers serve, '
  + 'and only the platform operator\'s workspace may run it.';
