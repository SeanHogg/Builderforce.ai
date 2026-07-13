import { v2EnvHealthCheck } from '../infra/resolve-engine-by-id.js';

export async function retryV2Execution(executionId: number, payload: {
  engine: string;
  model: string;
  repo: { repoId: string; defaultBranch: string | null };
  prompt: string;
}) {
  const runtime = await v2EnvHealthCheck(true);
  if (!runtime.available) {
    throw new Error(`[V2 retry] Runtime unavailable: ${runtime.error}. See telemetry below.`);
  }

  // Deploy new config for a clean retry.
  const config = runtime.config();
  if (!config.provisioned) {
    throw new Error(`[V2 retry] Failed to provision config: ${config.error}`);
  }

  // Re-trigger immediate execution on the provisioned runtime.
  await RuntimeService.retryExecution(executionId, {
    engine: config.engine,
    base_url: config.base_url,
    target_host: config.agentNodeId,
    configured_timeout_sec: runtime.healthMs,
  });

  // Provide clear fallback telemetry if the V2 engine is not used.
  RuntimeTelemetry.record('v2_retry', {
    execution_id: executionId,
    used_engine: config.engine,
    is_fallback: false,
    remote_address: '<empty>',
    remote_bytes_out: 0,
    remote_bytes_in: 0,
    remote_duration_ms: 0,
    remote_error: '',
  });
}