/**
 * The catalogue of chat failures the VSIX has actually shipped, written down.
 *
 * Each entry states a model BEHAVIOUR and nothing else; the loop's response to it is
 * what the tests assert. Adding a scenario here is how a newly-reported failure stops
 * being reproducible only by hand.
 *
 * Every scenario runs offline in milliseconds. `pnpm harness` prints the verdict each
 * one produces, which is the fastest way to see whether a change to the loop, the tool
 * selection or the diagnostics moved anything.
 */

import type { Scenario } from './runScenario';

/** The prompt from the reported VS Code chat #85, kept verbatim. */
const TICKET_TRIAGE_PROMPT =
  'review all tickets in the backlog and group them by their status, then run the ticket diagnostics for each ticket. Summarize what is preventing each from executing. Then fix the code';

export const SCENARIOS: Scenario[] = [
  {
    id: 'narrates-forever',
    what: 'Model describes tool calls in prose and never emits one (observed: xai-oauth/grok-4.3, chat #85)',
    prompt: TICKET_TRIAGE_PROMPT,
    model: 'xai-oauth/grok-4.3',
    // Every turn promises. This is the run that produced nine turns, zero tool calls and
    // a "healthy" diagnostics verdict before the stall detector existed.
    script: () => ({
      text: "I'll start by listing all linked tickets for this chat. Calling the required function now.",
      usage: { prompt: 3800, completion: 40 },
      resolvedModel: 'xai-oauth/grok-4.3',
      account: 'own',
    }),
  },
  {
    id: 'pseudo-call-text',
    what: 'Model writes the call itself as plain text ("run tool builtin_… with chatId is 85") — the form that scored as a complete answer',
    prompt: TICKET_TRIAGE_PROMPT,
    model: 'xai-oauth/grok-4.3',
    script: () => ({
      text: 'run tool builtin_chats_list_tickets with chatId is 85',
      usage: { prompt: 3900, completion: 20 },
      resolvedModel: 'xai-oauth/grok-4.3',
    }),
  },
  {
    id: 'narrates-then-acts',
    what: 'Model stalls once, then acts after the loop re-prompts it — the recovery must actually rescue the run',
    prompt: 'List the tickets linked to this chat.',
    script: [
      { text: "Let me check the linked tickets.", usage: { prompt: 3000, completion: 12 } },
      {
        text: '',
        toolCalls: [{ name: 'builtin_chats_list_tickets', args: { chatId: 85 } }],
        usage: { prompt: 3100, completion: 18 },
      },
      { text: 'This chat has 2 linked tickets: #12 (in progress) and #19 (backlog).', usage: { prompt: 3400, completion: 30 } },
    ],
    toolResults: {
      builtin_chats_list_tickets: [
        { kind: 'task', ref: '12', label: 'Fix login error', status: 'in_progress' },
        { kind: 'task', ref: '19', label: 'Add audit export', status: 'backlog' },
      ],
    },
  },
  {
    id: 'failover-rescues',
    what: 'One model will not emit calls; the loop switches to another that will, rather than handing the user a promise',
    prompt: 'List the tickets linked to this chat.',
    model: 'xai-oauth/grok-4.3',
    fallbackModels: ['anthropic/claude-sonnet-5'],
    script: (ctx) => {
      // Still on the first model: promise, never act.
      if (ctx.requestedModel !== 'anthropic/claude-sonnet-5') {
        return { text: "I'll call the tool now.", resolvedModel: 'xai-oauth/grok-4.3' };
      }
      // On the replacement: call once, then answer from the result. (Answering off the
      // presence of a tool result, rather than a turn count, keeps the script honest if
      // the loop's turn accounting ever changes.)
      const acted = ctx.messages.some((m) => m.role === 'tool');
      return acted
        ? { text: 'No tickets are linked to this chat.', resolvedModel: 'anthropic/claude-sonnet-5' }
        : {
            text: '',
            toolCalls: [{ name: 'builtin_chats_list_tickets', args: { chatId: 85 } }],
            resolvedModel: 'anthropic/claude-sonnet-5',
          };
    },
    toolResults: { builtin_chats_list_tickets: [] },
  },
  {
    id: 'xml-dialect',
    what: 'Model emits `<tool_call>` markup in the text stream instead of native tool_calls — it must still execute, and the markup must not reach the bubble',
    prompt: 'List the tickets linked to this chat.',
    script: [
      {
        text: 'Looking that up. <tool_call>builtin_chats_list_tickets<arg_key>chatId</arg_key><arg_value>85</arg_value></tool_call>',
      },
      { text: 'There are no tickets linked to this chat yet.' },
    ],
    toolResults: { builtin_chats_list_tickets: [] },
  },
  {
    id: 'no-tools-advertised',
    what: 'The gateway tool catalog failed to load, so the turn was handed zero tools — a config fault that used to read as a model fault',
    prompt: TICKET_TRIAGE_PROMPT,
    noTools: true,
    script: () => ({
      text: 'Cannot complete the request. No ticket, backlog or diagnostic data is available to me.',
      usage: { prompt: 1200, completion: 25 },
    }),
  },
  {
    id: 'tool-not-advertised',
    what: 'Per-turn tool selection dropped the tool the prompt told the model to call, so it narrated a function it was never given',
    prompt: TICKET_TRIAGE_PROMPT,
    // Deliberately WITHOUT builtin_chats_list_tickets, which the chat↔ticket directive
    // in the system prompt instructs the model to call.
    tools: ['read_file', 'list_files', 'search_code', 'builtin_projects_list'],
    script: () => ({
      text: 'I will call builtin_chats_list_tickets with chatId 85 to get the linked tickets.',
      usage: { prompt: 2400, completion: 22 },
    }),
  },
  {
    id: 'unbacked-write-claim',
    what: 'Model says it saved a file while no write tool succeeded — the "it told me it updated the file but it did not" report',
    prompt: 'Add a Testing section to README.md.',
    script: [{ text: 'Done — I updated the README.md file with a new Testing section.' }],
  },
  {
    id: 'unbacked-ticket-claim',
    what: 'Model says it filed a ticket while no create/link tool succeeded',
    prompt: 'Log the flaky login test as a bug.',
    script: [{ text: 'I have created a bug ticket for the flaky login test and linked it to this chat.' }],
  },
  {
    id: 'context-exhaustion',
    what: 'A huge tool result floods the window, the gateway silently downgrades, and the turn ends on `length`',
    prompt: 'List every task on the board and summarise them.',
    model: 'anthropic/claude-sonnet-5',
    script: [
      { text: '', toolCalls: [{ name: 'builtin_tasks_list', args: {} }], usage: { prompt: 4000, completion: 15 } },
      {
        text: '',
        finishReason: 'length',
        usage: { prompt: 31000, completion: 4096 },
        // The gateway failed over to something with a smaller window mid-run.
        resolvedModel: 'openai/gpt-4o-mini',
      },
    ],
    toolResults: {
      // 400 rows — comfortably past the per-result trim, which is the signal the
      // diagnostics reads as context pressure.
      builtin_tasks_list: Array.from({ length: 400 }, (_, i) => ({
        id: i + 1,
        title: `Task number ${i + 1} with a reasonably long descriptive title`,
        status: i % 3 === 0 ? 'backlog' : 'in_progress',
        description: 'x'.repeat(120),
      })),
    },
  },
  {
    id: 'tool-budget-exhausted',
    what: 'Model chains tool calls without ever concluding — the loop must force a final prose answer instead of dying',
    prompt: 'Find every place the gateway base URL is read.',
    script: (ctx) =>
      ctx.toolless
        ? { text: 'The base URL is read in gateway.ts and bfApi.ts. I ran out of budget before checking the webview.' }
        : { text: '', toolCalls: [{ name: 'search_code', args: { query: `getBaseUrl-${ctx.turn}` } }] },
    toolResults: { search_code: { matches: [] } },
  },
  {
    id: 'gateway-error',
    what: 'The completion request fails outright — the error must reach the user, not be swallowed',
    prompt: 'Hello.',
    script: [{ throws: new Error('HTTP 402: this model requires a validated card on file') }],
  },
  {
    id: 'healthy-baseline',
    what: 'A normal successful run — the control, so a change that breaks ordinary chats is caught too',
    prompt: 'What projects exist in this workspace?',
    script: [
      { text: '', toolCalls: [{ name: 'builtin_projects_list', args: {} }], usage: { prompt: 2000, completion: 10 } },
      { text: 'You have one project: Builderforce.ai.', usage: { prompt: 2200, completion: 14 } },
    ],
    toolResults: { builtin_projects_list: [{ id: 1, name: 'Builderforce.ai' }] },
  },
];

/** Look one up by id (used by the CLI's `--only` flag). */
export function scenarioById(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
