/**
 * How a Creation Session's timeline becomes the CONVERSATION a model is given —
 * and how a speaker label the model copied back is taken off its answer again.
 *
 * ── THE DEFECT THIS EXISTS TO STOP ───────────────────────────────────────────────
 * The timeline was flattened for the model by prefixing every message with its
 * author's display name (`You: …`, `Brain: …`). For a multi-agent turn that is
 * necessary — several assistants share one `assistant` role and are otherwise
 * indistinguishable. For the ordinary solo turn it is actively harmful: it hands the
 * model a transcript in which every assistant line begins with `Brain:` and teaches
 * it that an answer IS that format.
 *
 * Measured on the public landing canvas, 2026-08-12 (ui 2026.7.210): a first turn
 * failed and its runtime notice was written back as an assistant message. The next
 * turn then returned, verbatim, `Brain: I couldn't prepare any canvas changes from
 * that request.` — 15 completion tokens, zero tool calls. That answer was stored and
 * relabelled, so the turn after it produced `Brain: Brain: I couldn't prepare…`. The
 * accumulating prefix is the signature of the bug: the model was copying its own
 * transcript instead of acting on the request.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────────
 *  • The `user` and `assistant` ROLES already say "the human" and "the coordinating
 *    Brain". Never label those — a name in the content is redundant and mimicable.
 *  • Label ONLY an assistant turn authored by a named specialist AGENT, which is the
 *    one case the role cannot disambiguate.
 *  • A runtime failure notice is not conversation. It is excluded entirely, so a turn
 *    that failed cannot teach the next turn how to fail.
 *  • Defensively, {@link stripSpeakerLabel} removes a leading `Name:` the model
 *    emitted anyway, so a relapse never compounds across turns.
 */

/** The shape this module needs from a canvas timeline message. */
export interface CanvasTranscriptMessage {
  messageRole: 'user' | 'assistant' | 'system';
  body: string;
  metadata?: {
    error?: boolean;
    authoredBy?: { kind: 'agent' | 'brain' | 'human'; ref: string; name: string };
  };
}

export interface CanvasConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * Build the conversation array sent with a canvas turn.
 *
 * Runtime error notices are dropped, and only specialist-agent turns carry a speaker
 * label — see the rule above.
 */
export function canvasTranscriptForModel(
  timeline: readonly CanvasTranscriptMessage[],
): CanvasConversationMessage[] {
  return timeline.flatMap((message) => {
    // A failure notice the RUNTIME wrote (a rejected turn, a failed agent group).
    // Replaying it as a prior turn is what let one failed turn become the template
    // for every turn after it.
    if (message.metadata?.error === true) return [];
    const body = message.body.trim();
    if (!body) return [];
    const author = message.metadata?.authoredBy;
    // Only a named specialist agent needs a label: several agents share the single
    // `assistant` role, so without one the model cannot tell them apart. The human
    // and Brain are already identified by their role.
    const content = author?.kind === 'agent' && author.name ? `${author.name}: ${body}` : body;
    return [{ role: message.messageRole, content }];
  });
}

/**
 * Longest speaker label a model would plausibly echo. Bounded so this can never eat
 * the opening of a real sentence that happens to contain a colon
 * ("Step 1: install the CLI" is content, not a label).
 */
const MAX_SPEAKER_LABEL_CHARS = 40;
const LEADING_SPEAKER_LABEL = /^[ \t]*([\p{L}\p{N} .'’&-]{1,40}):[ \t]+(?=\S)/u;

/**
 * Remove speaker labels the model copied onto the front of its own answer.
 *
 * Applied to every canvas answer, repeatedly, because the observed failure compounds:
 * one relapse produces `Brain: …`, and if that is stored it produces `Brain: Brain: …`
 * on the following turn. `names` are the labels this surface actually uses, so an
 * answer that legitimately opens `Warning: the dataset is stale` is left alone.
 */
export function stripSpeakerLabel(text: string, names: readonly string[]): string {
  const known = new Set(
    names
      .map((name) => name.trim().toLocaleLowerCase())
      .filter((name) => name.length > 0 && name.length <= MAX_SPEAKER_LABEL_CHARS),
  );
  if (!known.size) return text;
  let out = text;
  // Bounded rather than `while (true)`: a pathological answer of nothing but labels
  // must not spin, and no real answer carries more than a couple.
  for (let pass = 0; pass < 8; pass += 1) {
    const match = LEADING_SPEAKER_LABEL.exec(out);
    if (!match || !known.has(match[1]!.trim().toLocaleLowerCase())) return out;
    out = out.slice(match[0].length);
  }
  return out;
}

/**
 * Speaker labels actually present in a conversation — `Brain`, any invited specialist,
 * and whatever prefix earlier turns already carry. Feeds {@link stripSpeakerLabel} so
 * it only ever removes a label this session really uses.
 */
export function conversationSpeakerLabels(
  conversation: readonly CanvasConversationMessage[] | undefined,
  extra: readonly (string | undefined)[] = [],
): string[] {
  const labels = new Set<string>(['Brain']);
  for (const name of extra) if (name?.trim()) labels.add(name.trim());
  for (const message of conversation ?? []) {
    if (message.role !== 'assistant') continue;
    const match = LEADING_SPEAKER_LABEL.exec(message.content);
    if (match) labels.add(match[1]!.trim());
  }
  return [...labels];
}

/** Comparable form of an answer: label-free, case-folded, whitespace-collapsed. */
function comparable(text: string, labels: readonly string[]): string {
  return stripSpeakerLabel(text, labels).toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * True when a model's reply is a REPRODUCTION of something already in the transcript
 * rather than an answer to the latest message.
 *
 * This is the measured Canvas failure mode, not a hypothetical: a free model given a
 * transcript whose last assistant line was a failure notice returned that exact line
 * back, and the surface presented it to the user as a fresh answer. A reply that
 * merely resembles an earlier one is fine; an identical one never is.
 */
export function echoesEarlierAnswer(
  answer: string,
  conversation: readonly CanvasConversationMessage[] | undefined,
  labels: readonly string[],
): boolean {
  const candidate = comparable(answer, labels);
  if (!candidate) return false;
  return (conversation ?? []).some(
    (message) => message.role === 'assistant' && comparable(message.content, labels) === candidate,
  );
}
