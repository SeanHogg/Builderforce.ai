/**
 * A host tool's result as an object. The editor's local executors hand results back as JSON
 * TEXT, the account's relay as objects; every reader that needs a field off a result (an id,
 * `autoRun.dispatched`, an error) reads it through this one parse.
 */
export function toolResultRecord(result: unknown): Record<string, unknown> | null {
  if (typeof result === 'string') {
    try {
      const parsed = JSON.parse(result) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return result && typeof result === 'object' ? (result as Record<string, unknown>) : null;
}
