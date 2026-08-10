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

  return segments.length > 0 ? segments : [{ kind: 'answer', content }];
}
