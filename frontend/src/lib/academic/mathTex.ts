/**
 * TeX → MathML, so the canvas can hold mathematics.
 *
 * ── WHY THIS IS HERE AND NOT KaTeX ───────────────────────────────────────────────
 * The published surfaces run under a strict CSP with no external hosts, and the
 * artifact renderer forbids CDN scripts and remote fonts outright. KaTeX is ~280KB
 * plus a font family; MathJax is larger. Both would have to be vendored into every
 * bundle that might show one equation.
 *
 * MathML is native in every current browser, needs no script and no font download, and
 * — the reason that actually decides it — is what a screen reader speaks. A LaTeX
 * expression rendered as an image, or as styled spans, is silent to a student using
 * assistive technology, which makes it unlawful to distribute to a class. Rendering to
 * MathML with an `alttext` is the accessible option, not merely the small one.
 *
 * ── WHAT IS SUPPORTED, AND WHAT HAPPENS TO THE REST ──────────────────────────────
 * The subset a lecture, a methods section and an economics model actually use:
 * fractions, roots, super/subscripts, sums and integrals with limits, Greek letters,
 * operators and relations, common named functions, delimiters, vectors and text runs.
 *
 * Anything unrecognised is emitted VERBATIM inside an `<mi>` rather than dropped. A
 * silently discarded term changes what an equation says, which is the one failure mode
 * a mathematics renderer must not have — a visibly odd symbol is a bug report, a
 * missing one is a wrong equation nobody notices.
 */

/** Greek and the symbols that carry meaning in most disciplines. */
const SYMBOLS: Readonly<Record<string, string>> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ',
  eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν',
  xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'ϕ',
  chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ',
  Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  partial: '∂', nabla: '∇', infty: '∞', hbar: 'ℏ', ell: 'ℓ', Re: 'ℜ', Im: 'ℑ', aleph: 'ℵ',
  emptyset: '∅', varnothing: '∅', forall: '∀', exists: '∃', neg: '¬', angle: '∠',
};

/** Operators and relations. The distinction from SYMBOLS is the MathML element: an
 *  operator gets `<mo>`, which is what controls spacing and line-breaking. */
const OPERATORS: Readonly<Record<string, string>> = {
  times: '×', cdot: '⋅', div: '÷', pm: '±', mp: '∓', ast: '∗', star: '⋆', circ: '∘',
  leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', approx: '≈', equiv: '≡',
  sim: '∼', simeq: '≃', cong: '≅', propto: '∝', ll: '≪', gg: '≫',
  subset: '⊂', supset: '⊃', subseteq: '⊆', supseteq: '⊇', in: '∈', notin: '∉', ni: '∋',
  cup: '∪', cap: '∩', setminus: '∖', oplus: '⊕', otimes: '⊗',
  rightarrow: '→', to: '→', leftarrow: '←', leftrightarrow: '↔', Rightarrow: '⇒',
  Leftarrow: '⇐', Leftrightarrow: '⇔', mapsto: '↦', implies: '⟹',
  land: '∧', lor: '∨', therefore: '∴', because: '∵', perp: '⊥', parallel: '∥',
  dots: '…', ldots: '…', cdots: '⋯', vdots: '⋮', ddots: '⋱', prime: '′', degree: '°',
};

/** Operators drawn large, with limits above and below rather than beside. */
const BIG_OPERATORS: Readonly<Record<string, string>> = {
  sum: '∑', prod: '∏', coprod: '∐', int: '∫', iint: '∬', iiint: '∭', oint: '∮',
  bigcup: '⋃', bigcap: '⋂', lim: 'lim', max: 'max', min: 'min', sup: 'sup', inf: 'inf',
};

/** Functions set upright rather than italic — the typographic convention that
 *  distinguishes the function `sin` from the product of three variables s·i·n. */
const FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'arcsin', 'arccos', 'arctan',
  'sinh', 'cosh', 'tanh', 'log', 'ln', 'lg', 'exp', 'det', 'dim', 'ker', 'deg',
  'gcd', 'arg', 'mod', 'Pr',
]);

const LEFT_DELIMS: Readonly<Record<string, string>> = {
  '(': '(', '[': '[', '\\{': '{', '\\langle': '⟨', '|': '|', '\\|': '‖', '\\lceil': '⌈', '\\lfloor': '⌊', '.': '',
};
const RIGHT_DELIMS: Readonly<Record<string, string>> = {
  ')': ')', ']': ']', '\\}': '}', '\\rangle': '⟩', '|': '|', '\\|': '‖', '\\rceil': '⌉', '\\rfloor': '⌋', '.': '',
};

const xml = (value: string): string => value
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** A parsed node, kept deliberately small — this tree exists only to be emitted. */
type Node =
  | { t: 'n'; v: string }
  | { t: 'i'; v: string }
  | { t: 'o'; v: string }
  | { t: 'fn'; v: string }
  | { t: 'text'; v: string }
  | { t: 'row'; kids: Node[] }
  | { t: 'frac'; num: Node; den: Node }
  | { t: 'sqrt'; body: Node; index?: Node }
  | { t: 'sup'; base: Node; up: Node }
  | { t: 'sub'; base: Node; down: Node }
  | { t: 'subsup'; base: Node; down: Node; up: Node }
  | { t: 'big'; v: string; down?: Node; up?: Node }
  | { t: 'fenced'; open: string; close: string; body: Node }
  | { t: 'accent'; kind: 'vec' | 'hat' | 'bar' | 'dot' | 'tilde'; body: Node };

const MAX_TEX = 8_000;
const MAX_DEPTH = 24;

class Parser {
  private i = 0;
  constructor(private readonly src: string) {}

  private peek(): string { return this.src[this.i] ?? ''; }
  private eof(): boolean { return this.i >= this.src.length; }
  private skipSpace(): void { while (!this.eof() && /\s/.test(this.src[this.i])) this.i += 1; }

  /** Read `\name`, returning the bare name. */
  private command(): string {
    this.i += 1; // the backslash
    const match = /^[A-Za-z]+/.exec(this.src.slice(this.i));
    if (!match) { const single = this.src[this.i] ?? ''; this.i += 1; return single; }
    this.i += match[0].length;
    return match[0];
  }

  /** One argument: a braced group, or the single next atom (TeX's own rule). */
  private argument(depth: number): Node {
    this.skipSpace();
    if (this.peek() === '{') { this.i += 1; const body = this.sequence(depth + 1, '}'); this.skipSpace(); if (this.peek() === '}') this.i += 1; return body; }
    return this.atom(depth + 1) ?? { t: 'row', kids: [] };
  }

  /** Read a delimiter token after \left or \right. */
  private delimiter(): string {
    this.skipSpace();
    if (this.peek() === '\\') {
      const start = this.i;
      const name = this.command();
      return `\\${name}` in LEFT_DELIMS || `\\${name}` in RIGHT_DELIMS ? `\\${name}` : (this.i = start + 1, '');
    }
    const char = this.peek();
    this.i += 1;
    return char;
  }

  private atom(depth: number): Node | null {
    if (depth > MAX_DEPTH) return null;
    this.skipSpace();
    if (this.eof()) return null;
    const char = this.peek();

    if (char === '}' || char === ']') return null;

    if (char === '{') { this.i += 1; const body = this.sequence(depth + 1, '}'); this.skipSpace(); if (this.peek() === '}') this.i += 1; return body; }

    if (char === '\\') {
      const name = this.command();

      if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
        return { t: 'frac', num: this.argument(depth), den: this.argument(depth) };
      }
      if (name === 'sqrt') {
        this.skipSpace();
        let index: Node | undefined;
        if (this.peek() === '[') { this.i += 1; index = this.sequence(depth + 1, ']'); if (this.peek() === ']') this.i += 1; }
        return { t: 'sqrt', body: this.argument(depth), ...(index ? { index } : {}) };
      }
      if (name === 'text' || name === 'mathrm' || name === 'operatorname' || name === 'mathbf' || name === 'textbf') {
        this.skipSpace();
        if (this.peek() !== '{') return { t: 'i', v: name };
        this.i += 1;
        const start = this.i;
        let level = 1;
        while (!this.eof() && level > 0) {
          if (this.src[this.i] === '{') level += 1;
          else if (this.src[this.i] === '}') { level -= 1; if (level === 0) break; }
          this.i += 1;
        }
        const raw = this.src.slice(start, this.i);
        if (this.peek() === '}') this.i += 1;
        return { t: 'text', v: raw };
      }
      if (name === 'left') {
        const open = this.delimiter();
        const body = this.sequence(depth + 1, '\\right');
        // `sequence` stops before \right; consume it and its delimiter.
        this.skipSpace();
        if (this.src.startsWith('\\right', this.i)) { this.i += 6; }
        const close = this.delimiter();
        return { t: 'fenced', open: LEFT_DELIMS[open] ?? open, close: RIGHT_DELIMS[close] ?? close, body };
      }
      if (name === 'vec' || name === 'hat' || name === 'bar' || name === 'dot' || name === 'tilde' || name === 'overline') {
        const kind = name === 'overline' ? 'bar' : name as 'vec' | 'hat' | 'bar' | 'dot' | 'tilde';
        return { t: 'accent', kind, body: this.argument(depth) };
      }
      if (name in BIG_OPERATORS) return { t: 'big', v: BIG_OPERATORS[name] };
      if (name in SYMBOLS) return { t: 'i', v: SYMBOLS[name] };
      if (name in OPERATORS) return { t: 'o', v: OPERATORS[name] };
      if (FUNCTIONS.has(name)) return { t: 'fn', v: name };
      if (name === 'quad' || name === 'qquad' || name === ',' || name === ';' || name === '!' || name === ' ') return { t: 'text', v: ' ' };
      if (name === '%' || name === '&' || name === '#' || name === '_' || name === '$') return { t: 'i', v: name };
      // Unrecognised: keep it visible. See the header.
      return { t: 'i', v: `\\${name}` };
    }

    if (/[0-9]/.test(char)) {
      const match = /^[0-9]+(?:\.[0-9]+)?/.exec(this.src.slice(this.i)) as RegExpExecArray;
      this.i += match[0].length;
      return { t: 'n', v: match[0] };
    }

    if (/[A-Za-z]/.test(char)) { this.i += 1; return { t: 'i', v: char }; }

    if ('+-=<>/*,;:!?|'.includes(char)) { this.i += 1; return { t: 'o', v: char === '-' ? '−' : char }; }
    if (char === '(' || char === ')' || char === '[' || char === ']') { this.i += 1; return { t: 'o', v: char }; }

    this.i += 1;
    return { t: 'i', v: char };
  }

  /** A run of atoms with their scripts, up to `stop`. */
  sequence(depth: number, stop: string): Node {
    const kids: Node[] = [];
    while (!this.eof()) {
      this.skipSpace();
      if (stop === '}' && this.peek() === '}') break;
      if (stop === ']' && this.peek() === ']') break;
      if (stop === '\\right' && this.src.startsWith('\\right', this.i)) break;
      const before = this.i;
      let node = this.atom(depth);
      if (!node) { if (this.i === before) break; continue; }

      // Scripts bind to the atom just read, and `x_i^2` and `x^2_i` must produce the
      // same tree — hence one loop that fills whichever slot is empty.
      let up: Node | undefined;
      let down: Node | undefined;
      for (;;) {
        this.skipSpace();
        const mark = this.peek();
        if (mark !== '^' && mark !== '_') break;
        this.i += 1;
        const script = this.argument(depth);
        if (mark === '^') up = script; else down = script;
      }
      if (node.t === 'big' && (up || down)) node = { ...node, ...(up ? { up } : {}), ...(down ? { down } : {}) };
      else if (up && down) node = { t: 'subsup', base: node, down, up };
      else if (up) node = { t: 'sup', base: node, up };
      else if (down) node = { t: 'sub', base: node, down };

      kids.push(node);
      if (this.i === before) { this.i += 1; }
    }
    return kids.length === 1 ? kids[0] : { t: 'row', kids };
  }
}

function emit(node: Node): string {
  switch (node.t) {
    case 'n': return `<mn>${xml(node.v)}</mn>`;
    case 'i': return `<mi>${xml(node.v)}</mi>`;
    case 'o': return `<mo>${xml(node.v)}</mo>`;
    case 'fn': return `<mi mathvariant="normal">${xml(node.v)}</mi>`;
    case 'text': return `<mtext>${xml(node.v)}</mtext>`;
    case 'row': return `<mrow>${node.kids.map(emit).join('')}</mrow>`;
    case 'frac': return `<mfrac>${wrap(node.num)}${wrap(node.den)}</mfrac>`;
    case 'sqrt': return node.index
      ? `<mroot>${wrap(node.body)}${wrap(node.index)}</mroot>`
      : `<msqrt>${emit(node.body)}</msqrt>`;
    case 'sup': return `<msup>${wrap(node.base)}${wrap(node.up)}</msup>`;
    case 'sub': return `<msub>${wrap(node.base)}${wrap(node.down)}</msub>`;
    case 'subsup': return `<msubsup>${wrap(node.base)}${wrap(node.down)}${wrap(node.up)}</msubsup>`;
    case 'big': {
      const operator = `<mo>${xml(node.v)}</mo>`;
      if (node.up && node.down) return `<munderover>${operator}${wrap(node.down)}${wrap(node.up)}</munderover>`;
      if (node.down) return `<munder>${operator}${wrap(node.down)}</munder>`;
      if (node.up) return `<mover>${operator}${wrap(node.up)}</mover>`;
      return operator;
    }
    case 'fenced': return `<mrow><mo>${xml(node.open)}</mo>${emit(node.body)}<mo>${xml(node.close)}</mo></mrow>`;
    case 'accent': {
      const marks = { vec: '→', hat: '^', bar: '¯', dot: '˙', tilde: '~' };
      return `<mover accent="true">${wrap(node.body)}<mo stretchy="false">${xml(marks[node.kind])}</mo></mover>`;
    }
  }
}

/** MathML layout elements require exactly one child per slot, so a bare token that is
 *  already single stays single and everything else is wrapped. */
const wrap = (node: Node): string => (node.t === 'row' ? emit(node) : `<mrow>${emit(node)}</mrow>`);

export interface RenderedMath {
  /** A complete `<math>` element, ready to inject. Escaped throughout. */
  mathml: string;
  /** Generated spoken reading, used when the author has not written an `altText`. */
  spoken: string;
  /** True when nothing renderable was found — the caller shows the source instead. */
  empty: boolean;
}

/**
 * Render TeX.
 *
 * `altText` overrides the generated reading, because an author who has written how
 * their equation should be spoken knows better than a generator: "the Laplacian of u"
 * is what a lecturer says, and "nabla squared u" is what the symbols say.
 */
export function renderTex(source: unknown, altText?: unknown): RenderedMath {
  const raw = typeof source === 'string' ? source.slice(0, MAX_TEX) : '';
  const cleaned = raw
    .replace(/^\s*\$\$?|\$\$?\s*$/g, '')
    .replace(/^\s*\\\[|\\\]\s*$/g, '')
    .replace(/^\s*\\\(|\\\)\s*$/g, '')
    .trim();
  if (!cleaned) return { mathml: '', spoken: '', empty: true };

  const tree = new Parser(cleaned).sequence(0, '');
  const spoken = typeof altText === 'string' && altText.trim() ? altText.trim().slice(0, 2_000) : speak(tree);
  const body = tree.t === 'row' ? emit(tree) : `<mrow>${emit(tree)}</mrow>`;
  return {
    mathml: `<math xmlns="http://www.w3.org/1998/Math/MathML" display="block" alttext="${xml(spoken)}">${body}</math>`,
    spoken,
    empty: false,
  };
}

/** Read the symbol names aloud. Deliberately literal — a generated reading that
 *  paraphrases is a reading that can be wrong about what the maths says. */
const SPOKEN_OPERATORS: Readonly<Record<string, string>> = {
  '+': 'plus', '−': 'minus', '-': 'minus', '=': 'equals', '<': 'less than', '>': 'greater than',
  '≤': 'less than or equal to', '≥': 'greater than or equal to', '≠': 'not equal to',
  '×': 'times', '⋅': 'times', '÷': 'divided by', '±': 'plus or minus', '≈': 'approximately',
  '→': 'goes to', '∈': 'in', '∪': 'union', '∩': 'intersection', '∝': 'proportional to',
  '(': 'open bracket', ')': 'close bracket', ',': 'comma',
};

function speak(node: Node): string {
  switch (node.t) {
    case 'n': return node.v;
    case 'i': return node.v;
    case 'o': return SPOKEN_OPERATORS[node.v] ?? node.v;
    case 'fn': return node.v;
    case 'text': return node.v;
    case 'row': return node.kids.map(speak).filter(Boolean).join(' ');
    case 'frac': return `the fraction ${speak(node.num)} over ${speak(node.den)}`;
    case 'sqrt': return node.index ? `the ${speak(node.index)} root of ${speak(node.body)}` : `the square root of ${speak(node.body)}`;
    case 'sup': return `${speak(node.base)} to the power ${speak(node.up)}`;
    case 'sub': return `${speak(node.base)} sub ${speak(node.down)}`;
    case 'subsup': return `${speak(node.base)} sub ${speak(node.down)} to the power ${speak(node.up)}`;
    case 'big': {
      const name = node.v === '∑' ? 'the sum' : node.v === '∫' ? 'the integral' : node.v === '∏' ? 'the product' : node.v;
      const from = node.down ? ` from ${speak(node.down)}` : '';
      const to = node.up ? ` to ${speak(node.up)}` : '';
      return `${name}${from}${to} of`;
    }
    case 'fenced': return `open ${speak(node.body)} close`;
    case 'accent': return `${node.kind === 'vec' ? 'vector' : node.kind} ${speak(node.body)}`;
  }
}

/** Is this string plausibly TeX? Used to decide whether a `note` or a lesson body
 *  should be scanned for inline maths at all. */
export function looksLikeTex(value: unknown): boolean {
  const raw = typeof value === 'string' ? value : '';
  return /\\(frac|sqrt|sum|int|alpha|beta|gamma|delta|partial|nabla|cdot|times|leq|geq|infty|left|right)\b/.test(raw)
    || /\$[^$]{2,}\$/.test(raw)
    || /\^\{?[A-Za-z0-9]/.test(raw) && /_\{?[A-Za-z0-9]/.test(raw);
}
