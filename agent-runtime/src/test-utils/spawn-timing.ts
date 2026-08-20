/**
 * Time budgets for tests that spawn a REAL child process.
 *
 * A test that asserts "this command exits normally" is asserting behaviour, not
 * latency — but it can only observe the behaviour if its timeout outlasts the
 * interpreter's cold start. Several suites hard-coded budgets (800 ms overall,
 * 500 ms of silence) that hold comfortably on a Linux runner and do not hold on
 * Windows, where spawning `node` costs several times more: process creation goes
 * through `CreateProcess` rather than `fork`, the module resolver walks a
 * case-insensitive filesystem, and Defender inspects the image on first launch.
 * Those tests then failed on a verdict about the machine, not about the code —
 * the classic false red that teaches people to ignore a suite.
 *
 * So the numbers live here, once, expressed as what they actually are: "long
 * enough for a real spawn to happen". Tests that assert a timeout DOES fire keep
 * their own short, deliberate values — a generous budget would defeat the point.
 */

/**
 * Headroom for one `node -e '…'` spawn to start, run a trivial script, and exit.
 *
 * Deliberately generous. Nothing is asserted about how long it took, so the only
 * cost of a larger budget is how long a genuinely hung test takes to fail, and
 * the only cost of a smaller one is a false failure on a loaded machine.
 */
export const SPAWN_BUDGET_MS = process.platform === "win32" ? 15_000 : 5_000;

/** A budget for a spawn that must also survive `count` sequential child starts. */
export function spawnBudgetMs(count = 1): number {
  return SPAWN_BUDGET_MS * Math.max(1, count);
}
