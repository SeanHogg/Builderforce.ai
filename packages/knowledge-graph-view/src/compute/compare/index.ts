/** Compare's pure engine (PRD 43 Part C5/C6): the diff, the union graph and the restructure proposals. */

export { diffGraphs, diffKindOf, type DiffKind, type GraphDiff } from './diffGraphs';
export { movedMarks, movedModules, movedSpans, type MovedSpan } from './movedMarks';
// A restructure's marks are read from `Proposal.spans`, made with the symbols the proposer held.
export { isRestructurable, needsSymbols, PROPOSERS, proposeRestructure, type Proposal, type Proposer } from './restructure';
export { applySideMask, type MaskMarks } from './sideMask';
export { absentOn, unionGraph, type UnionGraph } from './unionGraph';
