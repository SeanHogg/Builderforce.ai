/** The ONE "did this tool step fail?" predicate lives in `@builderforce/agent-tools` (`toolFailure.ts`), where the run's
 *  memory record reads it too; every diagnostics module here imports it through this path. */
export { isFailedToolResult } from '@builderforce/agent-tools';
