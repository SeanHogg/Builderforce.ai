// types.ts — common DTOs for parallelization-plan analysis (PRD FR-1 to FR-6)
export type InputFormat = "json" | "yaml" | "pdt"; // Plain-text (newline-delimited tasks)

export interface Task {
  id: string;
  name: string;
  description: string;
  depends_on?: string[];
  estimated_duration?: number; // minutes; optional
}

export interface ParallelPlan {
  metadata: PlanMetadata;
  waves: Wave[];
  critical_path_summary: string;
  summary: Summary;
}

export interface Wave {
  wave_number: number;
  task_ids: string[];
  task_names: string[];
  max_duration: number; // minutes
  total_duration: number;
}

export interface PlanMetadata {
  input_task_count: number;
  wave_count: number;
  critical_path_length: number;
  created_at: string;
}

export interface Summary {
  sequential_total_time: number;
  parallelized_total_time: number;
  time_saved_percentage: number;
  total_waves: number;
  tasks_in_critical_path: number;
}

export interface DependencyGraph {
  nodes: Node[];
  edges: Edge[];
  critical_path_nodes: string[];
  critical_path_edges: Edge[];
}

export interface Node {
  id: string;
  name: string;
  in_degree: number;
  out_degree: number;
}

export interface Edge {
  from: string;
  to: string;
  duration: number | undefined;
}

export interface ErrorDetail {
  cause: string[];
}

export interface AnalysisError {
  error_code: string;
  message: string;
  details?: ErrorDetail;
}