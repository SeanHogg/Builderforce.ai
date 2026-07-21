> **PRD** — drafted by Ada (Sr. Product Mgr) · task #402
> _Each agent that updates this PRD signs its change below._

## Product Requirements Document: Chat Titling

### Problem
Users frequently struggle to identify, recall, and manage individual chat conversations due to the absence of descriptive titles. This leads to a disorganized user experience, reduced efficiency, and difficulty in retrieving past interactions. Unnamed chats clutter the interface, making navigation cumbersome.

### Goal
Implement a robust system that ensures every surviving chat conversation is automatically assigned, or can be manually given, a descriptive and meaningful title. This will significantly enhance chat organization, searchability, and overall user experience.

### Target Users / ICP Roles
*   **All Platform Users:** Anyone who initiates or participates in chat conversations. This includes, but is not limited to, general users, power users, and enterprise clients.

### Scope
This PRD covers the automatic generation of titles for new chats, the manual editing of titles for any chat, and the consistent display and persistence of these titles across the application.

### Functional Requirements

**FR1: Automatic Title Generation for New Chats**
*   **FR1.1:** When a user initiates a new chat by sending the first message, a descriptive title shall be automatically generated.
*   **FR1.2:** The auto-generated title shall be based on the initial context and content of the conversation.
*   **FR1.3:** The title shall be concise, ideally between 3 and 10 words.
*   **FR1.4:** Title generation shall occur within 5 seconds of the first message being sent.
*   **FR1.5:** In cases where a clear topic cannot be discerned from the initial messages, a sensible default title (e.g., "New Chat – [Date YYYY-MM-DD]") shall be provided.

**FR2: Manual Title Editing**
*   **FR2.1:** Users shall be able to edit the title of any chat (both automatically generated and existing) at any time.
*   **FR2.2:** The title editing interface shall be easily accessible from both the chat list view and the active chat header.
*   **FR2.3:** Title edits shall be saved immediately upon user confirmation (e.g., pressing Enter, clicking outside the input field).
*   **FR2.4:** The title input field shall support a maximum of 100 characters.

**FR3: Title Display**
*   **FR3.1:** The chat title shall be prominently displayed in the chat list view, replacing any previous generic or absent title.
*   **FR3.2:** The chat title shall be prominently displayed in the header of the active chat window.

**FR4: Title Persistence**
*   **FR4.1:** All chat titles, whether automatically generated or manually edited, shall persist across user sessions, device logins, and application restarts.

### Acceptance Criteria

*   A newly initiated chat (after the first message is sent) displays an automatically generated title in both the chat list and chat header.
*   The automatically generated title is contextually relevant to the initial messages.
*   A user can successfully change the title of any chat through the provided editing mechanism.
*   Manual title changes are reflected immediately in both the chat list and the active chat header.
*   Upon refreshing the page, logging out and back in, or switching devices, all chat titles remain as last set (either automatically or manually).
*   No active chat in a user's history displays a blank, "Untitled," or generic date-based title (unless it was explicitly auto-generated due to lack of context as per FR1.5).

### Out of Scope

*   Batch editing of multiple chat titles simultaneously.
*   AI-driven re-titling or dynamic title updates as a conversation evolves (beyond the initial generation).
*   System-level enforcement of title quality beyond the initial automatic generation and user's manual input.
*   Suggesting alternative titles during manual editing.
*   Localized title generation for languages other than the primary supported language (initially).
*   A dedicated bulk migration task to title *all* existing untitled chats from before this feature's release. This PRD focuses on ensuring new chats get titles and providing the mechanism for users to title *any* chat.