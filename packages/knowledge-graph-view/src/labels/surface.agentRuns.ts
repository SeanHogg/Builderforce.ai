/** The Agent runs drawer's words (PRD 46): the interface and its English defaults (a host overrides them per key). */

/** Every finding kind the host's detectors name (PRD 46 §3.1), keyed exactly as the finding's `kind`. */
export type AgentRunFindingKindId =
    | 'analysis_overrun' | 'unkept_readiness' | 'serial_single_writes' | 'prompt_bloat' | 'unverified_writes' | 'bracket_break'
    | 'edit_churn' | 'filed_then_inline' | 'same_model_roles' | 'oversized_args' | 'slow_turns' | 'repeated_narration' | 'stopped_unverified';

/** What an evidence row measured, keyed exactly as the evidence's `note`; the host words it, the run carries only numbers. */
export type AgentRunEvidenceNoteId = 'argBytes' | 'argBytesShared' | 'slowTurn';

export interface AgentRunsLabels {
    agentRuns: {
        loading: string;
        failed: string;
        emptyRuns: string;
        emptyFindings: string;
        runsTitle: string;
        /** A run row's detail line. `{turns}`, `{models}`. */
        runMeta: string;
        /** A run's finding counts in words (never colour alone). `{error}`, `{warn}`, `{info}`. */
        runCounts: string;
        reportLoading: string;
        reportMissing: string;
        stripTitle: string;
        /** One bar's accessible title. `{index}`, `{role}`, `{model}`, `{kind}`, `{prompt}`, `{completion}`, `{tools}`, `{seconds}`. */
        stripBar: string;
        legendTitle: string;
        findingsTitle: string;
        /** An evidence row. `{turn}` (optional part), `{label}`. */
        evidenceRow: string;
        /** An evidence row's measurement, by its `note`. `argBytes*`: `{bytes}`; `slowTurn`: `{ms}`, `{completionTokens}`, `{argBytes}`. */
        evidenceNotes: Record<AgentRunEvidenceNoteId, string>;
        filesTitle: string;
        filesEmpty: string;
        /** `{count}`. */
        fileWrites: string;
        fileChecked: string;
        fileUnchecked: string;
        showOnGraph: string;
        /** "Show on graph" for a file the graph has no node for. */
        notOnGraph: string;
        severity: Record<'info' | 'warn' | 'error', string>;
        turnKinds: Record<'read' | 'write' | 'forced' | 'text' | 'failed', string>;
        /** One title and one description per finding kind; the description's `{param}` holes are the finding's params. */
        findings: Record<AgentRunFindingKindId, { title: string; description: string }>;
    };
}

export const AGENT_RUNS_DEFAULTS: AgentRunsLabels = {
    agentRuns: {
        loading: 'Reading the recorded agent runs…',
        failed: 'The agent runs could not be read.',
        emptyRuns: 'No agent runs recorded on this machine yet.',
        emptyFindings: 'Nothing to flag in this run.',
        runsTitle: 'Recent runs',
        runMeta: '{turns} turns · {models}',
        runCounts: '{error} errors · {warn} warnings · {info} notes',
        reportLoading: 'Reading this run…',
        reportMissing: 'This run is no longer recorded.',
        stripTitle: 'Turns',
        stripBar: 'Turn {index} · {role} · {model} · {kind} · {prompt} prompt tokens · {completion} completion tokens · {tools} tool calls · {seconds} s',
        legendTitle: 'Turn kinds',
        findingsTitle: 'Findings',
        evidenceRow: '[[Turn {turn} · ]]{label}',
        evidenceNotes: {
            argBytes: '{bytes} bytes of arguments',
            argBytesShared: '{bytes} bytes of arguments · repeats a block another call carries',
            slowTurn: '{ms} ms · {completionTokens} completion tokens · {argBytes} bytes of arguments',
        },
        filesTitle: 'Files touched',
        filesEmpty: 'This run wrote no files.',
        fileWrites: '{count} writes',
        fileChecked: 'Checked',
        fileUnchecked: 'Not checked',
        showOnGraph: 'Show on graph',
        notOnGraph: 'Not on this graph',
        severity: { info: 'Note', warn: 'Warning', error: 'Error' },
        turnKinds: { read: 'Read', write: 'Write', forced: 'Forced hand-off', text: 'Text only', failed: 'Failed' },
        findings: {
            analysis_overrun: { title: 'Long analysis before the first write', description: '{readTurns} read-only turns before the first write (turn {firstWriteTurn}).' },
            unkept_readiness: { title: 'Said it was ready, kept reading', description: '{claims} readiness claims were followed by {readTurnsAfter} read-only turns.' },
            serial_single_writes: { title: 'One write per turn', description: '{turns} turns each made a single write, costing {promptTokens} prompt tokens.' },
            prompt_bloat: { title: 'Prompt far larger than the output', description: 'The prompt was {ratio}× the completion: {promptTokens} prompt tokens, {perWrite} per write.' },
            unverified_writes: { title: 'Writes never checked', description: '{files} files ({writes} writes) had no successful check afterwards.' },
            bracket_break: { title: 'An edit broke bracket balance', description: 'An edit to {path} changed the bracket balance ({delta}).' },
            edit_churn: { title: 'The same file rewritten again and again', description: '{path} was written {writes} times.' },
            filed_then_inline: { title: 'Filed tickets, then did the work itself', description: '{tickets} tickets were filed and none dispatched; the session then wrote the code itself.' },
            same_model_roles: { title: 'Planning and coding on one model', description: 'Planning and coding both ran on {model} although the work was handed off.' },
            oversized_args: { title: 'Oversized tool arguments', description: '{calls} {tool} calls carried up to {bytes} bytes of arguments.' },
            slow_turns: { title: 'Slow turns', description: '{turns} turns took a minute or more; the slowest took {slowestMs} ms.' },
            repeated_narration: { title: 'Repeated narration', description: '{turns} turns repeated the same narration before calling a tool.' },
            stopped_unverified: { title: 'Stopped with unchecked writes', description: 'The run was stopped with {files} written files never checked.' },
        },
    },
};
