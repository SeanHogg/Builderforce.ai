import type { TimelineNode } from '../timelineModel';

/** The glyph in a row's gutter dot, by node kind (an error mark wins over the kind). */
export function dotIcon(kind: TimelineNode['kind'], isError?: boolean): string {
  if (isError) return '✗';
  switch (kind) {
    case 'user':
      return '›';
    case 'assistant':
      return '✦';
    case 'thinking':
      return '∴';
    case 'tool':
      return '⚙';
    case 'error':
      return '✗';
    case 'recall':
    case 'memoryAnswer':
    case 'learn':
    case 'reconcile':
      return '🧠';
    case 'compacted':
      return '⇊';
    default:
      return '•';
  }
}
