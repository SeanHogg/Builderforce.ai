/**
 * The pre-push check's verdict, kept short: it is read at the moment someone wants to push.
 *
 * OK or WARN-only: at most 6 lines. FAIL: the failing check (name, log path, re-run line), its first 5 error lines, and how
 * to skip once. Warnings never block; each is one line naming its reason and fix.
 */
const MAX_WARN_LINES = 3;

/** The first `n` lines of a result's output that look like errors (else the first non-empty ones), minus the `$ command` echo. */
function errorLines(output, n) {
  const lines = output.split('\n').map((l) => l.trimEnd()).filter((l) => l && !l.startsWith('$ '));
  const errors = lines.filter((l) => /error|fail|✗|✖|not ok/i.test(l));
  return (errors.length ? errors : lines).slice(0, n).map((l) => (l.length > 200 ? `${l.slice(0, 200)}...` : l));
}

/**
 * @param {{ results: object[], warnings: string[], areas: string[], seconds: number }} run
 * @returns {{ lines: string[], failed: boolean }}
 */
export function summarize({ results, warnings, areas, seconds }) {
  const failed = results.filter((r) => r.status === 'fail');
  const warned = [...results.filter((r) => r.status === 'warn' || r.status === 'timeout').map((r) => `${r.task.name}: ${r.reason ?? r.status}`), ...warnings];
  const passed = results.filter((r) => r.status === 'pass').length;
  const lines = [`pre-push ${failed.length ? 'FAILED' : 'OK'}: ${passed}/${results.length} checks passed, ${failed.length} failed, ${warned.length} warning(s), ${seconds.toFixed(1)}s (areas: ${areas.join(', ') || 'none'})`];
  const shown = warned.slice(0, MAX_WARN_LINES).map((w) => `WARN (does not block): ${w}`);
  if (warned.length > MAX_WARN_LINES) shown.push(`WARN: +${warned.length - MAX_WARN_LINES} more warning(s); see the check logs`);
  if (!failed.length) return { lines: [...lines, ...shown].slice(0, 6), failed: false };
  const [first] = failed;
  lines.push(`FAIL ${first.task.name}${failed.length > 1 ? ` (+${failed.length - 1} more: ${failed.slice(1).map((r) => r.task.name).join(', ')})` : ''}; log ${first.logPath}; re-run ${first.rerun}`);
  lines.push(...errorLines(first.output, 5).map((l) => `  ${l}`));
  lines.push('skip once: git push --no-verify or BF_SKIP_PREPUSH=1');
  return { lines, failed: true };
}
