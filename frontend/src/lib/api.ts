const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'http://localhost:8787';

export async function fetchProjects(): Promise<import('./types').Project[]> {
  const res = await fetch(`${WORKER_URL}/api/projects`);
  if (!res.ok) throw new Error('Failed to fetch projects');
  return res.json();
}

export async function fetchProject(id: string): Promise<import('./types').Project> {
  const res = await fetch(`${WORKER_URL}/api/projects/${id}`);
  if (!res.ok) throw new Error('Failed to fetch project');
  return res.json();
}

export async function createProject(data: { name: string; description?: string; template?: string }): Promise<import('./types').Project> {
  const res = await fetch(`${WORKER_URL}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to create project');
  return res.json();
}

export async function updateProject(id: string, data: Partial<import('./types').Project>): Promise<import('./types').Project> {
  const res = await fetch(`${WORKER_URL}/api/projects/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to update project');
  return res.json();
}

export async function deleteProject(id: string): Promise<void> {
  const res = await fetch(`${WORKER_URL}/api/projects/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to delete project');
}

export async function fetchFiles(projectId: string): Promise<import('./types').FileEntry[]> {
  const res = await fetch(`${WORKER_URL}/api/projects/${projectId}/files`);
  if (!res.ok) throw new Error('Failed to fetch files');
  return res.json();
}

export async function fetchFileContent(projectId: string, filePath: string): Promise<string> {
  const res = await fetch(`${WORKER_URL}/api/projects/${projectId}/files/${filePath}`);
  if (!res.ok) throw new Error('Failed to fetch file content');
  return res.text();
}

export async function saveFile(projectId: string, filePath: string, content: string): Promise<void> {
  const res = await fetch(`${WORKER_URL}/api/projects/${projectId}/files/${filePath}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/plain' },
    body: content,
  });
  if (!res.ok) throw new Error('Failed to save file');
}

export async function deleteFile(projectId: string, filePath: string): Promise<void> {
  const res = await fetch(`${WORKER_URL}/api/projects/${projectId}/files/${filePath}`, {
    method: 'DELETE',
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
    headers: { 'Content-Type': 'application/json' },
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
