/** The fix words of the surface: the interface and its English defaults (a host overrides them per key). */

export interface FixLabels {
    /** The staged fix flow. `{open}`, `{shown}`, `{repo}`, `{branch}`, `{count}`, `{step}`, `{title}`, `{items}`. */
    fix: Record<
        'title' | 'queue' | 'queueTitle' | 'queueAria' | 'sendToAgent' | 'noComposer' | 'undo' | 'undoNoRecord' | 'permNote' | 'previewTitle' | 'previewFromFiles'
        | 'promptTitle' | 'promptNote' | 'checksTitle' | 'checksList' | 'checkNoReport' | 'appliedOn' | 'branchError' | 'branchUnknown'
        | 'requestApply' | 'requestChecks' | 'requestResolve' | 'requestUndo' | 'requestPrompt' | 'requestReview',
        string
    > & {
        queueState: Record<'open' | 'applied' | 'resolved', string>;
        mode: Record<'group' | 'apply' | 'prompt' | 'noCodemod', string>;
        primary: Record<'apply' | 'prompt' | 'checks' | 'resolve' | 'resolved' | 'sent' | 'running', string>;
        check: Record<'types' | 'tests' | 'rescan' | 'review', string>;
        checkStatus: Record<'pending' | 'running' | 'pass' | 'fail' | 'skipped' | 'error' | 'agent', string>;
        beforeAfter: Record<'group' | 'noBaseline', string>;
        errors: Record<'noRoot' | 'noRecord' | 'unknown', string>;
        codemod: Record<'unusedExport' | 'unusedFile' | 'unusedDependency' | 'splitByCommand' | 'extractClone', string>;
    };
}

export const FIX_DEFAULTS: FixLabels = {
    fix: {
        title: 'Fix',
        queue: '{open} open of {shown} shown · {repo} in the repo',
        queueTitle: 'Fix queue',
        queueAria: 'Open {title}',
        queueState: {
            open: 'open',
            applied: 'applied · checking',
            resolved: 'resolved',
        },
        mode: {
            group: 'Fix mode',
            apply: 'Deterministic fix',
            prompt: 'Prompt',
            noCodemod: 'No codemod exists for this kind on this host.',
        },
        primary: {
            apply: 'Apply to branch fix/…',
            prompt: 'Send to the composer',
            checks: 'Run checks',
            resolve: 'Mark resolved',
            resolved: 'Resolved ✓',
            sent: 'Sent to the agent',
            running: 'Running…',
        },
        sendToAgent: 'Send to agent',
        noComposer: 'No agent composer is connected.',
        undo: 'Undo',
        undoNoRecord: 'This host kept no record of the fix, so it cannot undo it.',
        permNote: 'Runs as you on branch fix/…. Undo restores the branch you were on; nothing reaches the main branch until the checks pass and you merge.',
        previewTitle: 'What it changes',
        previewFromFiles: 'This host cannot preview lines; these are the files the finding names.',
        promptTitle: 'Prompt',
        promptNote: 'Goes to the one composer, with this finding and the four checks attached.',
        checksTitle: 'Resolved only when every check passes',
        checksList: 'Checks',
        check: {
            types: 'Typecheck the touched packages',
            tests: 'Targeted tests pass',
            rescan: 'Re-scan: the issue is gone',
            review: 'Review by the agent: no new findings',
        },
        checkStatus: {
            pending: 'Waiting',
            running: 'Running',
            pass: 'Passed',
            fail: 'Failed',
            skipped: 'Skipped',
            error: 'Error',
            agent: 'Sent to agent',
        },
        checkNoReport: 'This check never reported, so it counts as an error.',
        appliedOn: 'Applied on branch {branch}.',
        branchError: 'Applied in place: the branch could not be created ({reason}).',
        branchUnknown: 'the fix branch',
        requestApply: 'Fix this finding on a new branch named fix/…: {title}: {items}. Make the change and do not merge it.',
        requestChecks: 'Typecheck the touched packages and run the targeted tests for the change that fixes "{title}" ({items}) on {branch}, and report each result.',
        requestResolve: 'Mark the finding "{title}" ({items}) as resolved once {branch} passes its checks.',
        requestUndo: 'Undo the fix for "{title}" ({items}): revert the changes on {branch}.',
        requestPrompt: 'Fix this finding: {title}: {items}. Make the change on a new branch named fix/…, typecheck the touched packages, run the targeted tests, re-scan to confirm the finding is gone, and review the change for new findings. Report each result. Do not merge.',
        requestReview: 'Review the change that fixes "{title}" ({items}) on {branch} and report any new finding it introduces.',
        beforeAfter: {
            group: 'Before and after',
            noBaseline: 'This host keeps no earlier review to compare with.',
        },
        errors: {
            noRoot: 'This finding names no folder of the workspace.',
            noRecord: 'Nothing to undo: the host kept no record of this fix.',
            unknown: 'The step failed.',
        },
        codemod: {
            unusedExport: 'Remove unused exports',
            unusedFile: 'Remove unused files',
            unusedDependency: 'Remove unused dependencies',
            splitByCommand: 'Split by command group',
            extractClone: 'Extract the shared code',
        },
    },
};
