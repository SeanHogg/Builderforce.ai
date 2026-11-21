---
title: A blank preview now tells you why, and a Laravel API comes up in the tab
date: 2026-11-21
description: BuilderForce WebContainers 2026.11.9 reports what a preview load spent its time on and which origin its security policy blocked, in one call. A custom package CDN joins the preview policy by itself. And a Vite frontend, a Laravel API and Postgres now start together in the browser tab, with php artisan serve included.
tags: [webcontainers, open-source, runtime, browser, preview, developer-tools, idea-to-real, product]
author: Sean Hogg
---

# A blank preview now tells you why, and a Laravel API comes up in the tab

You press Run. The preview frame stays white. Or it fills in, but it takes twelve seconds, and you have no idea whether that was the network, the compiler, a package CDN or your own code.

Until now the in-browser runtime gave you very little to go on. The preview runs under a strict security policy, so a map that loads tiles from a third-party server, or a font from a CDN, is blocked, and the page simply looks broken. A slow first load looked the same as a fast one that happened to be stuck. And if your API was Laravel, `php artisan serve` failed before it served a single request.

BuilderForce WebContainers 2026.11.9 closes those gaps. **A blank or slow preview now comes with a reason, and a Laravel API now starts in the tab.**

## One call that says where the time went

`runtime.diagnostics()` returns a single load report. It holds only what the runtime measured:

- **Phase timings** for the runtime starting, the service worker becoming ready, the compiler loading and the preview's first paint.
- **Package CDN traffic:** how many requests, how long they took in total, and how many failed.
- **Requests per origin** and the **slowest requests**, labelled by origin and by what asked for them. Paths and URLs are left out.
- The **recent security-policy violations** in the preview.
- Whether the browser cache was **cold or warm**.
- A list of what **could not be measured**, so a missing number is not mistaken for a zero.

```bf-figure
{
  "kind": "flow",
  "title": "The four phases a load report times",
  "steps": [
    { "label": "Runtime start", "note": "The clock starts when you start the runtime. Every other phase is timed from here.", "hue": "make" },
    { "label": "Service worker ready", "note": "The worker that serves the preview's files is installed and answering.", "hue": "make" },
    { "label": "Compiler load", "note": "The esbuild WebAssembly compiler is downloaded and started. A cold cache shows here first.", "hue": "run" },
    { "label": "Preview first paint", "note": "The preview reports its first contentful paint. This is the moment a person sees something.", "hue": "measure" }
  ],
  "caption": "Each phase carries a start time and a duration. A phase the browser could not observe is listed as unavailable instead of being reported as zero."
}
```

So when someone says the preview is slow, you can see whether the compiler download took most of the time, or the package CDN did, or the cache was simply cold.

## See exactly what the security policy blocked

Previews run code you did not write, so the runtime gives each one a strict content security policy. That is the right default, and it is also the most common reason a preview renders blank or half-styled.

`runtime.onCspViolation(listener)` now tells the host page which origin was blocked and under which directive: for example, `img-src` blocked `https://tile.openstreetmap.org`. A blocked address is reduced to its origin, so no path or query leaves the preview. Repeats are reported once, and the total is capped, so a page stuck in a loop cannot flood you.

```bf-figure
{
  "kind": "screen",
  "frame": "Your page, with the runtime embedded",
  "ratio": 1.6,
  "regions": [
    { "label": "Preview", "note": "A map app with no tiles: the policy blocked the tile server", "x": 4, "y": 8, "w": 58, "h": 84, "hue": "muted", "style": "ghost" },
    { "label": "Blocked: img-src", "note": "https://tile.openstreetmap.org", "x": 66, "y": 8, "w": 30, "h": 24, "hue": "bad" },
    { "label": "Load report", "note": "Phases, CDN requests, slowest origins, cold or warm cache", "x": 66, "y": 36, "w": 30, "h": 34, "hue": "measure" },
    { "label": "Fix", "note": "Add the origin to the preview's allowed list", "x": 66, "y": 74, "w": 30, "h": 18, "hue": "good" }
  ],
  "caption": "The blank frame stops being a mystery. The violation names the origin and the directive, and the fix is one line of configuration."
}
```

Moving an existing app onto the policy? `previewCspMode: 'report-only'` reports every violation without blocking anything, so you can collect the full list first. It switches the protection off, so it is for migrations only, and your server has to allow it on purpose. Builderforce never turns it on.

## Your own package CDN, without a blank page

If you serve npm packages from your own mirror instead of esm.sh, the mirror now declares its origins and the runtime adds them to the preview policy for you. An esm.sh-compatible mirror takes one option:

```ts
const runtime = await startPreviewRuntime({
  relayUrl: 'https://preview.example.com/__bfwc/relay.html',
  cdn: createEsmShCdnFactory({ origin: 'https://esm.example.com' }),
});
```

A custom CDN that declares no origins used to fail quietly: every package import was blocked and the preview stayed blank. Now the runtime logs one warning that names the problem, once.

```bf-figure
{
  "kind": "compare",
  "title": "A blank preview, before and after",
  "columns": [
    { "title": "Before 2026.11.9", "hue": "muted", "items": ["A white frame and no reason", "Blocked origins visible only on your server, if you collected reports", "A slow load looked the same as a stuck one", "A custom CDN without its origin listed broke silently", "php artisan serve failed on start"] },
    { "title": "With 2026.11.9", "hue": "run", "items": ["The blocked origin and directive, on the host page", "One load report: phases, CDN, origins, cache", "Report-only mode for moving an app onto the policy", "A custom CDN's origins join the policy, or you get one warning", "A Laravel API starts with php artisan serve"] }
  ],
  "caption": "The policy is as strict as before. What changed is that it explains itself."
}
```

## A Laravel API now comes up in the tab

`php artisan serve` starts PHP's built-in web server as a separate process. The WebAssembly build of PHP that runs in the browser cannot start processes that way, so Laravel's own serve command failed before the API answered anything. The runtime now serves it directly, the way Laravel would, from the app's `public/` directory.

That means a Vite frontend, a Laravel API and a Postgres database start end to end in one tab: Composer installs the packages, the migrations run, the API comes up and the frontend reaches it through the same address.

```bf-figure
{
  "kind": "flow",
  "title": "A Vite, Laravel and Postgres app starting in one tab",
  "steps": [
    { "label": "Postgres", "note": "A real Postgres database, held in the page.", "hue": "measure", "tag": "in the tab" },
    { "label": "composer install", "note": "Installs the API's packages. Its output ends with its last line before the next step starts.", "hue": "make", "tag": "setup" },
    { "label": "artisan migrate", "note": "Creates the schema once the packages and the database are ready.", "hue": "make", "tag": "setup" },
    { "label": "artisan serve", "note": "The Laravel API, ready when its health route answers.", "hue": "run", "tag": "in the tab" },
    { "label": "Vite frontend", "note": "The page you click through, calling the API at /api.", "hue": "run", "tag": "in the tab" }
  ],
  "caption": "Setup steps are services too: each one finishes before the services that depend on it start, and its full log is there when it does."
}
```

The setup steps got one more fix. When `composer install` or `npm install` finishes, its log now always ends with its final line before the next service changes state. If a step fails, the error you need is in the log, not cut off just above it.

## Smaller things that make it easier to host

- **The .NET runtime bundle installs from npm** as `@seanhogg/builderforce-webcontainers-dotnet`, at the same version as the runtime. Copy it into your static files and point the runtime at it.
- **A table of every asset fetched at runtime.** The README now lists each origin the runtime downloads from, which page or worker fetches it, when, and how to host it yourself. If your site has a strict policy or no network, you can see exactly what to mirror.

## Where it sits in the method

Idea to Real is an arc, **Idea → Make → Run → Measure**, with a loop inside it: [Read, Prove, Build](/blog/read-prove-build-the-inner-loop). Reading and proving cost nothing, so the decision to build is a real decision.

A proof only helps if its answer is clear. Run a smoke test or a proof of concept and get a blank page, and you cannot tell whether the idea failed or the plumbing did. A load report and a named blocked origin separate the two: either the app does what you described, or you know which line of configuration stopped it.

```bf-figure
{
  "kind": "stack",
  "title": "The arc, with Run and Measure reporting back",
  "bands": [
    { "label": "Idea", "note": "Read it, and choose the cheapest proof worth running: a smoke test, a proof of concept, a pilot.", "hue": "idea" },
    { "label": "Make", "note": "Build the one thing the proof asked for, a Laravel API included.", "hue": "make" },
    { "label": "Run", "note": "See it start in the tab. If the preview is blank, the blocked origin is named.", "hue": "run", "tag": "explains itself" },
    { "label": "Measure", "note": "Phase timings and request counts, so a slow run has a number attached.", "hue": "measure", "tag": "load report" }
  ],
  "caption": "A failed proof should be a finding about the idea, not about the preview."
}
```

## What you can do with it today

- **Find out why a preview is blank** by reading the blocked origin and directive, then allow that origin.
- **Find out why a preview is slow** with one call that times each phase and counts the CDN and origin traffic.
- **Move an existing app onto the policy** with report-only mode, then switch back to enforcing.
- **Serve packages from your own mirror** without listing its origin by hand.
- **Run a Laravel API** with a Vite frontend and Postgres, end to end, in the browser tab.
- **Host the runtime on a locked-down site**, with a list of everything it fetches and the .NET bundle from npm.

---

**Related reading:** [BuilderForce WebContainers is open source](/blog/builderforce-webcontainers-open-source) · [Your full-stack app now runs in the browser tab you built it in](/blog/your-full-stack-app-now-runs-in-your-browser-tab) · [Read, Prove, Build: the inner loop](/blog/read-prove-build-the-inner-loop)

[Read the runtime on GitHub](https://github.com/SeanHogg/builderforce-webcontainers), or [open a canvas](/create), describe an app with a Laravel API, and press Run.
