/**
 * The `angular` frontend part: a minimal Angular 19 standalone app (the shape `ng new`
 * writes) calling the kit's API through HttpClient.
 *
 * Two dev commands, on purpose. `npm start` is the real `ng serve` (with the `/api`
 * proxy) for a machine with the Angular CLI. `npm run dev` — the manifest's command —
 * runs `vite`, which the browser runtime hands off to its instant preview: that preview
 * compiles Angular 17–20 standalone apps itself (JIT) from `angular.json`, while `ng
 * serve` is not handed off and would try to boot the CLI's own bundler.
 */
import { BACKEND_INGRESS_PATH } from '@builderforce/app-detect/manifest';
import type { KitPart } from '../types';
import { frontendFragment, KIT_API_PORT, KIT_WEB_PORT } from './fragments';

const ANGULAR = '^19.2.0';

const PACKAGE_JSON = JSON.stringify({
  name: 'web',
  version: '1.0.0',
  private: true,
  scripts: {
    ng: 'ng',
    start: 'ng serve',
    dev: `vite --port ${KIT_WEB_PORT}`,
    build: 'ng build',
  },
  dependencies: {
    '@angular/common': ANGULAR,
    '@angular/compiler': ANGULAR,
    '@angular/core': ANGULAR,
    '@angular/forms': ANGULAR,
    '@angular/platform-browser': ANGULAR,
    rxjs: '~7.8.0',
    tslib: '^2.3.0',
    'zone.js': '~0.15.0',
  },
  devDependencies: {
    '@angular-devkit/build-angular': ANGULAR,
    '@angular/cli': ANGULAR,
    '@angular/compiler-cli': ANGULAR,
    typescript: '~5.7.2',
  },
}, null, 2);

const ANGULAR_JSON = JSON.stringify({
  $schema: './node_modules/@angular/cli/lib/config/schema.json',
  version: 1,
  newProjectRoot: 'projects',
  projects: {
    web: {
      projectType: 'application',
      root: '',
      sourceRoot: 'src',
      prefix: 'app',
      architect: {
        build: {
          builder: '@angular-devkit/build-angular:application',
          options: {
            outputPath: 'dist/web',
            index: 'src/index.html',
            browser: 'src/main.ts',
            polyfills: ['zone.js'],
            tsConfig: 'tsconfig.app.json',
            assets: [],
            styles: ['src/styles.css'],
          },
        },
        serve: {
          builder: '@angular-devkit/build-angular:dev-server',
          options: { buildTarget: 'web:build', port: KIT_WEB_PORT, proxyConfig: 'proxy.conf.json' },
        },
      },
    },
  },
}, null, 2);

const TSCONFIG = JSON.stringify({
  compileOnSave: false,
  compilerOptions: {
    outDir: './dist/out-tsc',
    strict: true,
    noImplicitOverride: true,
    noPropertyAccessFromIndexSignature: true,
    noImplicitReturns: true,
    noFallthroughCasesInSwitch: true,
    skipLibCheck: true,
    isolatedModules: true,
    esModuleInterop: true,
    experimentalDecorators: true,
    moduleResolution: 'bundler',
    importHelpers: true,
    target: 'ES2022',
    module: 'ES2022',
  },
  angularCompilerOptions: {
    enableI18nLegacyMessageIdFormat: false,
    strictInjectionParameters: true,
    strictInputAccessModifiers: true,
    strictTemplates: true,
  },
}, null, 2);

const TSCONFIG_APP = JSON.stringify({
  extends: './tsconfig.json',
  compilerOptions: { outDir: './out-tsc/app', types: [] },
  files: ['src/main.ts'],
  include: ['src/**/*.d.ts'],
}, null, 2);

const PROXY_CONF = JSON.stringify({ [BACKEND_INGRESS_PATH]: { target: `http://localhost:${KIT_API_PORT}`, secure: false } }, null, 2);

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>My App</title>
    <base href="/" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <app-root></app-root>
  </body>
</html>`;

const STYLES_CSS = `body {
  margin: 0;
  font-family: system-ui, -apple-system, sans-serif;
}`;

const MAIN_TS = `import { provideHttpClient } from '@angular/common/http';
import { provideZoneChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';

bootstrapApplication(AppComponent, {
  providers: [provideZoneChangeDetection({ eventCoalescing: true }), provideHttpClient()],
}).catch((error) => console.error(error));`;

const APP_COMPONENT = `import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';

interface Item {
  id: number;
  name: string;
}

interface ItemList {
  items: Item[];
  storage: string;
  note?: string;
}

interface Health {
  status: string;
  runtime: string;
  storage: string;
}

// Same-origin: the dev server proxies /api to the API service (proxy.conf.json).
const API = '/api';

@Component({
  selector: 'app-root',
  imports: [FormsModule],
  template: \`
    <main class="page">
      <h1>Hello World! 🚀</h1>
      <p>API health: <strong>{{ health }}</strong></p>
      <form (ngSubmit)="add()">
        <input [(ngModel)]="name" name="name" placeholder="New item" />
        <button type="submit">Add</button>
      </form>
      @if (note) {
        <p><small>{{ note }}</small></p>
      }
      <ul>
        @for (item of items; track item.id) {
          <li>{{ item.name }}</li>
        }
      </ul>
      <p>Edit src/app/app.component.ts to get started.</p>
    </main>
  \`,
  styles: [\`.page { padding: 2rem; max-width: 640px; }\`],
})
export class AppComponent implements OnInit {
  private readonly http = inject(HttpClient);

  health = 'checking…';
  items: Item[] = [];
  note = '';
  name = '';

  ngOnInit(): void {
    this.http.get<Health>(\`\${API}/health\`).subscribe({
      next: (body) => (this.health = \`\${body.status} (\${body.runtime}, \${body.storage})\`),
      error: (error: Error) => (this.health = \`unreachable: \${error.message}\`),
    });
    this.load();
  }

  load(): void {
    this.http.get<ItemList>(\`\${API}/items\`).subscribe({
      next: (body) => {
        this.items = body.items;
        this.note = body.note ?? '';
      },
      error: (error: Error) => (this.note = error.message),
    });
  }

  add(): void {
    if (!this.name.trim()) return;
    this.http.post<Item>(\`\${API}/items\`, { name: this.name }).subscribe(() => {
      this.name = '';
      this.load();
    });
  }
}`;

export const ANGULAR_PART: KitPart = {
  id: 'angular',
  kind: 'frontend',
  label: 'Angular 19 (standalone)',
  serviceId: 'web',
  root: '/web',
  ingress: '/',
  files: {
    'package.json': PACKAGE_JSON,
    'angular.json': ANGULAR_JSON,
    'tsconfig.json': TSCONFIG,
    'tsconfig.app.json': TSCONFIG_APP,
    'proxy.conf.json': PROXY_CONF,
    'src/index.html': INDEX_HTML,
    'src/styles.css': STYLES_CSS,
    'src/main.ts': MAIN_TS,
    'src/app/app.component.ts': APP_COMPONENT,
  },
  manifest: frontendFragment({ runtime: 'node', command: 'npm run dev', install: 'npm install' }),
};
