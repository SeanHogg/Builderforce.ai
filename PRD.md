> **PRD** — drafted by Product Manager · task #1378
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document (PRD) - Fix Code Block Detection in brain-ui Markdown Component

## Problem & Goal

### Problem
The current implementation of code block detection in the `Markdown` component of `brain-ui` relies on the `inline` prop and text newline checks, which has proven to be unreliable and error-prone. This has led to inconsistent rendering of code blocks and potential issues with the display of user-generated content.

### Goal
Replace the existing faulty inline detection logic with a more reliable method that accurately identifies code blocks. The new approach will use the presence of a `className` attribute to determine if a code block should be rendered, aligning with the approach used in `ChatMessageContent.tsx` in the frontend.

## Target Users / ICP Roles
- **Frontend Developers**: Developers who work with the `brain-ui` library and need to ensure consistent rendering of Markdown content.
- **Technical Writers**: Users who rely on the `Markdown` component to document code and technical content accurately.
- **QA Engineers**: Individuals responsible for testing the rendering of Markdown content to ensure quality and consistency.

## Scope

### In-Scope
- Update the `Markdown` component in `brain-ui` to use `className` for code block detection.
- Remove the existing logic that relies on the `inline` prop and text newline checks.
- Ensure that the new detection method aligns with the approach used in `ChatMessageContent.tsx`.
- Update relevant tests to validate the new detection logic.

### Out-of-Scope
- Changes to the `ChatMessageContent.tsx` component.
- Modifications to other components or libraries that use the `Markdown` component.
- Implementation of additional features or enhancements unrelated to code block detection.

## Functional Requirements

1. **Code Block Detection**
   - The `Markdown` component must use the presence of a `className` attribute to determine if a code block should be rendered.
   - The component should no longer rely on the `inline` prop or text newline checks for code block detection.

2. **Rendering Consistency**
   - The rendering of code blocks must be consistent with the behavior of the `ChatMessageContent.tsx` component.
   - All code blocks must be rendered correctly, with appropriate styling and formatting.

3. **Backward Compatibility**
   - The update should not introduce breaking changes to the existing API of the `Markdown` component.
   - Any deprecated props or methods related to code block detection should be documented and phased out appropriately.

4. **Testing**
   - Unit tests must be updated to reflect the new detection logic.
   - Integration tests should be implemented to ensure that code blocks are rendered correctly in various scenarios.

## Acceptance Criteria

- The `Markdown` component successfully uses `className` for code block detection.
- All existing tests pass with the new detection logic in place.
- The rendering of code blocks is consistent with the `ChatMessageContent.tsx` component.
- No regression issues are introduced in the `brain-ui` library as a result of the update.
- Documentation is updated to reflect the changes in the detection logic.

## Out of Scope

- Refactoring of other components or utilities within `brain-ui`.
- Implementation of new features or enhancements unrelated to code block detection.
- Changes to the frontend codebase outside of the `Markdown` component.

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