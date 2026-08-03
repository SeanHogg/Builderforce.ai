// cli.ts — CLI entry point for plan-parallel (FR-6.2)
// Run with: npx tsx src/info/docs/analysis/cli.ts --input <file> --format <json|yaml|markdown>

import { readFileSync } from "fs";
import { planParallelFromText, parseTasks, planParallel } from "./index";
import type { TaskInput, PlanOutputFormat } from "./types";

interface CLIArgs {
  input?: string;
  format?: PlanOutputFormat;
  help?: boolean;
}

function parseArgs(argv: string[]): CLIArgs {
  const args: CLIArgs = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = argv[i + 1];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--input" && next) {
      args.input = next;
      i++;
    } else if (arg === "--format" && next) {
      if (["json", "yaml", "markdown", "dot", "mermaid"].includes(next)) {
        args.format = next as PlanOutputFormat;
      }
      i++;
    }
  }
  return args;
}

function printHelp() {
  console.log(`
plan-parallel — Generate parallelization plans from task lists

Usage:
  plan-parallel --input <file> [options]

Options:
  --input <file>    Input file containing tasks (JSON, YAML, or plain text)
  --format          Output format: json, yaml, markdown, dot, mermaid (default: json)
  --help, -h        Show this help message

Examples:
  # From a JSON file
  plan-parallel --input tasks.json

  # From a YAML file with markdown output
  plan-parallel --input tasks.yaml --format markdown

  # From plain text (one task per line)
  plan-parallel --input todo.txt --format mermaid
`);
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (!args.input) {
    console.error("Error: --input is required");
    printHelp();
    process.exit(1);
  }

  let inputContent: string;
  try {
    inputContent = readFileSync(args.input, "utf-8");
  } catch (e) {
    console.error(`Error: Could not read file "${args.input}": ${(e as Error).message}`);
    process.exit(1);
  }

  const format = args.format ?? "json";

  // Try parsing as structured first (JSON/YAML)
  let result = planParallelFromText(inputContent, { format, format_hint: "auto" });

  // If parsing failed, try treating as plain text
  if (result.error) {
    result = planParallelFromText(inputContent, { format, inference: true });
  }

  if (result.error) {
    console.error(`Error [${result.error.error_code}]: ${result.error.message}`);
    if (result.error.details?.cause) {
      console.error("Details:", JSON.stringify(result.error.details, null, 2));
    }
    process.exit(1);
  }

  if (result.formatted) {
    console.log(result.formatted);
  } else {
    console.error("Error: No output generated");
    process.exit(1);
  }
}

main();
