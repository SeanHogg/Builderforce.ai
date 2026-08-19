/**
 * Every spec vocabulary, imported for its registration side effect.
 *
 * ── THE DEFECT THIS CLOSES ───────────────────────────────────────────────────────
 * `specObjects.ts` holds the registry and CANNOT import the sets — the sets import
 * `registerSpecObjectSet` from it, so the dependency only runs one way. Each set
 * therefore registers itself when its module is first evaluated, which makes
 * "is this kind spec'd?" depend on whether anybody happened to import that module yet.
 *
 * In the running app the answer was yes, by accident: `CreationNode` imports
 * `creationObjectRegistry`, which imports all five sets, so every consumer downstream of
 * the canvas tree saw a full registry. `SpecObjectBody` imported on its own saw an EMPTY
 * one and rendered null for every kind — which is how a component with forty-seven
 * working object bodies had fifteen failing unit tests and a passing app.
 *
 * An accident of import order is not a dependency. This is the one module that knows the
 * full list, so a consumer that needs the registry populated imports THIS rather than
 * guessing which set happens to pull in the others.
 *
 * Adding a vocabulary is adding a line here. A set that registers itself and is never
 * listed works in whichever surface imports it directly and silently renders nothing
 * everywhere else — which is exactly the failure above.
 */

import './founderObjects';
import './academicObjects';
import './hiringObjects';
import './peopleObjects';
import './sharedCanvasObjects';
// The two data vocabularies were missing from this list for exactly the reason the
// header describes, and the app hid it: `creationObjectRegistry` imports
// `dataScienceObjects` transitively, so the running board resolved a `model`, a
// `trainingRun` and a `labelSet` while `SpecObjectBody` imported on its own rendered
// null for all six. A set that registers itself and is never listed here works in
// whichever surface happens to pull it in and silently renders nothing everywhere else.
import './dataScienceObjects';
// The field vocabulary — the operation a vertical company actually runs.
import './operationsObjects';
// The secure legal FILE — uploaded, encrypted, shared and signed. Distinct from the
// authored `contract` the founder set already registers; see `legalObjects.ts`.
import './legalObjects';
// The sell motion — the commercial half of "idea to real". Listed here for the reason the
// header gives: a set that registers itself and is never listed works in whichever surface
// happens to import it and silently renders nothing everywhere else.
import './sellMotionObjects';

export {};
