import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'migrations/0374_execution_lifecycle_outbox.sql'),
  'utf8',
);

describe('execution lifecycle database contract', () => {
  it('captures every insert and status update at the executions table boundary', () => {
    expect(migration).toContain('AFTER INSERT OR UPDATE ON executions');
    expect(migration).toContain('IF NEW.status IS NOT DISTINCT FROM OLD.status');
    expect(migration).toContain('execution.submitted');
    expect(migration).toContain('execution.resumed');
  });

  it('uses a monotonic transition version and stable event key', () => {
    expect(migration).toContain('NEW.lifecycle_version := OLD.lifecycle_version + 1');
    expect(migration).toContain(`'execution:' || NEW.id || ':v:' || NEW.lifecycle_version`);
    expect(migration).toContain('ON CONFLICT (event_key) DO NOTHING');
  });

  it('projects idempotently into the tenant activity stream', () => {
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_log_event_key');
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_execution_lifecycle_outbox_event_key');
  });

  it('does not silently swallow exceptions on execution lifecycle surfaces', () => {
    const runtimeDir = resolve(process.cwd(), 'src/application/runtime');
    const runtimeFiles = readdirSync(runtimeDir)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .map((name) => resolve(runtimeDir, name));
    const boundaryFiles = [
      'src/infrastructure/relay/CloudRunnerDO.ts',
      'src/infrastructure/relay/AnalysisRunnerDO.ts',
      'src/presentation/routes/runtimeRoutes.ts',
      'src/presentation/routes/agentHostRoutes.ts',
      'src/presentation/routes/repoAnalysisRoutes.ts',
      'src/application/rehearsal/rehearsalService.ts',
    ].map((path) => resolve(process.cwd(), path));
    const emptyCatch = /catch\s*(?:\([^)]*\))?\s*(?:=>\s*)?\{\s*(?:\/\*[\s\S]*?\*\/\s*)?\}/;
    const offenders = [...runtimeFiles, ...boundaryFiles].flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return emptyCatch.test(source) ? [file.replace(process.cwd(), '')] : [];
    });
    expect(offenders).toEqual([]);
  });
});
