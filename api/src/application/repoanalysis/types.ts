/**
 * Shared types for the Architect / Digital-Transformation repo-analysis tool.
 * The DO builds an EvidenceBundle from the RepoSource clients, then feeds it to
 * ArchitectAnalysisService which produces one GeneratedArtifact per kind.
 */

/** The six analysis outputs. Order is the canonical pipeline / display order. */
export const ARTIFACT_KINDS = [
  'diagnostic',
  'recommendation',
  'business',
  'arch_4plus1',
  'antipatterns',
  'principles',
] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

/** Artifacts every plan produces (Free tier is capped to these two). */
export const FREE_ARTIFACT_KINDS: ArtifactKind[] = ['diagnostic', 'recommendation'];

export interface SampledFile {
  path: string;
  content: string;
  truncated: boolean;
}

export interface RepoEvidence {
  provider: string;
  owner: string;
  repo: string;
  defaultBranch: string;
  languages: Record<string, number>;
  treeSummary: {
    topDirs: string[];
    fileCount: number;
    totalBytes: number;
    truncated: boolean;
  };
  sampledFiles: SampledFile[];
  recentCommits: { message: string; date: string }[];
}

export interface EvidenceBundle {
  projectName: string;
  repos: RepoEvidence[];
}

export interface GeneratedArtifact {
  kind: ArtifactKind;
  title: string;
  /** Human-readable Markdown (Mermaid in fenced blocks). */
  bodyMd: string;
  /** Structured output (stringified JSON) for agents to consume. */
  dataJson: string;
  model: string | null;
  tokens: number;
  /** Headline recommendation, only set by the recommendation artifact. */
  recommendation?: 'brownfield' | 'greenfield' | 'parallel';
  /** Project write-back hints, only set by the diagnostic artifact. */
  suggestedProjectDescription?: string;
  suggestedModality?: string;
}
