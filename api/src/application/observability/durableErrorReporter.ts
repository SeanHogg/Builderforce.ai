import { reportCaughtError, type CaughtErrorDetails } from './caughtErrorReporter';

/**
 * A Durable Object runs outside the Worker's AsyncLocalStorage context, so a bare
 * `reportCaughtError` there resolves NO runtime and the reporter drops the record
 * after its console line. The runtime override is what makes it land — and because
 * it is optional in the signature, forgetting it type-checks cleanly and silently
 * downgrades the report to a console log.
 *
 * Binding the override ONCE per DO constructor removes the chance to forget it:
 * call sites pass only the error and the operation, and the source string is
 * spelled once per class instead of once per catch.
 */

/**
 * The `waitUntil`-bearing half of a Durable Object. `DurableObjectState` exposes it
 * as `this.state`; `Container` subclasses expose the same shape as `this.ctx`. The
 * factory takes the shape rather than either name so both kinds of DO can bind it.
 */
export interface DurableWaitUntilHost {
  waitUntil(task: Promise<unknown>): void;
}

/** Report an intentionally-handled exception from inside a Durable Object. */
export type DurableErrorReporter = (
  error: unknown,
  details: Omit<CaughtErrorDetails, 'source'>,
) => void;

/**
 * Bind `reportCaughtError` to one Durable Object's source, env and waitUntil host.
 *
 * @param source Repo-relative module path, e.g. `infrastructure/relay/CloudRunnerDO.ts`.
 * @param env    The DO's env binding — the sink reads its database credentials from it.
 * @param host   The DO's `state` (or a `Container`'s `ctx`); durable delivery is
 *               attached to it so the report survives the DO returning.
 */
export function createDurableErrorReporter(
  source: string,
  env: unknown,
  host: DurableWaitUntilHost,
): DurableErrorReporter {
  return (error, details) => {
    reportCaughtError(error, { ...details, source }, {
      env,
      waitUntil: (task) => host.waitUntil(task),
    });
  };
}
