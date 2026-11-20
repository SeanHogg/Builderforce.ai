import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { isRetiredScaffold, RETIRED_SCAFFOLD_CONTENT, VANILLA_TEMPLATE } from '../index';
import { KIT_PARTS, NAMED_KITS, findKitPart, listKitOptions } from './registry';

describe('the kit part registry', () => {
  it('lists every part once, by kind, with the named kits — the ONE list /starter-kit and /help read', () => {
    const options = listKitOptions();
    expect(options.frontends.map((o) => o.id)).toEqual(['react-vite', 'angular', 'vue-vite']);
    expect(options.backends.map((o) => o.id)).toEqual(['node-express', 'python-fastapi', 'laravel', 'dotnet-minimal']);
    // Phase 3 ships the postgres extra only (§W11 Rev 2 item 6).
    expect(options.extras.map((o) => o.id)).toEqual(['postgres']);
    expect(options.namedKits).toBe(NAMED_KITS);
    for (const option of [...options.frontends, ...options.backends, ...options.extras]) expect(option.label).not.toBe('');
  });

  it('resolves aliases only within their kind', () => {
    expect(findKitPart('react', 'frontend')?.id).toBe('react-vite');
    expect(findKitPart('Vue', 'frontend')?.id).toBe('vue-vite');
    expect(findKitPart('node', 'backend')?.id).toBe('node-express');
    expect(findKitPart('fastapi', 'backend')?.id).toBe('python-fastapi');
    expect(findKitPart('dotnet', 'backend')?.id).toBe('dotnet-minimal');
    expect(findKitPart('node', 'frontend')).toBeUndefined();
  });

  it('roots every part at its service, with files relative to that root', () => {
    for (const part of Object.values(KIT_PARTS)) {
      expect(part.root).toBe(part.serviceId === 'web' ? '/web' : '/api');
      for (const path of Object.keys(part.files)) expect(path).not.toMatch(/^\/|^(web|api)\//);
    }
  });

  it('every backend serves the same contract on PORT (default 8000)', () => {
    for (const part of Object.values(KIT_PARTS).filter((p) => p.kind === 'backend')) {
      const source = Object.values(part.files).join('\n');
      expect(source, part.id).toContain('/health');
      expect(source, part.id).toContain('/api/items');
      expect(source, part.id).toContain('DATABASE_URL');
      expect(source, part.id).toContain('migrations/001_items.sql');
    }
  });

  it('pins the .NET part to the runtime bundle (net10.0, bundled Npgsql)', () => {
    const csproj = KIT_PARTS['dotnet-minimal']!.files['Api.csproj']!;
    expect(csproj).toContain('<TargetFramework>net10.0</TargetFramework>');
    expect(csproj).toContain('Include="Npgsql"');
  });

  it('uses pg8000 (pure Python), never psycopg/asyncpg, for the FastAPI part', () => {
    const requirements = KIT_PARTS['python-fastapi']!.files['requirements.txt']!;
    expect(requirements).toContain('pg8000');
    expect(requirements).not.toMatch(/psycopg|asyncpg/);
  });
});

describe('VANILLA_TEMPLATE is the react-vite part’s source, unchanged', () => {
  it('keeps its keys and bytes (scaffoldRepair recognises projects already seeded)', () => {
    expect(Object.keys(VANILLA_TEMPLATE)).toEqual(['package.json', 'index.html', 'src/main.jsx', 'src/App.jsx', 'src/index.css', 'vite.config.js']);
    const hash = createHash('sha256').update(JSON.stringify(VANILLA_TEMPLATE).replace(/\\r\\n/g, '\\n')).digest('hex');
    expect(hash).toBe('3682893fcfbef365d68770cbc5eebd0991a257150bea08b20c9d589af807f8a1');
  });

  it('is derived, not copied: react-vite reuses every scaffold file but the App and the proxied Vite config', () => {
    const files = KIT_PARTS['react-vite']!.files;
    for (const [path, content] of Object.entries(VANILLA_TEMPLATE)) {
      if (path === 'src/App.jsx' || path === 'vite.config.js') expect(files[path]).not.toBe(content);
      else expect(files[path]).toBe(content);
    }
    expect(files['vite.config.js']).toContain("'/api': 'http://localhost:8000'");
  });

  it('leaves the retired-scaffold check as it was', () => {
    expect(Object.keys(RETIRED_SCAFFOLD_CONTENT)).toEqual(['src/main.jsx']);
    expect(isRetiredScaffold('src/main.jsx', RETIRED_SCAFFOLD_CONTENT['src/main.jsx']![0]!)).toBe(true);
    expect(isRetiredScaffold('src/main.jsx', VANILLA_TEMPLATE['src/main.jsx']!)).toBe(false);
  });
});
