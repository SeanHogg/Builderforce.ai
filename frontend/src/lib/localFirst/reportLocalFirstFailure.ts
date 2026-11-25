/**
 * THE sink a local-first catch reports through.
 *
 * A catch in the sync driver or the board library REPORTS the failure; it never just
 * skips it. The report goes to the product Quality feed through the one background
 * reporter (`reportBackgroundFailure`), which resolves rather than throws, so a failed
 * report cannot fail the save or the push that was already finished.
 *
 * Callers take a `LocalFirstFailureSink` as an option and default to this one, so a test
 * can capture what was reported without a network.
 */

import { reportBackgroundFailure } from '../reportError';

export type LocalFirstFailureSink = (where: string, error: unknown) => void;

export const reportLocalFirstFailure: LocalFirstFailureSink = (where, error) => {
  const reason = error instanceof Error ? error.message : String(error);
  void reportBackgroundFailure({
    title: 'LocalFirstFailure',
    message: `${where}: ${reason}`,
    level: 'error',
    context: { where, stack: error instanceof Error ? error.stack : undefined },
  });
};
