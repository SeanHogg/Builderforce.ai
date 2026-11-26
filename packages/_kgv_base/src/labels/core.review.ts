/** The review run's words (its cost, progress, phases and outcome): part of `CoreLabels` (`core.ts`). */

export interface ReviewRunLabels {
    reviewPlanCost: string;
    /** Shown in the confirm chip while the host cannot price the judgement pass. */
    reviewPlanCostPending: string;
    /** Shown in the confirm chip when the judgement pass runs on the person's own local model. */
    reviewPlanCostLocal: string;
    reviewPlanning: string;
    reviewStop: string;
    /** Shown from Stop until the host settles. */
    reviewCancelled: string;
    reviewDoneTitle: string;
    reviewDoneBody: string;
    reviewContinue: string;
    reviewAborted: string;
    reviewFailed: string;
    /** The failure's own reason, under the sentence. `{message}`. */
    reviewFailedReason: string;
    /** Copies the failure's diagnostics (phase, message, detail, host, time) as plain text. */
    reviewCopyDetails: string;
    reviewProgress: string;
    phases: Record<'plan' | 'extract' | 'resolve' | 'mapped' | 'judge' | 'compare' | 'write' | 'analyse' | 'index' | 'done', string>;
}

export const REVIEW_RUN_DEFAULTS: ReviewRunLabels = {
reviewPlanCost: '≈ {cost}',
reviewPlanCostPending: 'Cost is shown after routing.',
reviewPlanCostLocal: 'Runs on your local model — no cost.',
reviewPlanning: 'Walking the folder…',
reviewStop: 'Stop',
reviewCancelled: 'Review cancelled. Nothing was written.',
reviewDoneTitle: 'Review finished',
reviewDoneBody: '{extracted} files read · {judged} sections judged · {facts} facts written',
reviewContinue: 'Continue',
reviewAborted: 'Review stopped. What was written stays.',
reviewFailed: 'The review failed. Nothing more was written.',
reviewFailedReason: 'Reason: {message}',
reviewCopyDetails: 'Copy details',
reviewProgress: '{phase} · {done} of {total}',
phases: {
    plan: 'Planning', extract: 'Reading', resolve: 'Resolving', mapped: 'Map complete', judge: 'Judging', compare: 'Comparing', write: 'Writing', analyse: 'Mapping the code', index: 'Indexing', done: 'Done',
},
};
