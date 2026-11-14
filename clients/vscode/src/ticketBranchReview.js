/**
 * The ticket branch review — "which tickets have pending code, and what should happen to
 * each" — as pure classification and formatting. The git facts and ticket list come in;
 * a compact, grouped verdict goes out. No I/O (see `ticketBranchTool.ts` for that).
 *
 * ── WHY ONE CALL ─────────────────────────────────────────────────────────────
 * Asked to "review the open tickets; merge the ones with pending changes", a VS Code run
 * spent ~40 calls assembling this picture by hand: `git branch -a`, a `for` loop of
 * `git log main..X`, a `rev-list --count` sweep, then `tasks_get` on each ticket to learn
 * its branch and PR. Every one of those answers is mechanical, so the whole picture is
 * one tool result — and the model's calls go to the judgement it is actually for.
 */
/** Groups in the order a reviewer acts on them. */
export const VERDICT_ORDER = [
    "ready", "conflicts", "merged_pr_leftover", "in_base", "branch_missing", "unknown", "no_branch",
];
/** What to do about each verdict — stated once, returned with the review. */
export const NEXT_STEP = {
    ready: "Check it still fits the codebase and roadmap, then sync the base into it (git_sync_latest), verify, merge to the base, and close the ticket.",
    conflicts: "Decide whether it is still wanted; if so, sync the base into it, resolve the listed conflicts, verify, merge, and close the ticket.",
    merged_pr_leftover: "Already delivered through its PR (squash-merged). Delete the branch (git_cleanup_merged with force:true) and close the ticket.",
    in_base: "Nothing left to merge. Close the ticket if it is not done, and delete the branch.",
    branch_missing: "The named branch is gone (usually deleted after merge). Confirm the work landed, then close the ticket.",
    unknown: "The merge check could not run here (git < 2.38?). Inspect with git_history / git_diff.",
    no_branch: "No code was pushed for these tickets — nothing to merge.",
};
const TERMINAL_STATUSES = new Set(["done", "cancelled", "canceled", "closed", "archived"]);
export function isOpenTicket(status) {
    return !TERMINAL_STATUSES.has((status ?? "").toLowerCase());
}
/** `builderforce/task-58` → 58. The platform's own branch convention for a ticket. */
export function taskIdFromBranch(name) {
    const m = /(?:^|\/)task-(\d+)$/.exec(name);
    return m ? Number(m[1]) : undefined;
}
/** The ticket's branch: the one it names, else one following the `…/task-<id>` convention. */
export function branchForTicket(ticket, branchNames) {
    if (ticket.gitBranch)
        return ticket.gitBranch;
    for (const name of branchNames)
        if (taskIdFromBranch(name) === ticket.id)
            return name;
    return undefined;
}
export function classify(ticket, branch, exists, comparison) {
    if (!branch)
        return "no_branch";
    if (!exists)
        return "branch_missing";
    if (!comparison)
        return "unknown";
    if (comparison.ahead === 0 || comparison.merge === "in_base")
        return "in_base";
    // A merged PR whose branch still differs is a squash-merge leftover — even when a
    // naive merge would "conflict" (the base has since moved on over the same lines).
    if (ticket.prState === "merged")
        return "merged_pr_leftover";
    if (comparison.merge === "conflicts")
        return "conflicts";
    if (comparison.merge === "clean")
        return "ready";
    return "unknown";
}
function clip(text, max) {
    return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
/** One ticket as a single scan-able line. */
export function formatRow(row) {
    const t = row.ticket;
    const parts = [`#${t.id} [${t.status ?? "?"}]`];
    if (row.branch)
        parts.push(`${row.branch}${row.remoteOnly ? " (origin only)" : ""}`);
    if (row.comparison)
        parts.push(`+${row.comparison.ahead}/-${row.comparison.behind}`);
    if (t.prNumber)
        parts.push(`PR#${t.prNumber}${t.prState ? ` ${t.prState}` : ""}`);
    const conflicts = row.comparison?.conflictFiles ?? [];
    if (conflicts.length)
        parts.push(`conflicts: ${conflicts.slice(0, 4).join(", ")}${conflicts.length > 4 ? ` (+${conflicts.length - 4})` : ""}`);
    return `${parts.join(" ")} — ${clip(t.title, 70)}`;
}
export function formatUntracked(b) {
    const hint = b.impliedTaskId != null ? ` (ticket #${b.impliedTaskId}, not in this review)` : "";
    return `${b.name} +${b.comparison.ahead}/-${b.comparison.behind} ${b.comparison.merge}${hint} · last commit ${b.committedAt.slice(0, 10)}`;
}
/** Characters of rows the result may carry — under the loop's per-result budget. */
const ROW_BUDGET_CHARS = 4_800;
/**
 * The review as the model reads it: counts by verdict, then each group's rows in acting
 * order, then branches no ticket claims. Rows are budgeted so the result is never cut
 * mid-list by the transcript cap; what did not fit is COUNTED, and `only` re-asks for one
 * group in full.
 */
export function formatReview(input) {
    const groups = new Map(VERDICT_ORDER.map((v) => [v, []]));
    for (const row of input.rows)
        groups.get(row.verdict).push(row);
    const summary = {};
    for (const v of VERDICT_ORDER)
        if (groups.get(v).length)
            summary[v] = groups.get(v).length;
    const out = {
        ok: true,
        repo: input.repo,
        base: input.base,
        fetched: input.fetched,
        reviewed: input.rows.length,
        summary,
    };
    let budget = ROW_BUDGET_CHARS;
    const omitted = {};
    const take = (lines) => {
        const kept = [];
        for (const line of lines) {
            if (budget - line.length < 0)
                break;
            budget -= line.length;
            kept.push(line);
        }
        return kept;
    };
    for (const verdict of VERDICT_ORDER) {
        if (input.only && verdict !== input.only)
            continue;
        const rows = groups.get(verdict);
        if (!rows.length)
            continue;
        if (verdict === "no_branch") {
            out.no_branch = `tickets ${rows.map((r) => `#${r.ticket.id}`).join(", ")}`;
            continue;
        }
        const lines = take(rows.map(formatRow));
        out[verdict] = lines;
        if (lines.length < rows.length)
            omitted[verdict] = rows.length - lines.length;
    }
    if (!input.only && input.untracked.length) {
        const lines = take(input.untracked.map(formatUntracked));
        out.untrackedBranches = lines;
        if (lines.length < input.untracked.length)
            omitted.untrackedBranches = input.untracked.length - lines.length;
    }
    out.next = Object.fromEntries(VERDICT_ORDER.filter((v) => groups.get(v).length && (!input.only || v === input.only)).map((v) => [v, NEXT_STEP[v]]));
    const notes = [];
    if (!input.fetched)
        notes.push("Could not fetch origin — this reflects the refs already on this machine.");
    if (Object.keys(omitted).length) {
        notes.push(`Not shown for space: ${Object.entries(omitted).map(([k, n]) => `${n} ${k}`).join(", ")} — call again with \`only\` set to one group to see it in full.`);
    }
    notes.push("Merge checks ran in git's object store (no checkout). Each verdict is mechanical — whether a ready branch still fits the current code and roadmap is your call.");
    out.note = notes.join(" ");
    return out;
}
//# sourceMappingURL=ticketBranchReview.js.map