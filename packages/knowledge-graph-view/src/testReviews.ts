/**
 * Test helper (not shipped): the review action's button (`surface/ReviewAction.tsx`, at the right end of the ask-bar row) is the one way into the Reviews panel, where a review is started. Like `openList`, it takes
 * testing-library injected so this module imports none.
 */

export interface ReviewsDeps {
    screen: {
        findByTestId(id: string): Promise<HTMLElement>;
        findByRole(role: 'button', options: { name: string }): Promise<HTMLElement>;
    };
    fireEvent: { click(element: Element): unknown };
}


/**
 * Presses the review action's button: it opens the Reviews panel and counts NOTHING (planning walks and hashes every file,
 * which the person did not ask for by opening the panel — RunPanel.tsx). The panel shows the idle body until Start review.
 */
export async function openReviews({ screen, fireEvent }: ReviewsDeps): Promise<void> {
    fireEvent.click(await screen.findByTestId('kg-review-action'));
}

/** Opens the panel and presses Start review: with nothing planned, the footer's one press counts the files and starts. */
export async function startReviewing(deps: ReviewsDeps): Promise<void> {
    await openReviews(deps);
    await deps.screen.findByTestId('kg-review-idle'); // nothing planned yet
    deps.fireEvent.click(await deps.screen.findByTestId('kg-footer-action'));
}

/** The pinned footer's button, whatever it says now. */
export const footerAction = (deps: Pick<ReviewsDeps, 'screen'>): Promise<HTMLElement> => deps.screen.findByTestId('kg-footer-action');
