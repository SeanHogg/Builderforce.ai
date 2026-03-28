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
  /** From list endpoint: primary assigned Workforce agent (claw) for this project */
  assignedClaw?: { id: number; name: string } | null;
}

export interface FileEntry {
  path: string;
  content: string;
  type: 'file' | 'directory';
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
  project_id: number | string;
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
  created_at: string;
  updated_at: string;
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
// CoderClaw Agent
// ---------------------------------------------------------------------------

/** Which model backend a CoderClaw agent uses for inference */
export type ModelBackend = 'mamba' | 'external-llm' | string;

/** Top-level configuration for a CoderClaw agent */
export interface CoderClawAgentConfig {
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

/** Compact snapshot of a Mamba SSM state vector, serialisable to IndexedDB / R2 */
export interface MambaStateSnapshot {
  /** Packed Float32 values encoded as a plain number array for JSON portability */
  data: number[];
  /** Dimensionality of each state channel */
  dim: number;
  /** SSM order (hidden states per channel) */
  order: number;
  /** Number of parallel channels */
  channels: number;
  /** Monotonically increasing sequence counter */
  step: number;
}

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
