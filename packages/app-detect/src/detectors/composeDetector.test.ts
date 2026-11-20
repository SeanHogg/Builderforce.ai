import { describe, expect, it } from 'vitest';
import { noteMessages } from '../notes';
import { composeDetector, imageName } from './composeDetector';
import { runDetectors } from './index';

const COMPOSE = [
  'services:',
  '  api:',
  '    build: ./api',
  '    ports: ["8000:8000"]',
  '    depends_on: [db, cache, web-helper]',
  '  web:',
  '    build:',
  '      context: ./web',
  '      dockerfile: Dockerfile',
  '    ports:',
  '      - "5173:5173"',
  '    depends_on:',
  '      api:',
  '        condition: service_healthy',
  '  web-helper:',
  '    build: ./tools/helper',
  '    command: node helper.js',
  '  db:',
  '    image: postgres:16-alpine',
  '  cache:',
  '    image: docker.io/library/redis:7',
  '  files:',
  '    image: minio/minio:latest',
  '  mail:',
  '    image: axllent/mailpit',
  '  search:',
  '    image: elasticsearch:8.13.0',
].join('\n');

function repo(files: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(files));
}

describe('composeDetector', () => {
  it('maps build contexts to services and known images to resources', () => {
    const result = composeDetector.detect(repo({
      'docker-compose.yml': COMPOSE,
      'api/requirements.txt': 'fastapi\n',
      'web/package.json': JSON.stringify({ name: 'web', scripts: { dev: 'vite' }, devDependencies: { vite: '5', react: '18' } }),
    }));
    expect(result.services?.map((s) => [s.id, s.kind, s.rootDir, s.ports])).toEqual([
      ['api', 'python', 'api', [8000]],
      ['web', 'vite-react', 'web', [5173]],
      ['tools-helper', 'node', 'tools/helper', [3000]],
    ]);
    expect(result.services?.find((s) => s.id === 'web')?.dependsOn).toEqual(['api']);
    expect(result.services?.find((s) => s.id === 'api')?.dependsOn).toEqual(['tools-helper']);
    expect(result.services?.find((s) => s.id === 'tools-helper')?.devCommand).toBe('node helper.js');
    expect(result.composeResources).toEqual([
      { id: 'db', type: 'postgres', image: 'postgres:16-alpine', usedBy: ['api'] },
      { id: 'cache', type: 'redis', image: 'docker.io/library/redis:7', usedBy: ['api'] },
      { id: 'files', type: 'object-storage', image: 'minio/minio:latest', usedBy: [] },
      { id: 'mail', type: 'mail', image: 'axllent/mailpit', usedBy: [] },
    ]);
  });

  it('names every resource and every unsupported image in its warnings', () => {
    const warnings = noteMessages(composeDetector.detect(repo({ 'compose.yaml': COMPOSE })).warnings ?? []);
    expect(warnings.filter((w) => w.includes('resource'))).toHaveLength(4);
    expect(warnings).toContain('compose.yaml service "search": image "elasticsearch:8.13.0" is not supported by the browser runtime');
  });

  it('adds no service for a root build context another detector reads, but keeps its resources', () => {
    const result = composeDetector.detect(repo({
      'compose.yml': 'services:\n  app:\n    build: .\n    depends_on: [redis]\n  redis:\n    image: valkey/valkey:8\n',
      'package.json': '{"name":"app"}',
    }));
    expect(result.services).toBeUndefined();
    expect(result.composeResources).toEqual([{ id: 'redis', type: 'redis', image: 'valkey/valkey:8', usedBy: ['app'] }]);
  });

  it('reads pgvector as postgres with the vector extension, and mailhog as mail', () => {
    expect(imageName('pgvector/pgvector:pg16')).toBe('pgvector');
    const result = composeDetector.detect(repo({
      'compose.yaml': 'services:\n  pg:\n    image: pgvector/pgvector:pg16\n  mh:\n    image: mailhog/mailhog\n',
    }));
    expect(result.composeResources?.map((r) => [r.id, r.type, r.extensions])).toEqual([
      ['pg', 'postgres', ['vector']],
      ['mh', 'mail', undefined],
    ]);
  });

  it('warns on a build context outside the repo and on an unreadable file', () => {
    expect(noteMessages(composeDetector.detect(repo({ 'compose.yaml': 'services:\n  x:\n    build: ../elsewhere\n' })).warnings ?? []))
      .toEqual(['compose.yaml service "x": its build context is outside the repository and was not read']);
    expect(noteMessages(composeDetector.detect(repo({ 'compose.yaml': 'just text' })).warnings ?? []))
      .toEqual(['compose.yaml: no services section could be read']);
  });

  it('follows each build context\'s manifests', () => {
    expect(composeDetector.followReads?.(repo({ 'docker-compose.yml': COMPOSE }))).toEqual(expect.arrayContaining([
      'api/package.json', 'api/requirements.txt', 'web/composer.json', 'tools/helper/Cargo.toml',
    ]));
  });

  it('lets a language detector refine the service it shares a root (and id) with', () => {
    const result = runDetectors(repo({
      'compose.yaml': 'services:\n  api:\n    build: ./api\n',
      'api/requirements.txt': 'fastapi\nuvicorn\n',
      'api/main.py': 'from fastapi import FastAPI\napp = FastAPI()\n',
    }));
    const api = result.services?.filter((s) => s.rootDir === 'api') ?? [];
    expect(api).toHaveLength(1);
    expect(api[0]!.devCommand).not.toBe('python main.py');
  });
});
