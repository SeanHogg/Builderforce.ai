/**
 * The visit tally behind the CIRCLING-read guard: how many times a run has gone back to
 * one target, with which argument sets, and whether something with an unknown blast
 * radius ran in between (so the next re-read is fetching news, not circling).
 *
 * One tally, two hosts: the in-memory read guard (`ReadCoverage`, the browser Brain and
 * the VS Code loop) and the durable progress detector (`ProgressDetector`, the cloud
 * loop), which persists it between steps — so its state is plain JSON.
 */
/** Visits to one target before the model is told it is circling. Two reads of a long
 *  file is ordinary (read the top, jump to the section); the THIRD is the point where a
 *  pass stops being navigation and starts being a loop. */
export const REVISIT_NUDGE_AT = 3;
/** Visits after which the advisory escalates from a reminder to an instruction. By the
 *  fifth read of one file the gentle version has demonstrably not worked. */
export const REVISIT_HARD_AT = 5;
/** Distinct argument sets remembered per target — enough to quote back, not a log. */
const MAX_REMEMBERED_ARGS = 8;
export class VisitTally {
    visits;
    constructor(state) {
        this.visits = new Map((state ?? []).map(([k, v]) => [k, { ...v, priorArgs: [...v.priorArgs] }]));
    }
    /**
     * Record one visit to `key` made with `args`. Returns a SNAPSHOT of the resulting
     * visit, so the caller cannot hold — or reset — the live tally. The "something ran
     * that could have changed this" pass is spent by the read it excuses.
     */
    record(key, args) {
        let argText;
        try {
            argText = JSON.stringify(args ?? {});
        }
        catch {
            argText = String(args ?? "");
        }
        const existing = this.visits.get(key);
        if (!existing) {
            const fresh = { count: 1, priorArgs: [argText], mayHaveChanged: false };
            this.visits.set(key, fresh);
            return { ...fresh, priorArgs: [...fresh.priorArgs] };
        }
        existing.count += 1;
        if (!existing.priorArgs.includes(argText) && existing.priorArgs.length < MAX_REMEMBERED_ARGS) {
            existing.priorArgs.push(argText);
        }
        const visit = { ...existing, priorArgs: [...existing.priorArgs] };
        existing.mayHaveChanged = false;
        return visit;
    }
    /** Forget every visit whose key matches. */
    forget(match) {
        for (const key of [...this.visits.keys()])
            if (match(key))
                this.visits.delete(key);
    }
    /** Something with an unknown blast radius ran: excuse the NEXT read of every target. */
    markAllMayHaveChanged() {
        for (const visit of this.visits.values())
            visit.mayHaveChanged = true;
    }
    snapshot() {
        return [...this.visits.entries()].map(([k, v]) => [k, { ...v, priorArgs: [...v.priorArgs] }]);
    }
}
/**
 * The advisory to attach to a read result once a target has been visited enough times
 * to look like circling. Null below the threshold — the overwhelming majority of reads
 * carry nothing extra.
 *
 * Written as a diagnosis plus a next move, not a scolding: a model told only "you are
 * repeating yourself" tends to repeat itself apologetically. It is told what it has
 * already been given, why looking again will not help, and which of the two things it
 * should do instead — page FORWARD through the rest of the file from the offset its
 * last result named, or act on what it has.
 */
export function revisitAdvisory(tool, target, visit) {
    if (visit.count < REVISIT_NUDGE_AT)
        return null;
    // Something ran since the last read of this target, so this one is genuinely fetching
    // news rather than circling.
    if (visit.mayHaveChanged)
        return null;
    const shape = visit.priorArgs.length > 1
        ? ` The argument sets you have already used on it: ${visit.priorArgs.map((a) => `\`${a}\``).join(", ")}.`
        : "";
    if (visit.count >= REVISIT_HARD_AT) {
        return `STOP RE-READING. This is call ${visit.count} of \`${tool}\` against ${target} in this run, and the previous ${visit.count - 1} results are all still above you in this conversation.${shape} Re-reading it again will return content you already have and will not move the task forward — this pattern is how a run exhausts its tool budget without producing a single change. Do ONE of these now: (a) if you still need more of the file, continue from the \`offset\` the last result's note gave you and page forward in order — never re-open a window you already have; (b) otherwise stop reading and make the edit, or state plainly what is blocking you. Do not issue another partial read of this target.`;
    }
    return `You have now read ${target} ${visit.count} times in this run with \`${tool}\`, and every earlier result is still above you in this conversation.${shape} If you are looking for something you have not found, another window over the same lines is unlikely to surface it — page forward from the \`offset\` the last result's note gave you, or search for the specific symbol with search_code. If you already have what you need, act on it rather than re-reading.`;
}
/**
 * Attach an advisory to a tool result without disturbing its shape. Object results gain
 * a `note` field (the same channel the tools' own guidance uses, so the model meets one
 * convention rather than two); anything else is wrapped so the original value survives
 * intact under `result`.
 */
export function withAdvisory(result, advisory) {
    if (result && typeof result === "object" && !Array.isArray(result)) {
        const existing = result.note;
        const note = typeof existing === "string" && existing ? `${existing}\n\n${advisory}` : advisory;
        return { ...result, note };
    }
    return { result, note: advisory };
}
//# sourceMappingURL=visitTally.js.map