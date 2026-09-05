export interface ThinkSegment {
  kind: 'answer' | 'thought';
  content: string;
}

/**
 * Split vendor-emitted `<think>…</think>` text without enabling raw HTML.
 * An unclosed block is retained as a thought while a response is streaming, so
 * the literal control tags never break Markdown parsing or swallow the answer.
 */
export function splitThinkSegments(content: string): ThinkSegment[] {
  if (!/<\/?think\s*>/i.test(content)) return [{ kind: 'answer', content }];
  const segments: ThinkSegment[] = [];
  const tags = /<\/?think\s*>/gi;
  let kind: ThinkSegment['kind'] = 'answer';
  let offset = 0;
  let match: RegExpExecArray | null;

  const push = (end: number) => {
    const value = content.slice(offset, end).trim();
    if (value) segments.push({ kind, content: value });
  };

  while ((match = tags.exec(content)) !== null) {
    push(match.index);
    kind = match[0].startsWith('</') ? 'answer' : 'thought';
    offset = match.index + match[0].length;
  }
  push(content.length);

  if (segments.length === 0) return [{ kind: 'answer', content }];
  return promoteSwallowedAnswer(segments);
}

/**
 * Longest a leftover can be and still be judged a fragment rather than a short reply.
 * A real answer that runs past this is a reply whatever it starts with.
 */
const MAX_FRAGMENT_CHARS = 40;

/**
 * Characters a genuine reply can OPEN with: a capital, a digit, or a Markdown block
 * marker. The discriminator is deliberately the first character rather than the
 * length — "Done." is a complete answer and must never be second-guessed, while
 * "/task number?" is visibly the tail of a sentence that began somewhere else.
 */
const REPLY_OPENER = /^[A-Z0-9#*\-_>`[|("']/;

/** Is this leftover text a dangling fragment rather than a reply in its own right? */
function isFragment(text: string): boolean {
  return text.length > 0 && text.length <= MAX_FRAGMENT_CHARS && !REPLY_OPENER.test(text);
}

/**
 * Rescue a reply whose answer ended up INSIDE the thought block.
 *
 * Some models close `</think>` in the wrong place. Observed verbatim from a real run:
 * the entire reply — "\"Fix\" is too vague — I need to know what to fix. Could you
 * specify: a file or error message? a ticket" — sat inside the think block, and the
 * only text after the closing tag was "/task number?". Rendered faithfully, the user's
 * whole answer was the words "/task number?".
 *
 * Hiding reasoning is a presentation preference; showing the user a scrap is a broken
 * turn, so the scrap loses. When the text outside the block is a FRAGMENT and a thought
 * carries a real reply, the thought is promoted and the fragment appended to it —
 * usually the tail of the same sentence, so nothing is lost and the sentence reads
 * whole again.
 *
 * Two cases are deliberately left alone. A short but complete answer ("Done.") is a
 * reply and keeps its reasoning hidden. A response with NO answer segment at all is a
 * block still streaming — the existing behaviour renders it as visible thought, which
 * is right, and promoting it would show reasoning as the answer on every turn.
 */
function promoteSwallowedAnswer(segments: ThinkSegment[]): ThinkSegment[] {
  const answers = segments.filter((s) => s.kind === 'answer');
  if (answers.length === 0) return segments;

  const answerText = answers.map((s) => s.content).join(' ').trim();
  if (!isFragment(answerText)) return segments;

  const thoughts = segments.filter((s) => s.kind === 'thought');
  const richest = thoughts.reduce<ThinkSegment | null>(
    (best, s) => (!best || s.content.length > best.content.length ? s : best),
    null,
  );
  // Nothing worth promoting: leave the fragment as the answer rather than replacing it
  // with something even thinner.
  if (!richest || richest.content.length <= answerText.length) return segments;

  const promoted: ThinkSegment[] = [{ kind: 'answer', content: `${richest.content} ${answerText}`.trim() }];
  // Any OTHER thought blocks stay thoughts — only the one carrying the reply moves.
  for (const s of thoughts) if (s !== richest) promoted.unshift(s);
  return promoted;
}
