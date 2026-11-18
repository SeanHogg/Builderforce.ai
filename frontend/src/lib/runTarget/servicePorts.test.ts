import { describe, expect, it } from 'vitest';
import { createNodeProvider, validateSpec, type NodeServiceHost, type ServiceSpec } from '@seanhogg/builderforce-webcontainers/app';
import { blueprintToApplicationSpec } from './blueprintToApplicationSpec';
import { acceptBlueprintInBrowser } from './browserAcceptance';
import { blueprint, service } from './blueprintFixtures';
import { rebindCommand } from './servicePorts';

const byId = (spec: ReturnType<typeof blueprintToApplicationSpec>, id: string) => spec.services.find((s) => s.id === id);
const moved = (line: string, from: number, to: number) => {
  const rebound = rebindCommand(line, from, to);
  return rebound.ok ? rebound.line : null;
};
const DATABASE = { engine: 'postgres', migrationCommand: '', seedCommand: null, migrationsPath: '', connectionSecretName: 'DATABASE_URL' } as const;

describe('rebindCommand — only the port forms it knows', () => {
  it.each([
    ['uvicorn main:app --port 8000', 'uvicorn main:app --port 8001'],
    ['uvicorn main:app --port=8000', 'uvicorn main:app --port=8001'],
    ['flask run -p 8000', 'flask run -p 8001'],
    ['next dev -p8000', 'next dev -p8001'],
    ['php -S 0.0.0.0:8000 -t public', 'php -S 0.0.0.0:8001 -t public'],
    ['gunicorn app:app --bind 0.0.0.0:8000', 'gunicorn app:app --bind 0.0.0.0:8001'],
    ['gunicorn app:app -b :8000', 'gunicorn app:app -b :8001'],
    ['gunicorn app:app --bind=127.0.0.1:8000', 'gunicorn app:app --bind=127.0.0.1:8001'],
    ['dotnet run --urls http://0.0.0.0:8000', 'dotnet run --urls http://0.0.0.0:8001'],
    ['dotnet run --url=http://localhost:8000/', 'dotnet run --url=http://localhost:8001/'],
    ['PORT=8000 node server.js', 'PORT=8001 node server.js'],
  ])('%s', (line, expected) => {
    expect(moved(line, 8000, 8001)).toBe(expected);
  });

  it.each([
    ['uvicorn main:app --port "8000"', 'uvicorn main:app --port "8001"'],
    ["uvicorn main:app --port '8000'", "uvicorn main:app --port '8001'"],
    ['uvicorn main:app "--port=8000"', 'uvicorn main:app "--port=8001"'],
    ['uvicorn main:app --port="8000"', 'uvicorn main:app --port="8001"'],
    ['php -S "0.0.0.0:8000" -t public', 'php -S "0.0.0.0:8001" -t public'],
  ])('quoted: %s', (line, expected) => {
    expect(moved(line, 8000, 8001)).toBe(expected);
  });

  it('never touches another number: a heap size, a timeout, a path', () => {
    expect(moved('NODE_OPTIONS=--max-old-space-size=8000 node server.js --port 8000', 8000, 8001))
      .toBe('NODE_OPTIONS=--max-old-space-size=8000 node server.js --port 8001');
    expect(moved('node /srv/8000/server.js --timeout 8000 --port 8000', 8000, 8001))
      .toBe('node /srv/8000/server.js --timeout 8000 --port 8001');
    expect(moved('uvicorn main:app --timeout-keep-alive 8000 --port 8000', 8000, 8001))
      .toBe('uvicorn main:app --timeout-keep-alive 8000 --port 8001');
  });

  it('rewrites a shell line per command, a bfsh -c script inside its quotes', () => {
    expect(moved('cd api && uvicorn main:app --port 8000', 8000, 8001)).toBe('cd api && uvicorn main:app --port 8001');
    expect(moved('bfsh -c "pip install -r requirements.txt && uvicorn main:app --port 8000"', 8000, 8001))
      .toBe('bfsh -c "pip install -r requirements.txt && uvicorn main:app --port 8001"');
    expect(moved("NODE_OPTIONS=--max-old-space-size=8000 bfsh -c 'sleep 8000; PORT=8000 node a.js'", 8000, 8001))
      .toBe("NODE_OPTIONS=--max-old-space-size=8000 bfsh -c 'sleep 8000; PORT=8001 node a.js'");
  });

  it('adds its server’s port flag to a command that names none', () => {
    expect(moved('uvicorn main:app', 8000, 8001)).toBe('uvicorn main:app --port 8001');
    expect(moved('fastapi run main.py', 8000, 8001)).toBe('fastapi run main.py --port 8001');
    expect(moved('flask run', 5000, 5001)).toBe('flask run --port 5001');
    expect(moved('npx vite', 5173, 5174)).toBe('npx vite --port 5174');
    expect(moved('next dev', 3000, 3001)).toBe('next dev -p 3001');
    expect(moved('php public/router.php', 8000, 8001)).toBe('php -S 0.0.0.0:8001 public/router.php');
    expect(moved('dotnet run -- --verbose', 8080, 8081)).toBe('dotnet run --urls http://0.0.0.0:8081 -- --verbose');
    expect(moved('cd api && uvicorn main:app', 8000, 8001)).toBe('cd api && uvicorn main:app --port 8001');
    expect(moved('bfsh -c "cd api && uvicorn main:app"', 8000, 8001)).toBe('bfsh -c "cd api && uvicorn main:app --port 8001"');
  });

  it('cannot move a command that names no port and has no known flag, or names another port', () => {
    expect(rebindCommand('node app.js 18000 80001', 8000, 8001)).toMatchObject({ ok: false });
    expect(rebindCommand('./target/wasm32-wasip1/release/edge.wasm', 8080, 8081)).toMatchObject({ ok: false });
    expect(rebindCommand('uvicorn main:app --port 9000', 8000, 8001)).toMatchObject({ ok: false, reason: expect.stringMatching(/9000/) });
    expect(rebindCommand('vite & uvicorn main:app', 8000, 8001)).toMatchObject({ ok: false });
  });

  it('leaves a command that keeps its port as it is', () => {
    expect(moved('node app.js', 3000, 3000)).toBe('node app.js');
  });
});

describe('blueprintToApplicationSpec — one port per service', () => {
  it.each([
    {
      what: 'a Python and a PHP API (both 8000)',
      first: service({ id: 'py', kind: 'python', rootDir: 'py', installCommand: '', devCommand: 'uvicorn main:app --host 0.0.0.0 --port 8000', ports: [8000] }),
      second: service({ id: 'site', kind: 'php', rootDir: 'site', installCommand: '', devCommand: 'php -S 0.0.0.0:8000 -t public', ports: [8000] }),
      moved: { port: 8001, command: 'php', args: ['-S', '0.0.0.0:8001', '-t', 'public'] },
    },
    {
      what: 'two Python APIs (both 8000)',
      first: service({ id: 'a', kind: 'python', rootDir: 'a', installCommand: '', devCommand: 'uvicorn main:app --port 8000', ports: [8000] }),
      second: service({ id: 'b', kind: 'python', rootDir: 'b', installCommand: '', devCommand: 'gunicorn site.wsgi:application --bind 0.0.0.0:8000', ports: [8000] }),
      moved: { port: 8001, command: 'gunicorn', args: ['site.wsgi:application', '--bind', '0.0.0.0:8001'] },
    },
    {
      what: 'a portless uvicorn after another Python API: its flag is added',
      first: service({ id: 'a', kind: 'python', rootDir: 'a', installCommand: '', devCommand: 'uvicorn main:app --port 8000', ports: [8000] }),
      second: service({ id: 'b', kind: 'python', rootDir: 'b', installCommand: '', devCommand: 'uvicorn main:app', ports: [] }),
      moved: { port: 8001, command: 'uvicorn', args: ['main:app', '--port', '8001'] },
    },
  ])('gives each its own port, the later one’s command told so: $what', ({ first, second, moved: expected }) => {
    const app = blueprint({ services: [first, second] });
    const spec = blueprintToApplicationSpec(app);
    expect(byId(spec, first.id)?.port).toBe(first.ports[0]);
    expect(byId(spec, second.id)).toMatchObject(expected);
    expect(validateSpec(spec)).toEqual([]);
    expect(acceptBlueprintInBrowser(app)).toMatchObject({ ok: true });
  });

  it.each([
    {
      what: 'two Node services on 3000 whose second names no port',
      services: [
        service({ id: 'a', kind: 'node', devCommand: 'node a.js', ports: [3000] }),
        service({ id: 'b', kind: 'node', devCommand: 'node b.js', ports: [3000] }),
      ],
      named: /^b: port 3000 is taken/,
    },
    {
      what: 'a Rust module after a .NET service (both 8080)',
      services: [
        service({ id: 'shop', kind: 'dotnet', rootDir: 'shop', installCommand: '', devCommand: 'dotnet run --urls http://0.0.0.0:8080', ports: [8080] }),
        service({ id: 'edge', kind: 'rust', rootDir: 'edge', installCommand: '', devCommand: './target/wasm32-wasip1/release/edge.wasm', ports: [8080] }),
      ],
      named: /^edge: port 8080 is taken/,
    },
  ])('declines a moved service whose command cannot be told its port: $what', ({ services, named }) => {
    const verdict = acceptBlueprintInBrowser(blueprint({ services }));
    expect(verdict).toMatchObject({ ok: false, code: 'serviceDeclined' });
    if (!verdict.ok) expect(verdict.detail).toMatch(named);
  });

  it('holds a declared port before a default: a default declared first moves, not the declared one', () => {
    const app = blueprint({
      services: [
        service({ id: 'py', kind: 'python', installCommand: '', devCommand: 'uvicorn main:app', ports: [] }),
        service({ id: 'api', kind: 'node', devCommand: 'node server.js --port 8000', ports: [8000] }),
      ],
    });
    const spec = blueprintToApplicationSpec(app);
    expect(byId(spec, 'api')).toMatchObject({ port: 8000, args: ['server.js', '--port', '8000'] });
    expect(byId(spec, 'py')).toMatchObject({ port: 8001, args: ['main:app', '--port', '8001'] });
    expect(acceptBlueprintInBrowser(app)).toMatchObject({ ok: true });
  });

  it('never moves a service onto the database port', () => {
    const spec = blueprintToApplicationSpec(blueprint({
      services: [service({ id: 'api', kind: 'node', devCommand: 'node server.js --port=5432', ports: [5432] })],
      database: DATABASE,
    }));
    expect(byId(spec, 'db')?.port).toBe(5432);
    expect(byId(spec, 'api')).toMatchObject({ port: 5433, args: ['server.js', '--port=5433'] });
  });

  it('declines a service when no port is left below 65536', () => {
    const verdict = acceptBlueprintInBrowser(blueprint({
      services: [
        service({ id: 'a', kind: 'node', devCommand: 'node a.js --port 65535', ports: [65535] }),
        service({ id: 'b', kind: 'node', devCommand: 'node b.js --port 65535', ports: [65535] }),
      ],
    }));
    expect(verdict).toMatchObject({ ok: false, code: 'serviceDeclined' });
    if (!verdict.ok) expect(verdict.detail).toMatch(/^b: no free port from 65535/);
  });
});

describe('blueprintToApplicationSpec — a move reaches the services that call it', () => {
  const apis = [
    service({ id: 'py', kind: 'python', rootDir: 'py', installCommand: '', devCommand: 'uvicorn main:app --port 8000', ports: [8000] }),
    service({ id: 'site', kind: 'php', rootDir: 'site', installCommand: '', devCommand: 'php -S 0.0.0.0:8000 -t public', ports: [8000] }),
  ];
  const vars = [{ name: 'API_URL', defaultValue: 'http://localhost:8000/api' }, { name: 'OTHER', defaultValue: 'http://10.0.0.1:8000' }];

  it('gives a dependent of the moved service its env with the port moved', () => {
    const spec = blueprintToApplicationSpec(blueprint({
      services: [...apis, service({ id: 'web', kind: 'vite-react', rootDir: 'web', ports: [5173], dependsOn: ['site'] })],
      vars,
    }));
    expect(byId(spec, 'web')?.env).toEqual({ API_URL: 'http://localhost:8001/api' });
    expect(byId(spec, 'py')?.env).toBeUndefined();
    expect(spec.env).toEqual({ API_URL: 'http://localhost:8000/api', OTHER: 'http://10.0.0.1:8000' });
  });

  it('leaves an ambiguous reference as it is: a dependent of both the moved and the kept service', () => {
    const declared = blueprintToApplicationSpec(blueprint({
      services: [...apis, service({ id: 'web', kind: 'vite-react', rootDir: 'web', ports: [5173], dependsOn: ['py', 'site'] })],
      vars,
    }));
    expect(byId(declared, 'web')?.env).toBeUndefined();
    // A frontend with no dependsOn depends on every backend: as ambiguous.
    const defaulted = blueprintToApplicationSpec(blueprint({
      services: [...apis, service({ id: 'web', kind: 'vite-react', rootDir: 'web', ports: [5173] })],
      vars,
    }));
    expect(byId(defaulted, 'web')?.env).toBeUndefined();
  });
});

describe('a moved service with http readiness', () => {
  it('is probed on its new port: the provider derives the probe port from the spec’s port', async () => {
    const spec = blueprintToApplicationSpec(blueprint({
      services: [
        service({ id: 'a', kind: 'node', devCommand: 'node a.js --port 3000', ports: [3000] }),
        service({ id: 'b', kind: 'node', devCommand: 'node b.js --port 3000', ports: [3000], readiness: { kind: 'http', path: '/health' } }),
      ],
    }));
    const moved = byId(spec, 'b') as ServiceSpec;
    expect(moved).toMatchObject({ port: 3001, args: ['b.js', '--port', '3001'], readiness: { kind: 'http', path: '/health' } });

    const probed: number[] = [];
    let listening: ((server: { port: number; url: string }) => void) | undefined;
    const host: NodeServiceHost = {
      run: () => ({ wait: () => new Promise<number>(() => undefined), kill: () => undefined, combinedOutput: new ReadableStream() }) as never,
      onServerListening: (listener) => { listening = listener as typeof listening; return () => undefined; },
      onPortChange: () => () => undefined,
      request: async (port) => { probed.push(port); return { status: 200 }; },
    };
    const starting = createNodeProvider(host, { probeIntervalMs: 1 })
      .start(moved, { security: {}, env: {}, signal: new AbortController().signal } as never);
    listening?.({ port: 3001, url: 'http://localhost:3001' });
    await (await starting).ready();
    expect(probed).toEqual([3001]);
  });
});
