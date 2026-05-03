#!/usr/bin/env node
import { parseArgs } from "node:util";
import { getAdapter, listArchitectures } from "./architectures";
import { convert } from "./convert";
import { summarizeBundle, verifyBundle } from "./verify";
import type { WebDiTQuantization } from "@webdit/shared";

const QUANTIZATIONS: WebDiTQuantization[] = ["q4f16_1", "q8f16_0", "f16"];

export async function main(argv: string[]): Promise<number> {
  const cmd = argv[0];
  if (!cmd) return usage("missing command");

  if (cmd === "list_architectures") {
    for (const arch of listArchitectures()) console.log(arch);
    return 0;
  }

  if (cmd === "verify") {
    const dir = argv[1];
    if (!dir) return usage("verify requires <bundle-dir>");
    const r = await verifyBundle(dir);
    const total = r.ditTensorCount + r.textEncoderTensorCount + r.vaeTensorCount;
    console.log(`OK: ${r.manifest.architecture} ${r.manifest.quantization}, ${total} tensors, ${(r.totalWeightBytes / (1024 * 1024)).toFixed(2)} MB`);
    return 0;
  }

  if (cmd === "info") {
    const dir = argv[1];
    if (!dir) return usage("info requires <bundle-dir>");
    console.log(await summarizeBundle(dir));
    return 0;
  }

  if (cmd === "convert_weight") {
    const { values, positionals } = parseArgs({
      args: argv.slice(1),
      allowPositionals: true,
      options: {
        architecture: { type: "string", short: "a" },
        quantization: { type: "string", short: "q", default: "q4f16_1" },
        output: { type: "string", short: "o" },
      },
    });
    const source = positionals[0];
    if (!source) return usage("convert_weight requires <source> positional arg");
    if (!values.architecture) return usage("--architecture is required");
    if (!values.output) return usage("--output (-o) is required");
    if (!isQuantization(values.quantization)) {
      return usage(`--quantization must be one of ${QUANTIZATIONS.join(", ")}`);
    }

    const adapter = getAdapter(values.architecture);
    const manifest = await convert(adapter, {
      source,
      output: values.output,
      quantization: values.quantization,
    });
    console.log(`Wrote bundle to ${values.output} (${manifest.architecture}, ${manifest.quantization})`);
    return 0;
  }

  return usage(`unknown command '${cmd}'`);
}

function isQuantization(v: unknown): v is WebDiTQuantization {
  return typeof v === "string" && (QUANTIZATIONS as readonly string[]).includes(v);
}

function usage(err: string): number {
  console.error(`webdit-convert: ${err}`);
  console.error("Usage:");
  console.error("  webdit-convert list_architectures");
  console.error("  webdit-convert convert_weight <source> --architecture <id> [--quantization q4f16_1] -o <output>");
  console.error("  webdit-convert verify <bundle-dir>");
  console.error("  webdit-convert info <bundle-dir>");
  return 2;
}

const isMain =
  // tsx / direct node execution detection
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("cli.ts") ||
  process.argv[1]?.endsWith("cli.js");

if (isMain) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
