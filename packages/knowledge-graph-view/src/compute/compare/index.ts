/** Compare's pure engine (PRD 43 Part C5/C6): the diff, the union graph and the restructure proposals. */

export { diffGraphs, diffKindOf, type DiffKind, type GraphDiff } from './diffGraphs';
export { isRestructurable, needsSymbols, PROPOSERS, proposeRestructure, type Proposal, type Proposer } from './restructure';
export { applySideMask, type MaskMarks } from './sideMask';
export { absentOn, unionGraph, type UnionGraph } from './unionGraph';
