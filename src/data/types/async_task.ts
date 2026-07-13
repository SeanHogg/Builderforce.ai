/**
 * Async Task Types
 * 
 * Types for background tasks related to tax compliance (1099 generation, e-filing).
 */

/**
 * Task status
 */
export type AsyncTaskStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';

/**
 * Tax async任务
 */
export interface TaxAsyncTask {
  id: string;
  taskId: string; // Related platform task ID
  type: 'generate_1099' | 'efile_1099' | 'aggregate_payments' | 'export_batch';
  
  // Task metadata
  fiscalYear?: number;
  formType?: '1099-NEC' | '1099-MISC';
  recipientId?: string;
  batchId?: string;
  
  // Status tracking
  status: AsyncTaskStatus;
  progress?: number; // 0-100
  startedAt?: Date;
  completedAt?: Date;
  
  // Results
  result?: any;
  error?: string;
  
  // Parallel runs
  totalRuns: number;
  currentRun: number;
  
  createdAt: Date;
  updatedAt: Date;
}