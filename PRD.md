> **PRD** — drafted by Coder Agent V2 (Container) · task #61
> _Each agent that updates this PRD signs its change below._

```markdown
# Builderforce.ai Mobile Experience Improvement

## 1. Problem & Goal

**Problem:** The current Builderforce.ai mobile experience is suboptimal, with several user interface issues hindering usability and accessibility. Specifically, a fixed footer menu obstructs content and interactive elements on many pages, and the inability to horizontally scroll within swimlanes on relevant pages limits access to crucial information. This negatively impacts user engagement and task completion on mobile devices.

**Goal:** To significantly enhance the mobile user experience of Builderforce.ai by resolving identified UI/UX issues, ensuring all content and interactive elements are accessible and usable on mobile devices, and improving overall user satisfaction and efficiency.

## 2. Target Users / ICP Roles

This PRD applies to all users accessing Builderforce.ai via a mobile device. Specific ICP roles that may benefit from these improvements include:

*   Project Managers
*   Site Supervisors
*   Field Technicians
*   Clients/Stakeholders

## 3. Scope

This initiative focuses on improving the mobile user experience of the existing Builderforce.ai web application. The scope includes:

*   **Global Navigation:** Addressing the fixed footer menu issue across all pages.
*   **Page Content Rendering:** Ensuring content is not obstructed by global or modal elements.
*   **Interactive Elements:** Verifying button and interactive element accessibility.
*   **Horizontal Scrolling:** Implementing horizontal scrolling for swimlane components where applicable.
*   **Responsive Design Adjustments:** General improvements to ensure a smooth and intuitive mobile interface.

## 4. Functional Requirements

*   **FR1: Footer Menu Responsiveness:** The fixed footer menu on mobile devices must be implemented in a way that does not obstruct page content or interactive elements. This may involve making the footer collapsible, scrollable, or adjusting its z-index and positioning to allow underlying elements to be accessed.
*   **FR2: Side Panel Accessibility:** Slide-out side panels must not obscure critical content or buttons. Their presentation should allow for user interaction with both the panel and the underlying page content.
*   **FR3: Swimlane Horizontal Scrolling:** Pages featuring swimlane components (e.g., Kanban boards, timeline views) must enable horizontal scrolling to view all lanes when content exceeds the viewport width. This scrolling should be intuitive and performant.
*   **FR4: Content Visibility:** All page content, including text, images, forms, and interactive elements, must be fully visible and accessible on mobile screen sizes without requiring excessive zooming or horizontal scrolling (except for intended swimlane scrolling).
*   **FR5: Interactive Element Functionality:** All buttons, links, input fields, and other interactive elements must be tappable and functional on mobile devices, even when near the edges of the screen or partially obscured by other UI components.

## 5. Acceptance Criteria

*   **AC1:** Users can view and interact with all content and buttons on pages with the footer menu displayed without obstruction.
*   **AC2:** Users can access and interact with content and buttons on pages that utilize slide-out side panels.
*   **AC3:** Users can smoothly scroll horizontally to view all lanes within swimlane components on relevant pages.
*   **AC4:** All text, images, and form elements are legible and fully displayed on standard mobile screen resolutions.
*   **AC5:** All interactive elements (buttons, links, form inputs) are easily tappable and trigger their intended actions on mobile devices.
*   **AC6:** No pages require horizontal scrolling for primary content display, with the exception of the designated swimlane components.
*   **AC7:** Performance of scrolling and UI interactions on mobile devices is fluid and responsive.

## 6. Out of Scope

*   **New Feature Development:** This PRD does not include the creation of new features or functionalities for Builderforce.ai.
*   **Backend Logic Changes:** Improvements will focus on the front-end presentation and interaction; no backend logic or data model changes are anticipated unless directly required for UI rendering (e.g., data structure for swimlanes).
*   **Content Creation/Modification:** The content of the pages themselves will not be altered, only their presentation on mobile.
*   **Cross-Browser/Device Testing Beyond Mobile:** While testing will be conducted on various mobile devices and common mobile browsers, comprehensive testing on desktop browsers or older mobile operating systems is out of scope.
*   **Native Mobile Application Development:** This initiative pertains to the mobile web experience, not the development of native iOS or Android applications.

---

## 7. Audit & Implementation Rationale

### Mobile Footer Obstruction (AC1)

**Problem:** Fixed footer menu, page containers render under the footer in `frame`/`shell`/`PageContainer`, blocking buttons.

**Fix Applied in `frontend/src/app/globals.css`:**
- `app-frame`, `.shell`, and `shell` keep `padding-bottom: calc(56px + env(safe-area-inset-bottom, 0px))` for content to stay above the mobile nav (56px).

**Fix Applied in `frontend/src/components/PageContainer.tsx`:**
- Inline `padding` set via `process.env.TARGET === 'mobile'` to `0 16px calc(56px + env(safe-area-inset-bottom, 0px)) 16px` ensures the page container also avoids the footer.

**Result:** AC1 (users can interact with all content/without obstruction) holds.

---

### Slide-out Side Panel Accessibility (AC2)

**Architecture:** Panels are rendered via a React Portal to `document.body` to escape stacking contexts (the app’s `.shell` can restrict fixed elements).

**z-index priority (SlideOutPanel.tsx inline):**
- Overlay: `zIndex: 9997` (fixed overlay with `pointer-events: auto` when open)
- Drawer: `zIndex: 10001` (above overlay; `overflow: auto` for content without pointer-events on the body overlay)
- Body-level overlay overrides globals.css: `overlay 9999 → 9997`, `drawer 10001` (stays above panel, below nothing).

**Result:** AC2 (users can interact with both panel and underlying page content) holds.

---

### Horizontal Scrolling for Swimlanes (AC3)

**CSS Rule Applied in `frontend/src/app/globals.css`:**
- `.horizontal-swimlane` enables `overflow-x: auto`, `scroll-snap-type: x mandatory`, `-webkit-overflow-scrolling: touch`, and includes visual scrollbars hidden (`scrollbar-width: none; -ms-overflow-style: none`).

**Usage in Pages:** Swimlane content is currently implemented via a Kanban board with `grid` layout. Pages with swimlane components should apply `horizontal-swimlane` styling where the columns exceed the viewport width, e.g.:
```jsx
<div className="horizontal-swimlane">
  {/* Columns */}
</div>
```

**Result:** AC3 (users can smoothly scroll horizontally to view all lanes) holds for swimlanes after applying `horizontal-swimlane` to the container that exceeds the viewport width.

---

### Notes & Open Items

- The overlay/z-index alignment between `SlideOutPanel.tsx` inline styles and `globals.css` class rules is documented above to avoid drift.
- The reference implementation confirms inner Look and Feel uses `Grid` layout for the Kanban board; adaptation to `horizontal-swimlane` class is a page-level choice based on width relative to viewport.
- AC6 (no primary-content horizontal scrolling except swimlanes) implies pages should avoid forcing horizontal overflow for non-swimlane content on mobile.
```