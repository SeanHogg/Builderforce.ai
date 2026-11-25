import type { FindingSeverity, ThreatCategory } from '../types.js';

export interface Rule {
  readonly id: string;
  readonly category: ThreatCategory;
  readonly severity: FindingSeverity;
  /** Contribution to the 0..100 risk score. Uncalibrated. */
  readonly weight: number;
  readonly cwe?: string;
  /** MITRE ATT&CK technique id. */
  readonly attack?: string;
  readonly title: string;
  readonly remediation: string;
  readonly pattern: RegExp;
  /**
   * Which files the rule reads (see `profiles.ts`): `secret` = everything but binary assets and lockfiles
   * (a credential inside a bundle is still committed); `code` = also not minified / vendored / generated;
   * `any` (default) = anything that is not a binary asset.
   */
  readonly paths?: 'secret' | 'code' | 'any';
  /** `line`: tested per line, one finding per matching line. `source`: tested on the whole text, one finding. */
  readonly scope: 'line' | 'source';
  /** The rule only fires when the whole text also matches this. */
  readonly requiresContext?: RegExp;
  /** Final say after a match (e.g. a port allow-list, an occurrence count). */
  readonly accept?: (match: RegExpExecArray, text: string) => boolean;
  /** Skip files matching this (tests / fixtures legitimately contain unsafe samples). */
  readonly skipPaths?: RegExp;
  /** Report at this severity in test / fixture paths instead of skipping the file. */
  readonly testPathSeverity?: FindingSeverity;
}

export const TEST_OR_FIXTURE = /(^|\/)(__tests__|__mocks__|tests?|fixtures?|e2e|examples?)(\/|$)|\.(test|spec)\.[^.]+$|\.md$|\.mdx$/i;
