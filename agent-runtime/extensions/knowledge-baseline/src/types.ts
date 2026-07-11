/**
 * Knowledge Baseline — core domain types
 *
 * All artifacts, nodes, edges, manifests, and versioning types used
 * across the ingestion, graph, snapshot, sealing, and registry layers.
 */

import type { Static } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";

// ─── Artifact types ───────────────────────────────────────────────────────

export const ArtifactType = {
  Document: "Document",
  Fact: "Fact",
  Rule: "Rule",
  Procedure: "Procedure",
} as const;

export type ArtifactType = (typeof ArtifactType)[keyof typeof ArtifactType];

export const ALL_ARTIFACT_TYPES: readonly ArtifactType[] = Object.values(ArtifactType);

/** Schema for a raw ingested artifact before validation. */
export interface RawArtifact {
  /** Original filename or source identifier. */
  source: string;
  /** Declared type. */
  type: ArtifactType;
  /** Raw bytes of the artifact content. */
  data: Uint8Array;
  /** MIME-type hint (e.g. "application/pdf", "text/markdown"). */
  mime?: string;
  /** Optional human-readable label. */
  label?: string;
}

/** An artifact that has passed schema validation. */
export interface ValidatedArtifact {
  /** Content-addressed hash (SHA-256 of the normalised bytes). */
  id: string;
  /** Original filename / source identifier. */
  source: string;
  /** Declared type. */
  type: ArtifactType;
  /** Detected or provided MIME-type. */
  mime: string;
  /** Human-readable label (falls back to source). */
  label: string;
  /** The artifact's content, normalised to a UTF-8 string. */
  content: string;
  /** Parsed structured representation (for Facts, Rules, Procedures). */
  parsed: unknown;
  /** SHA-256 hash of the original raw bytes. */
  contentHash: string;
  /** Size in bytes of the original raw data. */
  size: number;
}

// ─── Graph types ──────────────────────────────────────────────────────────

export type NodeType = "Document" | "Fact" | "Rule" | "Procedure" | "Entity" | "Concept";

export const NODE_TYPES: readonly NodeType[] = [
  "Document",
  "Fact",
  "Rule",
  "Procedure",
  "Entity",
  "Concept",
];

/** A node in the knowledge graph. */
export interface GraphNode {
  id: string;
  type: NodeType;
  /** The textual content or label of the node. */
  label: string;
  /** Original artifact content hash (null for extracted Entity/Concept). */
  contentHash: string | null;
  /** The artifact source this node was derived from. */
  source: string;
  /** Arbitrary metadata key-value pairs. */
  properties: Record<string, unknown>;
  /** When this node was created (UTC epoch ms). */
  createdAt: number;
}

export type RelationshipLabel =
  | "DEFINES"
  | "REFERENCES"
  | "DERIVED_FROM"
  | "GOVERNS"
  | "PRECEDES"
  | "RELATES_TO";

export const RELATIONSHIP_LABELS: readonly RelationshipLabel[] = [
  "DEFINES",
  "REFERENCES",
  "DERIVED_FROM",
  "GOVERNS",
  "PRECEDES",
  "RELATES_TO",
];

export type RelationshipSource = "human" | "extracted";

/** A directed edge in the knowledge graph. */
export interface GraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  label: RelationshipLabel;
  /** Whether this edge was asserted by a human or extracted by the system. */
  source: RelationshipSource;
  /** Confidence score 0.0–1.0 (only meaningful for extracted edges). */
  confidence: number;
  /** Arbitrary metadata. */
  properties: Record<string, unknown>;
  /** When this edge was created (UTC epoch ms). */
  createdAt: number;
}

/** The complete knowledge graph state. */
export interface KnowledgeGraph {
  nodes: Map<string, GraphNode>;
  edges: Map<string, GraphEdge>;
}

// ─── Snapshot / Manifest ──────────────────────────────────────────────────

export type SealStatus = "DRAFT" | "SEALED";

/** Per-type artifact count. */
export interface ArtifactCounts {
  Document: number;
  Fact: number;
  Rule: number;
  Procedure: number;
}

/** Cryptographically-signed baseline metadata. */
export interface SignatureInfo {
  algorithm: "ed25519" | "rsa-4096";
  /** Base64-encoded signature. */
  value: string;
  /** Base64-encoded public key used to create the signature. */
  publicKey: string;
  /** ISO-8601 timestamp of when the signature was created. */
  signedAt: string;
}

/** Snapshot manifest – attached to every snapshot. */
export interface SnapshotManifest {
  snapshotUuid: string;
  /** Parent baseline version tag, if derived. */
  parentVersion: string | null;
  /** Creation timestamp (UTC ISO-8601). */
  createdAt: string;
  /** SHA-256 of the canonical serialized graph. */
  contentHash: string;
  /** Artifact count by type. */
  artifactCounts: ArtifactCounts;
  /** Total number of nodes in the graph. */
  nodeCount: number;
  /** Total number of edges in the graph. */
  edgeCount: number;
  /** Author / system identity. */
  author: string;
  /** Seal status. */
  sealStatus: SealStatus;
  /** Cryptographic signature, present only after sealing. */
  signature: SignatureInfo | null;
}

// ─── Versioning ───────────────────────────────────────────────────────────

/** Semantic version components. */
export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  preRelease: string | null;
}

/** A version record in the version registry. */
export interface VersionRecord {
  version: string;
  semver: SemVer;
  snapshotUuid: string;
  parentVersion: string | null;
  author: string;
  createdAt: string;
  sealStatus: SealStatus;
  artifactCounts: ArtifactCounts;
  nodeCount: number;
  edgeCount: number;
  contentHash: string;
}

/** The version lineage graph (parent-child relationships). */
export interface VersionLineage {
  /** Map of version tag → set of direct child version tags. */
  children: Map<string, Set<string>>;
  /** Map of version tag → parent version tag (null for root). */
  parents: Map<string, string | null>;
}

// ─── Event payloads ───────────────────────────────────────────────────────

export interface BaselineSealedEvent {
  type: "baseline.sealed";
  versionTag: string;
  snapshotUuid: string;
  contentHash: string;
  signature: SignatureInfo;
}

// ─── TypeBox schemas for runtime validation ───────────────────────────────

export const ArtifactTypeSchema = Type.Union(
  ALL_ARTIFACT_TYPES.map((t) => Type.Literal(t)) as [
    typeof Type.Literal,
    typeof Type.Literal,
    typeof Type.Literal,
    typeof Type.Literal,
  ],
);

export const IngestOptionsSchema = Type.Object({
  allowOverwrite: Type.Optional(Type.Boolean({ default: false })),
  author: Type.Optional(Type.String()),
});

export type IngestOptions = Static<typeof IngestOptionsSchema>;

export const SnapshotOptionsSchema = Type.Object({
  dryRun: Type.Optional(Type.Boolean({ default: false })),
  author: Type.Optional(Type.String()),
});

export type SnapshotOptions = Static<typeof SnapshotOptionsSchema>;

export const QueryOptionsSchema = Type.Object({
  nodeType: Type.Optional(
    Type.Union(
      NODE_TYPES.map((t) => Type.Literal(t)) as [
        typeof Type.Literal,
        typeof Type.Literal,
        typeof Type.Literal,
        typeof Type.Literal,
        typeof Type.Literal,
        typeof Type.Literal,
      ],
    ),
  ),
  fullText: Type.Optional(Type.String()),
  nodeId: Type.Optional(Type.String()),
  neighborOf: Type.Optional(Type.String()),
  edgeLabel: Type.Optional(
    Type.Union(
      RELATIONSHIP_LABELS.map((l) => Type.Literal(l)) as [
        typeof Type.Literal,
        typeof Type.Literal,
        typeof Type.Literal,
        typeof Type.Literal,
        typeof Type.Literal,
        typeof Type.Literal,
      ],
    ),
  ),
  limit: Type.Optional(Type.Number({ default: 100 })),
});

export type QueryOptions = Static<typeof QueryOptionsSchema>;

export const ExportFormat = {
  jsonld: "jsonld",
  nquads: "nquads",
} as const;

export type ExportFormat = (typeof ExportFormat)[keyof typeof ExportFormat];