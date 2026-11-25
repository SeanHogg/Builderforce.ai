import type { FindingSeverity, NormalizedFinding } from '@builderforce/sarif';

export type { FindingSeverity };

export type ThreatCategory =
  | 'secret' | 'insecure-code' | 'malware-signature' | 'credential-access' | 'exfiltration'
  | 'remote-shell' | 'cryptojacking' | 'obfuscation' | 'persistence' | 'keylogging' | 'supply-chain' | 'typosquat';

export interface ScanSubject {
  readonly path: string;
  readonly content: string | Uint8Array;
  readonly packageName?: string;
  readonly packageVersion?: string;
}

export interface ScanFinding extends NormalizedFinding {
  readonly category: ThreatCategory;
  readonly weight: number;
  /** MITRE ATT&CK technique id, e.g. T1552.001. */
  readonly attack?: string;
}

export type ScanAction = 'allow' | 'log' | 'review' | 'quarantine' | 'block';

export type IncompleteReason = 'too-large' | 'binary-unsupported' | 'deadline' | 'error';

export interface FileVerdict {
  readonly path: string;
  readonly sha256: string;
  readonly score: number;
  readonly action: ScanAction;
  /** False when the file was not (fully) scanned. Incomplete is never a clean result. */
  readonly complete: boolean;
  readonly incompleteReason?: IncompleteReason;
  readonly findings: readonly ScanFinding[];
}

export interface ScanReport {
  readonly files: readonly FileVerdict[];
  readonly complete: boolean;
  readonly score: number;
  readonly action: ScanAction;
}
