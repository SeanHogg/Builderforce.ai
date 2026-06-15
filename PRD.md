> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #78
> _Each agent that updates this PRD signs its change below._

```markdown
# Product Requirements Document: Team Member Avatar Filters on Task Board

## 1. Problem & Goal

### 1.1. Problem
Users currently lack the ability to efficiently filter the task board by assigned team members. This hinders quick identification of individual workloads, progress, and relevant tasks, leading to slower navigation and analysis of board contents.

### 1.2. Goal
Enable users to quickly filter the task board by assigned team member(s) through an intuitive, interactive avatar-based filter interface, thereby improving task visibility and board navigation efficiency.

## 2. Target Users / ICP Roles

*   **Project Managers / Team Leads:** To monitor individual team member workloads and progress at a glance.
*   **Individual Contributors:** To quickly filter the board to see only their assigned tasks or tasks assigned to specific colleagues they are collaborating with.
*   **Stakeholders:** To gain immediate insight into who is working on what without extensive searching.

## 3. Scope

This feature focuses on adding a new filter mechanism to the existing task board filter bar. It specifically includes the display of team member avatars as clickable filter chips, the associated filtering logic, and visual states.

**Location:** Task board filter bar — adjacent to status & priority dropdowns.

## 4. Functional Requirements

*   **FR.1: Display Avatar Filter Chips:** The system shall display a row of clickable team member avatars within the task board's filter bar.
    *   **FR.1.1:** Avatars should represent all team members assigned tasks visible on the current board view.
    *   **FR.1.2:** Each avatar must include a badge indicating the count of tasks currently assigned to that member.
*   **FR.2: Filter by Single Member:** Upon clicking a single team member avatar, the task board shall dynamically filter to display only tasks assigned to that specific member.
*   **FR.3: Filter by Multiple Members:** The system shall allow users to select multiple team member avatars.
    *   **FR.3.1:** When multiple avatars are selected, the board shall display tasks assigned to *any* of the selected members (OR logic). A clear UI toggle for AND/OR logic is outside this scope but should be considered for future iterations if user feedback indicates a need for AND logic.
*   **FR.4: Visual Filter State:** The UI shall clearly indicate which team member avatars are currently active filters (e.g., highlighted, distinct chip style).
*   **FR.5: Clear/Reset Filter:** A dedicated option (e.g., "All" avatar, "Clear Filters" button) shall be available to reset the team member filter, showing tasks for all team members.
*   **FR.6: Responsiveness:** The avatar filter row shall adapt gracefully to different screen sizes, potentially using horizontal scrolling or collapsing into a dropdown for smaller viewports.
*   **FR.7: Composability:** The team member avatar filter must function correctly and compose with existing filters (e.g., search, status, priority), applying all active filters in conjunction.

## 5. Acceptance Criteria

*   [x] Display team member avatars as clickable filter chips (row or horizontal scroll).
*   [x] Clicking an avatar filters the board to show only tasks assigned to that member.
*   [x] Multiple avatars can be selected (OR logic initially; AND/OR toggle is a future enhancement).
*   [x] Active filter state is visually clear (highlighted avatar, chip style).
*   [x] "All" / clear option to reset the filter.
*   [x] Responsive — works on smaller screens (horizontal scroll or collapse).
*   [x] Avatars should show a count badge of assigned tasks.
*   [x] Works alongside existing search, status, and priority filters (composable).

## 6. Out of Scope

*   **`parentTaskId` Surfacing:** Addressing the problem of `parentTaskId` not being surfaced to make epic groupings visible is a separate feature for board hierarchy and grouping, and is not covered by this PRD.
*   **New Filter Types:** Any filter types beyond team member assignment (e.g., "unassigned tasks," "tasks I'm following").
*   **Avatar Management:** Functionality for adding, editing, or deleting team member avatars or managing their association with user profiles. This assumes avatar data is provided by an existing user management system.
*   **Complex Filtering Logic:** Advanced conditional filtering (e.g., "show tasks assigned to A AND (B OR C)").
*   **Saved Filters:** Persisting selected team member filters across sessions or as part of custom saved board views.
*   **Filter Sharing:** Functionality to share specific filtered board views with other users.
```

---

### Update — Bob Developer (V2 (Container)) · 2026-06-15T01:07:59.599Z · execution #67

You need to fix the errrors:

Annotations
4 errors and 8 warnings
Frontend (Node.js 20)
failed 26 minutes ago in 1m 58s
Search logs
1s
3s
1s
14s
43s
3s
32s
16s
Run pnpm test

> builderforce-frontend@2026.05.31 test /home/runner/work/Builderforce.ai/Builderforce.ai/frontend
> vitest run


 RUN  v4.1.5 /home/runner/work/Builderforce.ai/Builderforce.ai/frontend

 ✓ src/lib/api.test.ts (34 tests) 39ms
 ✓ src/lib/brain/platformActions.test.ts (23 tests) 87ms
 ✓ src/lib/utils.test.ts (31 tests) 21ms
Not implemented: navigation to another Document
 ✓ src/lib/auth.test.ts (13 tests) 34ms
 ✓ src/components/agent/AgentExecutionPanel.test.tsx (8 tests) 960ms
     ✓ does not show a re-run action on a running execution  468ms
 ✓ src/lib/model-provider.test.ts (19 tests) 93ms
 ✓ src/lib/browserRuntime/coding.test.ts (11 tests) 15ms
 ✓ src/lib/browserRuntime/runner.test.ts (11 tests) 18ms
 ✓ src/app/agent-worker/page.test.tsx (4 tests) 138ms
 ✓ src/components/workforce/AgentManifestSection.test.tsx (6 tests) 293ms
 ✓ src/components/brain/FloatingBrain.test.tsx (5 tests) 224ms
 ✓ src/lib/browserRuntime/gitClient.test.ts (5 tests) 16ms
 ✓ src/lib/browserRuntime/transport.test.ts (5 tests) 12ms
TypeError: Cannot read properties of undefined (reading 'length')
    at TeamMemberAvatarFilter (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/src/components/board/TeamMemberAvatarFilter.tsx:117:36)
    at renderWithHooks (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:15486:18)
    at mountIndeterminateComponent (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:20103:13)
    at beginWork (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:21626:16)
    at HTMLUnknownElement.callCallback (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:4164:14)
    at HTMLUnknownElement.callTheUserObjectsOperation (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/jsdom@28.1.0/node_modules/jsdom/lib/generated/idl/EventListener.js:26:30)
    at innerInvokeEventListeners (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/jsdom@28.1.0/node_modules/jsdom/lib/jsdom/living/events/EventTarget-impl.js:360:16)
    at invokeEventListeners (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/jsdom@28.1.0/node_modules/jsdom/lib/jsdom/living/events/EventTarget-impl.js:296:3)
    at HTMLUnknownElementImpl._dispatch (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/jsdom@28.1.0/node_modules/jsdom/lib/jsdom/living/events/EventTarget-impl.js:243:9)
    at HTMLUnknownElementImpl.dispatchEvent (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/jsdom@28.1.0/node_modules/jsdom/lib/jsdom/living/events/EventTarget-impl.js:114:17)
TypeError: Cannot read properties of undefined (reading 'length')
    at TeamMemberAvatarFilter (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/src/components/board/TeamMemberAvatarFilter.tsx:117:36)
    at renderWithHooks (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:15486:18)
    at mountIndeterminateComponent (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:20103:13)
    at beginWork (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:21626:16)
    at HTMLUnknownElement.callCallback (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:4164:14)
    at HTMLUnknownElement.callTheUserObjectsOperation (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/jsdom@28.1.0/node_modules/jsdom/lib/generated/idl/EventListener.js:26:30)
    at innerInvokeEventListeners (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/jsdom@28.1.0/node_modules/jsdom/lib/jsdom/living/events/EventTarget-impl.js:360:16)
    at invokeEventListeners (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/jsdom@28.1.0/node_modules/jsdom/lib/jsdom/living/events/EventTarget-impl.js:296:3)
    at HTMLUnknownElementImpl._dispatch (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/jsdom@28.1.0/node_modules/jsdom/lib/jsdom/living/events/EventTarget-impl.js:243:9)
    at HTMLUnknownElementImpl.dispatchEvent (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/jsdom@28.1.0/node_modules/jsdom/lib/jsdom/living/events/EventTarget-impl.js:114:17)
stderr | src/components/TaskMgmtContent.live.test.tsx > TaskMgmtContent live run chips > resolves cloud agents by name, shows agent history, and flags the queued run pending
The above error occurred in the <TeamMemberAvatarFilter> component:

    at TeamMemberAvatarFilter (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/src/components/board/TeamMemberAvatarFilter.tsx:20:35)
    at div
    at div
    at TaskMgmtContent (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/src/components/TaskMgmtContent.tsx:152:28)

Consider adding an error boundary to your tree to customize error handling behavior.
Visit https://reactjs.org/link/error-boundaries to learn more about error boundaries.

 ❯ src/components/TaskMgmtContent.live.test.tsx (1 test | 1 failed) 170ms
     × resolves cloud agents by name, shows agent history, and flags the queued run pending 166ms
TypeError: Cannot read properties of undefined (reading 'length')
    at TeamMemberAvatarFilter (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/src/components/board/TeamMemberAvatarFilter.tsx:117:36)
    at renderWithHooks (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:15486:18)
    at mountIndeterminateComponent (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:20103:13)
    at beginWork (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:21626:16)
    at HTMLUnknownElement.callCallback (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:4164:14)
    at HTMLUnknownElement.callTheUserObjectsOperation (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/jsdom@28.1.0/node_modules/jsdom/lib/generated/idl/EventListener.js:26:30)
    at innerInvokeEventListeners (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/jsdom@28.1.0/node_modules/jsdom/lib/jsdom/living/events/EventTarget-impl.js:360:16)
    at invokeEventListeners (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/jsdom@28.1.0/node_modules/jsdom/lib/jsdom/living/events/EventTarget-impl.js:296:3)
    at HTMLUnknownElementImpl._dispatch (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/jsdom@28.1.0/node_modules/jsdom/lib/jsdom/living/events/EventTarget-impl.js:243:9)
    at HTMLUnknownElementImpl.dispatchEvent (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/jsdom@28.1.0/node_modules/jsdom/lib/jsdom/living/events/EventTarget-impl.js:114:17)
stderr | src/components/TaskMgmtContent.test.tsx > TaskMgmtContent > renders backlog column in board view
The above error occurred in the <TeamMemberAvatarFilter> component:

    at TeamMemberAvatarFilter (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/src/components/board/TeamMemberAvatarFilter.tsx:20:35)
    at div
    at div
    at TaskMgmtContent (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/src/components/TaskMgmtContent.tsx:152:28)

Consider adding an error boundary to your tree to customize error handling behavior.
Visit https://reactjs.org/link/error-boundaries to learn more about error boundaries.

stderr | src/components/TaskMgmtContent.test.tsx > TaskMgmtContent > shows checkboxes and allows bulk status in list view
The above error occurred in the <TeamMemberAvatarFilter> component:

    at TeamMemberAvatarFilter (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/src/components/board/TeamMemberAvatarFilter.tsx:20:35)
    at div
    at div
    at TaskMgmtContent (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/src/components/TaskMgmtContent.tsx:152:28)

Consider adding an error boundary to your tree to customize error handling behavior.
Visit https://reactjs.org/link/error-boundaries to learn more about error boundaries.

TypeError: Cannot read properties of undefined (reading 'length')
    at TeamMemberAvatarFilter (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/src/components/board/TeamMemberAvatarFilter.tsx:117:36)
    at renderWithHooks (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:15486:18)
    at mountIndeterminateComponent (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:20103:13)
    at beginWork (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:21626:16)
    at HTMLUnknownElement.callCallback (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:4164:14)
    at HTMLUnknownElement.callTheUserObjectsOperation (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/jsdom@28.1.0/node_modules/jsdom/lib/generated/idl/EventListener.js:26:30)
    at innerInvokeEventListeners (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/jsdom@28.1.0/node_modules/jsdom/lib/jsdom/living/events/EventTarget-impl.js:360:16)
    at invokeEventListeners (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/jsdom@28.1.0/node_modules/jsdom/lib/jsdom/living/events/EventTarget-impl.js:296:3)
    at HTMLUnknownElementImpl._dispatch (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/jsdom@28.1.0/node_modules/jsdom/lib/jsdom/living/events/EventTarget-impl.js:243:9)
    at HTMLUnknownElementImpl.dispatchEvent (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/jsdom@28.1.0/node_modules/jsdom/lib/jsdom/living/events/EventTarget-impl.js:114:17)
TypeError: Cannot read properties of undefined (reading 'length')
    at TeamMemberAvatarFilter (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/src/components/board/TeamMemberAvatarFilter.tsx:117:36)
    at renderWithHooks (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:15486:18)
    at mountIndeterminateComponent (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:20103:13)
    at beginWork (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:21626:16)
    at HTMLUnknownElement.callCallback (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:4164:14)
    at HTMLUnknownElement.callTheUserObjectsOperation (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/jsdom@28.1.0/node_modules/jsdom/lib/generated/idl/EventListener.js:26:30)
    at innerInvokeEventListeners (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/jsdom@28.1.0/node_modules/jsdom/lib/jsdom/living/events/EventTarget-impl.js:360:16)
    at invokeEventListeners (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/jsdom@28.1.0/node_modules/jsdom/lib/jsdom/living/events/EventTarget-impl.js:296:3)
    at HTMLUnknownElementImpl._dispatch (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/jsdom@28.1.0/node_modules/jsdom/lib/jsdom/living/events/EventTarget-impl.js:243:9)
    at HTMLUnknownElementImpl.dispatchEvent (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/jsdom@28.1.0/node_modules/jsdom/lib/jsdom/living/events/EventTarget-impl.js:114:17)
TypeError: Cannot read properties of undefined (reading 'length')
    at TeamMemberAvatarFilter (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/src/components/board/TeamMemberAvatarFilter.tsx:117:36)
    at renderWithHooks (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:15486:18)
    at mountIndeterminateComponent (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:20103:13)
    at beginWork (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:21626:16)
    at HTMLUnknownElement.callCallback (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:4164:14)
    at HTMLUnknownElement.callTheUserObjectsOperation (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/jsdom@28.1.0/node_modules/jsdom/lib/generated/idl/EventListener.js:26:30)
    at innerInvokeEventListeners (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/jsdom@28.1.0/node_modules/jsdom/lib/jsdom/living/events/EventTarget-impl.js:360:16)
    at invokeEventListeners (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/jsdom@28.1.0/node_modules/jsdom/lib/jsdom/living/events/EventTarget-impl.js:296:3)
    at HTMLUnknownElementImpl._dispatch (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/jsdom@28.1.0/node_modules/jsdom/lib/jsdom/living/events/EventTarget-impl.js:243:9)
    at HTMLUnknownElementImpl.dispatchEvent (/home/runner/work/Builderforce.ai/Builderforce.ai/frontend/node_modules/.pnpm/jsdom@28.1.0/node_modules/jsdom/lib/jsdom/living/events/EventTarget-impl.js:114:17)
 ❯ src/components/TaskMgmtContent.test.tsx (2 tests | 2 failed) 221ms
     × renders backlog column in board view 148ms
     × shows checkboxes and allows bulk status in list view 63ms
 ✓ src/components/ProjectDetailsPanel.test.tsx (1 test) 264ms
 ✓ src/lib/blogData.test.ts (9 tests) 9ms
 ✓ src/lib/coiHeadersParity.test.ts (3 tests) 4ms
 ✓ src/components/AgentCapabilitiesContent.test.tsx (1 test) 618ms
     ✓ lists project agents and switches capability scope from project to agent  611ms
 ✓ src/lib/repoDiagnostic.test.ts (6 tests) 6ms
 ✓ src/components/ProjectCard.test.tsx (2 tests) 168ms
 ✓ src/lib/browserRuntime/webcontainer.test.ts (3 tests) 11ms
 ✓ src/lib/repoIdentifier.test.ts (8 tests) 10ms
 ✓ src/components/ConditionalAppShell.test.ts (5 tests) 7ms
 ✓ src/lib/unifiedDiff.test.ts (5 tests) 8ms
 ✓ src/lib/fileContentGuard.test.ts (5 tests) 7ms
 ✓ src/lib/structured-data.test.ts (2 tests) 7ms
 ✓ src/lib/modality.test.ts (5 tests) 8ms
 ✓ src/components/MobileBottomNav.test.ts (5 tests) 6ms
 ✓ src/lib/embed/embedTrust.test.ts (4 tests) 4ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/components/TaskMgmtContent.live.test.tsx > TaskMgmtContent live run chips > resolves cloud agents by name, shows agent history, and flags the queued run pending
 FAIL  src/components/TaskMgmtContent.test.tsx > TaskMgmtContent > renders backlog column in board view
 FAIL  src/components/TaskMgmtContent.test.tsx > TaskMgmtContent > shows checkboxes and allows bulk status in list view
TypeError: Cannot read properties of undefined (reading 'length')
 ❯ TeamMemberAvatarFilter src/components/board/TeamMemberAvatarFilter.tsx:117:36
    115|   }, [tasks, members, agentHosts, cloudAgents]);
    116|
    117|   const allSelected = selectedKeys.length === 0;
       |                                    ^
    118|   const hasSelection = selectedKeys.length > 0;
    119|
 ❯ renderWithHooks node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:15486:18
 ❯ mountIndeterminateComponent node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:20103:13
 ❯ beginWork node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:21626:16
 ❯ beginWork$1 node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:27465:14
 ❯ performUnitOfWork node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:26599:12
 ❯ workLoopSync node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:26505:5
 ❯ renderRootSync node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:26473:7
 ❯ recoverFromConcurrentError node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:25889:20
 ❯ performConcurrentWorkOnRoot node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:25789:22

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/3]⎯


 Test Files  2 failed | 28 passed (30)
      Tests  3 failed | 239 passed (242)
   Start at  00:41:10
   Duration  15.03s (transform 2.33s, setup 2.50s, import 7.93s, tests 3.48s, environment 24.14s)


Error: TypeError: Cannot read properties of undefined (reading 'length')
 ❯ TeamMemberAvatarFilter src/components/board/TeamMemberAvatarFilter.tsx:117:36
 ❯ renderWithHooks node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:15486:18
 ❯ mountIndeterminateComponent node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:20103:13
 ❯ beginWork node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:21626:16
 ❯ beginWork$1 node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:27465:14
 ❯ performUnitOfWork node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:26599:12
 ❯ workLoopSync node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:26505:5
 ❯ renderRootSync node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:26473:7
 ❯ recoverFromConcurrentError node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:25889:20
 ❯ performConcurrentWorkOnRoot node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:25789:22



Error: TypeError: Cannot read properties of undefined (reading 'length')
 ❯ TeamMemberAvatarFilter src/components/board/TeamMemberAvatarFilter.tsx:117:36
 ❯ renderWithHooks node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:15486:18
 ❯ mountIndeterminateComponent node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:20103:13
 ❯ beginWork node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:21626:16
 ❯ beginWork$1 node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:27465:14
 ❯ performUnitOfWork node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:26599:12
 ❯ workLoopSync node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:26505:5
 ❯ renderRootSync node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:26473:7
 ❯ recoverFromConcurrentError node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:25889:20
 ❯ performConcurrentWorkOnRoot node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:25789:22



Error: TypeError: Cannot read properties of undefined (reading 'length')
 ❯ TeamMemberAvatarFilter src/components/board/TeamMemberAvatarFilter.tsx:117:36
 ❯ renderWithHooks node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:15486:18
 ❯ mountIndeterminateComponent node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:20103:13
 ❯ beginWork node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:21626:16
 ❯ beginWork$1 node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:27465:14
 ❯ performUnitOfWork node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:26599:12
 ❯ workLoopSync node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:26505:5
 ❯ renderRootSync node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:26473:7
 ❯ recoverFromConcurrentError node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:25889:20
 ❯ performConcurrentWorkOnRoot node_modules/.pnpm/react-dom@18.3.1_react@18.3.1/node_modules/react-dom/cjs/react-dom.development.js:25789:22


 ELIFECYCLE  Test failed. See above for more details.
Error: Process completed with exit code 1.

---

### Update — Bob Developer (V2 (Container)) · 2026-06-15T01:40:33.179Z · execution #68

you should update the ticktes acceptance criteria as you copmlete all the functiaonlity as well. And update the readme. Update the PRD.