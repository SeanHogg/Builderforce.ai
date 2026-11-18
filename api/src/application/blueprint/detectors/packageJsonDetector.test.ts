import { describe, expect, it } from 'vitest';
import { detectDevPorts, detectFromPackageJson } from './packageJsonDetector';

const pkg = (body: Record<string, unknown>) => JSON.stringify(body);

describe('package.json detector — dev ports', () => {
  it('writes the framework’s real dev port, not a list of common ports', () => {
    const vite = detectFromPackageJson(pkg({ name: 'web', scripts: { dev: 'vite' }, dependencies: { react: '18' } }));
    expect(vite.services?.[0]?.ports).toEqual([5173]);
    const next = detectFromPackageJson(pkg({ name: 'site', scripts: { dev: 'next dev' }, dependencies: { next: '15', react: '19' } }));
    expect(next.services?.[0]?.ports).toEqual([3000]);
    const astro = detectFromPackageJson(pkg({ name: 'docs', scripts: { dev: 'astro dev' }, dependencies: { astro: '4' } }));
    expect(astro.services?.[0]?.ports).toEqual([4321]);
    const node = detectFromPackageJson(pkg({ name: 'api', scripts: { dev: 'node server.js' }, dependencies: { express: '4' } }));
    expect(node.services?.[0]?.ports).toEqual([3000]);
  });

  it('honours an explicit --port / -p in the dev script', () => {
    expect(detectDevPorts('vite --port 4000', 'vite-react', {})).toEqual([4000]);
    expect(detectDevPorts('next dev -p 3100', 'nextjs', {})).toEqual([3100]);
    expect(detectDevPorts('vite --port=4001', 'vite-react', {})).toEqual([4001]);
  });

  it('tells classic Remix (3000) from Vite Remix (5173)', () => {
    expect(detectDevPorts('remix dev', 'remix', { '@remix-run/dev': '2' })).toEqual([3000]);
    expect(detectDevPorts('remix vite:dev', 'remix', { '@remix-run/dev': '2', vite: '5' })).toEqual([5173]);
  });

  it('declares no port for a kind without a dev server of its own', () => {
    expect(detectDevPorts('', 'container', {})).toEqual([]);
  });
});
