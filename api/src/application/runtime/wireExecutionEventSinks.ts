/**
 * wireExecutionEventSinks — register the live destinations for execution events in
 * THIS isolate.
 *
 * The hub ({@link ./executionEvents}) is env-free, so the concrete sinks have to be
 * installed by whoever holds an `env`. The subtlety that makes this its own module
 * rather than two lines in the Worker's composition root: module state on Workers is
 * PER-ISOLATE, and executions are driven from several entry points that never build
 * the HTTP app —
 *
 *   • the Worker request handler (`buildApp` → `buildRuntimeService`),
 *   • cron sweeps (the stale-execution reaper, autonomous/manager sweeps),
 *   • the durable executor (`CloudRunnerDO`),
 *   • the container backplane (`AgentContainerDO.onError` → `handleCloudRunCrash`).
 *
 * An isolate that emits without having registered publishes into a void, which is
 * precisely how a container hard-death recovered by the reaper produced telemetry no
 * open drawer ever saw. Calling this from {@link ../../buildRuntimeService} (which
 * every execution-driving path but the container crash handler goes through) plus the
 * container handler covers all four, and registration REPLACES rather than appends,
 * so repeating it cannot multiply deliveries.
 */
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { setExecutionEventSinks } from './executionEvents';
import { makeExecutionRelaySink } from './executionRelayBroadcast';
import { makeExecutionBoardSink } from './executionBoardBroadcast';

export function wireExecutionEventSinks(env: Env, db: Db): void {
  // RELAY first: it carries each frame into the run's own DO room (the per-execution
  // tail — status, messages, file changes, tool events), which is the stream a viewer
  // is attached to. BOARD second: a lifecycle event also signals the project room so
  // every board / calendar / list refetches, not just whoever opened the drawer.
  setExecutionEventSinks(makeExecutionRelaySink(env), makeExecutionBoardSink(env, db));
}
