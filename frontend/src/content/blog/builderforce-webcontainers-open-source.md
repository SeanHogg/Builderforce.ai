---
title: BuilderForce WebContainers is open source — the in-browser dev runtime you can fork
date: 2026-10-16
description: The runtime behind every Builderforce canvas preview, Publish and Check is now MIT on GitHub and npm. It previews, builds and type-checks Vite, React, Vue and Svelte apps and runs Node, npm and a shell in the tab, with no COOP/COEP headers and no session caps.
tags: [open-source, webcontainers, developer-tools, ide, browser, preview]
author: Sean Hogg
---

# BuilderForce WebContainers is open source — the in-browser dev runtime you can fork

Every app you build on a Builderforce canvas runs in your browser before it runs anywhere else. Until this month, the thing that ran it was not ours.

We used StackBlitz WebContainers (`@webcontainer/api`). It is impressive technology, and it was the right way to start. It also came with four constraints that got harder to live with the more the canvas did:

- **A proprietary licence.** The free tier is non-commercial and requires attribution. A runtime that sits under a commercial product needs a commercial agreement, and every customer who wanted to self-host inherited that question.
- **Cross-origin isolation.** It needs the host page served with COOP and COEP headers. Those headers are exactly what break the things a real app embeds: sign-in popups, payment frames, video players, analytics, any third-party script that does not send the right headers back.
- **Session caps.** 25,000 API sessions a month on the free tier. A canvas that opens a preview every time someone looks at an app spends sessions fast.
- **No way in.** When a preview broke inside the runtime, we could report it and wait. We could not read the code, fix it, or fork it.

So we built our own, and today it is open source under MIT: **BuilderForce WebContainers**, on [GitHub](https://github.com/SeanHogg/builderforce-webcontainers) and npm as [`@seanhogg/builderforce-webcontainers`](https://www.npmjs.com/package/@seanhogg/builderforce-webcontainers).

## What you can do with it now

Hand it a project as files, and it serves a live preview in an iframe, with TypeScript, JSX, CSS, JSON and npm packages working the way they do under Vite. All of it runs in the user's browser.

- **Preview frontend apps.** Vite with React, Vue or Svelte, Create React App, and static sites. Edits reload every open preview of the project; there is nothing to restart.
- **Build for deployment in the page.** `runtime.build()` is `npm run build` without a server. It returns a bundled, minified, content-hashed static site you can upload anywhere.
- **Type-check in the page.** `createChecker()` runs TypeScript in a Web Worker over the project's own tsconfig and returns diagnostics as plain data.
- **Run Node programs.** `npm install` from the real npm registry, Node scripts, Express-style servers on virtual ports, and an interactive `jsh` shell for a terminal. Each process gets its own Web Worker, so a busy loop never freezes the page and `kill()` always works.
- **Isolate untrusted code.** In relay mode, previews and processes run on a separate origin, so AI-written code and arbitrary npm packages never share your app's cookies or storage.
- **Fork it.** The compiler, the package CDN and the transport are ports. Swap esbuild for SWC, or esm.sh for your own mirror, without patching the core.

```bf-figure
{
  "kind": "compare",
  "title": "The two runtimes, side by side",
  "columns": [
    { "title": "StackBlitz WebContainers", "hue": "muted", "items": ["Proprietary licence; free tier is non-commercial", "25,000 API sessions a month on the free tier", "Requires COOP and COEP on the host page", "Fixed compiler and package source", "Build and type-check by running npm run build and tsc in the container", "Node, npm and a shell"] },
    { "title": "BuilderForce WebContainers", "hue": "make", "items": ["MIT: fork it, ship it, sell it", "No session cap", "No cross-origin isolation required; embeds keep working", "Pluggable ports for the compiler, the package CDN and the transport", "runtime.build() and createChecker() in the browser", "Node, npm and a shell, one Web Worker per process"] }
  ],
  "caption": "Requirements for ours: a secure context (https or localhost) for the service worker. That is all."
}
```

## How it works

There is no bundling during development. The runtime works the way Vite's dev server works, with a service worker standing in for the network.

```bf-figure
{
  "kind": "flow",
  "title": "From files to a running preview",
  "steps": [
    { "label": "Mount", "note": "The project lives in a virtual file system in the page. Writing a file is an edit; there is no disk.", "hue": "idea" },
    { "label": "Compile per file", "note": "When the preview asks for src/App.tsx, that one file is compiled with esbuild-wasm and served as a native ES module.", "hue": "make" },
    { "label": "Resolve packages", "note": "Bare imports become esm.sh URLs, pinned from package.json and deduped, so there is one React.", "hue": "make" },
    { "label": "Serve", "note": "A service worker answers the iframe's requests by asking the page, so the preview loads like any website.", "hue": "run", "tag": "in the tab" }
  ],
  "caption": "Startup is immediate and an edit recompiles one file. Browsers kill idle service workers; when that happens the worker asks open pages to re-attach instead of failing the request."
}
```

Node programs take a different path. `runtime.spawn('node', …)` starts a Web Worker with a snapshot of the files and shims for `fs`, `http`, `child_process` and the rest of Node's core modules; writes sync back to every other process. A server that calls `listen(3000)` is answered through the same service worker, and the runtime fires `server-ready` with its URL. The `spawn` API has the same shape as `@webcontainer/api`'s, so code written against StackBlitz ports over with little change.

## What it powers on Builderforce

```bf-figure
{
  "kind": "screen",
  "frame": "An app on the canvas, running on BuilderForce WebContainers",
  "ratio": 1.62,
  "regions": [
    { "label": "Preview", "note": "Served from preview.builderforce.ai, isolated from your session", "x": 4, "y": 8, "w": 58, "h": 62, "hue": "make" },
    { "label": "Terminal", "note": "jsh: npm, npx, node, pipes", "x": 4, "y": 74, "w": 58, "h": 20, "hue": "run" },
    { "label": "Check", "note": "Type-check, build, lint, with failures sent to the agent", "x": 65, "y": 8, "w": 31, "h": 40, "hue": "prove" },
    { "label": "Publish", "note": "runtime.build() to a static site at your address", "x": 65, "y": 52, "w": 31, "h": 42, "hue": "accent" }
  ],
  "caption": "One runtime behind all four. Nothing here asks the browser for cross-origin isolation, so the app you preview behaves like the app you ship."
}
```

- **Canvas previews.** The app surface and Studio run every project through it, in relay mode: the preview lives at `preview.builderforce.ai`, a separate origin, so code an agent wrote never touches your Builderforce cookies or storage.
- **Publish.** Publish builds the site in your browser from the project's files, then uploads the static output to your subdomain. The preview, and anything mounted into it, is left untouched.
- **Check.** Check type-checks and builds the project from its files with no install, then runs the project's own `npm run lint` on the Node runtime when it has one. Every failed step goes back to the agent as something to fix.
- **Errors.** Uncaught errors in the preview are posted to the host page, which is how a broken app reaches the assistant that wrote it instead of sitting there looking finished.

## What it does not do yet

We would rather say this than have you find it:

- **Native addons and install scripts.** `.node` addons cannot load in a browser, and `postinstall` is skipped. Packages with a WebAssembly fallback (esbuild-wasm, @swc/wasm) work; packages that only ship native binaries (sharp, better-sqlite3) do not.
- **Next.js, Nuxt, SvelteKit, Remix and Astro dev servers.** They need native binaries today. The runtime detects these projects and declines with a reason, so the host can fall back to another runtime instead of showing a broken preview.
- **WebSockets and streaming responses** from a server inside the runtime. Responses are buffered whole for now.
- **`execSync` and `spawnSync`.** Blocking one worker on another would need cross-origin isolation, which this runtime refuses to require.

Each of these is on the public [roadmap](https://github.com/SeanHogg/builderforce-webcontainers/blob/main/ROADMAP.md), roughly in the order it is worth closing.

## Quick start

Serve the service worker from the package at `/__bfwc/sw.js`, then boot, mount and preview:

```ts
import { bootPreviewRuntime } from '@seanhogg/builderforce-webcontainers';

const runtime = await bootPreviewRuntime({ serviceWorkerUrl: '/__bfwc/sw.js', id: 'my-project' });
runtime.mount({
  'package.json': JSON.stringify({ dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' } }),
  'index.html': '<div id="root"></div><script type="module" src="/src/main.tsx"></script>',
  'src/main.tsx': `import { createRoot } from 'react-dom/client';
createRoot(document.getElementById('root')!).render(<h1>Hello</h1>);`,
});

if (runtime.profile().supported) iframe.src = runtime.url;
runtime.onError((e) => console.warn('preview crashed:', e.message));

// Ship it: a static site with hashed assets, built in the page.
const { files } = await runtime.build({ base: './' });
```

If the code you preview is AI-written or pulls in arbitrary packages, serve the relay files from a separate origin and pass `relayUrl` instead of `serviceWorkerUrl`. The [README](https://github.com/SeanHogg/builderforce-webcontainers#readme) covers relay mode, type-checking, Vue and Svelte, and the Node runtime.

Every preview shows a small "Built with Builderforce.ai" badge. It is not a licence condition, and `attribution: false` turns it off. If the runtime saves you money, leaving it on is how the project is funded.

## Where it sits in the method

Work on Builderforce follows an arc, **Idea → Make → Run → Measure**, and each act runs through the same inner loop: [Read, Prove, Build](/blog/read-prove-build-the-inner-loop).

```bf-figure
{
  "kind": "flow",
  "title": "One runtime, three acts of the arc",
  "steps": [
    { "label": "Make", "note": "The preview in the tab: an edit recompiles one file and every open preview reloads.", "hue": "make" },
    { "label": "Check", "note": "Type-check, build and lint before anything ships, with failures sent back to the agent.", "hue": "prove" },
    { "label": "Run", "note": "Publish builds in the browser and puts a static site at your address.", "hue": "run" },
    { "label": "Measure", "note": "Preview errors are reported to the page, so the first evidence arrives before a user does.", "hue": "measure" }
  ],
  "caption": "The runtime costs nothing to start, which is what keeps Prove cheap: a working prototype is a few seconds in the tab, not a container."
}
```

The runtime lives in **Make**, and it changes how **Prove** feels. Proving an idea with a running prototype used to mean waiting for a container or a deploy. Now the prototype starts in the tab, costs nothing to run, and has no session meter, so trying the second idea is as cheap as the first.

**Build** gets a gate. Check runs the same type-check and build that Publish will, so the step from **Make** to **Run** is a result you can read, not a hope.

And because the runtime is MIT, none of this is a dependency you cannot see into. If a preview misbehaves, the code that ran it is on GitHub.

## What you can do with it today

- **Build an app on the canvas** and watch it run in the tab, with no headers to configure and no install.
- **Embed the runtime in your own product.** One package, one service worker, MIT.
- **Port from `@webcontainer/api`.** `spawn`, `server-ready` and the shell have the same shape.
- **Read the roadmap and send a pull request.** Lint in the check worker, hot module replacement and style preprocessors are next.

---

**Related reading:** [Open source at Builderforce](/blog/open-source-at-builderforce) · [The App on your canvas is now a real project](/blog/your-canvas-app-is-a-real-project) · [The in-browser IDE](/blog/in-browser-ide-and-collaboration)

[See everything we open-source](/open-source) or [read the runtime's page](/open-source/builderforce-webcontainers).
