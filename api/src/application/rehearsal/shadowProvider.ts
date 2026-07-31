/**
 * shadowProvider — the decorator that turns a live capability provider into a rehearsal.
 *
 * The whole design of a rehearsal is here, and it is deliberately ONE function rather
 * than a parallel loop: reads pass through untouched, effects are recorded and faked.
 * The agent runs the same registry, the same prompts and the same model as production,
 * and it cannot tell the difference — which is the only way a rehearsal predicts
 * anything about the live run it is standing in for.
 *
 * WHAT IS SUPPRESSED (everything that escapes the process):
 *   repo.write / repo.edit / repo.delete → recorded, never committed
 *   memory.remember / memory.forget      → recorded, memory left untouched
 *   human.ask                            → recorded, nobody is paged; a synthetic
 *                                          answer keeps the loop moving instead of
 *                                          parking the run forever
 *   coordinate.claim / release / postNote → recorded, no real lease is taken (a
 *                                          rehearsal must never block a live agent)
 *
 * WHAT PASSES THROUGH: repo.read/search, web fetch/search, static-check,
 * memory.recall, coordinate.listClaims/readNotes. A rehearsal must SEE the same world
 * the live run sees, including the notes and leases of agents working right now.
 *
 * A suppressed write returns `ok: true` with a note. Returning a failure would be a
 * lie in the other direction: the agent would retry, escalate, or abandon the plan, and
 * the transcript would tell you how the agent behaves when git is broken rather than
 * what it would have delivered.
 */

import type {
  CapabilityProvider,
  CoordinationCapability,
  HumanCapability,
  MemoryCapability,
  RepoWriteCapability,
} from '@builderforce/agent-tools';

/** One suppressed effect, in the order it happened. */
export interface ShadowStep {
  op: string;
  target: string;
  detail: Record<string, unknown>;
}

/** Collects the suppressed effects. In-memory during the run, flushed to
 *  `rehearsal_steps` when it ends — one batch insert instead of a write per tool call. */
export class ShadowRecorder {
  private readonly entries: ShadowStep[] = [];

  record(op: string, target: string, detail: Record<string, unknown> = {}): void {
    this.entries.push({ op, target, detail });
  }

  get steps(): readonly ShadowStep[] {
    return this.entries;
  }

  /** Effects that would have changed the repository — the headline count. */
  get writeCount(): number {
    return this.entries.filter((e) => e.op.startsWith('repo.')).length;
  }
}

/** Cap on echoed content so a rehearsal of a large refactor doesn't blow up the row. */
const MAX_RECORDED_CONTENT = 20_000;
const clip = (s: string): string => (s.length > MAX_RECORDED_CONTENT ? `${s.slice(0, MAX_RECORDED_CONTENT)}\n…[truncated]` : s);

const SUPPRESSED_NOTE =
  'REHEARSAL: recorded, not applied. Continue exactly as you would normally — the run is being '
  + 'measured on what you would have done.';

function shadowRepoWrite(inner: RepoWriteCapability | undefined, rec: ShadowRecorder): RepoWriteCapability | undefined {
  if (!inner) return undefined;
  return {
    async writeFile(path, content, summary) {
      rec.record('repo.write', path, { content: clip(content), summary });
      return { ok: true, change: 'modified', note: SUPPRESSED_NOTE };
    },
    async editFile(path, oldString, newString, replaceAll) {
      rec.record('repo.edit', path, { oldString: clip(oldString), newString: clip(newString), replaceAll: replaceAll === true });
      return { ok: true, change: 'modified', replaced: 1, note: SUPPRESSED_NOTE };
    },
    async deleteFile(path, reason) {
      rec.record('repo.delete', path, { reason });
      return { ok: true, deleted: true, note: SUPPRESSED_NOTE };
    },
  };
}

function shadowMemory(inner: MemoryCapability | undefined, rec: ShadowRecorder): MemoryCapability | undefined {
  if (!inner) return undefined;
  return {
    // Recall PASSES THROUGH: the agent must reason over the memory it really has, or
    // the rehearsal measures a different agent than the one that would run.
    recall: (query, limit) => inner.recall(query, limit),
    async remember(key, content, opts) {
      rec.record('memory.remember', key, { content: clip(content), scope: opts?.scope, ttlDays: opts?.ttlDays });
      return { ok: true, key };
    },
    async forget(key) {
      rec.record('memory.forget', key, {});
      return { ok: true, key, deleted: true };
    },
  };
}

function shadowHuman(inner: HumanCapability | undefined, rec: ShadowRecorder): HumanCapability | undefined {
  if (!inner) return undefined;
  return {
    async ask(question, context) {
      rec.record('human.ask', question.slice(0, 200), { question, context });
      // Answer synthetically rather than pausing. A rehearsal that parks on the first
      // question tells you only that the agent asks questions — the point is to see the
      // whole plan, so record the escalation and let the run continue.
      return {
        paused: false,
        answer:
          'REHEARSAL: no human is available. Assume the most reasonable default, state the '
          + 'assumption in your summary, and continue.',
        note: SUPPRESSED_NOTE,
      };
    },
  };
}

function shadowCoordination(inner: CoordinationCapability | undefined, rec: ShadowRecorder): CoordinationCapability | undefined {
  if (!inner) return undefined;
  return {
    // Reads pass through — a rehearsal should see what live agents currently hold.
    listClaims: () => inner.listClaims(),
    readNotes: (query, limit) => inner.readNotes(query, limit),
    // Writes are suppressed: a rehearsal must never take a lease a live agent then
    // waits on, and must never post to a board real agents are reading.
    async claim(resource, opts) {
      rec.record('coordinate.claim', resource, { mode: opts?.mode ?? 'exclusive', reason: opts?.reason });
      return { ok: true, resource, mode: opts?.mode ?? 'exclusive', granted: true, note: SUPPRESSED_NOTE };
    },
    async release(resource) {
      rec.record('coordinate.release', resource, {});
      return { ok: true, resource, released: true };
    },
    async postNote(key, content) {
      rec.record('coordinate.note', key, { content: clip(content) });
      return { ok: true, key };
    },
  };
}

/**
 * Wrap a live provider so nothing escapes.
 *
 * The capability SET is passed through almost unchanged, because withdrawing
 * `repo.write` would produce a rehearsal of a read-only agent — the model must be
 * offered exactly the tools it would get on a real run, and see them "succeed".
 *
 * `shell` is the ONE exception, and it is dropped from both the service bag and the
 * advertised set. A shell cannot be shadowed: there is no way to tell `ls` from
 * `rm -rf` before running it, so passing it through would make "nothing escapes" false
 * the moment a rehearsal ran on a shell-capable surface. Today rehearsals run on the
 * durable/Worker surface, which has no shell, so this strips nothing in practice — it
 * is the guarantee that stays true if that ever changes.
 */
export function shadowProvider(inner: CapabilityProvider, rec: ShadowRecorder): CapabilityProvider {
  const capabilities = inner.capabilities.has('shell')
    ? new Set([...inner.capabilities].filter((c) => c !== 'shell' && c !== 'process'))
    : inner.capabilities;
  return {
    capabilities,
    repoRead: inner.repoRead,
    staticCheck: inner.staticCheck,
    web: inner.web,
    repoWrite: shadowRepoWrite(inner.repoWrite, rec),
    memory: shadowMemory(inner.memory, rec),
    human: shadowHuman(inner.human, rec),
    coordination: shadowCoordination(inner.coordination, rec),
  };
}
