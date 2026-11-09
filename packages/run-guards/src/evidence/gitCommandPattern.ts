/**
 * `gitCommandPattern` — moved from `brain-embedded/src/shipVerification.ts` (PRD 45
 * §4.3: "No re-export, no second copy"). Lives once, in `@builderforce/run-guards`.
 */

/**
 * A raw shell `git <verb>`, however git's own options precede the verb. The options
 * that TAKE A VALUE (`-C <path>`, `-c <key=value>`) are matched as a pair: a
 * multi-checkout workspace runs `git -C Builderforce.ai push`, and a pattern that only
 * skipped single-token flags stopped at the path and never saw the verb.
 */
export function gitCommandPattern(verbs: string): RegExp {
  return new RegExp(`\\bgit\\s+(?:-[Cc]\\s+\\S+\\s+|-\\S+\\s+|--\\S+(?:=\\S+)?\\s+)*(?:${verbs})\\b`, "i");
}
