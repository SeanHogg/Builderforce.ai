import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateId, VANILLA_TEMPLATE, createTemplateFiles } from './projects';

// ---------------------------------------------------------------------------
// generateId
// ---------------------------------------------------------------------------

describe('generateId', () => {
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  it('returns a string matching UUID v4 format', () => {
    expect(generateId()).toMatch(UUID_RE);
  });

  it('returns a unique value on each call', () => {
    const ids = Array.from({ length: 10 }, () => generateId());
    const unique = new Set(ids);
    expect(unique.size).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// VANILLA_TEMPLATE
// ---------------------------------------------------------------------------

describe('VANILLA_TEMPLATE', () => {
  it('contains package.json', () => {
    expect(VANILLA_TEMPLATE).toHaveProperty('package.json');
  });

  it('contains index.html', () => {
    expect(VANILLA_TEMPLATE).toHaveProperty('index.html');
  });

  it('contains src/main.jsx', () => {
    expect(VANILLA_TEMPLATE).toHaveProperty('src/main.jsx');
  });

  it('contains src/index.css and vite.config.js', () => {
    expect(VANILLA_TEMPLATE).toHaveProperty('src/index.css');
    expect(VANILLA_TEMPLATE).toHaveProperty('vite.config.js');
  });

  it('package.json is valid JSON with a "scripts.dev" field', () => {
    const pkg = JSON.parse(VANILLA_TEMPLATE['package.json']);
    expect(pkg).toHaveProperty('scripts.dev');
    expect(typeof pkg.scripts.dev).toBe('string');
  });

  it('package.json includes vite (devDependencies) and react (dependencies)', () => {
    const pkg = JSON.parse(VANILLA_TEMPLATE['package.json']);
    expect(pkg.devDependencies).toHaveProperty('vite');
    expect(pkg.dependencies).toHaveProperty('react');
  });

  it('index.html references the main entry script', () => {
    expect(VANILLA_TEMPLATE['index.html']).toContain('src/main.jsx');
  });

  it('src/main.jsx contains non-empty content', () => {
    expect(VANILLA_TEMPLATE['src/main.jsx'].trim().length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// createTemplateFiles
// ---------------------------------------------------------------------------

describe('createTemplateFiles', () => {
  let putMock: ReturnType<typeof vi.fn>;
  let mockStorage: R2Bucket;

  beforeEach(() => {
    putMock = vi.fn().mockResolvedValue(undefined);
    mockStorage = { put: putMock } as unknown as R2Bucket;
  });

  it('calls storage.put once per template file', async () => {
    await createTemplateFiles(mockStorage, 'project-abc', 'vanilla');
    expect(putMock).toHaveBeenCalledTimes(Object.keys(VANILLA_TEMPLATE).length);
  });

  it('prefixes each file key with the project id', async () => {
    await createTemplateFiles(mockStorage, 'project-abc', 'vanilla');
    for (const call of putMock.mock.calls) {
      expect((call[0] as string).startsWith('project-abc/')).toBe(true);
    }
  });

  it('stores the correct content for each file', async () => {
    await createTemplateFiles(mockStorage, 'proj-1', 'vanilla');
    for (const [path, content] of Object.entries(VANILLA_TEMPLATE)) {
      expect(putMock).toHaveBeenCalledWith(`proj-1/${path}`, content);
    }
  });

  it('works with any project id (including UUIDs)', async () => {
    const id = '550e8400-e29b-41d4-a716-446655440000';
    await createTemplateFiles(mockStorage, id, 'vanilla');
    expect(putMock.mock.calls[0][0]).toMatch(new RegExp(`^${id}/`));
  });

  it('awaits all R2 puts in parallel (all resolve before returning)', async () => {
    let resolved = 0;
    putMock.mockImplementation(() =>
      new Promise<void>((res) => setTimeout(() => { resolved++; res(); }, 5))
    );
    await createTemplateFiles(mockStorage, 'p', 'vanilla');
    expect(resolved).toBe(Object.keys(VANILLA_TEMPLATE).length);
  });
});
