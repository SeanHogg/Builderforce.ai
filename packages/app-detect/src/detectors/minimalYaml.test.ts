import { describe, expect, it } from 'vitest';
import { parseYaml, yamlScalar } from './minimalYaml';

describe('minimalYaml', () => {
  it('reads nested block mappings and sequences, scalars as strings', () => {
    const doc = parseYaml([
      'version: "3.9"   # a comment',
      'services:',
      '  web:',
      '    build: ./web',
      '    ports:',
      '      - "5173:5173"',
      '      - 8080:80',
      '    depends_on:',
      '      - api',
      '  db:',
      "    image: 'postgres:16'",
      '    environment:',
      '      POSTGRES_PASSWORD: secret',
      '      EMPTY:',
    ].join('\n'));
    expect(doc).toEqual({
      version: '3.9',
      services: {
        web: { build: './web', ports: ['5173:5173', '8080:80'], depends_on: ['api'] },
        db: { image: 'postgres:16', environment: { POSTGRES_PASSWORD: 'secret', EMPTY: null } },
      },
    });
  });

  it('reads a sequence at its key\'s own indent and mappings inside sequences', () => {
    const doc = parseYaml([
      'ports:',
      '- target: 80',
      '  published: 8080',
      '- "443"',
      'volumes:',
      '  -',
      '    type: volume',
    ].join('\n'));
    expect(doc).toEqual({
      ports: [{ target: '80', published: '8080' }, '443'],
      volumes: [{ type: 'volume' }],
    });
  });

  it('reads flow collections, quotes, comments inside quotes and block scalars', () => {
    const doc = parseYaml([
      'command: ["npm", "run", "dev"]',
      "healthcheck: { test: 'curl -f http://localhost', interval: 10s }",
      'label: "a # not a comment"',
      "it: it's plain",
      'script: |',
      '  echo one',
      '  # kept',
      '  echo two',
      'folded: >',
      '  one',
      '  two',
      'after: yes',
    ].join('\n'));
    expect(doc).toEqual({
      command: ['npm', 'run', 'dev'],
      healthcheck: { test: 'curl -f http://localhost', interval: '10s' },
      label: 'a # not a comment',
      it: "it's plain",
      script: 'echo one\n# kept\necho two\n',
      folded: 'one two\n',
      after: 'yes',
    });
  });

  it('keeps a value with a colon that does not end a key (image tags, URLs)', () => {
    expect(parseYaml('image: redis:7-alpine\nurl: http://x:1/y')).toEqual({ image: 'redis:7-alpine', url: 'http://x:1/y' });
  });

  it('reads null forms and document markers', () => {
    expect(parseYaml('---\na: ~\nb: null\n...\n')).toEqual({ a: null, b: null });
    expect(yamlScalar('')).toBeNull();
    expect(parseYaml('')).toBeNull();
  });
});
