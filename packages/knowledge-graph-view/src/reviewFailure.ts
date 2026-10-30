/**
 * What a source throws from `review()` when the run failed in the host. The `message` is
 * the person-facing reason; the rest is diagnostic detail a host MAY attach so a failed
 * review can be reported (the view's *Copy details*): the stack, where it ran, which build.
 * Any other thrown value still works — it just carries no detail.
 */

export interface ReviewFailureDetail {
    /** The host's stack / full error text. */
    detail?: string;
    /** Which host and build ran it (`BuilderForce for VS Code 1.2.3`). */
    host?: string;
    /** The folder it was reviewing, as the host knows it. */
    rootPath?: string;
}

export class ReviewFailure extends Error implements ReviewFailureDetail {
    readonly detail?: string;
    readonly host?: string;
    readonly rootPath?: string;

    constructor(message: string, info: ReviewFailureDetail = {}) {
        super(message);
        this.name = 'ReviewFailure';
        if (info.detail) this.detail = info.detail;
        if (info.host) this.host = info.host;
        if (info.rootPath) this.rootPath = info.rootPath;
    }
}

/** The detail a thrown value carries: a {@link ReviewFailure}'s, else the error's own stack. */
export function failureDetailOf(err: unknown): ReviewFailureDetail {
    if (err instanceof ReviewFailure) {
        return {
            ...(err.detail ? { detail: err.detail } : {}),
            ...(err.host ? { host: err.host } : {}),
            ...(err.rootPath ? { rootPath: err.rootPath } : {}),
        };
    }
    return err instanceof Error && err.stack ? { detail: err.stack } : {};
}
