import { requestGatewayCompletion, type GatewayChatMessage } from './gateway';
import type { DatasetExample } from './dataset';

export interface TrainingJobRecord {
  id: string;
  project_id: string;
  dataset_id: string | null;
  base_model: string;
  lora_rank: number;
  epochs: number;
  batch_size: number;
  learning_rate: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  current_epoch: number;
  current_loss: number | null;
  r2_artifact_key: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface TrainingLogRecord {
  id: string;
  job_id: string;
  epoch: number | null;
  step: number | null;
  loss: number | null;
  message: string;
  created_at: string;
}

export interface EvaluationResult {
  job_id: string;
  score: number;
  code_correctness: number;
  reasoning_quality: number;
  hallucination_rate: number;
  details: string;
  created_at: string;
}

export interface TrainingEnv {
  STORAGE: R2Bucket;
  BUILDERFORCE_API_BASE_URL?: string;
}

/** System prompt for model output evaluation. */
const EVAL_SYSTEM_PROMPT = `You are an AI evaluation expert. Assess model outputs for quality and accuracy.

For each evaluation, return a JSON object with these exact fields:
{
  "score": 0.0-1.0,
  "code_correctness": 0.0-1.0,
  "reasoning_quality": 0.0-1.0,
  "hallucination_rate": 0.0-1.0,
  "details": "brief explanation"
}

Return ONLY the JSON object, no other text.`;

/**
 * Evaluates fine-tuned model outputs using an AI judge.
 * Routes judge scoring through the centralized Builderforce gateway.
 *
 * @param examples - Dataset examples to evaluate (input/expected output pairs)
 * @param modelOutputs - Actual outputs produced by the fine-tuned model
 * @param jobId - Training job identifier
 * @param env - Worker environment bindings
 */
export async function evaluateModelOutputs(
  examples: DatasetExample[],
  modelOutputs: string[],
  jobId: string,
  env: TrainingEnv,
  authToken: string
): Promise<EvaluationResult> {
  const sampleSize = Math.min(examples.length, 5);
  const sampleExamples = examples.slice(0, sampleSize);
  const sampleOutputs = modelOutputs.slice(0, sampleSize);

  const evaluationPrompt = `Evaluate these model outputs against expected outputs:

${sampleExamples.map((ex, i) => `
Example ${i + 1}:
Instruction: ${ex.instruction}
Expected: ${ex.output}
Actual: ${sampleOutputs[i] ?? '(no output)'}
`).join('\n')}

Provide scores for: overall quality (score), code correctness, reasoning quality, and hallucination rate.`;

  const messages: GatewayChatMessage[] = [
    { role: 'system', content: EVAL_SYSTEM_PROMPT },
    { role: 'user', content: evaluationPrompt },
  ];

  let responseText = '';
  try {
    responseText = await requestGatewayCompletion({
      env,
      authToken,
      messages,
      maxTokens: 1024,
    });
  } catch (error) {
    console.error('Gateway evaluation call failed:', error);
    // Fall back to default scores on evaluation failure
  }

  return parseEvaluationResponse(responseText, jobId);
}

/**
 * Parses the AI evaluation response into structured scores.
 */
export function parseEvaluationResponse(text: string, jobId: string): EvaluationResult {
  const now = new Date().toISOString();
  const defaultResult: EvaluationResult = {
    job_id: jobId,
    score: 0.5,
    code_correctness: 0.5,
    reasoning_quality: 0.5,
    hallucination_rate: 0.1,
    details: 'Evaluation completed with default scores.',
    created_at: now,
  };

  if (!text) return defaultResult;

  try {
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1) return defaultResult;

    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Partial<EvaluationResult>;
    return {
      job_id: jobId,
      score: clamp(Number(parsed.score ?? 0.5)),
      code_correctness: clamp(Number(parsed.code_correctness ?? 0.5)),
      reasoning_quality: clamp(Number(parsed.reasoning_quality ?? 0.5)),
      hallucination_rate: clamp(Number(parsed.hallucination_rate ?? 0.1)),
      details: String(parsed.details ?? 'No details provided.'),
      created_at: now,
    };
  } catch {
    return defaultResult;
  }
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, isNaN(value) ? 0.5 : value));
}

/**
 * Builds an R2 key for a model artifact.
 */
export function buildArtifactKey(projectId: string, jobId: string): string {
  return `artifacts/${projectId}/${jobId}/adapter.bin`;
}

/**
 * Saves a placeholder model artifact to R2.
 * In a real implementation, this would store the serialised LoRA adapter weights.
 */
export async function saveModelArtifact(
  storage: R2Bucket,
  projectId: string,
  jobId: string,
  metadata: Record<string, unknown>
): Promise<string> {
  const key = buildArtifactKey(projectId, jobId);
  const content = JSON.stringify({ ...metadata, saved_at: new Date().toISOString() });
  await storage.put(key, content, {
    httpMetadata: { contentType: 'application/json' },
  });
  return key;
}
