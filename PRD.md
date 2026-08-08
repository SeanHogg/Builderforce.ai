> **PRD** — drafted by Ada (Sr. Product Mgr) · task #875
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document (PRD)

## Problem & Goal

### Problem
The current implementation of the chat functionality lacks the necessary plumbing for the `chatId` parameter. This omission prevents the system from correctly associating chat messages with specific tasks and runtime messages, leading to potential issues in task management and communication tracking.

### Goal
Implement the required `chatId` plumbing to ensure that:
1. The `builtinMcpService.ts` includes the `chatId` in the POST request to `/api/tasks/:id/run-now`.
2. The `taskRoutes.ts` endpoint extracts and merges the `chatId` into the payload object.
3. The `DispatchMessage` type in `runtimeRoutes.ts` carries an optional `chatId` and is populated from the payload object.

## Target Users / ICP Roles
- **Developers**: Responsible for implementing and maintaining the chat and task management features.
- **QA Engineers**: Need to verify the correct implementation and integration of the `chatId` parameter.
- **Product Managers**: Require the `chatId` functionality to ensure seamless communication and task tracking for end-users.

## Scope

### In-Scope
- **Modification of `builtinMcpService.ts`**:
  - Include `chatId` in the POST request to `/api/tasks/:id/run-now`.
- **Modification of `taskRoutes.ts`**:
  - Extract `chatId` from the request payload.
  - Merge `chatId` into the `payloadObj`.
- **Modification of `runtimeRoutes.ts`**:
  - Update the `DispatchMessage` type to include an optional `chatId`.
  - Populate the `chatId` from the payload object.

### Out-of-Scope
- **UI Changes**: Any changes to the user interface related to chat or task management.
- **Backend Logic Changes**: Any modifications to the backend logic beyond the inclusion and propagation of the `chatId`.
- **Testing Framework**: Implementation of new tests or modification of existing tests (unless necessary for verification).
- **Documentation**: Updating user or developer documentation related to the `chatId` functionality.

## Functional Requirements

1. **Include `chatId` in POST Request**
   - The `builtinMcpService.ts` must include the `chatId` parameter in the POST request to `/api/tasks/:id/run-now`.
   - The `chatId` should be obtained from the incoming request context.

2. **Extract and Merge `chatId` into Payload**
   - The `taskRoutes.ts` endpoint must extract the `chatId` from the request payload.
   - The extracted `chatId` should be merged into the `payloadObj` before further processing.

3. **Update `DispatchMessage` Type with `chatId`**
   - The `DispatchMessage` type in `runtimeRoutes.ts` must be updated to include an optional `chatId` field.
   - The `chatId` field should be populated from the `payloadObj` when present.

## Acceptance Criteria

1. **Successful Inclusion of `chatId`**
   - The POST request to `/api/tasks/:id/run-now` includes the `chatId` parameter.
   - The `chatId` is correctly obtained from the request context.

2. **Correct Extraction and Merging of `chatId`**
   - The `chatId` is accurately extracted from the request payload in `taskRoutes.ts`.
   - The `chatId` is properly merged into the `payloadObj`.

3. **Proper Population of `chatId` in `DispatchMessage`**
   - The `DispatchMessage` type includes an optional `chatId` field.
   - The `chatId` is correctly populated from the `payloadObj` when present.

4. **No Regression Issues**
   - The implementation of the `chatId` plumbing does not introduce any new bugs or issues in the existing functionality.
   - All existing tests pass, and new tests (if any) related to the `chatId` functionality are added and pass.

## Out of Scope

- **UI/UX Changes**: Any changes to the user interface or user experience related to chat or task management.
- **Backend Logic Beyond `chatId`**: Any modifications to the backend logic beyond the inclusion and propagation of the `chatId`.
- **Comprehensive Testing**: Implementation of a comprehensive testing framework for the `chatId` functionality (unless necessary for verification).
- **Documentation Updates**: Updating user or developer documentation related to the `chatId` functionality.

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