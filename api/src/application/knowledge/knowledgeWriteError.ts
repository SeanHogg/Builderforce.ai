/**
 * KnowledgeWriteError — a knowledge write or upload the caller got wrong (PRD 38 §4.2, §4.8):
 * the route answers it with `status` and `{ error, code }`. Its own module so the perception
 * uploads can raise it without loading the writer.
 */
export class KnowledgeWriteError extends Error {
  constructor(readonly status: 400 | 413, readonly code: string, message: string) {
    super(message);
    this.name = 'KnowledgeWriteError';
  }
}
