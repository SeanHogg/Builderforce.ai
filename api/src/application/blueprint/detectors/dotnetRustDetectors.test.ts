/**
 * The .NET and Rust detectors: the services detection writes for a repo (path → content),
 * with the commands the browser runtime takes (`dotnet run --urls …`, a prebuilt
 * wasm32-wasip1 module) — or, for a native Rust server, the one it declines.
 */

import { describe, expect, it } from 'vitest';
import { detectDotnet, dotnetDetector } from './dotnetDetector';
import { detectRust, rustDetector } from './rustDetector';
import { runDetectors } from './index';

const repo = (files: Record<string, string>) => new Map(Object.entries(files));

const WEB_CSPROJ = '<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>';
const LIB_CSPROJ = '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>';
const URLS = '--urls http://0.0.0.0:8080';
const slnEntry = (name: string, path: string) => `Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "${name}", "${path}", "{${name}}"\nEndProject`;

describe('.NET detector', () => {
  it('a web csproj at the root runs with `dotnet run` on the kind port', () => {
    const result = detectDotnet(repo({ 'Shop.csproj': WEB_CSPROJ, 'Program.cs': 'var app = WebApplication.Create();' }));
    expect(result.services).toEqual([expect.objectContaining({
      id: 'Shop', kind: 'dotnet', rootDir: '.', packageManager: 'dotnet', installCommand: 'dotnet restore',
      devCommand: `dotnet run ${URLS}`, ports: [8080], isPrimary: true,
    })]);
    expect(result.database).toBeUndefined();
  });

  it.each([
    ['a class library', LIB_CSPROJ],
    ['a Blazor WebAssembly app (runs in the browser, not a server)', '<Project Sdk="Microsoft.NET.Sdk.BlazorWebAssembly"></Project>'],
  ])('%s is not a service', (_name, csproj) => {
    expect(detectDotnet(repo({ 'App.csproj': csproj }))).toEqual({});
  });

  it.each([
    ['a versioned SDK', '<Project Sdk="Microsoft.NET.Sdk.Web/8.0.0"></Project>'],
    ['an <Sdk Name> element', '<Project><Sdk Name="Microsoft.NET.Sdk.Web" /></Project>'],
  ])('%s is a web project', (_name, csproj) => {
    expect(detectDotnet(repo({ 'Api.csproj': csproj })).services?.[0]).toMatchObject({ kind: 'dotnet', devCommand: `dotnet run ${URLS}` });
  });

  it('a .sln with several projects runs its web project by path; Npgsql yields Postgres', () => {
    const result = detectDotnet(repo({
      'Shop.sln': ['Microsoft Visual Studio Solution File, Format Version 12.00', slnEntry('Core', 'src\\Core\\Core.csproj'), slnEntry('Api', 'src\\Api\\Api.csproj'), slnEntry('Api.Tests', 'tests\\Api.Tests\\Api.Tests.csproj')].join('\n'),
      'src/Core/Core.csproj': LIB_CSPROJ,
      'src/Api/Api.csproj': WEB_CSPROJ.replace('</Project>', '<ItemGroup><PackageReference Include="Npgsql.EntityFrameworkCore.PostgreSQL" Version="8.0.0" /></ItemGroup></Project>'),
      'tests/Api.Tests/Api.Tests.csproj': LIB_CSPROJ,
    }));
    expect(result.services).toEqual([expect.objectContaining({
      id: 'Api', rootDir: '.', installCommand: 'dotnet restore src/Api/Api.csproj', devCommand: `dotnet run --project src/Api/Api.csproj ${URLS}`,
    })]);
    expect(result.database).toMatchObject({ engine: 'postgres', migrationCommand: '' });
  });

  it('a .slnx lists projects with Path in any attribute position', () => {
    const result = detectDotnet(repo({
      'Shop.slnx': '<Solution>\n  <Project Type="Classic C#" Path="src/Core/Core.csproj" />\n  <Project Id="2" Path="src/Web/Web.csproj" />\n</Solution>',
      'src/Core/Core.csproj': LIB_CSPROJ,
      'src/Web/Web.csproj': WEB_CSPROJ,
    }));
    expect(result.services?.[0]).toMatchObject({ id: 'Web', devCommand: `dotnet run --project src/Web/Web.csproj ${URLS}` });
  });

  it('single-quotes a project path with spaces, escaping an embedded quote', () => {
    const result = detectDotnet(repo({ 'Shop.sln': slnEntry('My Api', 'src\\My Api\\My Api.csproj'), 'src/My Api/My Api.csproj': WEB_CSPROJ }));
    expect(result.services?.[0]).toMatchObject({
      installCommand: "dotnet restore 'src/My Api/My Api.csproj'", devCommand: `dotnet run --project 'src/My Api/My Api.csproj' ${URLS}`,
    });
    const quoted = detectDotnet(repo({ 'Shop.sln': slnEntry('Bob', "src\\Bob's\\Api.csproj"), "src/Bob's/Api.csproj": WEB_CSPROJ }));
    expect(quoted.services?.[0]?.installCommand).toBe("dotnet restore 'src/Bob'\\''s/Api.csproj'");
  });

  it('a root solution keeps a project the backend folder does not offer (api/ holds only a library)', () => {
    const result = detectDotnet(repo({
      'App.sln': slnEntry('Web', 'api\\src\\Web\\Web.csproj'),
      'api/Lib.csproj': LIB_CSPROJ,
      'api/src/Web/Web.csproj': WEB_CSPROJ,
    }));
    expect(result.services?.map((s) => [s.id, s.rootDir, s.devCommand])).toEqual([['Web', '.', `dotnet run --project api/src/Web/Web.csproj ${URLS}`]]);
  });

  it('follows every root solution to its projects (the second, uncapped read pass)', () => {
    expect(dotnetDetector.followReads?.(repo({
      'App.sln': slnEntry('Web', 'deep\\a\\b\\Web\\Web.csproj'),
      'api/Api.slnx': '<Solution><Project Path="src/Api/Api.csproj" /></Solution>',
      'api/Direct.csproj': LIB_CSPROJ,
    }))).toEqual(['deep/a/b/Web/Web.csproj', 'api/src/Api/Api.csproj', 'api/Direct.csproj']);
  });

  it('a repo-root solution leaves a project in a .NET backend folder to that folder (one service, not two)', () => {
    const direct = detectDotnet(repo({ 'App.sln': slnEntry('Api', 'api\\Api.csproj'), 'api/Api.csproj': WEB_CSPROJ }));
    expect(direct.services?.map((s) => [s.id, s.rootDir])).toEqual([['api', 'api']]);
    const nested = detectDotnet(repo({
      'App.sln': slnEntry('Api', 'api\\src\\Api\\Api.csproj'),
      'api/Api.sln': slnEntry('Api', 'src\\Api\\Api.csproj'),
      'api/src/Api/Api.csproj': WEB_CSPROJ,
    }));
    expect(nested.services?.map((s) => [s.id, s.rootDir, s.devCommand])).toEqual([['api', 'api', `dotnet run --project src/Api/Api.csproj ${URLS}`]]);
  });

  it('reads project and solution files at the root and in the backend folders, with globs', () => {
    expect(dotnetDetector.reads).toEqual(expect.arrayContaining(['*.csproj', '*.sln', '*.slnx', 'api/*.csproj', 'backend/*/*.csproj']));
  });
});

const REACTOR = '[package]\nname = "todo-service"\n\n[lib]\ncrate-type = ["cdylib"]\n\n[dependencies]\nbfwc-wasi = { path = "../bfwc-wasi" }\naxum = "0.8"\n';

describe('Rust detector', () => {
  it('a bfwc-wasi reactor runs as its prebuilt wasm32-wasip1 module', () => {
    const result = detectRust(repo({ 'Cargo.toml': `${REACTOR}tokio-postgres = { version = "0.7", default-features = false }\n` }));
    expect(result.services).toEqual([expect.objectContaining({
      id: 'todo-service', kind: 'rust', rootDir: '.', packageManager: 'cargo', installCommand: '',
      devCommand: './target/wasm32-wasip1/release/todo_service.wasm', startCommand: './target/wasm32-wasip1/release/todo_service.wasm',
      buildCommand: 'cargo build --release --target wasm32-wasip1', ports: [8080],
    })]);
    expect(result.database).toMatchObject({ engine: 'postgres', migrationCommand: '' });
  });

  it.each([
    ['actix-web', '[dependencies]\nactix-web = "4"\n'],
    ['rocket', '[dependencies.rocket]\nversion = "0.5"\n'],
    ['plain axum on tokio', '[dependencies]\naxum = "0.8"\ntokio = { version = "1", features = ["full"] }\n'],
  ])('%s is a native server: `cargo run --release` (the browser declines it)', (_name, deps) => {
    expect(detectRust(repo({ 'Cargo.toml': `[package]\nname = "api"\n\n${deps}` })).services?.[0]).toMatchObject({
      kind: 'rust', devCommand: 'cargo run --release', buildCommand: 'cargo build --release',
    });
  });

  it('reads workspace deps (dotted keys) and [target.*.dependencies]', () => {
    const dotted = detectRust(repo({ 'Cargo.toml': '[package]\nname = "svc"\n[[bin]]\nname = "svc-bin"\n[dependencies]\nbfwc-wasi.workspace = true\n' }));
    expect(dotted.services?.[0]).toMatchObject({ devCommand: './target/wasm32-wasip1/release/svc-bin.wasm' });
    const target = detectRust(repo({ 'Cargo.toml': '[package]\nname = "svc"\n[target.\'cfg(target_os = "wasi")\'.dependencies]\nbfwc-wasi = { workspace = true }\n' }));
    expect(target.services?.[0]).toMatchObject({ devCommand: './target/wasm32-wasip1/release/svc.wasm' });
  });

  it('a subroot crate in the root workspace (multi-line, globbed members) builds into the workspace target; the virtual root is not a service', () => {
    const result = detectRust(repo({
      'Cargo.toml': '[workspace]\nresolver = "2"\nmembers = [\n  "crates/*", # libraries\n  "api",\n]\n',
      'api/Cargo.toml': REACTOR.replace('todo-service', 'shop-api'),
    }));
    expect(result.services).toEqual([expect.objectContaining({ id: 'api', rootDir: 'api', devCommand: '../target/wasm32-wasip1/release/shop_api.wasm' })]);
    const globbed = detectRust(repo({ 'Cargo.toml': '[workspace]\nmembers = ["*"]\n', 'server/Cargo.toml': REACTOR }));
    expect(globbed.services?.[0]).toMatchObject({ rootDir: 'server', devCommand: '../target/wasm32-wasip1/release/todo_service.wasm' });
    const outside = detectRust(repo({ 'Cargo.toml': '[workspace]\nmembers = ["crates/*"]\n', 'backend/Cargo.toml': REACTOR }));
    expect(outside.services?.[0]).toMatchObject({ devCommand: './target/wasm32-wasip1/release/todo_service.wasm' });
  });

  it('a .env.example Postgres DATABASE_URL alone yields Postgres', () => {
    const result = detectRust(repo({ 'Cargo.toml': REACTOR, '.env.example': 'DATABASE_URL=postgres://app@localhost:5432/app\n' }));
    expect(result.database).toMatchObject({ engine: 'postgres' });
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
    expect(result.services?.find((s) => s.id === 'api')?.devCommand).toBe(`dotnet run ${URLS}`);
  });
});
