import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchProjects,
  fetchProject,
  createProject,
  updateProject,
  deleteProject,
  fetchFiles,
  fetchFileContent,
  saveFile,
  deleteFile,
  sendAIMessage,
  publishAgent,
  listAgents,
  hireAgent,
  fetchAgentPackage,
} from './api';
import type { Project, FileEntry, PublishedAgent, AgentPackage } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockOk(body: unknown, options?: ResponseInit) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      ...options,
    })
  );
}

function mockText(text: string, status = 200) {
  return Promise.resolve(new Response(text, { status }));
}

function mockError(status = 500) {
  return Promise.resolve(new Response('error', { status }));
}

const sampleProject: Project = {
  id: 1,
  name: 'My App',
  description: 'A test project',
  template: 'vanilla',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

const sampleFiles: FileEntry[] = [
  { path: 'index.ts', content: '', type: 'file' },
  { path: 'package.json', content: '', type: 'file' },
];

// ---------------------------------------------------------------------------
// Setup: replace global fetch with a spy before each test
// ---------------------------------------------------------------------------

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// fetchProjects
// ---------------------------------------------------------------------------

describe('fetchProjects', () => {
  it('calls the correct endpoint and returns an array of projects', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ projects: [sampleProject] }), { status: 200 })
    );
    const result = await fetchProjects();
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls[0][0]).toMatch(/\/api\/projects$/);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  it('throws when the server returns a non-ok response', async () => {
    fetchSpy.mockResolvedValueOnce(mockError(500));
    await expect(fetchProjects()).rejects.toThrow('Failed to fetch projects');
  });
});

// ---------------------------------------------------------------------------
// fetchProject
// ---------------------------------------------------------------------------

describe('fetchProject', () => {
  it('calls /api/projects/:id and returns the project', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(sampleProject), { status: 200 })
    );
    const result = await fetchProject(1);
    expect(fetchSpy.mock.calls[0][0]).toMatch(/\/api\/projects\/1$/);
    expect(result.id).toBe(1);
  });

  it('throws on non-ok response', async () => {
    fetchSpy.mockResolvedValueOnce(mockError(404));
    await expect(fetchProject('missing')).rejects.toThrow('Failed to fetch project');
  });
});

// ---------------------------------------------------------------------------
// createProject
// ---------------------------------------------------------------------------

describe('createProject', () => {
  it('POSTs to /api/projects with the correct body', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(sampleProject), { status: 201 })
    );
    const result = await createProject({ name: 'My App', description: 'A test project' });
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/projects$/);
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.name).toBe('My App');
    expect(result.id).toBe(1);
  });

  it('throws on non-ok response', async () => {
    fetchSpy.mockResolvedValueOnce(mockError(500));
    await expect(createProject({ name: 'Bad' })).rejects.toThrow('Failed to create project');
  });
});

// ---------------------------------------------------------------------------
// updateProject
// ---------------------------------------------------------------------------

describe('updateProject', () => {
  it('PATCHes /api/projects/:id', async () => {
    const updated = { ...sampleProject, name: 'Renamed' };
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(updated), { status: 200 })
    );
    const result = await updateProject(1, { name: 'Renamed' });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/projects\/1$/);
    expect(init.method).toBe('PATCH');
    expect(result.name).toBe('Renamed');
  });

  it('throws on non-ok response', async () => {
    fetchSpy.mockResolvedValueOnce(mockError(404));
    await expect(updateProject('gone', { name: 'x' })).rejects.toThrow('Failed to update project');
  });
});

// ---------------------------------------------------------------------------
// deleteProject
// ---------------------------------------------------------------------------

describe('deleteProject', () => {
  it('DELETEs /api/projects/:id', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(undefined, { status: 204 })
    );
    await deleteProject(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/projects\/1$/);
    expect(init.method).toBe('DELETE');
  });

  it('throws on non-ok response', async () => {
    fetchSpy.mockResolvedValueOnce(mockError(404));
    await expect(deleteProject('missing')).rejects.toThrow('Failed to delete project');
  });
});

// ---------------------------------------------------------------------------
// fetchFiles
// ---------------------------------------------------------------------------

describe('fetchFiles', () => {
  it('GETs /api/ide/projects/:id/files and returns an array', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(sampleFiles), { status: 200 })
    );
    const result = await fetchFiles(1);
    expect(fetchSpy.mock.calls[0][0]).toMatch(/\/api\/ide\/projects\/1\/files$/);
    expect(result).toHaveLength(2);
  });

  it('throws on non-ok response', async () => {
    fetchSpy.mockResolvedValueOnce(mockError(500));
    await expect(fetchFiles('proj-1')).rejects.toThrow('Failed to fetch files');
  });
});

// ---------------------------------------------------------------------------
// fetchFileContent
// ---------------------------------------------------------------------------

describe('fetchFileContent', () => {
  it('GETs the file path and returns the text', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('console.log("hi")', { status: 200 })
    );
    const content = await fetchFileContent('proj-1', 'src/main.js');
    expect(fetchSpy.mock.calls[0][0]).toMatch(/\/api\/projects\/proj-1\/files\/src\/main\.js$/);
    expect(content).toBe('console.log("hi")');
  });

  it('throws on non-ok response', async () => {
    fetchSpy.mockResolvedValueOnce(mockError(404));
    await expect(fetchFileContent('proj-1', 'missing.js')).rejects.toThrow('Failed to fetch file content');
  });
});

// ---------------------------------------------------------------------------
// saveFile
// ---------------------------------------------------------------------------

describe('saveFile', () => {
  it('PUTs with the file content as plain text', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );
    await saveFile('proj-1', 'src/main.js', 'const x = 1;');
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/projects\/proj-1\/files\/src\/main\.js$/);
    expect(init.method).toBe('PUT');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('text/plain');
    expect(init.body).toBe('const x = 1;');
  });

  it('throws on non-ok response', async () => {
    fetchSpy.mockResolvedValueOnce(mockError(500));
    await expect(saveFile('proj-1', 'f.js', '')).rejects.toThrow('Failed to save file');
  });
});

// ---------------------------------------------------------------------------
// deleteFile
// ---------------------------------------------------------------------------

describe('deleteFile', () => {
  it('DELETEs the file path', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );
    await deleteFile('proj-1', 'src/old.js');
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/projects\/proj-1\/files\/src\/old\.js$/);
    expect(init.method).toBe('DELETE');
  });

  it('throws on non-ok response', async () => {
    fetchSpy.mockResolvedValueOnce(mockError(500));
    await expect(deleteFile('proj-1', 'f.js')).rejects.toThrow('Failed to delete file');
  });
});

// ---------------------------------------------------------------------------
// sendAIMessage — streaming SSE response
// ---------------------------------------------------------------------------

describe('sendAIMessage', () => {
  function sseStream(...chunks: string[]): Response {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });
    return new Response(body, { status: 200 });
  }

  it('accumulates parsed SSE response chunks via onChunk', async () => {
    const chunks: string[] = [];
    fetchSpy.mockResolvedValueOnce(
      sseStream(
        'data: {"response":"Hello"}\n\n',
        'data: {"response":" world"}\n\n',
        'data: [DONE]\n\n',
      )
    );
    await sendAIMessage('proj-1', [{ role: 'user', content: 'hi' }], (c) => chunks.push(c));
    expect(chunks).toEqual(['Hello', ' world']);
  });

  it('stops at [DONE] sentinel', async () => {
    const chunks: string[] = [];
    fetchSpy.mockResolvedValueOnce(
      sseStream('data: [DONE]\n\n', 'data: {"response":"after"}\n\n')
    );
    await sendAIMessage('proj-1', [], (c) => chunks.push(c));
    expect(chunks).toHaveLength(0);
  });

  it('passes raw non-JSON data lines through as-is', async () => {
    const chunks: string[] = [];
    fetchSpy.mockResolvedValueOnce(sseStream('data: plain text chunk\n\n'));
    await sendAIMessage('proj-1', [], (c) => chunks.push(c));
    expect(chunks).toEqual(['plain text chunk']);
  });

  it('handles OpenRouter / OpenAI SSE format (choices[0].delta.content)', async () => {
    const chunks: string[] = [];
    fetchSpy.mockResolvedValueOnce(
      sseStream(
        'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n\n',
        'data: {"choices":[{"delta":{"content":" world"},"finish_reason":null}]}\n\n',
        'data: [DONE]\n\n',
      )
    );
    await sendAIMessage('proj-1', [{ role: 'user', content: 'hi' }], (c) => chunks.push(c));
    expect(chunks).toEqual(['Hello', ' world']);
  });

  it('ignores OpenRouter chunks where delta.content is empty or absent', async () => {
    const chunks: string[] = [];
    fetchSpy.mockResolvedValueOnce(
      sseStream(
        'data: {"choices":[{"delta":{},"finish_reason":null}]}\n\n',
        'data: {"choices":[{"delta":{"content":"done"},"finish_reason":"stop"}]}\n\n',
        'data: [DONE]\n\n',
      )
    );
    await sendAIMessage('proj-1', [], (c) => chunks.push(c));
    expect(chunks).toEqual(['done']);
  });

  it('POSTs to /api/ai/chat with messages', async () => {
    fetchSpy.mockResolvedValueOnce(sseStream('data: [DONE]\n\n'));
    await sendAIMessage('proj-1', [{ role: 'user', content: 'test' }], () => {});
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/ai\/chat$/);
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.messages).toBeDefined();
    expect(body.messages[0].role).toBe('user');
  });

  it('throws when the server returns a non-ok response', async () => {
    fetchSpy.mockResolvedValueOnce(mockError(500));
    await expect(sendAIMessage('proj-1', [], () => {})).rejects.toThrow('Failed to send AI message');
  });
});

// ---------------------------------------------------------------------------
// Agent Registry
// ---------------------------------------------------------------------------

const sampleAgent: PublishedAgent = {
  id: 'agent-1',
  project_id: 'proj-1',
  job_id: 'job-1',
  name: 'Code Expert',
  title: 'Senior TypeScript Developer',
  bio: 'Specializes in Node.js and React',
  skills: ['TypeScript', 'React', 'Node.js'],
  base_model: 'gpt-neox-20m',
  lora_rank: 8,
  r2_artifact_key: 'proj-1/jobs/job-1/adapter.bin',
  status: 'active',
  hire_count: 0,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

describe('publishAgent', () => {
  it('POSTs to /api/ide/agents and returns the published agent', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(sampleAgent), { status: 201 })
    );
    const result = await publishAgent({
      project_id: 1,
      name: 'Code Expert',
      title: 'Senior TypeScript Developer',
      bio: 'Specializes in Node.js and React',
      skills: ['TypeScript'],
      base_model: 'gpt-neox-20m',
    });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/agents$/);
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.name).toBe('Code Expert');
    expect(result.id).toBe('agent-1');
  });

  it('throws on non-ok response', async () => {
    fetchSpy.mockResolvedValueOnce(mockError(500));
    await expect(
      publishAgent({ project_id: 'p', name: 'x', title: 't', bio: 'b', skills: [], base_model: 'm' })
    ).rejects.toThrow('Failed to publish agent');
  });
});

describe('listAgents', () => {
  it('GETs /api/agents and returns an array', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify([sampleAgent]), { status: 200 })
    );
    const result = await listAgents();
    expect(fetchSpy.mock.calls[0][0]).toMatch(/\/api\/agents$/);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('agent-1');
  });

  it('throws on non-ok response', async () => {
    fetchSpy.mockResolvedValueOnce(mockError(500));
    await expect(listAgents()).rejects.toThrow('Failed to fetch agents');
  });
});

describe('hireAgent', () => {
  it('POSTs to /api/agents/:id/hire and returns the updated agent', async () => {
    const hired = { ...sampleAgent, hire_count: 1 };
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(hired), { status: 200 })
    );
    const result = await hireAgent('agent-1');
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/agents\/agent-1\/hire$/);
    expect(init.method).toBe('POST');
    expect(result.hire_count).toBe(1);
  });

  it('throws on non-ok response', async () => {
    fetchSpy.mockResolvedValueOnce(mockError(404));
    await expect(hireAgent('missing')).rejects.toThrow('Failed to hire agent');
  });
});

// ---------------------------------------------------------------------------
// fetchAgentPackage
// ---------------------------------------------------------------------------

const samplePackage: AgentPackage = {
  version: '1.0',
  platform: 'builderforce.ai',
  name: 'Code Expert',
  title: 'Senior TypeScript Developer',
  bio: 'Specializes in Node.js and React',
  skills: ['TypeScript', 'React', 'Node.js'],
  base_model: 'gpt-neox-20m',
  lora_config: { rank: 8, alpha: 16, target_modules: ['q_proj', 'v_proj'] },
  training_job_id: 'job-1',
  r2_artifact_key: 'proj-1/jobs/job-1/adapter.bin',
  created_at: '2024-01-01T00:00:00Z',
};

describe('fetchAgentPackage', () => {
  it('GETs /api/agents/:id/package and returns the package', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(samplePackage), { status: 200 })
    );
    const result = await fetchAgentPackage('agent-1');
    expect(fetchSpy.mock.calls[0][0]).toMatch(/\/api\/agents\/agent-1\/package$/);
    expect(result.version).toBe('1.0');
    expect(result.platform).toBe('builderforce.ai');
    expect(result.name).toBe('Code Expert');
    expect(result.lora_config.rank).toBe(8);
    expect(result.skills).toEqual(['TypeScript', 'React', 'Node.js']);
  });

  it('throws on non-ok response', async () => {
    fetchSpy.mockResolvedValueOnce(mockError(404));
    await expect(fetchAgentPackage('missing')).rejects.toThrow('Failed to fetch agent package');
  });
});
