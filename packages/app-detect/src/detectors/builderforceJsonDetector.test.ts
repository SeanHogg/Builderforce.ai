/**
 * PRD 31 §W11 Rev 2 item 12: an unusable `builderforce.json` is REPORTED (it used to be
 * dropped without a word), and a `"version": 1` file is the manifest, not a partial blueprint.
 */
import { describe, expect, it } from 'vitest';
import { detectApp } from '../detectApp';
import { builderforceJsonDetector } from './builderforceJsonDetector';

const files = (content: string) => new Map([['builderforce.json', content]]);

describe('builderforceJsonDetector — reporting', () => {
  it('names the JSON error of an unparseable file in a warning', () => {
    const result = builderforceJsonDetector.detect(files('{nope'));
    expect(result.overrides).toBeUndefined();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings![0]).toMatch(/^builderforce\.json is not valid JSON and was ignored: .+/);
  });

  it('warns on a non-object file and on an unsupported version', () => {
    expect(builderforceJsonDetector.detect(files('[1]')).warnings).toEqual(['builderforce.json is not a JSON object and was ignored']);
    expect(builderforceJsonDetector.detect(files('{"version":2}')).warnings).toEqual(['builderforce.json has unsupported version 2 and was ignored']);
  });

  it('carries the warning into the detection metadata', () => {
    const detection = detectApp(files('{"services": ['));
    expect(detection.metadata.warnings.some((w) => w.startsWith('builderforce.json is not valid JSON'))).toBe(true);
    expect(detection.blueprint.sources.builderforceJson).toBe(false);
  });

  it('says nothing when there is no file, and nothing for a valid legacy file', () => {
    expect(builderforceJsonDetector.detect(new Map()).warnings).toBeUndefined();
    expect(builderforceJsonDetector.detect(files('{"isMonorepo":true}')).warnings).toBeUndefined();
  });
});

describe('builderforceJsonDetector — manifest v1', () => {
  const V1 = JSON.stringify({
    $schema: 'https://builderforce.ai/schema/app.v1.json',
    version: 1,
    resources: { db: { type: 'postgres', persistent: true }, cache: { type: 'redis' } },
    services: {
      'api-install': { runtime: 'node', root: '/api', command: 'npm install', readiness: { exitZero: true }, restart: 'never' },
      api: { runtime: 'node', root: '/api', command: 'node server.js', port: 8000, uses: ['db', 'cache'], dependsOn: ['api-install'], env: { MODE: 'dev' } },
      web: { runtime: 'node', root: '/web', command: 'vite', port: 5173, role: 'frontend', dependsOn: ['api'] },
    },
    environments: { local: { target: 'browser', tier: 'non-production' } },
  });

  it('maps a v1 manifest to blueprint overrides, not a partial blueprint', () => {
    const result = builderforceJsonDetector.detect(files(V1));
    expect(result.sources?.builderforceJson).toBe(true);
    expect(result.overrides?.services?.map((s) => [s.id, s.kind, s.rootDir, s.devCommand, s.installCommand, s.ports])).toEqual([
      ['api', 'node', 'api', 'node server.js', 'npm install', [8000]],
      ['web', 'spa', 'web', 'vite', '', [5173]],
    ]);
    expect(result.overrides?.database?.engine).toBe('postgres');
    expect(result.overrides?.vars).toEqual([{ name: 'MODE', defaultValue: 'dev' }]);
    expect(result.overrides).not.toHaveProperty('version');
    expect(result.warnings).toEqual(['builderforce.json: resource "cache" (redis) has no blueprint field; the runtime reads it from the manifest']);
  });

  it('lays the v1 services over detection', () => {
    const detection = detectApp(new Map([
      ['builderforce.json', V1],
      ['package.json', JSON.stringify({ name: 'detected', scripts: { dev: 'next dev' }, dependencies: { next: '15' } })],
    ]));
    expect(detection.blueprint.services.map((s) => s.id)).toEqual(['api', 'web']);
    expect(detection.blueprint.services.find((s) => s.isPrimary)?.id).toBe('web');
  });
});
