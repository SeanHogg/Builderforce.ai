# @seanhogg/builderforce-feedback

Embeddable product-feedback widget for [Builderforce.ai](https://builderforce.ai).

Drops a small tab onto the edge of any page. Clicking it slides out a panel that files a
feature request, bug report or idea straight into a Builderforce project's backlog.

## Install

Script tag (no build step):

```html
<script src="https://unpkg.com/@seanhogg/builderforce-feedback"></script>
<script>
  BuilderforceFeedback.init({ key: 'bff_your_ingest_key' });
</script>
```

Or as a module:

```bash
npm install @seanhogg/builderforce-feedback
```

```ts
import { init } from '@seanhogg/builderforce-feedback';

init({ key: process.env.FEEDBACK_KEY!, appVersion: '2026.7.19' });
```

Get the ingest key from **Quality → Feedback** in Builderforce, with the project selected.
It is shown once, at creation.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `key` | *(required)* | The project's ingest key (`bff_…`). |
| `endpoint` | `https://api.builderforce.ai/api/feedback-ingest` | Ingest base for self-hosted deployments. |
| `side` | `'right'` | Which edge the tab docks to. |
| `accent` | `'#f4726e'` | Accent colour for the tab and submit button. |
| `theme` | `'auto'` | `'light'`, `'dark'`, or follow the page's `prefers-color-scheme`. |
| `kinds` | all four | Subset of `feature` \| `bug` \| `idea` \| `other`. |
| `collectEmail` | `true` | Ask for an email so the team can follow up. |
| `appVersion` | — | Release recorded against each request. |
| `context` | — | Extra structured context attached to every submission. |
| `labels` | English | Override any visible string (see `FeedbackLabels`). |
| `showTab` | `true` | Set `false` to drive the panel yourself via `open()`. |
| `onSubmit` | — | Called with `{ submissionId, deduped }` once accepted. |

## Driving it yourself

```ts
init({ key: 'bff_…', showTab: false });

document.querySelector('#help-menu-feedback')
  .addEventListener('click', () => BuilderforceFeedback.open());
```

`open()`, `close()` and `destroy()` are exported alongside `init`.

## What happens to a submission

Each request opens a ticket in the project's backlog marked as an **external request**.
Those tickets are hard-gated: no agent can pick one up — autonomously or via Run now —
until a human approves it in the feedback triage queue. Approving is the only thing that
makes the ticket executable, so nothing gets built because a stranger asked for it.

Duplicate submissions (same kind, title and body) collapse onto the existing request
rather than opening a second ticket, and each collector enforces a rolling 24-hour
submission ceiling.

## Rendering

Everything renders inside a shadow root with its own reset, so the widget can neither
inherit nor leak page styles. No dependencies, no framework, works on any page.

## Licence

MIT
