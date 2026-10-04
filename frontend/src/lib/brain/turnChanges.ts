import { isStepMessage, parseStepMessage } from '@seanhogg/builderforce-brain-embedded';

/** The fields of a conversation message this reads. */
interface TurnMessage {
  id: number;
  role: string;
  metadata: string | null;
}

/**
 * The files an agent turn changed, read from the turn's persisted tool steps.
 *
 * A turn is everything between one user message and the next. The tools that
 * commit to a workspace say so in their result — the build tools answer
 * `{ applied: true, path }`, the workspace's `create_file` answers `{ created }`
 * — so this reads that shape instead of matching tool names, which a surface may
 * prefix. Failed steps never count.
 *
 * Returns the paths in first-write order, or null when `replyId` is not the LAST
 * reply of its turn (the card belongs once per turn, under its final word).
 */
export function turnChangedFiles(messages: readonly TurnMessage[], replyId: number): string[] | null {
  const at = messages.findIndex((m) => m.id === replyId);
  if (at < 0) return null;

  let start = at;
  while (start > 0 && messages[start - 1]!.role !== 'user') start -= 1;
  let end = at + 1;
  while (end < messages.length && messages[end]!.role !== 'user') end += 1;

  const turn = messages.slice(start, end);
  const lastReply = [...turn].reverse().find((m) => m.role === 'assistant');
  if (lastReply?.id !== replyId) return null;

  const paths: string[] = [];
  for (const message of turn) {
    if (!isStepMessage(message)) continue;
    const parsed = parseStepMessage(message.metadata);
    if (!parsed || parsed.step.isError) continue;
    const path = committedPath(parsed.step.result);
    if (path && !paths.includes(path)) paths.push(path);
  }
  return paths;
}

/** The path a committing tool reports, from its (possibly stringified) result. */
function committedPath(result: unknown): string | null {
  let value = result;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return null; }
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as { applied?: unknown; path?: unknown; created?: unknown; error?: unknown };
  if (record.error) return null;
  if (record.applied === true && typeof record.path === 'string' && record.path) return record.path;
  if (typeof record.created === 'string' && record.created) return record.created;
  return null;
}
