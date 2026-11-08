/**
 * The actor a run refused by admission is cancelled as. One constant so the writer (`dispatchAdmission.settleRefusedRun`)
 * and the readers that must treat such a run differently (`RuntimeService.cancel` posts no chat milestone for it) cannot
 * drift: a refused run never started, so there is nothing to narrate, and the auto-run circuit breaker never counts it.
 */
export const ADMISSION_CANCEL_ACTOR = 'system:admission';
