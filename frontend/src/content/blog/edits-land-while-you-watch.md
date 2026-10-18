---
title: Edits land while you watch — hot updates, real stylesheets and the frameworks you already use
date: 2026-10-18
description: The app you build on a Builderforce canvas now updates in place as you edit, keeping what you typed and where you scrolled. It compiles Sass, SCSS and Less, scopes CSS Modules for real, loads the stylesheets your packages ship, and runs Next.js and SvelteKit dev servers in the browser.
tags: [creation-canvas, app-development, preview, runtime, product]
author: Sean Hogg
---

# Edits land while you watch — hot updates, real stylesheets and the frameworks you already use

Every time the preview reloads, you lose your place.

You were three screens into a checkout flow, with a half-filled form and a modal open, and you changed one colour. The page reloaded, the form emptied, and you clicked your way back to see whether the colour was right. Multiply that by every small edit in an afternoon and most of your time goes on getting back to where you were.

There was a second gap behind the first. A lot of real projects never reached the preview at all. A `styles.scss`, a `Button.module.css`, a `import 'some-library/dist/styles.css'` or a Next.js app, and the preview either failed or quietly showed the page without its styles.

This release closes both gaps.

## Edits land in place

```bf-figure
{
  "kind": "compare",
  "title": "Change one colour",
  "columns": [
    { "title": "Before", "hue": "muted", "items": ["The whole page reloads", "The form you were filling in is empty again", "The modal closes and the scroll jumps to the top", "You click your way back to check the change"] },
    { "title": "Now", "hue": "run", "items": ["Only the stylesheet swaps", "What you typed stays typed", "The modal stays open, the scroll stays put", "The new colour is just there"] }
  ],
  "caption": "Stylesheet edits swap in place. React component edits re-render the component and keep its state. Anything that can't update safely reloads, as before."
}
```

- **Stylesheets swap.** Change a `.css`, `.scss` or `.less` file and only that stylesheet is replaced in the running page. Nothing reloads.
- **React components keep their state.** Edit a component and it re-renders with the new code, keeping its state, using React's own Fast Refresh. Counters keep their counts and forms keep their values.
- **A safe fallback.** If an edit can't be applied in place (a change to an app's entry file, say), the page reloads the way it always has, so nothing is left half-updated.

## Stylesheets the way real projects write them

```bf-figure
{
  "kind": "flow",
  "title": "From your source to the page",
  "steps": [
    { "label": "styles.scss", "note": "Variables, nesting, @use and partials, or Less with its mixins", "hue": "make" },
    { "label": "Compiled in the browser", "note": "Imports resolve from your project, then node_modules, then the package CDN", "hue": "run", "tag": "new" },
    { "label": "Button.module.css", "note": "Class names scoped per file, with composes and :global", "hue": "run", "tag": "new" },
    { "label": "Preview and published site", "note": "The same CSS in both", "hue": "measure" }
  ],
  "caption": "The preview and the published build use the same compilers, so what you see while you build is what ships."
}
```

- **Sass, SCSS and Less compile.** That includes `.scss`, `.sass` and `.less` files, and `<style lang="scss">` in Vue and Svelte components. Partials, `@use`, `@import` and imports from npm packages all resolve.
- **CSS Modules are real.** `import styles from './Button.module.css'` gives each class a scoped name, so `.title` in one component never collides with `.title` in another. `composes`, `:global` and keyframes work as you'd expect.
- **Package stylesheets load.** `import 'react-toastify/dist/ReactToastify.css'`, a component library's theme or a font package's CSS now load in the preview and in the published site, instead of being skipped.

## Next.js in the browser

A Next.js project now runs its own dev server, `next dev`, inside the browser tab, the same way an Express or Vite app already did. The page you open is rendered by Next itself, from your `app/` directory, with nothing of ours in between. SvelteKit projects run the same way: `vite dev` starts real Vite, and SvelteKit renders the page on its own server.

To make that work, the runtime underneath gained the parts of Node a framework like Next quietly relies on. Processes can now message each other (`child_process.fork` and `worker_threads`), dynamic imports load the project's own files, and Next's WebAssembly compiler loads where its native one can't. Most of those changes help other tools too.

## Where it sits in the method

Building is the third act of [Read, Prove, Build](/blog/read-prove-build-the-inner-loop). What that act is like comes down to one thing: how short the trip is from *change something* to *see what it did*.

Hot updates take the reload out of that trip, and keeping your place takes out the clicking back. Real stylesheets and real frameworks fix the other side of it. The project you prove in the preview is the project you'll ship, not a simplified copy that only looks like it.

## What you can do today

- **Restyle without losing your place:** open a modal, edit its CSS and watch it change.
- **Bring your stylesheets as they are:** SCSS partials, Less, CSS Modules and your packages' own CSS.
- **Edit a React component mid-flow** and keep the state you were testing with.
- **Open a Next.js or SvelteKit project** on a canvas and run it.

---

**Related reading:** [Your app now talks back](/blog/your-app-talks-back) · [Run the app your board just built](/blog/run-your-app-on-the-canvas) · [BuilderForce WebContainers is open source](/blog/builderforce-webcontainers-open-source)

[Open a canvas](/create) and change something while it runs.
