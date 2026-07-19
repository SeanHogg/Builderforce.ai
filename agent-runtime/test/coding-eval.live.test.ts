/**
 * LIVE coding eval — a real model is given a real temp repo and the real tools, and is
 * graded by RUNNING the project it produced. Not part of any deterministic suite: it
 * needs a network and a funded key, so it lives behind `vitest.live.config.ts` and skips
 * itself unless configured.
 *
 *   BF_EVAL_LIVE_API_KEY   (required) key for an OpenAI-compatible endpoint
 *   BF_EVAL_LIVE_BASE_URL  (required) e.g. https://api.builderforce.ai/v1
 *   BF_EVAL_LIVE_MODEL     (optional) model id, defaults to the gateway's coder pool pick
 *
 *   pnpm --dir agent-runtime test:live
 *
 * The pass criterion is the fixture's OWN check — `node verify.mjs` exits 0 — so the
 * grade is "the code the model wrote actually runs and is correct", never a string match
 * against its prose. `shell: true` gives the model `run_command` so it can iterate against
 * that same check before finishing, exactly as it would on a real ticket.
 */

import { describe, expect, it } from "vitest";
import { createGatewayStreamFn } from "../src/builderforce/agent-loop/stream.js";
import type { Model } from "../src/builderforce/model/types.js";
import { EVAL_MODEL, runCodingEval, runInWorkspace, type CodingEvalResult } from "./helpers/coding-eval.js";

const apiKey = process.env.BF_EVAL_LIVE_API_KEY;
const baseUrl = process.env.BF_EVAL_LIVE_BASE_URL;
const configured = Boolean(apiKey && baseUrl);

const model: Model = {
  ...EVAL_MODEL,
  id: process.env.BF_EVAL_LIVE_MODEL ?? "claude-sonnet-4-6",
  name: process.env.BF_EVAL_LIVE_MODEL ?? "claude-sonnet-4-6",
  baseUrl: baseUrl ?? "",
  provider: "builderforce",
};

/** A self-checking fixture: `verify.mjs` is the grader AND the spec the model can run. */
const VERIFY = [
  "import { fizzbuzz } from './src/fizzbuzz.mjs';",
  "import assert from 'node:assert/strict';",
  "assert.equal(fizzbuzz(1), '1');",
  "assert.equal(fizzbuzz(3), 'Fizz');",
  "assert.equal(fizzbuzz(5), 'Buzz');",
  "assert.equal(fizzbuzz(15), 'FizzBuzz');",
  "assert.equal(fizzbuzz(7), '7');",
  "console.log('OK');",
  "",
].join("\n");

describe.skipIf(!configured)("live coding eval", () => {
  it(
    "implements a module from a spec and the project's own check passes",
    async () => {
      let run: CodingEvalResult | undefined;
      try {
        run = await runCodingEval({
          model,
          shell: true,
          files: {
            "verify.mjs": VERIFY,
            "README.md": "# fizzbuzz\n\n`verify.mjs` is the acceptance check. Run `node verify.mjs`.\n",
          },
          task:
            "Create src/fizzbuzz.mjs exporting a function fizzbuzz(n) that satisfies verify.mjs. " +
            "Run `node verify.mjs` with run_command to confirm it passes before you finish.",
          streamFn: createGatewayStreamFn({ baseUrl: baseUrl!, apiKey: apiKey! }),
        });

        // Graded by execution, independently of anything the model claimed.
        const check = await runInWorkspace(run.root, process.execPath, ["verify.mjs"]);
        expect(check.output).toContain("OK");
        expect(check.ok).toBe(true);

        // It solved the task with the shared tools, not by accident.
        expect(run.files["src/fizzbuzz.mjs"]).toBeTruthy();
        expect(run.trace.some((t) => t.name === "write_file" || t.name === "edit_file")).toBe(true);
        // The fixture's grader must be left intact — no editing the test to pass it.
        expect(run.files["verify.mjs"]).toBe(VERIFY);
      } finally {
        await run?.cleanup();
      }
    },
    600_000,
  );
});
