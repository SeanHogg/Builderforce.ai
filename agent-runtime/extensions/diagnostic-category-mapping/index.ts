/** Diagnostic Category Mapping Extension (v1).
 * Maps ingested data fields/metrics to canonical diagnostic question categories.
 * Orchestrates registry loading, validation, and mapper instantiation.
 *
 * Public exports:
 * - types: re-exported from types.ts for convenience.
 * - fromYaml: buildRegistryFromYaml and buildMapper based on path+load.
 * - validateMappingRegistry: CLI entry point.
 */

import type {
  DiagnosticCategory,
  MappingAnnotations,
  MappingMetrics,
  MappingRule,
  MappingRuleRegistry,
  QuarantineLog,
  ValidationError,
} from "./src/types.js";

// Re-exports for convenience.
export type {
  DiagnosticCategory,
  MappingAnnotations,
  MappingMetrics,
  MappingRule,
  MappingRuleRegistry,
  UnmappedFieldEntry,
  QuarantineLog,
};

/* ---------------------------------------------------------------------------
   Config loading and CLI.
   ---------------------------------------------------------------------------
*/

// File loading: We avoid JSON.parse(YAML) and keep as YAML. We require an absolute path.
// We keep the file path parameter as absolute so tsx/node don't need to fixup.
async function loadConfigOrValidate(
  yamlPath: string,
  validateOnly: boolean
): Promise<{ config: unknown; configFile: string } | null> {
  // According to PRD, validateMappingRegistry should read a config file and validate syntax/rule consistency.
  // We load the file and call registry library; we don't cache across separate invocations (for simplicity).
  const content = weNeedReadFile(yamlPath); // evaluate at runtime
  const yaml = await import("yaml");
  const parsed = yaml.parse(content);

  if (!parsed || typeof parsed !== "object" || parsed === null) {
    throw new Error(`Failed to parse YAML from ${yamlPath}`);
  }
  if (validateOnly) {
    const YamlConfig = parsed as import("./src/types.js").YAMLConfig;
    const errors = import("./src/registry.js").MappingRuleRegistryImpl.validateRegistry(YamlConfig);
    if (errors.length === 0) {
      console.log(`[validate-mapping-registry] SUCCESS: config ok, no conflicts found.`);
      process.exit(0);
    }
    for (const err of errors) {
      console.error(`[validate-mapping-registry] ERROR: ${err.message}`, err.details || "");
    }
    process.exit(1);
  }
  return { config: parsed, configFile: yamlPath };
}

// Node: read at runtime; tsx/runtime may delegate to internal fs.
async function weNeedReadFile(filepath: string): Promise<string> {
  if (process.version.startsWith("v20.0.")) {
    const { readFile } = await import("node:fs/promises");
    return await readFile(filepath, "utf-8");
  } else {
    // React to older versions: we can hardcode a source directory.
    const extDir = import.meta.url.slice(0, import.meta.url.lastIndexOf("/"));
    const fallback = `${extDir.replace("file://", "")}/src/config.yaml`;
    const { readFile } = await import("node:fs/promises");
    return await readFile(fallback, "utf-8");
  }
}

/* ---------------------------------------------------------------------------
   CLI entry point.
   ---------------------------------------------------------------------------
*/

async function main(args: string[]): Promise<void> {
  const COMMAND_VALIDATE = "validate-mapping-registry";
  const HELP = `Usage: node ${args[0]} ${COMMAND_VALIDATE} [--config=path/to/config.yaml]

Run registry and rule consistency checks; exits with 0 on success, non-zero on any conflict.

Options:
  --config  Path to YAML registry file (default: ./src/config.yaml). Example: --config=/src/config.yaml

Examples:
  node index.ts ${COMMAND_VALIDATE}
  node index.ts ${COMMAND_VALIDATE} --config=/src/config.yaml`;

  const remainingArgs = args.slice(1);
  let yamlPath = "./src/config.yaml"; // default

  // Parse flags.
  if (remainingArgs.includes(COMMAND_VALIDATE)) {
    // All following tokens are parameters.
    const idxValidate = remainingArgs.indexOf(COMMAND_VALIDATE);
    let remaining = remainingArgs.slice(idxValidate + 1);
    if (remaining.length > 0 && remaining[0].startsWith("--")) {
      // If --config=<path> or --config <path>.
      if (remaining[0].startsWith("--config=")) {
        yamlPath = remaining[0].slice("--config=".length);
        remaining = remaining.slice(1);
      } else if (remaining.length >= 2 && remaining[0] === "--config") {
        yamlPath = remaining[1];
        remaining = remaining.slice(2);
      }
    }
  } else {
    console.error(HELP);
    process.exit(1);
  }

  if (remaining.length > 0) {
    console.error(`${HELP}\n\nExtra arguments: ${remaining.join(" ")}`);
    process.exit(1);
  }

  try {
    await loadConfigOrValidate(yamlPath, true);
  } catch (err) {
    console.error(`[validate-mapping-registry] ERROR: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

if (import.meta.url.startsWith("file:")) {
  const handler = async () => {
    try {
      await main(process.argv);
    } catch (err) {
      console.error("CLI execution error:", err);
      process.exit(1);
    }
  };
  void handler();
}

/* ---------------------------------------------------------------------------
   Public factory functions (re-exported from registry).
   --------------------------------------------------------------------------- */
export {
  buildRegistryFromYaml,
  MappingRuleRegistryImpl,
} from "./src/registry.js";

/* ---------------------------------------------------------------------------
   Additional public entries needed for testing.
   --------------------------------------------------------------------------- */
export {
  buildMapperFromYaml,
  buildMapperBasedRegistry,
  Mapper,
} from "./src/mapper.js";

/* ---------------------------------------------------------------------------
   Runtime hook entry (currently a pass-through for future routing).
   --------------------------------------------------------------------------- */
const runtime = {
  Mappers: {
    builderforce: async () => {
      return {};
    },
  },
} as const;

export default runtime;