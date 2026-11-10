/**
 * The run-findings detectors, one row each (PRD 46 §3.1). Adding a detector is one file and one row here.
 */
import { analysisOverrun } from './detectors/analysisOverrun';
import { bracketBreak } from './detectors/bracketBreak';
import { editChurn } from './detectors/editChurn';
import { filedThenInline } from './detectors/filedThenInline';
import { oversizedArgs } from './detectors/oversizedArgs';
import { promptBloat } from './detectors/promptBloat';
import { repeatedNarration } from './detectors/repeatedNarration';
import { sameModelRoles } from './detectors/sameModelRoles';
import { serialSingleWrites } from './detectors/serialSingleWrites';
import { slowTurns } from './detectors/slowTurns';
import { stoppedUnverified } from './detectors/stoppedUnverified';
import { unkeptReadiness } from './detectors/unkeptReadiness';
import { unverifiedWrites } from './detectors/unverifiedWrites';
import type { RunFindingDetector, RunFindingKind } from './types';

export const RUN_FINDING_REGISTRY: ReadonlyArray<{ kind: RunFindingKind; detect: RunFindingDetector }> = [
  { kind: 'analysis_overrun', detect: analysisOverrun },
  { kind: 'unkept_readiness', detect: unkeptReadiness },
  { kind: 'serial_single_writes', detect: serialSingleWrites },
  { kind: 'prompt_bloat', detect: promptBloat },
  { kind: 'unverified_writes', detect: unverifiedWrites },
  { kind: 'bracket_break', detect: bracketBreak },
  { kind: 'edit_churn', detect: editChurn },
  { kind: 'filed_then_inline', detect: filedThenInline },
  { kind: 'same_model_roles', detect: sameModelRoles },
  { kind: 'oversized_args', detect: oversizedArgs },
  { kind: 'slow_turns', detect: slowTurns },
  { kind: 'repeated_narration', detect: repeatedNarration },
  { kind: 'stopped_unverified', detect: stoppedUnverified },
];
