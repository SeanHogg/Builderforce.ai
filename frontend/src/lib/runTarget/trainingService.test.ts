import { describe, expect, it } from 'vitest';
import { VirtualFileSystem } from '@seanhogg/builderforce-webcontainers';
import { validateSpec } from '@seanhogg/builderforce-webcontainers/app';
import { blueprint, service } from './blueprintFixtures';
import { blueprintToApplicationSpec } from './blueprintToApplicationSpec';
import { acceptBlueprintInBrowser } from './browserAcceptance';

/** A Vite page, a FastAPI service and a Python training script (`python train.py`, PRD 31 §W9 phase 7). */
const TRAINING_APP = blueprint({
  services: [
    service({ id: 'web', kind: 'vite-react', rootDir: 'web', ports: [5173], isPrimary: true }),
    service({ id: 'api', kind: 'python', rootDir: 'api', packageManager: 'pip', installCommand: 'pip install -r requirements.txt', devCommand: 'uvicorn main:app --port 8000', ports: [8000] }),
    // A port declared by mistake is dropped: a training service serves nothing.
    service({ id: 'train', kind: 'training', rootDir: 'ml', packageManager: 'pip', installCommand: 'pip install -r requirements.txt', devCommand: 'python train.py', ports: [8000] }),
  ],
});

const byId = (id: string) => blueprintToApplicationSpec(TRAINING_APP).services.find((s) => s.id === id)!;

describe('blueprintToApplicationSpec — a training service', () => {
  it('maps to a runtime training service on python, with no port and the runtime defaults', () => {
    const train = byId('train');
    expect(train).toMatchObject({ type: 'training', runtime: 'python', root: '/ml', command: 'python', args: ['train.py'] });
    expect(train.port).toBeUndefined();
    expect(train.readiness).toBeUndefined(); // the runtime's `started`
    expect(train.restartPolicy).toBeUndefined(); // the runtime's `never`
    expect(train.role).toBeUndefined();
  });

  it('starts after its own root’s pip install', () => {
    expect(byId('train').dependsOn).toEqual(['train-install']);
    expect(byId('train-install')).toMatchObject({ runtime: 'python', root: '/ml', command: 'pip' });
  });

  it('is nobody’s backend: the frontend waits for the API only, and the API keeps its port', () => {
    expect(byId('web').dependsOn).toEqual(['web-install', 'api']);
    expect(byId('api').port).toBe(8000);
  });

  it('does not wait on the database (the API does)', () => {
    const app = { ...TRAINING_APP, database: { engine: 'postgres' as const, migrationCommand: 'python -m alembic upgrade head', seedCommand: null, migrationsPath: 'api/migrations', connectionSecretName: 'DATABASE_URL' } };
    const spec = blueprintToApplicationSpec(app);
    expect(spec.services.find((s) => s.id === 'train')!.dependsOn).toEqual(['train-install']);
    expect(spec.services.find((s) => s.id === 'api')!.dependsOn).toEqual(expect.arrayContaining(['db', 'db-migrate']));
  });

  it('honours a declared restart policy', () => {
    const app = blueprint({ services: [service({ id: 'train', kind: 'training', installCommand: '', devCommand: 'python train.py', ports: [], restartPolicy: 'on-failure' })] });
    expect(blueprintToApplicationSpec(app).services[0]).toMatchObject({ type: 'training', restartPolicy: 'on-failure' });
  });

  it('is a valid application spec', () => {
    expect(validateSpec(blueprintToApplicationSpec(TRAINING_APP))).toEqual([]);
  });
});

describe('acceptBlueprintInBrowser — a training service', () => {
  it('accepts it, with and without the project files', () => {
    expect(acceptBlueprintInBrowser(TRAINING_APP).ok).toBe(true);
    const files = new VirtualFileSystem();
    files.writeTree({ 'ml/train.py': 'import torch\n', 'ml/requirements.txt': 'numpy\n', 'api/main.py': '', 'api/requirements.txt': 'fastapi\n', 'web/index.html': '' });
    expect(acceptBlueprintInBrowser(TRAINING_APP, files).ok).toBe(true);
  });

  it('accepts requirements naming torch and peft: the torch extension provides them', () => {
    const files = new VirtualFileSystem();
    files.writeTree({ 'ml/train.py': '', 'ml/requirements.txt': 'torch==2.4.0\npeft\n', 'api/main.py': '', 'api/requirements.txt': 'fastapi\n', 'web/index.html': '' });
    expect(acceptBlueprintInBrowser(TRAINING_APP, files)).toMatchObject({ ok: true });
  });

  it('declines a training service that is not a Python entry point, by the runtime’s own reason', () => {
    const app = blueprint({ services: [service({ id: 'train', kind: 'training', installCommand: '', devCommand: 'uvicorn main:app', ports: [] })] });
    const verdict = acceptBlueprintInBrowser(app);
    expect(verdict).toMatchObject({ ok: false, code: 'serviceDeclined' });
    expect(verdict.ok ? '' : verdict.detail).toContain('Training service "train"');
  });
});
