/**
 * The Python, PHP, .NET and Rust detectors: each row is a repo (path → content) and the service /
 * database detection must write for it — the commands are the ones the browser
 * runtime serves (`uvicorn`, `flask --app … run`, `gunicorn …wsgi`, `php -S`).
 */

import { describe, expect, it } from 'vitest';
import type { AppDatabase, AppService } from '@builderforce/creation-canvas-contract';
import { detectPython, pythonDetector } from './pythonDetector';
import { detectPhp, phpDetector } from './phpDetector';
import { detectDotnet, dotnetDetector } from './dotnetDetector';
import { detectRust, rustDetector } from './rustDetector';
import { runDetectors } from './index';

const repo = (files: Record<string, string>) => new Map(Object.entries(files));

interface Row {
  name: string;
  files: Record<string, string>;
  service: Partial<AppService>;
  database?: Partial<AppDatabase> | null;
}

describe('Python detector', () => {
  const rows: Row[] = [
    {
      name: 'FastAPI in main.py (requirements.txt)',
      files: { 'requirements.txt': 'fastapi>=0.110\nuvicorn[standard]  # server\n', 'main.py': 'from fastapi import FastAPI\napp = FastAPI()\n' },
      service: {
        id: 'python', kind: 'python', rootDir: '.', packageManager: 'pip', installCommand: 'pip install -r requirements.txt',
        devCommand: 'uvicorn main:app --host 0.0.0.0 --port 8000', ports: [8000], isPrimary: true,
      },
      database: null,
    },
    {
      name: 'FastAPI in app/main.py under another name (pyproject, PEP 621)',
      files: {
        'pyproject.toml': '[project]\nname = "shop"\ndependencies = [\n  "fastapi[all]>=0.110", # web\n  "uvicorn",\n]\n',
        'app/main.py': 'import fastapi\napi: fastapi.FastAPI = fastapi.FastAPI(title="Shop")\n',
      },
      service: { id: 'shop', installCommand: 'pip install .', devCommand: 'uvicorn app.main:api --host 0.0.0.0 --port 8000' },
      database: null,
    },
    {
      name: 'Starlette with no entry file it can read (module defaults to main:app)',
      files: { 'requirements.txt': 'starlette\n' },
      service: { devCommand: 'uvicorn main:app --host 0.0.0.0 --port 8000' },
    },
    {
      name: 'Flask in app.py',
      files: { 'requirements.txt': 'Flask==3.0\n', 'app.py': 'from flask import Flask\napp = Flask(__name__)\n' },
      service: { devCommand: 'flask --app app:app run --host 0.0.0.0 --port 8000', ports: [8000] },
      database: null,
    },
    {
      name: 'Flask from a Pipfile (installed by name)',
      files: { Pipfile: '[packages]\nflask = "*"\n"flask-cors" = "*"\n\n[dev-packages]\npytest = "*"\n', 'app.py': 'app = Flask(__name__)\n' },
      service: { installCommand: 'pip install flask flask-cors', devCommand: 'flask --app app:app run --host 0.0.0.0 --port 8000' },
    },
    {
      name: 'Django on Postgres (psycopg2), served as WSGI on gunicorn',
      files: {
        'requirements.txt': 'Django>=5\npsycopg2-binary\n',
        'manage.py': "os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'mysite.settings')\n",
      },
      service: { devCommand: 'gunicorn mysite.wsgi:application --bind 0.0.0.0:8000' },
      database: { engine: 'postgres', migrationCommand: 'python manage.py migrate', connectionSecretName: 'DATABASE_URL' },
    },
    {
      name: 'Poetry + SQLAlchemy pointed at Postgres by .env.example, migrated by Alembic',
      files: {
        'pyproject.toml': '[tool.poetry]\nname = "ledger"\n\n[tool.poetry.dependencies]\npython = "^3.12"\nfastapi = "^0.110"\nSQLAlchemy = "^2"\nalembic = "*"\n',
        'main.py': 'app = FastAPI()\n',
        'alembic.ini': '[alembic]\nscript_location = migrations\n',
        '.env.example': 'DATABASE_URL=postgresql+pg8000://app@localhost:5432/app\n',
      },
      service: { id: 'ledger', installCommand: 'pip install .', devCommand: 'uvicorn main:app --host 0.0.0.0 --port 8000' },
      database: { engine: 'postgres', migrationCommand: 'python -m alembic upgrade head', migrationsPath: 'migrations' },
    },
    {
      name: 'SQLAlchemy on SQLite is not Postgres',
      files: { 'requirements.txt': 'fastapi\nsqlalchemy\n', 'main.py': 'engine = create_engine("sqlite:///app.db")\napp = FastAPI()\n' },
      service: { kind: 'python' },
      database: null,
    },
    {
      name: 'pg8000 is a Postgres driver; no migration tool → no migration step',
      files: { 'requirements.txt': 'flask\npg8000\n', 'app.py': 'app = Flask(__name__)\n' },
      service: { kind: 'python' },
      database: { engine: 'postgres', migrationCommand: '' },
    },
    {
      name: 'a plain script runs as itself',
      files: { 'requirements.txt': 'requests\n', 'main.py': 'print("hi")\n' },
      service: { devCommand: 'python main.py', installCommand: 'pip install -r requirements.txt' },
    },
  ];

  it.each(rows)('$name', ({ files, service, database }) => {
    const result = detectPython(repo(files));
    expect(result.services).toHaveLength(1);
    expect(result.services?.[0]).toMatchObject(service);
    if (database === null) expect(result.database).toBeUndefined();
    else if (database) expect(result.database).toMatchObject(database);
  });

  it('a manifest with nothing to serve (tooling) is not a service', () => {
    expect(detectPython(repo({ 'requirements.txt': 'mkdocs\n' }))).toEqual({});
    expect(detectPython(repo({ 'package.json': '{}' }))).toEqual({});
  });

  it('reads its manifests at the root and in the backend folders', () => {
    expect(pythonDetector.reads).toEqual(expect.arrayContaining(['requirements.txt', 'api/requirements.txt', 'backend/pyproject.toml', 'server/manage.py']));
  });
});

describe('PHP detector', () => {
  const rows: Row[] = [
    {
      name: 'Slim front controller in public/',
      files: { 'composer.json': '{"name":"acme/api","require":{"php":">=8.1","slim/slim":"^4.0"}}', 'public/index.php': '<?php' },
      service: {
        id: 'api', kind: 'php', rootDir: '.', packageManager: 'composer', installCommand: 'composer install',
        devCommand: 'php -S 0.0.0.0:8000 -t public', ports: [8000], isPrimary: true,
      },
      database: null,
    },
    {
      name: 'Laravel on Postgres (.env.example), migrated by artisan',
      files: {
        'composer.json': '{"require":{"laravel/framework":"^11.0"}}',
        artisan: '#!/usr/bin/env php\n<?php',
        '.env.example': 'APP_NAME=Laravel\nDB_CONNECTION=pgsql\n',
      },
      service: { id: 'php', devCommand: 'php -S 0.0.0.0:8000 -t public' },
      database: { engine: 'postgres', migrationCommand: 'php artisan migrate --force', migrationsPath: 'database/migrations' },
    },
    {
      name: 'Laravel defaulting to Postgres in config/database.php',
      files: {
        'composer.json': '{"require":{"laravel/framework":"^11.0"}}',
        artisan: '<?php',
        'config/database.php': "<?php return ['default' => env('DB_CONNECTION', 'pgsql'), 'connections' => ['pgsql' => []]];",
      },
      service: { kind: 'php' },
      database: { migrationCommand: 'php artisan migrate --force' },
    },
    {
      name: 'Laravel on MySQL (its pgsql connection block is boilerplate)',
      files: {
        'composer.json': '{"require":{"laravel/framework":"^11.0"}}',
        artisan: '<?php',
        'config/database.php': "<?php return ['default' => env('DB_CONNECTION', 'mysql'), 'connections' => ['pgsql' => []]];",
      },
      service: { kind: 'php' },
      database: null,
    },
    {
      name: 'plain PHP requiring the Postgres PDO extension',
      files: { 'composer.json': '{"require":{"ext-pdo_pgsql":"*"}}', 'index.php': '<?php' },
      service: { devCommand: 'php -S 0.0.0.0:8000' },
      database: { engine: 'postgres', migrationCommand: '' },
    },
    {
      name: 'Doctrine Migrations against a Postgres DATABASE_URL',
      files: {
        'composer.json': '{"require":{"slim/slim":"^4","doctrine/dbal":"^4","doctrine/migrations":"^3"}}',
        'public/index.php': '<?php',
        '.env.example': 'DATABASE_URL="postgresql://app@localhost:5432/app"\n',
      },
      service: { devCommand: 'php -S 0.0.0.0:8000 -t public' },
      database: { migrationCommand: 'php vendor/bin/doctrine-migrations migrate --no-interaction' },
    },
  ];

  it.each(rows)('$name', ({ files, service, database }) => {
    const result = detectPhp(repo(files));
    expect(result.services).toHaveLength(1);
    expect(result.services?.[0]).toMatchObject(service);
    if (database === null) expect(result.database).toBeUndefined();
    else if (database) expect(result.database).toMatchObject(database);
  });

  it('an unreadable composer.json is not a service', () => {
    expect(detectPhp(repo({ 'composer.json': '{ not json' }))).toEqual({});
  });

  it('reads composer.json at the root and in the backend folders', () => {
    expect(phpDetector.reads).toEqual(expect.arrayContaining(['composer.json', 'api/composer.json', 'backend/artisan']));
  });
});

const WEB_CSPROJ = '<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>';
const LIB_CSPROJ = '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>';

describe('.NET detector', () => {
  it('a web csproj at the root runs with `dotnet run` on the kind port', () => {
    const result = detectDotnet(repo({ 'Shop.csproj': WEB_CSPROJ, 'Program.cs': 'var app = WebApplication.Create();' }));
    expect(result.services).toEqual([expect.objectContaining({
      id: 'Shop', kind: 'dotnet', rootDir: '.', packageManager: 'dotnet', installCommand: 'dotnet restore',
      devCommand: 'dotnet run --urls http://0.0.0.0:8080', ports: [8080], isPrimary: true,
    })]);
    expect(result.database).toBeUndefined();
  });

  it('a class library is not a service', () => {
    expect(detectDotnet(repo({ 'Core.csproj': LIB_CSPROJ }))).toEqual({});
  });

  it('a .sln with several projects runs its web project by path; Npgsql yields Postgres', () => {
    const sln = [
      'Microsoft Visual Studio Solution File, Format Version 12.00',
      'Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Core", "src\\Core\\Core.csproj", "{1}"',
      'EndProject',
      'Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Api", "src\\Api\\Api.csproj", "{2}"',
      'EndProject',
      'Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Api.Tests", "tests\\Api.Tests\\Api.Tests.csproj", "{3}"',
      'EndProject',
    ].join('\n');
    const result = detectDotnet(repo({
      'Shop.sln': sln,
      'src/Core/Core.csproj': LIB_CSPROJ,
      'src/Api/Api.csproj': WEB_CSPROJ.replace('</Project>', '<ItemGroup><PackageReference Include="Npgsql.EntityFrameworkCore.PostgreSQL" Version="8.0.0" /></ItemGroup></Project>'),
      'tests/Api.Tests/Api.Tests.csproj': LIB_CSPROJ,
    }));
    expect(result.services).toEqual([expect.objectContaining({
      id: 'Api', rootDir: '.', installCommand: 'dotnet restore src/Api/Api.csproj',
      devCommand: 'dotnet run --project src/Api/Api.csproj --urls http://0.0.0.0:8080',
    })]);
    expect(result.database).toMatchObject({ engine: 'postgres', migrationCommand: '' });
  });

  it('reads project and solution files at the root and in the backend folders, with globs', () => {
    expect(dotnetDetector.reads).toEqual(expect.arrayContaining(['*.csproj', '*.sln', 'api/*.csproj', 'backend/*/*.csproj']));
  });
});

describe('Rust detector', () => {
  it('a bfwc-wasi reactor runs as its prebuilt wasm32-wasip1 module', () => {
    const result = detectRust(repo({
      'Cargo.toml': '[package]\nname = "todo-service"\n\n[lib]\ncrate-type = ["cdylib"]\n\n[dependencies]\nbfwc-wasi = { path = "../bfwc-wasi" }\naxum = "0.8"\ntokio-postgres = { version = "0.7", default-features = false }\n',
    }));
    expect(result.services).toEqual([expect.objectContaining({
      id: 'todo-service', kind: 'rust', rootDir: '.', packageManager: 'cargo', installCommand: '',
      devCommand: './target/wasm32-wasip1/release/todo_service.wasm', startCommand: './target/wasm32-wasip1/release/todo_service.wasm',
      buildCommand: 'cargo build --release --target wasm32-wasip1', ports: [8080],
    })]);
    expect(result.database).toMatchObject({ engine: 'postgres', migrationCommand: '' });
  });

  it('a Cargo.toml in a subroot, member of the root workspace, builds into the workspace target', () => {
    const result = detectRust(repo({
      'Cargo.toml': '[workspace]\nmembers = ["api"]\n',
      'api/Cargo.toml': '[package]\nname = "shop-api"\n\n[[bin]]\nname = "shop"\n\n[dependencies.axum]\nversion = "0.8"\n',
    }));
    expect(result.services).toEqual([expect.objectContaining({ id: 'api', rootDir: 'api', devCommand: '../target/wasm32-wasip1/release/shop.wasm' })]);
  });

  it('a crate that serves nothing is not a service', () => {
    expect(detectRust(repo({ 'Cargo.toml': '[package]\nname = "tool"\n\n[dependencies]\nserde = "1"\n' }))).toEqual({});
  });

  it('reads Cargo.toml at the root and in the backend folders', () => {
    expect(rustDetector.reads).toEqual(expect.arrayContaining(['Cargo.toml', 'api/Cargo.toml', 'server/Cargo.toml']));
  });
});

describe('mixed roots: .NET and Rust beside other services', () => {
  it('Vite (root) + ASP.NET (api/) + Rust (backend/): one service each, the Node one primary', () => {
    const result = runDetectors(repo({
      'package.json': JSON.stringify({ name: 'web', scripts: { dev: 'vite' }, dependencies: { react: '18' } }),
      'api/Api.csproj': WEB_CSPROJ,
      'backend/Cargo.toml': '[package]\nname = "jobs"\n[lib]\ncrate-type = ["cdylib"]\n[dependencies]\nbfwc-wasi = "*"\n',
    }));
    expect(result.services?.map((s) => [s.id, s.kind, s.rootDir, s.isPrimary])).toEqual([
      ['web', 'vite-react', '.', true], ['api', 'dotnet', 'api', false], ['backend', 'rust', 'backend', false],
    ]);
    expect(result.services?.find((s) => s.id === 'api')?.devCommand).toBe('dotnet run --urls http://0.0.0.0:8080');
  });

  it('a repo-root solution listing api/Api.csproj leaves it to the api root (one service, not two)', () => {
    const result = detectDotnet(repo({
      'App.sln': 'Project("{X}") = "Api", "api\\Api.csproj", "{1}"\nEndProject\n',
      'api/Api.csproj': WEB_CSPROJ,
    }));
    expect(result.services?.map((s) => [s.id, s.rootDir])).toEqual([['api', 'api']]);
  });
});

describe('a frontend + backend repo yields both services', () => {
  const rows: Array<{ name: string; files: Record<string, string>; backend: Partial<AppService> & { id: string }; database: Partial<AppDatabase> | null }> = [
    {
      name: 'Vite (root) + FastAPI (api/)',
      files: {
        'package.json': JSON.stringify({ name: 'web', scripts: { dev: 'vite' }, dependencies: { react: '18' } }),
        'api/requirements.txt': 'fastapi\npg8000\n',
        'api/main.py': 'app = FastAPI()\n',
      },
      backend: { id: 'api', kind: 'python', rootDir: 'api', isPrimary: false, devCommand: 'uvicorn main:app --host 0.0.0.0 --port 8000' },
      database: { engine: 'postgres' },
    },
    {
      name: 'Vite (root) + Slim (backend/)',
      files: {
        'package.json': JSON.stringify({ name: 'web', scripts: { dev: 'vite' }, dependencies: { react: '18' } }),
        'backend/composer.json': '{"require":{"slim/slim":"^4"}}',
        'backend/public/index.php': '<?php',
      },
      backend: { id: 'backend', kind: 'php', rootDir: 'backend', isPrimary: false, installCommand: 'composer install' },
      database: null,
    },
  ];

  it.each(rows)('$name', ({ files, backend, database }) => {
    const result = runDetectors(repo(files));
    expect(result.services?.map((s) => s.id)).toEqual(['web', backend.id]);
    expect(result.services?.find((s) => s.id === 'web')).toMatchObject({ kind: 'vite-react', rootDir: '.', isPrimary: true });
    expect(result.services?.find((s) => s.id === backend.id)).toMatchObject(backend);
    if (database === null) expect(result.database).toBeUndefined();
    else expect(result.database).toMatchObject(database);
  });

  it('a backend in a folder names its migrations repo-relative', () => {
    const result = runDetectors(repo({
      'package.json': JSON.stringify({ name: 'web', scripts: { dev: 'vite' }, dependencies: { react: '18' } }),
      'api/requirements.txt': 'fastapi\nsqlalchemy\nalembic\npg8000\n',
      'api/main.py': 'app = FastAPI()\n',
      'api/alembic.ini': '[alembic]\nscript_location = ./migrations\n',
    }));
    expect(result.database).toMatchObject({ migrationCommand: 'python -m alembic upgrade head', migrationsPath: 'api/migrations' });
  });

  // Laravel ships a root package.json (for Vite) beside composer.json; a Flask app may too.
  const sameRootRows: Array<{ name: string; files: Record<string, string>; backend: Partial<AppService> & { id: string } }> = [
    {
      name: 'Laravel at the root (package.json + composer.json + artisan)',
      files: {
        'package.json': JSON.stringify({ private: true, type: 'module', scripts: { dev: 'vite', build: 'vite build' }, devDependencies: { 'laravel-vite-plugin': '^1', vite: '^5' } }),
        'composer.json': '{"require":{"laravel/framework":"^11.0"}}',
        artisan: '#!/usr/bin/env php\n<?php',
        '.env.example': 'DB_CONNECTION=pgsql\n',
      },
      backend: { id: 'php', kind: 'php', rootDir: '.', installCommand: 'composer install', devCommand: 'php -S 0.0.0.0:8000 -t public', isPrimary: false },
    },
    {
      name: 'Flask at the root beside a package.json',
      files: {
        'package.json': JSON.stringify({ name: 'web', scripts: { dev: 'vite' }, dependencies: { react: '18' } }),
        'requirements.txt': 'flask\n',
        'app.py': 'app = Flask(__name__)\n',
      },
      backend: { id: 'python', kind: 'python', rootDir: '.', installCommand: 'pip install -r requirements.txt', isPrimary: false },
    },
  ];

  it.each(sameRootRows)('$name: both services, one primary (the Node one)', ({ files, backend }) => {
    const result = runDetectors(repo(files));
    expect(result.services).toHaveLength(2);
    expect(result.services?.find((s) => s.id === backend.id)).toMatchObject(backend);
    const node = result.services?.find((s) => s.id !== backend.id);
    expect(node).toMatchObject({ rootDir: '.', installCommand: 'npm install', isPrimary: true });
    expect(result.services?.filter((s) => s.isPrimary)).toHaveLength(1);
  });

  it('a Laravel root names its migrations at the root', () => {
    const result = runDetectors(repo(sameRootRows[0]!.files));
    expect(result.database).toMatchObject({ migrationCommand: 'php artisan migrate --force', migrationsPath: 'database/migrations' });
  });

  it('a Node ORM config still owns the database when the repo has both', () => {
    const result = runDetectors(repo({
      'package.json': JSON.stringify({ name: 'web', dependencies: { next: '15' } }),
      'drizzle.config.ts': 'export default { out: "./drizzle" }',
      'api/requirements.txt': 'fastapi\npsycopg\n',
      'api/main.py': 'app = FastAPI()\n',
    }));
    expect(result.database).toMatchObject({ migrationCommand: 'npx drizzle-kit push' });
    expect(result.services?.map((s) => s.kind)).toEqual(['nextjs', 'python']);
  });
});
