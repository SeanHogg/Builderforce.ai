/**
 * ADJUDICATIONS — where a ratchet finding that was decided goes to stay decided.
 *
 * A baseline entry means "somebody looked at this once". It carries no reason,
 * and `reportRatchet --update` rewrites the file from scratch, so a `#` comment
 * explaining a verdict survives exactly until the next person trims a stale
 * entry. Four such arguments were living in baseline comments when this landed
 * — two duplicate-shape clusters, two shape-lint tables and one unadopted table —
 * each one a paragraph of reasoning that a routine `--update` would have deleted
 * without a diff anybody would read as a deletion.
 *
 * So a verdict is DATA, in a module, next to the guard it answers:
 *
 *     scripts/adjudications/<guard-name>.mjs   →   export default { key: reason }
 *
 * `reportRatchet` filters adjudicated keys out of the findings BEFORE the
 * baseline comparison, which gives the three properties the comment form never
 * had:
 *
 *   1. `--update` cannot destroy a verdict, because a verdict was never in the
 *      baseline file to begin with.
 *   2. The open balance is the number of things still to DO. An adjudicated
 *      entry is finished work and stops being counted as debt.
 *   3. A verdict cannot rot. If the table it argues about is renamed or dropped,
 *      the key stops matching any finding and the guard says so — the same
 *      stale-entry report the baseline already gets, applied to the reasons.
 *
 * WHY NOT ONE FILE FOR ALL SIX. The reasons are prose and there are dozens of
 * them; shape-lint's alone ran to 400 lines inside the 508-line guard, which is
 * how a lint script turns into a file nobody can read. One module per guard
 * keeps each one to a single subject and keeps the guards themselves short
 * enough to be about their rule.
 */
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const adjudicationsDir = resolve(here, '..', 'adjudications');

/**
 * Load the verdicts for one guard. Missing file → no verdicts, which is the
 * correct answer for a guard nobody has adjudicated anything for yet.
 *
 * @param {string} guard  Guard name as passed to `reportRatchet` (`check-shape-lint`).
 * @returns {Promise<Map<string, string>>} key → the argument for accepting it.
 */
export async function loadAdjudications(guard) {
  const file = resolve(adjudicationsDir, `${guard.replace(/^check-/, '')}.mjs`);
  if (!existsSync(file)) return new Map();
  const mod = await import(pathToFileURL(file).href);
  const entries = Object.entries(mod.default ?? {});
  for (const [key, reason] of entries) {
    // A verdict with no argument is a baseline entry wearing a costume — it
    // removes the item from the count while explaining nothing. Refuse it.
    if (typeof reason !== 'string' || reason.trim().length < 40) {
      console.error(
        `❌  ${guard}: adjudication for \`${key}\` has no argument.\n` +
          '    An adjudication REMOVES an item from the open balance, so it has to say why.\n' +
          '    Write the reason, or leave the entry in the baseline as outstanding work.',
      );
      process.exit(1);
    }
  }
  return new Map(entries);
}
