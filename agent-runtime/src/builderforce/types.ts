/**
 * Type definitions for builderForceAgents project-specific context
 */

// ---------------------------------------------------------------------------
// Workforce Agent Package (Builderforce Workforce Registry)
// ---------------------------------------------------------------------------

/**
 * LoRA adapter configuration embedded in an agent package.
 */
export type LoraConfig = {
  rank: number;
  alpha: number;
  target_modules: string[];
};

/**
 * Mamba SSM state snapshot — serialised form of the Mamba State Engine state.
 * Present only in v2.0 packages (agents trained with Memory or Hybrid mode).
 */
export type MambaStateSnapshot = {
  /** Packed Float32 values (channels × order) */
  data: number[];
  /** Input embedding dimension */
  dim: number;
  /** SSM hidden states per channel */
  order: number;
  /** Parallel channels */
  channels: number;
  /** Monotonic interaction counter */
  step: number;
};

/**
 * Portable agent package downloaded from the Builderforce Workforce Registry.
 * v1.0 — LoRA adapter only.
 */
export type AgentPackageV1 = {
  version: "1.0";
  platform: "builderforce.ai";
  name: string;
  title: string;
  bio: string;
  skills: string[];
  base_model: string;
  lora_config: LoraConfig;
  training_job_id?: string;
  r2_artifact_key?: string;
  resume_md?: string;
  created_at: string;
};

/**
 * Portable agent package downloaded from the Builderforce Workforce Registry.
 * v2.0 — LoRA adapter + Mamba persistent memory state.
 */
export type AgentPackageV2 = {
  version: "2.0";
  platform: "builderforce.ai";
  name: string;
  title: string;
  bio: string;
  skills: string[];
  base_model: string;
  lora_config: LoraConfig;
  training_job_id?: string;
  r2_artifact_key?: string;
  resume_md?: string;
  /** Persistent Mamba SSM state serialised at publish time */
  mamba_state?: MambaStateSnapshot;
  created_at: string;
};

/** Union of all supported agent package versions. */
export type AgentPackage = AgentPackageV1 | AgentPackageV2;

/**
 * Metadata stored in `.builderforce/context.yaml` after a Workforce agent is installed.
 * Records where the agent came from and how to invoke its custom LLM.
 */
export type InstalledWorkforceAgent = {
  /** Workforce Registry agent ID */
  agentId: string;
  /** Human-readable display name */
  name: string;
  /** Short description / title */
  title?: string;
  /** Base model used for inference (e.g. "gpt-neox-20m" or "codeparrot-350m") */
  baseModel: string;
  /**
   * BuilderForceAgents model reference used at runtime, e.g. "builderforcellm/workforce-<agentId>".
   * Points to the Builderforce inference endpoint that loads the LoRA adapter.
   */
  modelRef: string;
  /** R2 key for the LoRA adapter artifact */
  loraArtifactKey?: string;
  /** Package version ("1.0" or "2.0") */
  packageVersion: "1.0" | "2.0";
  /** Whether this agent carries a Mamba persistent memory state */
  hasMambaState: boolean;
  /** ISO timestamp of when the agent package was installed */
  installedAt: string;
  /** Builderforce server URL the package was fetched from */
  registryUrl: string;
};

export type ProjectContext = {
  version: number;
  projectName: string;
  description?: string;
  rootPath: string;
  languages: string[];
  frameworks: string[];
  architecture: {
    style: string;
    layers: string[];
    patterns: string[];
  };
  buildSystem?: string;
  testFramework?: string;
  lintingTools: string[];
  dependencies: {
    production: Record<string, string>;
    development: Record<string, string>;
  };
  customRules: string[];
  metadata?: Record<string, unknown>;
  llm?: {
    provider: string;
    model: string;
  };
  /**
   * Workforce agent installed into this project via `builderforce agent install`.
   * When present, the agent's custom LLM (Builderforce inference endpoint) is
   * used by default instead of the standard provider set in `llm`.
   */
  customAgent?: InstalledWorkforceAgent;
  builderforce?: {
    /** Numeric agentNode ID returned by POST /api/agent-hosts */
    instanceId: string;
    /** URL-safe slug returned by POST /api/agent-hosts */
    instanceSlug?: string;
    /** Human-readable name for this project's agentNode instance */
    instanceName?: string;
    /** Linked project id in Builderforce */
    projectId?: string;
    /** Tenant this agentNode belongs to */
    tenantId?: number;
    /** Builderforce server URL */
    url?: string;
    /** Runtime machine and tunnel profile persisted from registration/heartbeat. */
    machineProfile?: {
      machineName?: string;
      machineIp?: string;
      rootInstallDirectory?: string;
      workspaceDirectory?: string;
      gatewayPort?: number;
      relayPort?: number;
      tunnelUrl?: string;
      tunnelStatus?: string;
      networkMetadata?: Record<string, unknown>;
    };
    /** Project assignment context snapshot pulled from Builderforce. */
    assignmentContext?: {
      syncedAt?: string;
      project?: {
        id?: string;
        key?: string;
        name?: string;
        rootWorkingDirectory?: string;
        directoryPath?: string;
      };
      contextHints?: {
        manifestFiles?: string[];
        prdFiles?: string[];
        taskFiles?: string[];
        memoryFiles?: string[];
      };
    };
  };
  /**
   * Persona assignments for this agentNode.
   * Managed by Builderforce — do not edit manually.
   */
  personas?: {
    assignments: PersonaAssignment[];
  };
};

/**
 * Persona definition for an agent role — shapes tone, perspective, and decision style.
 * Injected into the system prompt prefix so every spawned sub-agent has a consistent identity.
 */
export type AgentPersona = {
  /** How the agent communicates, e.g. "methodical and detail-oriented" */
  voice: string;
  /**
   * Optional psychometric profile (Pro feature). A structured trait vector that
   * changes how the agent reasons and executes, not just its tone. Compiled into
   * prompt directives + execution params by `compilePsychometricProfile`.
   */
  psychometric?: import("./psychometrics.js").PsychometricProfile;
  /** The lens through which the agent evaluates all inputs, e.g. "views code through a security lens" */
  perspective: string;
  /** How the agent makes trade-off decisions, e.g. "conservative: prefer proven patterns" */
  decisionStyle: string;
};

/**
 * Output format contract for an agent role.
 * Tells downstream agents and the orchestrator how to parse this role's output.
 */
export type AgentOutputFormat = {
  /** Preferred output structure */
  structure: "markdown" | "json" | "structured-text";
  /** Section headings the agent should always include (in order) */
  requiredSections?: string[];
  /** Short label prepended to handoff summaries, e.g. "REVIEW:" */
  outputPrefix?: string;
};

/**
 * Structured handoff block passed from one agent to the next in a workflow.
 * Replaces plain-text result concatenation with a typed context object.
 */
export type TaskHandoff = {
  workflowId: string;
  taskId: string;
  fromRole: string;
  /** One-paragraph summary of what was produced */
  summary: string;
  /** Specific findings, decisions, or recommendations for the next agent */
  keyFindings: string[];
  /** Files, functions, or other artifacts produced or modified */
  artifacts: string[];
  /** ISO timestamp when this handoff was created */
  timestamp: string;
};

export type AgentRole = {
  name: string;
  description: string;
  capabilities: string[];
  tools: string[];
  systemPrompt?: string;
  /** Optional persona definition injected into the system prompt */
  persona?: AgentPersona;
  /** Optional output contract so downstream agents know how to interpret results */
  outputFormat?: AgentOutputFormat;
  model?: string;
  thinking?: string;
  constraints?: string[];
};

export type ProjectRules = {
  version: number;
  codeStyle: {
    indentation: "tabs" | "spaces";
    indentSize?: number;
    lineLength?: number;
    namingConventions?: Record<string, string>;
  };
  testing: {
    required: boolean;
    coverage?: number;
    frameworks: string[];
  };
  documentation: {
    required: boolean;
    format?: string;
    location?: string;
  };
  git: {
    branchNaming?: string;
    commitFormat?: string;
    requireReview?: boolean;
  };
  constraints: string[];
  customRules: string[];
};

export type CodeMap = {
  files: Map<string, FileInfo>;
  dependencies: Map<string, string[]>;
  exports: Map<string, ExportInfo>;
  imports: Map<string, ImportInfo[]>;
};

export type FileInfo = {
  path: string;
  language: string;
  size: number;
  lastModified: Date;
  functions: FunctionInfo[];
  classes: ClassInfo[];
  interfaces: InterfaceInfo[];
  types: TypeInfo[];
};

export type FunctionInfo = {
  name: string;
  line: number;
  params: string[];
  returnType?: string;
  exported: boolean;
  async: boolean;
};

export type ClassInfo = {
  name: string;
  line: number;
  extends?: string;
  implements: string[];
  methods: MethodInfo[];
  exported: boolean;
};

export type MethodInfo = {
  name: string;
  line: number;
  params: string[];
  returnType?: string;
  visibility: "public" | "private" | "protected";
  static: boolean;
  async: boolean;
};

export type InterfaceInfo = {
  name: string;
  line: number;
  extends: string[];
  properties: PropertyInfo[];
  methods: MethodInfo[];
  exported: boolean;
};

export type PropertyInfo = {
  name: string;
  type?: string;
  optional: boolean;
  readonly: boolean;
};

export type TypeInfo = {
  name: string;
  line: number;
  definition: string;
  exported: boolean;
};

export type ExportInfo = {
  name: string;
  kind: "function" | "class" | "interface" | "type" | "const" | "let" | "var";
  file: string;
  line: number;
};

export type ImportInfo = {
  source: string;
  imports: string[];
  file: string;
  line: number;
};

export type DependencyNode = {
  file: string;
  dependencies: string[];
  dependents: string[];
};

export type GitHistoryEntry = {
  sha: string;
  author: string;
  date: Date;
  message: string;
  filesChanged: string[];
};

export type ProjectKnowledge = {
  context: ProjectContext;
  codeMap: CodeMap;
  dependencyGraph: Map<string, DependencyNode>;
  gitHistory: GitHistoryEntry[];
  lastUpdated: Date;
};

/**
 * A session handoff document that lets the next agent session resume where
 * the last one stopped — the BuilderForceAgents alternative to Claude Projects session notes.
 */
export type SessionHandoff = {
  /** Unique identifier for this session */
  sessionId: string;
  /** ISO timestamp of when the session ended */
  timestamp: string;
  /** One-paragraph summary of what was accomplished */
  summary: string;
  /** Key decisions made during the session */
  decisions: string[];
  /** Concrete next steps for the following session */
  nextSteps: string[];
  /** Unresolved questions to revisit */
  openQuestions: string[];
  /** Files, docs, or other artifacts produced */
  artifacts: string[];
  /** Arbitrary extra context to carry forward */
  context?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Persona Plugin System
// ---------------------------------------------------------------------------

/**
 * Where a persona plugin originates.
 * Used to determine loading precedence and trust level.
 */
export type PersonaSource =
  | "builtin" // Shipped with builderForceAgents core
  | "user-global" // ~/.builderforce/personas/ (user-installed, all projects)
  | "project-local" // .builderforce/personas/ (project-scoped)
  | "marketplace" // Installed from Builderforce.ai Marketplace
  | "builderforce-assigned"; // Pushed to this agentNode from Builderforce

/**
 * Marketplace and versioning metadata for a persona plugin.
 * Present when a persona was installed from the Builderforce.ai Marketplace or assigned via builderforce.ai.
 */
export type PersonaPluginMetadata = {
  /** Builderforce.ai Marketplace identifier, e.g. "acme/senior-security-reviewer" */
  marketplaceId?: string;
  /** Semver version string, e.g. "1.2.0" */
  version?: string;
  /** Publisher name on Builderforce.ai Marketplace */
  author?: string;
  /** Author homepage or profile URL */
  authorUrl?: string;
  /** SPDX license identifier, e.g. "MIT" or "Commercial" */
  license?: string;
  /** Whether activating this persona requires a valid paid license */
  requiresLicense?: boolean;
  /** Builderforce.ai Marketplace listing URL */
  marketplaceUrl?: string;
  /** Minimum builderForceAgents version required (semver range) */
  builderForceAgentsVersion?: string;
  /** Discovery tags, e.g. ["security", "backend", "compliance"] */
  tags?: string[];
  /** SHA-256 hex digest of the PERSONA.yaml file for integrity verification */
  checksum?: string;
};

/**
 * A persona plugin — an `AgentRole` enriched with plugin lifecycle metadata.
 * Installed from the Builderforce.ai Marketplace or assigned to a agentNode via builderforce.ai.
 */
export type PersonaPlugin = AgentRole & {
  /** Where this persona was loaded from */
  source: PersonaSource;
  /** Marketplace metadata (present for marketplace / builderforce-assigned personas) */
  pluginMetadata?: PersonaPluginMetadata;
  /** Absolute path to the PERSONA.yaml file on disk; undefined for built-ins */
  filePath?: string;
  /** Whether this persona is currently active on this agentNode */
  active?: boolean;
};

/**
 * A persona assignment record stored in `context.yaml` under `personas.assignments`.
 * Created by Builderforce when an operator assigns a persona to a specific agentNode,
 * or locally when a user activates a persona with `builderforce persona activate <name>`.
 */
export type PersonaAssignment = {
  /** Name of the persona to activate (must match a loaded PersonaPlugin) */
  name: string;
  /** Builderforce.ai Marketplace ID — used for license verification on activation */
  marketplaceId?: string;
  /** True when this assignment was pushed from Builderforce (not manually set) */
  assignedByBuilderforce?: boolean;
  /** ISO 8601 timestamp of when the assignment was created */
  assignedAt?: string;
};
