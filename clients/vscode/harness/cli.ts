/**
 * `pnpm harness` — the VSIX chat, validated without building a VSIX.
 *
 * Two modes, both of which replace a manual build-install-chat-copy cycle:
 *
 *   pnpm harness                        replay every scripted failure offline, print verdicts
 *   pnpm harness --only narrates-forever   …and print that one's full copyable report
 *   pnpm probe "<prompt>"               run the prompt for real, print the same report
 *
 * The offline mode needs no account and no network; the probe needs `BF_EDITOR_KEY`.
 */

import { runScenario } from './runScenario';
import { SCENARIOS, scenarioById } from './scenarios';
import { probe } from './probe';

interface Flags {
  only?: string;
  chat?: number;
  project?: number;
  model?: string;
  root?: string;
  key?: string;
  baseUrl?: string;
  localToolsOnly: boolean;
  noTools: boolean;
  full: boolean;
  json: boolean;
}

function parse(argv: string[]): { mode: 'replay' | 'probe' | 'list'; rest: string[]; flags: Flags } {
  const flags: Flags = { localToolsOnly: false, noTools: false, full: false, json: false };
  const rest: string[] = [];
  let mode: 'replay' | 'probe' | 'list' = 'replay';

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (i === 0 && (a === 'probe' || a === 'replay' || a === 'list')) { mode = a; continue; }
    switch (a) {
      case '--only': flags.only = argv[++i]; break;
      case '--chat': flags.chat = Number(argv[++i]); break;
      case '--project': flags.project = Number(argv[++i]); break;
      case '--model': flags.model = argv[++i]; break;
      case '--root': flags.root = argv[++i]; break;
      case '--key': flags.key = argv[++i]; break;
      case '--base-url': flags.baseUrl = argv[++i]; break;
      case '--local-tools': flags.localToolsOnly = true; break;
      case '--no-tools': flags.noTools = true; break;
      case '--full': flags.full = true; break;
      case '--json': flags.json = true; break;
      case '--help':
      case '-h': mode = 'list'; break;
      default: rest.push(a);
    }
  }
  return { mode, rest, flags };
}

const USAGE = `
BuilderForce VSIX harness — validate the extension's chat without packaging it.

  pnpm harness                          replay every scripted scenario offline
  pnpm harness --only <id>              replay one, and print its full copy report
  pnpm harness --only <id> --json       …as JSON, for a script to assert on
  pnpm harness list                     list the scenarios

  pnpm probe "<prompt>"                 run the prompt against the REAL gateway
    --chat <id>        continue an existing chat instead of creating one
    --project <id>     attach to a project (enables Evermind recall + backstops)
    --model <id>       pin a model (default: gateway auto-select, as shipped)
    --root <dir>       workspace the local file tools act on (default: cwd)
    --local-tools      skip the gateway MCP catalog
    --no-tools         advertise nothing — reproduces a failed catalog fetch
    --key <bfk_…>      editor key (default: $BF_EDITOR_KEY)
    --base-url <url>   gateway base (default: $BF_BASE_URL)

A probe run spends real tokens and writes real chat rows, exactly as reproducing the
failure by hand would.
`.trim();

/** Right-pad for the verdict table. */
function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

async function replay(flags: Flags): Promise<number> {
  const chosen = flags.only ? [scenarioById(flags.only)] : SCENARIOS;
  if (chosen.some((s) => !s)) {
    console.error(`unknown scenario: ${flags.only}\nKnown: ${SCENARIOS.map((s) => s.id).join(', ')}`);
    return 1;
  }

  const width = Math.max(...SCENARIOS.map((s) => s.id.length)) + 2;
  console.log(`Replaying ${chosen.length} scenario(s) against the real run loop — offline.\n`);

  for (const s of chosen as typeof SCENARIOS) {
    const started = Date.now();
    const run = await runScenario(s);
    const d = run.diagnostics;
    const summary = [
      `verdict=${d.likelyCause}`,
      `tools=${run.toolCalls.length}`,
      `turns=${d.turns}`,
      d.stallRecoveries ? `reprompts=${d.stallRecoveries}` : '',
      d.modelFailovers ? `failovers=${d.modelFailovers}` : '',
      d.stallUnrecovered ? 'GAVE-UP' : '',
    ].filter(Boolean).join(' · ');
    console.log(`  ${pad(s.id, width)}${summary}  (${Date.now() - started}ms)`);

    if (flags.only) {
      if (flags.json) {
        console.log(JSON.stringify({ diagnostics: d, toolCalls: run.toolCalls, requests: run.requests }, null, 2));
      } else {
        console.log(`\n${'─'.repeat(72)}\n${s.what}\n${'─'.repeat(72)}\n`);
        console.log(run.transcript);
      }
    }
  }
  return 0;
}

async function main(): Promise<number> {
  const { mode, rest, flags } = parse(process.argv.slice(2));

  if (mode === 'list') {
    console.log(USAGE);
    console.log('\nScenarios:');
    for (const s of SCENARIOS) console.log(`  ${pad(s.id, 26)}${s.what}`);
    return 0;
  }

  if (mode === 'probe') {
    const prompt = rest.join(' ').trim();
    if (!prompt) {
      console.error('probe needs a prompt.\n\n' + USAGE);
      return 1;
    }
    try {
      const result = await probe({
        prompt,
        ...(flags.chat != null && Number.isFinite(flags.chat) ? { chatId: flags.chat } : {}),
        ...(flags.project != null && Number.isFinite(flags.project) ? { projectId: flags.project } : {}),
        ...(flags.model ? { model: flags.model } : {}),
        ...(flags.root ? { root: flags.root } : {}),
        ...(flags.key ? { editorKey: flags.key } : {}),
        ...(flags.baseUrl ? { baseUrl: flags.baseUrl } : {}),
        localToolsOnly: flags.localToolsOnly,
        noTools: flags.noTools,
        onDelta: (d) => process.stderr.write(d),
        onTool: (name) => process.stderr.write(`\n  → ${name}\n`),
      });
      process.stderr.write('\n\n');
      if (flags.json) {
        console.log(JSON.stringify({ chatId: result.chatId, diagnostics: result.diagnostics, tools: result.tools }, null, 2));
      } else {
        console.log(result.transcript);
      }
      // A run that never emitted a tool call, or was handed none, is a failure worth a
      // non-zero exit so CI and shell pipelines can gate on it.
      const bad = new Set(['no-tools-advertised', 'tool-not-advertised', 'tool-calls-not-emitted']);
      return bad.has(result.diagnostics.likelyCause) ? 2 : 0;
    } catch (e) {
      console.error(`probe failed: ${e instanceof Error ? e.message : String(e)}`);
      return 1;
    }
  }

  return replay(flags);
}

main().then(
  (code) => { process.exitCode = code; },
  (e) => {
    console.error(e);
    process.exitCode = 1;
  },
);
