import { getStoredTenantToken } from './auth';

const WORKER_URL = (() => {
  const url = process.env.NEXT_PUBLIC_WORKER_URL;
  if (!url) {
    console.warn(
      '[builderforce] NEXT_PUBLIC_WORKER_URL is not set. ' +
      'Falling back to http://localhost:8787. ' +
      'Set this env var during `next build` for production.'
    );
    return 'http://localhost:8787';
  }
  return url;
})();

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getStoredTenantToken();
  const headers: Record<string, string> = { ...extra };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

export async function fetchProjects(): Promise<import('./types').Project[]> {
  const res = await fetch(`${WORKER_URL}/api/projects`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to fetch projects');
  return res.json();
}

export async function fetchProject(id: string): Promise<import('./types').Project> {
  const res = await fetch(`${WORKER_URL}/api/projects/${id}`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to fetch project');
  return res.json();
}

export async function createProject(data: { name: string; description?: string; template?: string }): Promise<import('./types').Project> {
  const res = await fetch(`${WORKER_URL}/api/projects`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to create project');
  return res.json();
}

export async function updateProject(id: string, data: Partial<import('./types').Project>): Promise<import('./types').Project> {
  const res = await fetch(`${WORKER_URL}/api/projects/${id}`, {
    method: 'PUT',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to update project');
  return res.json();
}

export async function deleteProject(id: string): Promise<void> {
  const res = await fetch(`${WORKER_URL}/api/projects/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to delete project');
}

export async function fetchFiles(projectId: string): Promise<import('./types').FileEntry[]> {
  const res = await fetch(`${WORKER_URL}/api/projects/${projectId}/files`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to fetch files');
  return res.json();
}

export async function fetchFileContent(projectId: string, filePath: string): Promise<string> {
  const res = await fetch(`${WORKER_URL}/api/projects/${projectId}/files/${filePath}`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to fetch file content');
  return res.text();
}

export async function saveFile(projectId: string, filePath: string, content: string): Promise<void> {
  const res = await fetch(`${WORKER_URL}/api/projects/${projectId}/files/${filePath}`, {
    method: 'PUT',
    headers: { ...authHeaders(), 'Content-Type': 'text/plain' },
    body: content,
  });
  if (!res.ok) throw new Error('Failed to save file');
}

export async function deleteFile(projectId: string, filePath: string): Promise<void> {
  const res = await fetch(`${WORKER_URL}/api/projects/${projectId}/files/${filePath}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error('Failed to delete file');
}

export async function sendAIMessage(
  projectId: string,
  messages: { role: string; content: string }[],
  onChunk: (chunk: string) => void
): Promise<void> {
  const res = await fetch(`${WORKER_URL}/api/ai/chat`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, messages }),
  });
  if (!res.ok) throw new Error('Failed to send AI message');
  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    const lines = text.split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') return;
        try {
          const parsed = JSON.parse(data);
          // Extract the text chunk from whichever SSE format the active provider uses:
          //   choices[0].delta.content — OpenRouter / OpenAI-compatible (AI_PROVIDER=openrouter|ab)
          //   response                 — Cloudflare Workers AI (AI_PROVIDER=cloudflare)
          const chunk =
            parsed.choices?.[0]?.delta?.content ||
            parsed.response ||
            parsed.text ||
            parsed.delta ||
            '';
          if (chunk) onChunk(chunk);
        } catch {
          if (data) onChunk(data);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Datasets
// ---------------------------------------------------------------------------

export async function generateDataset(
  projectId: string,
  capabilityPrompt: string,
  name: string,
  onChunk?: (chunk: string) => void
): Promise<import('./types').Dataset> {
  const res = await fetch(`${WORKER_URL}/api/datasets/generate`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, capabilityPrompt, name }),
  });
  if (!res.ok) throw new Error('Failed to generate dataset');

  if (onChunk && res.headers.get('content-type')?.includes('text/event-stream')) {
    const reader = res.body?.getReader();
    if (reader) {
      const decoder = new TextDecoder();
      let finalDataset: import('./types').Dataset | undefined;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        for (const line of text.split('\n')) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') break;
            try {
              const parsed = JSON.parse(data);
              if (parsed.type === 'chunk' && parsed.content) onChunk(parsed.content);
              if (parsed.type === 'done') finalDataset = parsed.dataset;
            } catch {
              if (data) onChunk(data);
            }
          }
        }
      }
      if (finalDataset) return finalDataset;
    }
  }

  return res.json();
}

export async function listDatasets(projectId: string): Promise<import('./types').Dataset[]> {
  const res = await fetch(`${WORKER_URL}/api/datasets?projectId=${encodeURIComponent(projectId)}`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to fetch datasets');
  return res.json();
}

export async function fetchDataset(datasetId: string): Promise<import('./types').Dataset> {
  const res = await fetch(`${WORKER_URL}/api/datasets/${datasetId}`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to fetch dataset');
  return res.json();
}

// ---------------------------------------------------------------------------
// Training Jobs
// ---------------------------------------------------------------------------

export async function createTrainingJob(data: {
  projectId: string;
  datasetId?: string;
  baseModel: string;
  loraRank: number;
  epochs: number;
  batchSize: number;
  learningRate: number;
}): Promise<import('./types').TrainingJob> {
  const res = await fetch(`${WORKER_URL}/api/training`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to create training job');
  return res.json();
}

export async function listTrainingJobs(projectId: string): Promise<import('./types').TrainingJob[]> {
  const res = await fetch(`${WORKER_URL}/api/training?projectId=${encodeURIComponent(projectId)}`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to fetch training jobs');
  return res.json();
}

export async function fetchTrainingJob(jobId: string): Promise<import('./types').TrainingJob> {
  const res = await fetch(`${WORKER_URL}/api/training/${jobId}`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to fetch training job');
  return res.json();
}

export async function fetchTrainingLogs(jobId: string): Promise<import('./types').TrainingLog[]> {
  const res = await fetch(`${WORKER_URL}/api/training/${jobId}/logs`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to fetch training logs');
  return res.json();
}

export async function streamTrainingLogs(
  jobId: string,
  onLog: (log: import('./types').TrainingLog) => void
): Promise<void> {
  const res = await fetch(`${WORKER_URL}/api/training/${jobId}/logs/stream`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to stream training logs');
  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    for (const line of text.split('\n')) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') return;
        try {
          const log = JSON.parse(data) as import('./types').TrainingLog;
          onLog(log);
        } catch {
          // ignore malformed lines
        }
      }
    }
  }
}

export async function evaluateModel(jobId: string): Promise<import('./types').EvaluationResult> {
  const res = await fetch(`${WORKER_URL}/api/training/${jobId}/evaluate`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error('Failed to evaluate model');
  return res.json();
}

// ---------------------------------------------------------------------------
// Agent Registry (Workforce)
// ---------------------------------------------------------------------------

export async function publishAgent(data: {
  project_id: string;
  job_id?: string;
  name: string;
  title: string;
  bio: string;
  skills: string[];
  base_model: string;
  lora_rank?: number;
  r2_artifact_key?: string;
  resume_md?: string;
  eval_score?: number;
}): Promise<import('./types').PublishedAgent> {
  const res = await fetch(`${WORKER_URL}/api/agents`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to publish agent');
  return res.json();
}

export async function listAgents(): Promise<import('./types').PublishedAgent[]> {
  const res = await fetch(`${WORKER_URL}/api/agents`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to fetch agents');
  return res.json();
}

export async function fetchAgent(agentId: string): Promise<import('./types').PublishedAgent> {
  const res = await fetch(`${WORKER_URL}/api/agents/${agentId}`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to fetch agent');
  return res.json();
}

export async function hireAgent(agentId: string): Promise<import('./types').PublishedAgent> {
  const res = await fetch(`${WORKER_URL}/api/agents/${agentId}/hire`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error('Failed to hire agent');
  return res.json();
}

export async function fetchAgentPackage(agentId: string): Promise<import('./types').AgentPackage> {
  const res = await fetch(`${WORKER_URL}/api/agents/${agentId}/package`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to fetch agent package');
  return res.json();
}

/** Download raw JSONL text for a dataset from R2 via the worker. */
export async function downloadDataset(datasetId: string): Promise<string> {
  const res = await fetch(`${WORKER_URL}/api/datasets/${datasetId}/download`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Failed to download dataset');
  return res.text();
}

/** Upload a raw LoRA adapter ArrayBuffer to R2 via the worker. */
export async function uploadArtifact(jobId: string, data: ArrayBuffer): Promise<{ r2Key: string }> {
  const res = await fetch(`${WORKER_URL}/api/training/${jobId}/artifact`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/octet-stream' },
    body: data,
  });
  if (!res.ok) throw new Error('Failed to upload artifact');
  return res.json();
}

/** Update training job status/epoch/loss from the browser. */
export async function updateTrainingJob(
  jobId: string,
  data: {
    status?: string;
    currentEpoch?: number;
    currentLoss?: number;
    r2ArtifactKey?: string;
    errorMessage?: string;
  },
): Promise<import('./types').TrainingJob> {
  const res = await fetch(`${WORKER_URL}/api/training/${jobId}`, {
    method: 'PUT',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to update training job');
  return res.json();
}
