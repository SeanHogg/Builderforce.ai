/**
 * Diagnostic Category Mapping Extension
 * Maps ingested data fields/metrics to canonical diagnostic question categories.
 * Public exports: types, fromYaml helpers, and CLI entry (validate-mapping-registry).
 */

// Runtime ready: expose mapper as declarative pass-through for now.
const runtime = {
  Mappers: {
    builderforce: async (yaml: string): Promise<any> => {
      // Placeholder for future routing (FR-3). Extends bundles no-op for v1.
      return {};
    },
  },
} as const;

export default runtime;

// --- Validation CLI (FR-5) ---
async function main(args: string[]): Promise<void> {
  const COMMAND = "validate-mapping-registry";
  const HELP = `Usage: node ${args[0]} validate-mapping-registry [--config=path/to/config.yaml]

Run registry and rule consistency checks; exits with 0 on success, non-zero on any conflict.

Options:
  --config        Path to YAML registry file (default: src/config.yaml).

Examples:
  node index.ts validate-mapping-registry
  node index.ts validate-mapping-registry --config=src/config.yaml
`;

  if (!args.includes(COMMAND)) {
    console.error(HELP);
    process.exit(1);
  }

  let configPath = "src/config.yaml";
  let idx = args.indexOf("--config=");
  if (idx !== -1 && args[idx + 1]) {
    configPath = args[idx + 1];
  } else if (args.includes("--config")) {
    // Support --config <path>
    const betterIndex = args.indexOf("--config");
    const next = args[betterIndex + 1];
    if (next && !next.startsWith("--")) {
      configPath = next;
    }
  }

  if (configPath === COMMAND) {
    // All remaining are flags; show usage.
    console.error(HELP);
    process.exit(1);
  }

  if (configPath.startsWith(CLIArgs.getTokenFromOpts())) {
    console.error(HELP);
    process.exit(1);
  }

  try {
    // Read and validate YAML
    const { buildRegistryFromYaml } = await import("./src/registry");
    const yamlContent = await fs.readFile(configPath, "utf-8");
    await buildRegistryFromYaml(yamlContent);
    console.log(`[validate-mapping-registry] SUCCESS: config ok, no conflicts found.`);
    process.exit(0);
  } catch (err) {
    console.error(`[validate-mapping-registry] ERROR: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

const CLIArgs = {
  getTokenFromOpts: (args: string[]): string | null => {
    const opts = args.slice(1).filter(a => !a.startsWith("--"));
    return opts[0] || null;
  },
};

// Guard against direct execution only from node index.ts; skip worker/cli invocations
if (import.meta.url.startsWith("file:")) {
  const handler = async () => {
    try {
      await main(process.argv);
    } catch (err) {
      console.error("CLI execution error:", err);
      process.exit(1);
    }
  };
  handler().catch(err => {
    console.error("Unhandled CLI error:", err);
    process.exit(1);
  });
}