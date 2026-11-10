import { describe, expect, it } from 'vitest';
import { descriptorKindOf } from './deployModel.js';
import { parseDescriptor } from './parseDescriptor.js';

const unitsOf = (path: string, text: string) => parseDescriptor(path, text)?.units ?? [];

describe('descriptorKindOf', () => {
    it('recognises each family by path, and never a source file', () => {
        expect(descriptorKindOf('Dockerfile')).toBe('dockerfile');
        expect(descriptorKindOf('api/Dockerfile.prod')).toBe('dockerfile');
        expect(descriptorKindOf('docker-compose.yml')).toBe('compose');
        expect(descriptorKindOf('compose.dev.yaml')).toBe('compose');
        expect(descriptorKindOf('api/wrangler.toml')).toBe('wrangler');
        expect(descriptorKindOf('wrangler.jsonc')).toBe('wrangler');
        expect(descriptorKindOf('k8s/web.yaml')).toBe('kubernetes');
        expect(descriptorKindOf('Procfile')).toBe('procfile');
        expect(descriptorKindOf('fly.toml')).toBe('fly');
        expect(descriptorKindOf('vercel.json')).toBe('vercel');
        expect(descriptorKindOf('serverless.yml')).toBe('serverless');
        expect(descriptorKindOf('packages/x/package.json')).toBe('package');
        expect(descriptorKindOf('.github/workflows/ci.yml')).toBe('workflow');
        for (const p of ['src/deploy/dockerfile.ts', 'docs/Procfile.md', 'config.yml', 'pnpm-lock.yaml', 'tsconfig.json']) expect(descriptorKindOf(p), p).toBeUndefined();
    });
});

describe('Dockerfile', () => {
    it('reads the final stage image, ports, env names and the context folders it copies (hired.video shape)', () => {
        const text = [
            '# Build stage', 'FROM node:22-alpine AS builder', 'WORKDIR /app', 'COPY frontend/package*.json ./frontend/',
            'RUN cd frontend && npm ci', 'COPY frontend ./frontend', 'COPY shared ./shared', 'ARG API_URL', '',
            'FROM node:22-alpine', 'ENV NODE_ENV=production PORT=3000', 'COPY --from=builder /app/frontend/dist ./dist',
            'EXPOSE 3000', 'HEALTHCHECK --interval=30s \\', '  CMD node -e "1"', 'CMD ["serve", "-s", "dist", "-l", "3000"]',
        ].join('\n');
        expect(unitsOf('Dockerfile', text)).toEqual([{
            key: 'app', name: 'app', kind: 'container', runtime: 'node:22-alpine', ports: [3000], env: ['NODE_ENV', 'PORT'],
            bindings: [], cron: [], sources: ['frontend', 'shared'], dependsOn: [],
        }]);
    });

    it('follows a stage alias to its image and names the unit after its folder', () => {
        const [u] = unitsOf('services/api/Dockerfile', 'FROM python:3.12-slim AS base\nFROM base\nCOPY . .\nEXPOSE 8000/tcp\n');
        expect(u).toMatchObject({ name: 'api', runtime: 'python:3.12-slim', ports: [8000], sources: ['services/api'] });
    });
});

describe('Compose', () => {
    it('gives one container unit per service, with depends_on, ports, env names and named volumes', () => {
        const text = `services:
  web:
    build:
      context: ./web
    ports:
      - "8080:3000"
    environment:
      - DATABASE_URL=postgres://u:secret@db/app
      - REDIS_URL
    depends_on:
      db:
        condition: service_healthy
      cache:
        condition: service_started
  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: hunter2
    volumes:
      - pgdata:/var/lib/postgresql/data
  cache:
    image: redis:7
volumes:
  pgdata: {}
`;
        const units = unitsOf('docker-compose.yml', text);
        expect(units.map((u) => u.name)).toEqual(['web', 'db', 'cache']);
        expect(units[0]).toMatchObject({ runtime: 'docker build', sources: ['web'], ports: [3000], env: ['DATABASE_URL', 'REDIS_URL'], dependsOn: ['db', 'cache'] });
        expect(units[1]).toMatchObject({ runtime: 'postgres:16', env: ['POSTGRES_PASSWORD'], bindings: [{ kind: 'volume', name: 'pgdata' }] });
        expect(JSON.stringify(units)).not.toMatch(/hunter2|secret@/);
    });
});

describe('wrangler', () => {
    const TOML = `name = "hired-api"
main = "src/worker.ts"
compatibility_flags = ["nodejs_compat", "enable_request_signal"]
routes = [
  "api.hired.video/*",
  "cdn.hired.video/*",
]
[triggers]
crons = ["*/5 * * * *", "*/15 * * * *", "2 * * * *"]
[[r2_buckets]]
binding = "VIDEO_BUCKET"
bucket_name = "hired-videos-temp"
[[kv_namespaces]]
binding = "KV_CACHE"
id = "4ad142d51f6d4bdf97d8d969b5d7288f"
[ai]
binding = "AI"
[[durable_objects.bindings]]
name = "CHAT_ROOM"
class_name = "ChatRoom"
[[queues.producers]]
binding = "JOBS"
queue = "jobs-queue"
[[queues.consumers]]
queue = "jobs-queue"
[vars]
APP_ENV = "production"
[env.production]
name = "hired-api"
[[env.production.d1_databases]]
binding = "DB"
database_name = "hired"
database_id = "abc"
[env.production.vars]
FRONTEND_URL = "https://hired.video"
`;

    it('reads a Worker with every binding, its crons and var NAMES (ids never read)', () => {
        const [u] = unitsOf('api/wrangler.toml', TOML);
        expect(u).toMatchObject({ name: 'hired-api', kind: 'worker', runtime: 'cloudflare-workers', sources: ['api/src/worker.ts'] });
        expect(u!.cron).toEqual(['*/5 * * * *', '*/15 * * * *', '2 * * * *']);
        expect(u!.env).toEqual(['APP_ENV', 'FRONTEND_URL']);
        expect(u!.bindings).toEqual([
            { kind: 'kv', name: 'KV_CACHE' },
            { kind: 'r2', name: 'VIDEO_BUCKET', resource: 'hired-videos-temp' },
            { kind: 'ai', name: 'AI' },
            { kind: 'durable-object', name: 'CHAT_ROOM', resource: 'ChatRoom' },
            { kind: 'queue', name: 'JOBS', resource: 'jobs-queue', direction: 'produces' },
            { kind: 'queue', name: 'jobs-queue', resource: 'jobs-queue', direction: 'consumes' },
            { kind: 'd1', name: 'DB', resource: 'hired' },
        ]);
        expect(JSON.stringify(u)).not.toContain('4ad142d5');
    });

    it('reads a Pages project and wrangler.jsonc', () => {
        expect(unitsOf('frontend/wrangler.toml', 'name = "hired"\npages_build_output_dir = "dist"\n')[0])
            .toMatchObject({ name: 'hired', kind: 'service', runtime: 'cloudflare-pages', sources: ['frontend'] });
        const [j] = unitsOf('wrangler.jsonc', '{ // worker\n "name": "edge", "main": "./src/index.ts", "kv_namespaces": [{ "binding": "CACHE", "id": "x" },],\n}');
        expect(j).toMatchObject({ name: 'edge', sources: ['src/index.ts'], bindings: [{ kind: 'kv', name: 'CACHE' }] });
    });
});

describe('Kubernetes', () => {
    it('reads workloads and services across documents, linking a Service to the workload its selector picks', () => {
        const text = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: web
          image: ghcr.io/acme/web:1.4.0
          ports:
            - containerPort: 8080
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef: { name: db, key: url }
            - name: LOG_LEVEL
              value: info
---
apiVersion: v1
kind: Service
metadata:
  name: web
spec:
  selector:
    app: web
  ports:
    - port: 80
      targetPort: 8080
---
apiVersion: batch/v1
kind: CronJob
metadata:
  name: nightly
spec:
  schedule: "0 3 * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: job
              image: ghcr.io/acme/jobs:1
`;
        const units = unitsOf('k8s/web.yaml', text);
        expect(units.map((u) => [u.name, u.kind])).toEqual([['web', 'container'], ['web', 'service'], ['nightly', 'container']]);
        expect(units[0]).toMatchObject({ runtime: 'ghcr.io/acme/web:1.4.0', ports: [8080], env: ['DATABASE_URL', 'LOG_LEVEL'] });
        expect(units.map((u) => u.key)).toEqual(['default/Deployment/web', 'default/Service/web', 'default/CronJob/nightly']);
        expect(units[1]).toMatchObject({ ports: [80], dependsOn: ['default/Deployment/web'] });
        expect(units[2]).toMatchObject({ cron: ['0 3 * * *'], runtime: 'ghcr.io/acme/jobs:1' });
    });
});

describe('Procfile, fly.toml, vercel.json, serverless.yml', () => {
    it('Procfile: one service per process type', () => {
        const units = unitsOf('Procfile', 'web: node dist/server.js --port 5000\nworker: python worker.py\n# note\n');
        expect(units).toEqual([
            { key: 'web', name: 'web', kind: 'service', runtime: 'node', ports: [5000], env: [], bindings: [], cron: [], sources: ['dist/server.js'], dependsOn: [] },
            { key: 'worker', name: 'worker', kind: 'service', runtime: 'python', ports: [], env: [], bindings: [], cron: [], sources: ['worker.py'], dependsOn: [] },
        ]);
    });

    it('fly.toml: app, internal port, env names and mounts', () => {
        const text = 'app = "acme-api"\nprimary_region = "iad"\n[build]\n  dockerfile = "Dockerfile"\n[env]\n  PORT = "8080"\n[http_service]\n  internal_port = 8080\n[[mounts]]\n  source = "data"\n  destination = "/data"\n';
        expect(unitsOf('api/fly.toml', text)[0]).toMatchObject({
            name: 'acme-api', kind: 'service', runtime: 'docker build', ports: [8080], env: ['PORT'], sources: ['api'], bindings: [{ kind: 'volume', name: 'data' }],
        });
    });

    it('vercel.json: function sources, runtime and crons', () => {
        const text = '{ "functions": { "api/*.ts": { "runtime": "@vercel/node@3" } }, "crons": [{ "path": "/api/cron", "schedule": "0 5 * * *" }] }';
        expect(unitsOf('web/vercel.json', text)[0]).toMatchObject({ name: 'web', kind: 'function', runtime: '@vercel/node@3', sources: ['web/api'], cron: ['0 5 * * *'] });
    });

    it('serverless.yml: one function unit per handler, with schedules and SQS consumption', () => {
        const text = `service: billing
provider:
  name: aws
  runtime: nodejs20.x
  environment:
    STAGE: \${sls:stage}
functions:
  charge:
    handler: src/handlers/charge.main
    events:
      - httpApi: 'POST /charge'
  sweep:
    handler: src/handlers/sweep.run
    events:
      - schedule: rate(1 hour)
      - sqs:
          arn: arn:aws:sqs:us-east-1:123:invoices
`;
        const units = unitsOf('serverless.yml', text);
        expect(units.map((u) => u.name)).toEqual(['billing-charge', 'billing-sweep']);
        expect(units[0]).toMatchObject({ kind: 'function', runtime: 'nodejs20.x', sources: ['src/handlers/charge'], env: ['STAGE'] });
        expect(units[1]).toMatchObject({ cron: ['rate(1 hour)'], bindings: [{ kind: 'queue', name: 'invoices', direction: 'consumes' }] });
    });
});

describe('package.json', () => {
    it('reads bin commands, a start script and workspaces', () => {
        const pkg = JSON.stringify({
            name: '@acme/cli', main: 'dist/index.js', bin: { acme: './bin/acme.js' }, engines: { node: '>=20' },
            scripts: { start: 'node dist/server.js --port 4000' }, workspaces: ['packages/*'],
        });
        const parsed = parseDescriptor('tools/package.json', pkg)!;
        expect(parsed.workspaces).toEqual(['packages/*']);
        expect(parsed.units).toEqual([
            { key: 'bin:acme', name: 'acme', kind: 'cli', runtime: 'node >=20', ports: [], env: [], bindings: [], cron: [], sources: ['tools/bin/acme.js'], dependsOn: [] },
            { key: 'start', name: '@acme/cli', kind: 'service', runtime: 'node >=20', ports: [4000], env: [], bindings: [], cron: [], sources: ['tools/dist/server.js'], dependsOn: [] },
        ]);
    });

    it('a manifest with neither declares no unit', () => {
        expect(unitsOf('package.json', '{ "name": "lib", "scripts": { "test": "vitest" } }')).toEqual([]);
    });
});

describe('GitHub workflow', () => {
    it('keeps only deploy jobs, with their folders, env names and needs on other deploy jobs (hired.video shape)', () => {
        const text = `name: CI/CD Pipeline
on:
  push:
    branches: [main]
  schedule:
    - cron: '0 6 * * 1'
jobs:
  test-api:
    runs-on: ubuntu-latest
    steps:
      - run: cd api && npm test
  deploy-api:
    name: Deploy API to Cloudflare Workers
    runs-on: ubuntu-latest
    needs: [test-api]
    steps:
      - uses: actions/checkout@v5
      - name: Push secrets
        run: |
          printf '%s' "$2" | npx wrangler secret put "$1" --env production
      - name: Deploy to Cloudflare Workers
        run: cd api && npx wrangler deploy --env production
        env:
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
  deploy-production:
    name: Deploy to Cloudflare Pages
    runs-on: ubuntu-latest
    needs: [deploy-api, test-api]
    steps:
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: \${{ secrets.CLOUDFLARE_API_TOKEN }}
          command: pages deploy dist --project-name hired
          workingDirectory: frontend
`;
        const units = unitsOf('.github/workflows/ci.yml', text);
        expect(units).toEqual([
            { key: 'deploy-api', name: 'deploy-api', kind: 'workflow', runtime: 'ubuntu-latest', ports: [], env: ['CLOUDFLARE_API_TOKEN'], bindings: [], cron: ['0 6 * * 1'], sources: ['api'], dependsOn: [] },
            { key: 'deploy-production', name: 'deploy-production', kind: 'workflow', runtime: 'ubuntu-latest', ports: [], env: [], bindings: [], cron: ['0 6 * * 1'], sources: ['frontend'], dependsOn: ['deploy-api'] },
        ]);
    });
});
