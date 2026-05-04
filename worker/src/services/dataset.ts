import { requestGatewayCompletion, type GatewayEnv, type GatewayChatMessage } from './gateway';

export interface DatasetExample {
  instruction: string;
  input: string;
  output: string;
}

export interface GeneratedDataset {
  examples: DatasetExample[];
  capability: string;
}

export interface DatasetEnv {
  BUILDERFORCE_API_BASE_URL?: string;
}

/**
 * System prompt for structured dataset generation.
 * Produces JSON arrays of instruction-tuning examples.
 */
const DATASET_SYSTEM_PROMPT = `You are an expert AI trainer specialising in generating high-quality instruction-tuning datasets.

When asked to generate a dataset for a capability, you must respond with a JSON array of examples.
Each example must follow this exact format:
{"instruction": "task description", "input": "optional context or code", "output": "expected response"}

Guidelines:
- Generate diverse examples covering different difficulty levels
- Include edge cases and error scenarios
- For coding tasks: include both correct and buggy code examples
- For reasoning tasks: include step-by-step explanations
- Ensure outputs are accurate and high-quality
- Return ONLY the JSON array, no other text`;

/**
 * Generates a training dataset for the given capability prompt through
 * the centralized Builderforce gateway.
 *
 * @param capabilityPrompt - Describes the target capability (e.g. "Python debugging")
 * @param exampleCount - Number of examples to generate (default: 50)
 * @param env - Worker environment bindings
 * @returns Parsed dataset with instruction-tuning examples
 */
export async function generateDatasetWithAI(
  capabilityPrompt: string,
  exampleCount: number,
  env: DatasetEnv,
  authToken: string
): Promise<GeneratedDataset> {
  const userPrompt = `Generate ${exampleCount} diverse instruction-tuning examples for the following AI capability:

Capability: ${capabilityPrompt}

Requirements:
1. Task decomposition — cover multiple sub-tasks within the capability
2. Difficulty scaling — include easy, medium, and hard examples
3. Diversity — vary the style, domain, and complexity
4. Edge cases — include unusual inputs and error scenarios
5. Self-critique — ensure all outputs are correct and helpful

Return ONLY a valid JSON array of examples.`;

  const messages: GatewayChatMessage[] = [
    { role: 'system', content: DATASET_SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];

  const responseText = await requestGatewayCompletion({
    env: env as GatewayEnv,
    authToken,
    messages,
    maxTokens: 4096,
  });
  if (!responseText) {
    throw new Error('Gateway returned an empty dataset generation response');
  }

  return parseDatasetResponse(responseText, capabilityPrompt);
}

/**
 * Parses the AI response text into a structured dataset.
 * Handles various response formats and extracts the JSON array.
 */
export function parseDatasetResponse(text: string, capability: string): GeneratedDataset {
  // Strip markdown code fences if present
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

  // Find JSON array boundaries
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1) {
    throw new Error('AI response did not contain a valid JSON array');
  }

  const jsonStr = cleaned.slice(start, end + 1);
  const raw = JSON.parse(jsonStr) as unknown[];

  const examples: DatasetExample[] = raw
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map(item => ({
      instruction: String(item['instruction'] ?? ''),
      input: String(item['input'] ?? ''),
      output: String(item['output'] ?? ''),
    }))
    .filter(ex => ex.instruction.length > 0 && ex.output.length > 0);

  return { examples, capability };
}

/**
 * Serialises a dataset to JSONL format for storage in R2.
 */
export function serialiseDataset(dataset: GeneratedDataset): string {
  return dataset.examples.map(ex => JSON.stringify(ex)).join('\n');
}

/**
 * Stores a serialised dataset in R2 under a namespaced key.
 * Returns the R2 key.
 */
export async function storeDatasetInR2(
  storage: R2Bucket,
  projectId: string,
  datasetId: string,
  content: string
): Promise<string> {
  const key = `datasets/${projectId}/${datasetId}.jsonl`;
  await storage.put(key, content, {
    httpMetadata: { contentType: 'application/jsonl' },
  });
  return key;
}
