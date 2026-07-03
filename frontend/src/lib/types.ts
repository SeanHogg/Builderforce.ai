// ---------------------------------------------------------------------------
// Authentication & Multi-tenant
// ---------------------------------------------------------------------------

export interface AuthUser {
  id: string;
  email: string;
  name?: string;
  avatar?: string;
  /** When true, user can access Platform Admin (/admin). */
  isSuperadmin?: boolean;
  /** Account-type discriminator. 'freelancer' = a restricted gig/for-hire account
   *  that sees only the Profile / Find Work / Timecard shell; 'standard' (or
   *  undefined) = the full builder app. Sourced from the web JWT `act` claim /
   *  /api/auth/me. */
  accountType?: 'standard' | 'freelancer';
  /** This user's OWN personality (same shape agents/personas use); null when unset. */
  psychometric?: import('./psychometric').PsychometricProfile | null;
}

export interface Tenant {
  id: string;
  name: string;
  slug?: string;
  /** The authenticated user's role in this workspace (from the tenant JWT claim). */
  role?: string;
}

export interface AuthState {
  webToken: string | null;
  tenantToken: string | null;
  user: AuthUser | null;
  tenant: Tenant | null;
}

// ---------------------------------------------------------------------------
// Projects (unified API: id and tenant scoping)
// ---------------------------------------------------------------------------

export interface Project {
  id: number;
  publicId?: string;
  name: string;
  description?: string | null;
  template?: string | null;
  /** Active IDE modality for this project: 'designer' | 'video' | 'llm'. Defaults to 'designer'. */
  modality?: string | null;
  /** Where the project was born — 'ide' | 'imported' | 'external'. Drives the origin badge. */
  origin?: string | null;
  key?: string;
  tenantId?: number;
  status?: string;
  governance?: string | null;
  created_at?: string;
  updated_at?: string;
  createdAt?: string;
  updatedAt?: string;
  /** From list endpoint */
  taskCount?: number;
  /** From list endpoint: tasks in a completed status (done/closed/merged/…). */
  completedTaskCount?: number;
  /** From list endpoint: tasks not yet completed or cancelled. */
  openTaskCount?: number;
  /** From list endpoint: tasks in the blocked status. */
  blockedTaskCount?: number;
  /** From list endpoint: open tasks whose due date has passed. */
  overdueTaskCount?: number;
  /** From list endpoint: number of workflows associated with this project */
  workflowCount?: number;
  /** From list endpoint: true once an architecture PRD (Architect analysis output) exists. */
  hasArchitecturePrd?: boolean;
  /** From list endpoint: distinct objectives/OKRs linked to this project's tasks. Drives the inspection Direction (goals) signal. */
  linkedGoalCount?: number;
  /** Planning-spine initiative this project rolls up to, or null. Part of the inspection Direction (goals) signal. */
  initiativeId?: string | null;
  /** From list endpoint: primary assigned Workforce agent (agentHost) for this project */
  assignedAgentHost?: { id: number; name: string } | null;
  /** From list endpoint: earliest task start date (falls back to earliest due date). ISO string. Drives the calendar/Gantt timeline. */
  startDate?: string | null;
  /** From list endpoint: the EFFECTIVE project deadline (ISO) — the PM's explicit
   *  due date when set, else the derived latest-task due date. Drives calendar/Gantt. */
  dueDate?: string | null;
  /** From list endpoint: the PM's EXPLICIT project deadline only (ISO), or null when
   *  the deadline is auto-derived from tasks. Seeds the details due-date editor. */
  projectDueDate?: string | null;
}

export interface FileEntry {
  path: string;
  content: string;
  type: 'file' | 'directory';
}

/**
 * An IDE project (0224) — the buildable artifact you open in the IDE. A
 * first-class child of a Project: many can hang off one container Project
 * (`containerProjectId`, optional + reassignable). Backed by a hidden storage
 * project; you open it at `/ide/{storageProjectPublicId}`.
 */
export interface IdeProject {
  id: number;
  publicId: string;
  name: string;
  /** 'designer' | 'video' | 'llm' | 'voice'. */
  modality: string;
  status: string;
  /** The parent Project this build is grouped under, or null when ungrouped. */
  containerProjectId: number | null;
  containerName: string | null;
  /** The backing storage project (where files/datasets/site live; opens the IDE). */
  storageProjectId: number;
  storageProjectPublicId: string;
  storageProjectKey: string;
  /** Assigned workflow (LLM modality), or null. */
  workflowDefinitionId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A candidate parent Project for the assign/reassign picker. */
export interface IdeContainerOption {
  id: number;
  name: string;
  key: string;
}

export interface AIMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at?: string;
}

export interface CollaborationSession {
  id: string;
  project_id: string;
  user_id: string;
  started_at: string;
  ended_at?: string;
}

export interface UserPresence {
  userId: string;
  name: string;
  color: string;
  cursor?: {
    line: number;
    column: number;
  };
}

export interface WebContainerState {
  status: 'idle' | 'booting' | 'ready' | 'error';
  url?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// AI Model Training
// ---------------------------------------------------------------------------

export interface ModelOption {
  id: string;
  name: string;
  parameters: string;
  task: string;
  webgpu: boolean;
  maxParams: number;
}

export const SUPPORTED_MODELS: ModelOption[] = [
  { id: 'gpt-neox-20m', name: 'GPT-NeoX 20M', parameters: '20M', task: 'Tiny reasoning (browser testing)', webgpu: true, maxParams: 20e6 },
  { id: 'codeparrot-110m', name: 'CodeParrot 110M', parameters: '110M', task: 'Python coding', webgpu: true, maxParams: 110e6 },
  { id: 'gpt-neo-125m', name: 'GPT-Neo 125M', parameters: '125M', task: 'General reasoning', webgpu: true, maxParams: 125e6 },
  { id: 'codeparrot-350m', name: 'CodeParrot 350M', parameters: '350M', task: 'Python coding', webgpu: true, maxParams: 350e6 },
  { id: 'codegen-350m', name: 'CodeGen 350M', parameters: '350M', task: 'Coding', webgpu: true, maxParams: 350e6 },
  { id: 'gpt-neo-350m', name: 'GPT-Neo 350M', parameters: '350M', task: 'General reasoning', webgpu: true, maxParams: 350e6 },
  { id: 'santacoder-1b', name: 'SantaCoder 1B', parameters: '1B', task: 'Coding + reasoning', webgpu: true, maxParams: 1e9 },
  { id: 'starcoder-1b', name: 'StarCoder 1B', parameters: '1B', task: 'Coding + reasoning', webgpu: true, maxParams: 1e9 },
  { id: 'mpt-1b', name: 'MPT-1B', parameters: '1B', task: 'Instruction-following & reasoning', webgpu: true, maxParams: 1e9 },
  { id: 'mpt-1b-instruct', name: 'MPT-1B-Instruct', parameters: '1B', task: 'Instruction-following & reasoning', webgpu: true, maxParams: 1e9 },
  { id: 'openassistant-1b', name: 'OpenAssistant 1B', parameters: '1B', task: 'Instruction-following, reasoning', webgpu: true, maxParams: 1e9 },
  { id: 'mpt-1.3b', name: 'MPT-1.3B', parameters: '1.3B', task: 'Instruction-following & reasoning', webgpu: true, maxParams: 1.3e9 },
  { id: 'codegen-2b', name: 'CodeGen 2B', parameters: '2B', task: 'Full coding capabilities (LoRA/adapter)', webgpu: true, maxParams: 2e9 },
  { id: 'starcoder-2b', name: 'StarCoder 2B', parameters: '2B', task: 'Coding & reasoning (LoRA)', webgpu: true, maxParams: 2e9 },
];

export interface TrainingConfig {
  baseModel: string;
  capabilityPrompt: string;
  loraRank: number;
  epochs: number;
  batchSize: number;
  learningRate: number;
}

export interface Dataset {
  id: string;
  project_id: number | string;
  name: string;
  description?: string;
  capability_prompt: string;
  r2_key: string;
  example_count: number;
  status: 'pending' | 'generating' | 'ready' | 'error';
  created_at: string;
  updated_at: string;
}

export interface TrainingJob {
  id: string;
  project_id: number | string;
  dataset_id?: string;
  base_model: string;
  lora_rank: number;
  epochs: number;
  batch_size: number;
  learning_rate: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  current_epoch: number;
  current_loss?: number;
  r2_artifact_key?: string;
  error_message?: string;
  created_at: string;
  updated_at: string;
}

export interface TrainingLog {
  id: string;
  job_id: string;
  epoch?: number;
  step?: number;
  loss?: number;
  message: string;
  created_at: string;
}

export interface EvaluationResult {
  job_id: string;
  score: number;
  code_correctness?: number;
  reasoning_quality?: number;
  hallucination_rate?: number;
  details: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Agent Registry (Workforce)
// ---------------------------------------------------------------------------

export interface AgentProfile {
  name: string;
  title: string;
  bio: string;
  skills: string[];
  resumeMarkdown: string;
}

export interface PublishedAgent {
  id: string;
  project_id: number | string | null;
  job_id?: string;
  name: string;
  title: string;
  bio: string;
  skills: string[];
  base_model: string;
  lora_rank?: number;
  r2_artifact_key?: string;
  resume_md?: string;
  status: 'active' | 'inactive';
  hire_count: number;
  eval_score?: number;
  /** Public eval score (0-1) from the AI evaluation engine; null when not yet scored.
   *  Surfaced on the marketplace/registry card. Backend sends camelCase `evalScore`. */
  evalScore?: number | null;
  created_at: string;
  updated_at: string;
  // Workforce cloud agents (migration 0075). snake_case to match the raw row.
  tenant_id?: number | null;
  runtime_support?: 'cloud' | 'host' | 'both';
  preferred_runtime?: 'cloud' | 'host' | null;
  /** Agent runtime engine — always the current version (read-only denormalized value). */
  engine?: 'builderforce-v3';
  /** Cloud execution surface (migration 0105): durable DO vs long-lived Cloudflare Container. */
  runtime_surface?: 'durable' | 'container';
  price_cents?: number;
  pricing_model?: 'flat_fee' | 'consumption';
  price_unit?: string | null;
  published?: boolean;
  /** This agent's OWN personality (Pro). Parsed object (null when unset). Compiled at
   *  run time into prompt directives, sampling temperature, and limbic setpoints. */
  psychometric?: import('./psychometric').PsychometricProfile | null;
  /**
   * Number of tenants CURRENTLY holding this agent (active, non-unhired
   * purchases). Owner-only metric — populated by GET /agents/mine, not by the
   * public marketplace list. Distinct from `hire_count` (cumulative times hired).
   */
  active_hires?: number;
}

/** Portable agent package that can be downloaded and used to deploy the agent. */
export interface AgentPackage {
  version: '1.0' | '2.0';
  platform: 'builderforce.ai';
  name: string;
  title: string;
  bio: string;
  skills: string[];
  base_model: string;
  lora_config: {
    rank: number;
    alpha: number;
    target_modules: string[];
  };
  training_job_id?: string;
  r2_artifact_key?: string;
  resume_md?: string;
  created_at: string;
  /** Mamba persistent memory snapshot (v2.0+ agents only) */
  mamba_state?: MambaStateSnapshot;
  /** Mamba engine configuration (v2.0+ agents only) */
  mamba_config?: MambaConfig;
}

// ---------------------------------------------------------------------------
// BuilderForce Agents Agent
// ---------------------------------------------------------------------------

/** Which model backend a BuilderForce Agents agent uses for inference */
export type ModelBackend = 'mamba' | 'external-llm' | string;

/** Top-level configuration for a BuilderForce Agents agent */
export interface BuilderForceAgentConfig {
  /** Unique agent identifier */
  agentId: string;
  /** Display name shown in the IDE and workforce registry */
  name: string;
  /** Short description of what this agent does */
  description?: string;
  /** The model backend to use for inference */
  modelBackend: ModelBackend;
  /** Mamba provider config (required when modelBackend === 'mamba') */
  mambaProvider?: import('./model-provider').MambaProviderConfig;
  /** Mamba SSM state engine config */
  mambaConfig?: MambaConfig;
  /** Confidence threshold below which the agent escalates to cloud (0–1) */
  confidenceThreshold?: number;
}

// ---------------------------------------------------------------------------
// Mamba State Engine (Hybrid Local Brain)
// ---------------------------------------------------------------------------

/** Training mode for the AI training pipeline */
export type TrainingMode = 'behavior' | 'memory' | 'hybrid' | 'mamba';

/** Inference execution target */
export type InferenceMode = 'local' | 'hybrid' | 'cloud';

/** Compact snapshot of a Mamba SSM state vector, serialisable to IndexedDB / R2.
 *  Canonical definition lives in @seanhogg/builderforce-studio — re-exported
 *  here so existing frontend imports from '@/lib/types' keep working without
 *  carrying a duplicate declaration. */
import type { MambaStateSnapshot } from '@seanhogg/builderforce-studio';
export type { MambaStateSnapshot };

/** Configuration for the Mamba state engine */
export interface MambaConfig {
  dim: number;
  order: number;
  channels: number;
  /** Maximum interaction history to keep before compression */
  maxHistory: number;
}

/** Full persisted Mamba agent state (stored in IndexedDB + synced to R2) */
export interface MambaAgentState {
  agentId: string;
  projectId: string | number;
  /** Increment on each save for version history */
  version: number;
  snapshot: MambaStateSnapshot;
  /** Ring-buffer of recent interaction strings */
  history: string[];
  updatedAt: string;
}
