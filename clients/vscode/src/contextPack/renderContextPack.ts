/**
 * The TASK CONTEXT PACK, rendered (PRD 35 §3.2 `ContextPack`, §6.10, E2) — what a run
 * knows at turn 1 without a tool call: the files the request names (whole when small,
 * else their outline with line numbers), the chat's linked tickets and runs, git state
 * per checkout, and the `codemap:` facts for the areas those files sit in.
 *
 * It rides the volatile turn-context block (`runContextFor` → `turnContext.ts`), never
 * the cached system prefix. Capped: when the parts exceed the budget the LARGEST is
 * dropped first, and the block says what it dropped so the model knows to read it.
 *
 * Pure: parts in, text out. Gathering the parts is `contextPackSources.ts`.
 */

/** ≈8k tokens — the pack's budget (§6.10). */
export const CONTEXT_PACK_CHAR_CAP = 32_000;
/** A focus file at most this long is inlined whole; a longer one is outlined. */
export const FOCUS_INLINE_CHARS = 16_000;
/** Outline entries per focus file — enough to page by heading. */
export const FOCUS_OUTLINE_ENTRIES = 80;
/** Dirty files listed per checkout. */
export const DIRTY_FILES_SHOWN = 20;

export interface ContextPackFocus {
  /** Workspace-relative path. */
  path: string;
  totalLines: number;
  /** The whole file, when it is under {@link FOCUS_INLINE_CHARS}. */
  content?: string;
  /** Otherwise: what it defines / its headings, with line numbers. */
  outline?: Array<{ heading: string; line: number }>;
}

export interface ContextPackTicket {
  kind: string;
  ref: string;
  label: string;
  status: string;
  progressPct?: number;
}

export interface ContextPackRun {
  executionId: number;
  taskTitle: string | null;
  agentName: string | null;
  status: string;
  executor?: string | null;
  errorMessage?: string | null;
}

export interface ContextPackChat {
  tickets: ContextPackTicket[];
  /** null = the run history could not be read (never "nothing ran"). */
  runs: ContextPackRun[] | null;
}

export interface ContextPackRepo {
  /** Checkout name (its folder). */
  repo: string;
  branch?: string;
  ahead?: number;
  behind?: number;
  /** Uncommitted files, repo-relative, capped at {@link DIRTY_FILES_SHOWN}. */
  dirty: string[];
  dirtyTotal: number;
}

export interface ContextPackParts {
  focus: ContextPackFocus[];
  chat?: ContextPackChat;
  repos?: ContextPackRepo[];
  facts: Array<{ key: string; content: string }>;
}

export interface RenderedContextPack {
  /** The block, or '' when there was nothing to say. */
  block: string;
  /** Section names dropped to fit the cap, largest first. */
  dropped: string[];
  /** The focus files the block carries WHOLE (not dropped, not outlined) — the run's reads already. */
  inlined: string[];
}

interface Section {
  name: string;
  text: string;
  /** Set on a focus file inlined whole: its path. */
  inlinedPath?: string;
}

function focusSection(f: ContextPackFocus): Section {
  if (f.content !== undefined) {
    return {
      name: `focus file ${f.path}`,
      inlinedPath: f.path,
      text: `### Focus file \`${f.path}\` (${f.totalLines} lines, whole file — do not read it again)\n\`\`\`\n${f.content}\n\`\`\``,
    };
  }
  const outline = (f.outline ?? []).slice(0, FOCUS_OUTLINE_ENTRIES);
  const more = (f.outline?.length ?? 0) - outline.length;
  const lines = outline.map((o) => `- L${o.line} ${o.heading}`);
  if (more > 0) lines.push(`- (+${more} more)`);
  return {
    name: `focus file ${f.path} (outline)`,
    text: `### Focus file \`${f.path}\` (${f.totalLines} lines — too large to inline; outline below. Read only the sections you need: read_file with \`offset\` at a line here and a small \`limit\`)\n${lines.join("\n") || "- (no headings or definitions recognised)"}`,
  };
}

function chatSection(chat: ContextPackChat): Section {
  const tickets = chat.tickets.length
    ? chat.tickets.map((t) => `- ${t.kind} ${t.ref}: ${t.label} — ${t.status}${t.progressPct != null ? ` (${t.progressPct}%)` : ""}`)
    : ["- (no linked tickets)"];
  const runs = chat.runs == null
    ? ["- (run history could not be read)"]
    : chat.runs.length
      ? chat.runs.map((r) => `- #${r.executionId} ${r.taskTitle ?? "(untitled)"} — ${r.status}${r.agentName ? ` by ${r.agentName}` : ""}${r.executor ? ` [${r.executor}]` : ""}${r.errorMessage ? ` · ${r.errorMessage.slice(0, 160)}` : ""}`)
      : ["- (nothing has run for this chat)"];
  return {
    name: "chat state",
    text: `### Chat state (already read — do not call chats_list_tickets or chats_runs for it)\nLinked tickets:\n${tickets.join("\n")}\nRuns:\n${runs.join("\n")}`,
  };
}

function repoLine(r: ContextPackRepo): string {
  const sync = [r.ahead ? `ahead ${r.ahead}` : "", r.behind ? `behind ${r.behind}` : ""].filter(Boolean).join(", ");
  const head = `- ${r.repo}: ${r.branch ?? "(detached)"}${sync ? ` (${sync})` : ""}`;
  if (r.dirtyTotal === 0) return `${head} — clean`;
  const more = r.dirtyTotal - r.dirty.length;
  return `${head} — ${r.dirtyTotal} uncommitted: ${r.dirty.join(", ")}${more > 0 ? ` (+${more} more)` : ""}`;
}

function sectionsOf(parts: ContextPackParts): Section[] {
  const out: Section[] = parts.focus.map(focusSection);
  if (parts.chat) out.push(chatSection(parts.chat));
  if (parts.repos?.length) out.push({ name: "git state", text: `### Git state per checkout\n${parts.repos.map(repoLine).join("\n")}` });
  if (parts.facts.length) {
    out.push({
      name: "code map facts",
      text: `### Code map facts for these areas (open these files first instead of searching)\n${parts.facts.map((f) => `#### ${f.key}\n${f.content}`).join("\n")}`,
    });
  }
  return out;
}

const HEADER = "## Task context pack (gathered before turn 1 — what is here needs no tool call)";

/** The pack as one block, capped at `cap` characters, largest parts dropped first. */
export function renderContextPack(parts: ContextPackParts, cap: number = CONTEXT_PACK_CHAR_CAP): RenderedContextPack {
  let sections = sectionsOf(parts);
  if (sections.length === 0) return { block: "", dropped: [], inlined: [] };
  const dropped: string[] = [];
  const size = (list: Section[]): number => HEADER.length + list.reduce((n, s) => n + s.text.length + 2, 0) + 200;
  while (sections.length > 0 && size(sections) > cap) {
    const largest = sections.reduce((a, b) => (b.text.length > a.text.length ? b : a));
    dropped.push(largest.name);
    sections = sections.filter((s) => s !== largest);
  }
  const body = sections.map((s) => s.text);
  if (dropped.length) body.push(`dropped to fit the pack: ${dropped.join("; ")} — read them yourself if you need them.`);
  const inlined = sections.flatMap((s) => (s.inlinedPath ? [s.inlinedPath] : []));
  return { block: [HEADER, ...body].join("\n\n"), dropped, inlined };
}

/**
 * The recall hint the pack gives Evermind (`BrainRunRequest.recallHint`): the focus
 * files' paths and their top headings, then the code paths those files name (§6.10 — a
 * PRD names the modules it changes), so recall searches the code the request is about.
 */
export function contextPackRecallHint(parts: Pick<ContextPackParts, "focus">, headingsPerFile = 6, named: readonly string[] = []): string {
  const focus = new Set(parts.focus.map((f) => f.path));
  return [
    ...parts.focus.map((f) => [f.path, ...(f.outline ?? []).slice(0, headingsPerFile).map((o) => o.heading)].join(" ")),
    ...[...new Set(named)].filter((p) => !focus.has(p)),
  ]
    .join(" ")
    .trim();
}
