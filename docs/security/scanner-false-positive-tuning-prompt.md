# Prompt: reduce false positives in the /security scanner

You maintain the /security scanner (regex-based SAST + secret + risky-file rules). A scan of the
Builderforce.ai monorepo reported 268 findings in 14,253 files; manual review shows almost all of them
are false positives. Change the RULES and PATH FILTERS (not the scanned code) so that the cases below
stop firing while real vulnerabilities still fire. Every change needs a positive and a negative test.

## 1. Path filters (apply before any SAST rule)
- Treat as built/vendored output and skip SAST (keep secret rules): any file under `media/webview/`,
  `dist/`, `build/`, `out/`, `.next/`, `coverage/`, `node_modules/`, `vendor/`; any `*.min.js`;
  any bundler chunk/worker name matching `/(^|\/)(chunk|asset|vendor)-[\w-]+\.js$/` or
  `/\.worker-[A-Za-z0-9_-]{6,}\.js$/` (hashed). Report these as "not scanned: generated", not as findings.
- Skip or downgrade to INFO in tests/fixtures: `__tests__`, `__mocks__`, `test`/`tests`, `fixtures`,
  `e2e`, `examples`, `*.test.*`, `*.spec.*`, and files named `test-helpers*` / `*.fixture.*`
  (e.g. `agent-runtime/ui/src/ui/test-helpers/app-mount.ts`, `agent-runtime/src/gateway/test-helpers.server.ts`).
- Skip files under `**/generated/**` for SAST and risky-file scoring unless they are newly added in the change.

## 2. Detector self-reference (the scanner's own rule tables)
- Do not run SAST / behaviour / signature rules on files that DEFINE detection rules: paths matching
  `/(^|\/)(rules?|signatures?|registry)(\/.*)?\.(ts|js)$/` AND inside a package whose name contains
  `shield`, `delta`, `scanner` or `lint` (e.g. `packages/code-shield/src/signatures.ts`, `packages/code-shield/src/rules/behaviorRules.ts`,
  `packages/run-delta/src/registry/defaults.ts`). A `rules/` folder in any other package is still scanned.
- Ignore a match that sits entirely inside a string literal or regex literal, e.g. `'eval('`,
  `'new Function('`, `'.innerHTML='`, `String.raw\`createHash\(...\)\``. Mask the contents of
  comments, regex literals and plain quoted strings before matching code-execution, HTML and SQL
  rules, so the SINK (`eval(`, `.innerHTML =`, `.query(`) must appear in code. Do not mask template
  literals passed to a sink: their `${}` interpolations are what the SQL and HTML rules check.
- The EICAR test string inside a signature table is a test vector, not malware: report at most INFO.

## 3. secret-private-key (CWE-798)
- Fire only when a PEM header is followed by base64 key material on the next line(s):
  `-----BEGIN [A-Z ]*PRIVATE KEY-----\s*\n[A-Za-z0-9+/=]{40,}`.
- Do not fire when the header appears in a regex, an `includes()/startsWith()/replace()` argument,
  or a string used for validation/normalisation (e.g. `api/src/application/repos/githubApp.ts:142,151`).

## 4. secret-generic-assignment
- Ignore values that are obvious placeholders/test values (`test`, `dummy`, `fake`, `example`,
  `changeme`, `xxx`, `secret`, `password`, length < 12, or all one character) and anything in test-helper paths.

## 5. sql-template (CWE-89)
- Do NOT fire on tagged templates whose tag is a parameterising SQL builder:
  `sql\``, `Prisma.sql\``, `db.sql\``, drizzle `sql\``, `postgres\``. These bind `${}` values as
  parameters. `sql.unsafe(` and `sql.raw(` are not parameterising and still fire (see below).
- Do NOT fire when every `${}` in the SQL is an identifier taken from a constant/allow-listed column or
  table list in the same file, or a placeholder list such as `${ids.map(() => '?').join(',')}`
  (e.g. `packages/agent-tools/src/node-knowledge/sqliteRows.ts:165-168`, `manifestBuffer.ts:15`, `factStoreRows.ts:121`).
- Do fire on `.query(\`...${x}\`)`, `.execute(...)`, `.prepare(\`...${x}\`)`, `.raw(...)`,
  `$queryRawUnsafe`, `sql.raw(` / `sql.unsafe(` with interpolation, and on string concatenation into those calls.

## 6. xss-inner-html (CWE-79)
- Do NOT fire on `x.innerHTML = ''` / `= ""` / `= \`\`` (clearing).
- Do NOT fire when every interpolated/concatenated value is wrapped in a recognised escaper
  (`esc(`, `escape(`, `escapeHtml(`, `DOMPurify.sanitize(`, `sanitize(`) or is a number/`.length`
  (e.g. `clients/vscode/src/panels/boardPanel.ts:224,240,265`).
- Do fire when an unescaped variable or property reaches `innerHTML`, `outerHTML`,
  `insertAdjacentHTML`, `document.write`, or `dangerouslySetInnerHTML`.

## 7. eval-call / new-function (CWE-95)
- Do NOT fire on the fixed indirect-import idiom `new Function("m", "return import(m)")`
  or `new Function('return this')` when all arguments are string literals with no interpolation;
  report at most LOW "dynamic import shim" (e.g. `agent-runtime/src/infra/ssm-memory-service.ts:199`,
  `project-evermind-delta.ts:76`, `limbic-system-service.ts:140`).
- Do NOT fire on method names like `.eval(` on a model/module object (`model.eval()`, `module.eval()`,
  PyTorch-style training mode) or on Pyodide `runPython`/`pyodide.eval` wrappers whose argument is a
  bundled constant (e.g. `webdit/torch/src/autograd/nn/module.ts:47`, `webdit/torch/src/pyodide/python-files.ts:15,17`).
  Require a free `eval(` (not preceded by `.`, `\w` or `$`).
- Do fire when the argument is non-literal (a variable, template with `${}`, or concatenation).

## 8. weak-password-hash (CWE-916)
- Fire only when md5/sha1 output is assigned to, compared with, or derived from an identifier
  matching `/pass(word|wd)?|pwd|credential/i` within the same statement. Content-addressing
  (cache keys, ETags, file fingerprints, chunk ids) is not a password hash.

## 9. Risky-file scoring
- `decoded-exec`, `network-egress`, `obfuscation`, `credential-access` heuristics must not score files
  excluded in section 1 or 2. Score them only when the file is newly added or changed in the scanned diff.

## Acceptance
- Re-scan Builderforce.ai: none of the paths/lines cited above are reported.
- Add a regression fixture per rule with one TRUE positive that still fires, e.g.
  `db.query(\`SELECT * FROM t WHERE id = ${req.query.id}\`)`, `el.innerHTML = userInput`,
  `eval(code)`, `new Function(body)`, a real-looking PEM block, `md5(password)`.
- Report the before/after finding counts and list every remaining finding with file:line.
