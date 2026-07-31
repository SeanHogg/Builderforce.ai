> **PRD** — drafted by Bob Developer (V2 (Container)) · task #1377
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document (PRD)

## Problem & Goal
### Problem
The current implementation of code block detection in the `Markdown.tsx` component within `brain-ui` is unreliable and overly complex. It relies on the `inline` prop from `react-markdown` and additional text analysis, which often leads to incorrect rendering of code blocks.

### Goal
Refactor the code block detection logic to be simpler, more reliable, and aligned with standard markdown conventions. This will ensure consistent and correct rendering of both inline and block code elements.

## Target Users / ICP Roles
- **Frontend Developers**: Users who interact with the `brain-ui` library to render markdown content.
- **Technical Writers**: Users who author documentation or content that includes code snippets.

## Scope
- Refactor the code block detection logic in the `Markdown.tsx` component.
- Ensure that fenced code blocks (with language specifiers) are correctly identified and rendered as code blocks.
- Ensure that inline code snippets are correctly identified and rendered as inline code.

## Functional Requirements
1. **Code Block Detection**:
   - Utilize the presence of a `className` (e.g., "language-js") to determine if a code element is a block.
   - If `className` is present, render the code as a block using the `CodeBlock` component.
   - If `className` is absent, render the code as inline using the `<code>` element.

2. **Inline Code Rendering**:
   - Ensure that inline code snippets are rendered with the `bf-md__inline` class for styling.

3. **Fallback Handling**:
   - If `children` is not provided, render an empty code element to prevent rendering errors.

4. **Code Block Component Integration**:
   - Pass necessary props (`code`, `onApplyCode`, `onCreateFile`, `labels`) to the `CodeBlock` component when rendering a code block.

## Acceptance Criteria
- **Correct Rendering**: All fenced code blocks with a `className` are rendered as code blocks using the `CodeBlock` component.
- **Inline Code Rendering**: All code elements without a `className` are rendered as inline code using the `<code>` element with the `bf-md__inline` class.
- **No Reliance on `inline` Prop**: The detection logic does not use the `inline` prop from `react-markdown`.
- **No Complex Text Analysis**: The detection logic does not perform complex text analysis to determine if a code element is a block.
- **Consistent Styling**: Inline code snippets maintain consistent styling with the `bf-md__inline` class.
- **Error Handling**: The component gracefully handles cases where `children` is not provided by rendering an empty code element.

## Out of Scope
- **Styling Changes**: This task does not include changes to the styling of code blocks or inline code.
- **Functionality of `CodeBlock` Component**: The internal functionality of the `CodeBlock` component is not modified as part of this task.
- **Integration with Other Components**: This task does not involve changes to other components that use the `Markdown` component.
- **Performance Optimization**: While the refactor may have minor performance implications, explicit performance optimization is not in scope.

## Files to Modify
- `Builderforce.ai/packages/brain-ui/src/Markdown.tsx`: Update the code block detection logic to align with the specified approach.

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