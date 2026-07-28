> **PRD** — drafted by Product Manager · task #385
> _Each agent that updates this PRD signs its change below._

## Problem & Goal
Users of the Brain chat feature lack a quick way to copy AI responses, reducing workflow efficiency especially in the free tier. The goal is to add a non-intrusive copy button that appears on completed responses, enabling one-click clipboard copy to improve usability without altering core chat behavior.

## Target users / ICP roles
- Free-tier Brain and Chat users seeking basic productivity features
- Power users who frequently reuse AI-generated text in external tools

## Scope
- Add copy button to all Brain chat response messages
- Button visible only after response generation completes
- Limited to text content copying; no UI or backend changes beyond the button

## Functional requirements
- Display a copy icon button at the end of each AI response bubble
- On click, copy the full response text to the system clipboard
- Provide visual feedback (e.g., icon change or toast) confirming successful copy
- Button must be accessible via keyboard and screen readers
- Works consistently across desktop and mobile viewports

## Acceptance criteria
- Copy button appears immediately after each complete Brain response
- Clicking the button copies exact response text without extra formatting
- Success feedback is shown within 500ms of click
- No impact on existing chat loading, streaming, or error states
- Button does not appear on user messages or incomplete responses

## Out of scope
- Copy functionality for user messages or system prompts
- Integration with external sharing or export features
- Customizable button styling or position
- Analytics tracking or A/B testing of the feature

## Requirements

_Owned by the business-analyst — to be authored._

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._