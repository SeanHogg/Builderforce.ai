/**
 * delta/dynamic/runners.ts — the host's dynamic-tier runners as ONE port (run-delta `DynamicRunners`): what is
 * available here, and each check's run, all bounded by the tier's `deadline` (host clock) and `signal`.
 * Availability is decided by read-only probes of the working tree, before any process starts and before a copy is made.
 */

import { runBenchmarks } from './benchmarkRunner.js';
import { packageBin, type DynamicHost } from './host.js';
import type { DynamicCheckIdLike, DynamicRunnersLike, SkipReasonLike } from './runnerTypes.js';
import { runMutation, strykerAvailable } from './strykerRunner.js';
import { runTests, testsAvailable } from './testRunner.js';

export function dynamicRunners(host: DynamicHost, deadline: number): DynamicRunnersLike {
  return {
    async availability(policy) {
      const out: Partial<Record<DynamicCheckIdLike, SkipReasonLike>> = {};
      if (policy.benchmarks.length === 0 && host.benchFiles.length === 0) out.benchmark = 'not-configured';
      else if (policy.benchmarks.length === 0 && !await packageBin(host.exec, host.root, 'vitest', 'vitest')) out.benchmark = 'tool-unavailable';
      if (!await testsAvailable(host)) out['diff-coverage'] = 'tool-unavailable';
      if (!await strykerAvailable(host)) out.mutation = 'tool-unavailable';
      return out;
    },
    benchmarks: (specs, discovered, signal, sequential) => runBenchmarks(host, specs, discovered, signal, deadline, sequential),
    tests: (changedCode, signal) => runTests(host, changedCode, signal, deadline),
    mutation: (changedCode, signal) => runMutation(host, changedCode, signal, deadline),
  };
}
