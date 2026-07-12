> **PRD** — drafted by Ada (Sr. Product Mgr) · task #391
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Auto-Title Consolidated Chats

## 1. Problem & Goal

### 1.1 Problem
Currently, after multiple chat sessions are consolidated into a single thread, the resulting consolidated chat lacks a clear, descriptive title. This makes it challenging for users to quickly identify, recall, and navigate to specific consolidated conversations, leading to a poor user experience and reduced efficiency.

### 1.2 Goal
Automatically generate and assign a meaningful, concise title to each newly consolidated chat. This will enhance user experience by improving chat discoverability, organization, and overall navigation, allowing users to quickly understand the context of a consolidated thread.

## 2. Target Users / ICP Roles

*   **End-Users:** Individuals who interact with and rely on the chat application for their daily communication and information retrieval. They need easily identifiable conversations.
*   **Support/Admin Staff:** Internal teams who might need to quickly locate and reference specific consolidated chats based on their content.

## 3. Scope

This PRD covers the design and implementation of an automated process to generate and persist a title for *newly consolidated* chat threads. The generated title will be derived from the content of the consolidated messages and will be stored using the `brain.update` mechanism.

## 4. Functional Requirements

*   **FR1: Identify Consolidated Chats:** The system MUST detect when a chat consolidation event has successfully occurred and a new consolidated chat thread is created.
*   **FR2: Content Analysis:** The system MUST analyze the textual content of the newly consolidated chat thread to extract key themes, topics, and entities.
*   **FR3: Title Generation:** The system MUST generate a concise and descriptive title (e.g., 5-10 words) that accurately reflects the primary subject matter of the consolidated chat.
*   **FR4: Title Persistence (`brain.update`):** The generated title MUST be persisted to the consolidated chat object using the `brain.update` function.
*   **FR5: UI Display:** The generated title MUST be displayed prominently in the user interface wherever chat titles are typically shown (e.g., chat list, chat header).
*   **FR6: Performance:** The title generation process MUST not introduce significant latency or negatively impact the performance of the chat consolidation workflow or overall application responsiveness.

## 5. Acceptance Criteria

*   **AC1: Title Presence:** For every newly consolidated chat, a meaningful title is present and visible in the UI within 5 seconds of the consolidation event completing.
*   **AC2: Title Relevance:** At least 90% of generated titles accurately summarize the core topic(s) of the consolidated chat, as determined by manual review samples.
*   **AC3: Title Conciseness:** The average length of generated titles is between 5 and 10 words, with a hard maximum of 15 words.
*   **AC4: `brain.update` Usage:** Successful calls to `brain.update` with the new title are logged for every consolidated chat.
*   **AC5: UI Consistency:** The new title is displayed consistently across all relevant UI components (e.g., chat list, chat view header) without requiring a manual page refresh.
*   **AC6: Performance Impact:** The end-to-end consolidation and title generation process does not add more than 1 second of additional latency compared to consolidation without title generation.

## 6. Out of Scope

*   **Manual Title Editing:** Users will not be able to manually edit or override the automatically generated titles in this iteration.
*   **Re-titling Existing Chats:** This feature focuses only on *newly* consolidated chats; previously consolidated chats that lack titles will not be retroactively titled.
*   **Multi-language Titles:** Initial scope is for the primary language of the application; multi-language title generation is out of scope.
*   **Advanced AI/ML Models:** While content analysis is required, the initial solution will prioritize simpler, rule-based or statistical methods for title generation over complex, resource-intensive AI models.
*   **User Feedback Loop:** There will be no explicit user feedback mechanism for title quality in this phase.