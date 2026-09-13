/**
 * Does this shell command only LOOK at the workspace?
 *
 * `run_command` is the one tool whose blast radius the loop cannot see, so the read guard
 * (`readCoverage.ts`) treats every call as "anything may have changed" and throws away
 * every cached read answer. That is right for a build or a codemod and wrong for the
 * commands agents actually run most between reads: a ticket review measured on a VS Code
 * run issued `git branch -a`, `git log main..X --oneline`, `git rev-list --count` and a
 * `for` loop over branches — nineteen `run_command`s that changed nothing — and each one
 * re-armed a full re-read of every file the run had already seen.
 *
 * So a command that provably only reads (every segment of it a known read-only program,
 * no redirection into a file) is classified as such, and the guard keeps its answers.
 * CONSERVATIVE by construction: anything unrecognised — an unknown program, a `git`
 * subcommand not on the list, `sed -i`, `find -delete`, a `>` into a file — is "may
 * write", which is exactly the old behaviour. A false "read-only" would let the loop stub
 * a re-read with a stale answer; a false "may write" only costs a re-read.
 *
 * Pure: string in, boolean out.
 */

/** Programs that never change the filesystem when run without output redirection. */
const READ_ONLY_PROGRAMS = new Set([
  'cat', 'head', 'tail', 'wc', 'ls', 'dir', 'pwd', 'echo', 'printf', 'grep', 'egrep', 'fgrep', 'rg',
  'find', 'tree', 'stat', 'file', 'du', 'df', 'which', 'where', 'type', 'sort', 'uniq', 'cut', 'tr',
  'jq', 'basename', 'dirname', 'realpath', 'readlink', 'date', 'true', 'false', 'test', '[', 'diff',
  'cmp', 'comm', 'nl', 'column', 'less', 'more', 'sed', 'cd', 'read', 'whoami', 'hostname', 'uname',
  'node', 'npm', 'pnpm', 'yarn', 'python', 'python3',
]);

/** Programs allowed only with a version/info flag — a bare `node x.js` runs arbitrary code. */
const INFO_ONLY_PROGRAMS = new Set(['node', 'npm', 'pnpm', 'yarn', 'python', 'python3']);
const INFO_FLAGS = new Set(['--version', '-v', '-V', 'version', '--help', '-h']);

/** git subcommands that only read the repository. */
const READ_ONLY_GIT = new Set([
  'status', 'log', 'show', 'diff', 'rev-list', 'rev-parse', 'ls-files', 'ls-tree', 'ls-remote', 'cat-file',
  'merge-base', 'for-each-ref', 'describe', 'blame', 'shortlog', 'grep', 'name-rev', 'count-objects',
  'whatchanged', 'cherry', 'show-ref', 'show-branch', 'range-diff', 'var', 'check-ignore', 'check-attr',
]);

/** Shell keywords that open, continue or close a construct and run nothing themselves. */
const CONSTRUCT_WORDS = new Set(['then', 'else', 'fi', 'do', 'done', 'esac', '{', '}', '(', ')']);

/** Split into top-level segments on `&&`, `||`, `;`, `|` and newlines, respecting quotes. */
function splitSegments(command: string): string[] | null {
  const out: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let depth = 0; // inside $( … )
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '$' && command[i + 1] === '(') {
      depth += 1;
      current += '$(';
      i += 1;
      continue;
    }
    if (ch === ')' && depth > 0) {
      depth -= 1;
      current += ch;
      continue;
    }
    // `2>&1`, `>&2`, `<&0` and `&>file` are REDIRECTS, not job separators — the `&` belongs
    // to the redirect, and the redirect itself is judged by `writesViaRedirect`.
    if (ch === '&' && (command[i - 1] === '>' || command[i - 1] === '<' || command[i + 1] === '>')) {
      current += ch;
      continue;
    }
    if (depth === 0 && (ch === ';' || ch === '\n' || ch === '|' || ch === '&')) {
      // `&&` / `||` are one separator; a lone `&` backgrounds a job (still one segment end).
      if ((ch === '&' || ch === '|') && command[i + 1] === ch) i += 1;
      if (current.trim()) out.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (quote || depth !== 0) return null; // unbalanced — do not guess
  if (current.trim()) out.push(current.trim());
  return out;
}

/** The `$( … )` bodies inside a segment, so they are checked like any other command. */
function substitutions(segment: string): string[] {
  const out: string[] = [];
  let i = segment.indexOf('$(');
  while (i >= 0) {
    let depth = 1;
    let j = i + 2;
    for (; j < segment.length && depth > 0; j += 1) {
      if (segment[j] === '(') depth += 1;
      else if (segment[j] === ')') depth -= 1;
    }
    out.push(segment.slice(i + 2, j - 1));
    i = segment.indexOf('$(', j);
  }
  return out;
}

/** Whitespace tokens with quotes stripped. Substitutions are already checked separately. */
function tokens(segment: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m = re.exec(segment);
  while (m) {
    out.push(m[1] ?? m[2] ?? m[3]);
    m = re.exec(segment);
  }
  return out;
}

/** A redirect that WRITES somewhere other than a null device or another descriptor. */
function writesViaRedirect(segment: string): boolean {
  const unquoted = segment.replace(/"[^"]*"|'[^']*'/g, '""');
  const re = /(\d*)>>?\s*(&\d+|\S+)?/g;
  let m = re.exec(unquoted);
  while (m) {
    const target = m[2] ?? '';
    if (!/^(&\d+|\/dev\/null|nul|NUL|\$null)$/.test(target)) return true;
    m = re.exec(unquoted);
  }
  return false;
}

function gitIsReadOnly(args: string[]): boolean {
  // Global options before the subcommand: `-C <dir>`, `-c k=v`, `--no-pager`, …
  let i = 0;
  while (i < args.length && args[i].startsWith('-')) {
    i += args[i] === '-C' || args[i] === '-c' ? 2 : 1;
  }
  const sub = args[i];
  const rest = args.slice(i + 1);
  if (!sub) return true; // bare `git` prints usage
  if (READ_ONLY_GIT.has(sub)) return true;
  const flags = new Set(rest.filter((a) => a.startsWith('-')));
  const positional = rest.filter((a) => !a.startsWith('-'));
  switch (sub) {
    case 'branch': {
      const writes = ['-d', '-D', '--delete', '-m', '-M', '--move', '-c', '-C', '--copy', '-f', '--force', '-u', '--set-upstream-to', '--unset-upstream', '--edit-description'];
      if (writes.some((f) => flags.has(f) || [...flags].some((x) => x.startsWith(`${f}=`)))) return false;
      if (flags.has('--list') || flags.has('-l')) return true;
      // A bare positional is a branch NAME to create — unless it is the value of an option.
      const valued = new Set(['--format', '--sort', '--contains', '--no-contains', '--merged', '--no-merged', '--points-at']);
      for (let k = 0; k < rest.length; k += 1) {
        if (rest[k].startsWith('-')) {
          if (valued.has(rest[k])) k += 1;
          continue;
        }
        return false;
      }
      return true;
    }
    case 'tag':
      return positional.length === 0 || flags.has('-l') || flags.has('--list');
    case 'remote':
      return positional.length === 0 || ['show', 'get-url'].includes(positional[0]);
    case 'stash':
    case 'notes':
    case 'worktree':
      return ['list', 'show'].includes(positional[0] ?? '');
    case 'reflog':
      return positional.length === 0 || positional[0] === 'show';
    case 'config':
      return ['--get', '--get-all', '--get-regexp', '--list', '-l'].some((f) => flags.has(f));
    case 'symbolic-ref':
      return positional.length <= 1 && !flags.has('-d') && !flags.has('--delete');
    default:
      return false;
  }
}

function segmentIsReadOnly(segment: string, depth: number): boolean {
  if (depth > 4) return false;
  for (const body of substitutions(segment)) {
    if (!commandIsReadOnly(body, depth + 1)) return false;
  }
  // Substitution bodies were checked above as commands of their own; what remains is
  // this segment's own words — so `n=$(git rev-list … 2>/dev/null)` is not misread as a
  // redirect into a file called `/dev/null)`.
  const flat = segment.replace(/\$\((?:[^()]|\([^()]*\))*\)/g, 'X');
  if (writesViaRedirect(flat)) return false;
  let words = tokens(flat);
  // Leading construct words (`do echo …`, `then git log …`) and assignments (`n=$(…)`).
  while (words.length && (CONSTRUCT_WORDS.has(words[0]) || /^[A-Za-z_]\w*=/.test(words[0]) || words[0] === 'if' || words[0] === 'while' || words[0] === 'until' || words[0] === '!')) {
    words = words.slice(1);
  }
  if (words.length === 0) return true;
  const [program, ...args] = words;
  // `for x in a b c` runs nothing; its list was checked through the substitutions above.
  if (program === 'for' || program === 'case') return true;
  if (program === 'git') return gitIsReadOnly(args);
  if (!READ_ONLY_PROGRAMS.has(program)) return false;
  if (INFO_ONLY_PROGRAMS.has(program)) return args.length > 0 && args.every((a) => INFO_FLAGS.has(a));
  if (program === 'sed') return !args.some((a) => a === '-i' || a.startsWith('-i') || a === '--in-place' || a.startsWith('--in-place='));
  if (program === 'find') return !args.some((a) => ['-delete', '-exec', '-execdir', '-ok', '-okdir', '-fprint', '-fprintf', '-fls'].includes(a));
  if (program === 'sort') return !args.some((a) => a === '-o' || a.startsWith('--output'));
  return true;
}

function commandIsReadOnly(command: string, depth: number): boolean {
  if (/`/.test(command)) return false; // legacy substitution — not parsed, so not trusted
  const segments = splitSegments(command);
  if (!segments || segments.length === 0) return false;
  return segments.every((s) => segmentIsReadOnly(s, depth));
}

/** True only when every part of `command` is known to leave the filesystem untouched. */
export function isReadOnlyShellCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) return false;
  return commandIsReadOnly(trimmed, 0);
}
