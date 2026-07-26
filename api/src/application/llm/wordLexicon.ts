/**
 * wordLexicon — a compact, zero-dependency lexicon + language guard used by the text
 * coherence gate to catch the ONE failure mode the structural checks cannot see: an
 * under-trained byte-BPE head emitting fluent-SHAPED prose made of INVENTED WORDS that
 * balances its punctuation and never repeats itself ("…oredionisiing chats code related
 * tot, bound reposea this inatic exie. The cainstiel.ts, ore…").
 *
 * Every structural signal (repetition, dominant-token collapse, replacement chars,
 * orphaned delimiters) is blind to that text, and — measured on real samples —
 * no dictionary-free feature separates it: long-token share, type-token ratio and
 * character-cluster anomalies all score German/technical prose *worse* than the
 * gibberish. So this module supplies the missing signal: **is this token a word?**
 *
 * Three deliberate design constraints, because a false positive here silently drops a
 * legitimate reply:
 *
 *  1. **Language guard.** The lexicon is English-only, so it is consulted ONLY when the
 *     text is Latin-script AND English wins the function-word vote against es/fr/de/pt/it.
 *     A Spanish, French, German or Chinese reply is never judged by it. See
 *     {@link detectLatinLanguage}.
 *  2. **Small lexicon + generous escapes.** ~2.5k high-frequency stems (plus suffix
 *     stripping) can't possibly cover domain jargon, so a token also counts as known
 *     when it REPEATS in the text or appears in the caller's context (the prompt/question).
 *     Real jargon echoes the question or recurs; invented gibberish words are each
 *     different — that asymmetry is the observed signature.
 *  3. **Code is excluded, not judged.** Identifiers, paths, URLs, numbers and fenced
 *     blocks are stripped before scoring — they are legitimately non-words.
 *
 * Zero-dep and pure (no db/env/engine imports) so it can sit under `textCoherence`,
 * which every surface imports.
 */

/**
 * High-frequency English stems. Deliberately a STEM list — {@link isKnownEnglishWord}
 * strips regular inflections, so `merge` covers merged/merges/merging/merger(s).
 * Written as space-separated groups purely for readability; deduped by the Set.
 */
const ENGLISH_STEMS_RAW = [
  // Function words / pronouns / determiners / prepositions / conjunctions.
  `a an the this that these those there here it its it's they them their theirs he him his she her hers we us our ours you your yours i me my mine who whom whose which what when where why how
   and or but nor so yet for as if then than because while although though unless until since whether either neither both each every all any some none no not none other another same such own
   is am are was were be been being do does did done doing have has had having will would shall should can could may might must ought need dare used
   in on at by to from of with without within into onto out off over under above below between among across through during before after around near behind beyond against about upon toward towards along beside besides despite per via versus
   very too also just only even still already almost enough quite rather almost mostly always never often sometimes usually rarely again once twice more most less least much many few several little lot lots
   here there now then today tonight tomorrow yesterday soon later early late ago
   yes no maybe perhaps please thanks thank hello hi okay ok sure`,

  // Core verbs.
  `accept access add adjust admit adopt advise affect afford agree allow analyse analyze announce answer apply appear approve argue arise arrange arrive ask assign assume attach attempt attend avoid
   base become begin believe belong break bring build buy calculate call cancel capture carry catch cause change charge check choose claim clean clear click close collect combine come comment commit compare complete compute concern confirm connect consider consist contain continue contribute control convert copy correct cost cover create cut
   deal decide declare decrease define delete deliver depend describe design detect determine develop die differ disable discover discuss display divide document download draw drive drop
   earn edit effect elect enable encourage end enforce engage enjoy ensure enter escape establish estimate evaluate examine exceed exchange exclude execute exist expand expect experience explain explore export express extend extract
   face fail fall fetch fight fill filter find finish fit fix flag flow focus follow force forget form format forward free fund
   gain gather generate get give go grant grow guess guide handle happen help hide hire hit hold hope host identify ignore illustrate imagine implement import improve include increase indicate influence inform initialise initialize insert inspect install instruct intend introduce invest invite involve issue
   join judge keep kill know label last launch lead learn leave lend let level lie lift like limit link list listen live load locate lock log look lose love
   maintain make manage map mark match matter mean measure meet mention merge migrate mind miss mix modify monitor move
   name navigate need note notice notify observe obtain occur offer open operate order organise organize outline overwrite own
   pack parse partner pass pause pay perform permit persist pick place plan play point poll post practise practice predict prefer prepare present preserve press prevent print process produce program promise promote propose protect prove provide publish pull purchase push put
   qualify query queue quit quote raise rank reach react read realise realize receive recognise recognize recommend record recover reduce refer reflect refresh refuse register regret reject relate release rely remain remember remind remove rename render repair repeat replace reply report represent request require reset resolve respond rest restart restore restrict result resume retain retry return reveal review revert reward rewrite roll run
   save say scale scan schedule score search secure seed seek seem select sell send separate serve set settle share ship show shut sign signal simplify sit skip sleep slow solve sort sound speak specify spend split spread stand start state stay step stick stop store stream stretch strike study submit succeed suggest supply support suppose surface survive suspend sustain switch sync
   take talk target teach tell tend test thank think threaten throw tie touch trace track trade train transfer transform translate travel treat trigger trust try turn
   understand undo unlock update upgrade upload use validate value verify view visit vote wait wake walk want warn wash watch wear win wish wonder work worry wrap write`,

  // Core nouns.
  `ability access account action activity address advantage advice age agency agent agreement aim air alert amount analysis answer api app application approach approval area argument array article aspect asset assistant attempt attention audience audit author authority availability average
   background backup balance bar base baseline batch behaviour behavior benchmark benefit bill block board body book bottom boundary branch brand break budget bug build building business button
   cache calendar call capability capacity card care career case cash category cause cell center centre chain chance change channel chapter character chart chat check child choice church city claim class client cloud code collection college colour color column combination command comment commit committee community company comparison competition component computer concept concern condition conference config configuration confidence connection consequence consideration content context contract contrast contribution control conversation copy core corner cost council count country couple course court cover credit crisis criteria culture currency current customer cycle
   damage data database date day deal debt decade decision default defence defense degree delay demand department dependency deployment depth description design desk detail development device diagram dialog difference difficulty direction director discussion disk display distance distribution district document documentation dollar domain door draft drive driver drop duration duty
   earth economy edge edition editor education effect effort element email emergency employee employer end energy engine engineer entry environment episode equipment error estate estimate evaluation evening event evidence example exception exchange exercise existence expense experience experiment expert explanation export expression extension
   face fact factor failure family fault feature fee feed feedback field figure file film filter finance finding fix flag flow focus folder food foot force forecast form format formula forum foundation frame framework friend front function fund future
   game gap gateway generation girl goal government grade graph group growth guide
   habit half hand handler hardware head header health heart height help history hit hold home hook hope host hour house human hypothesis
   icon idea identity image impact implementation import importance improvement incident income increase index indicator individual industry influence information infrastructure initiative input insight instance institution instruction integration intent interaction interest interface internet interval interview introduction investment issue item
   job join journey judgement judgment jump
   key keyword kind king kitchen knowledge
   lab label lack land language latency law layer layout leader leadership league learning length lesson letter level library licence license life light limit line link list literature load loan location lock log logic login loop loss love
   machine magazine mail main maintenance majority manager map margin mark market material matter meaning measure media meeting member memory message metadata method metric middle migration milestone military million mind minute mission mistake mode model module moment money monitor month morning mother motion mountain mouse movement movie music
   name nation nature need network news night node noise note notice notification number
   object objective observation offer office officer operation opinion opportunity option order organisation organization origin outcome output overhead overview owner
   package page pain pair panel paper paragraph parameter parent park part participant partner party password patch path pattern payment peace people percent performance period permission person perspective phase phone photo phrase picture piece pipeline place plan plant platform player point policy politics pool population port portfolio position possibility post potential power practice practise prediction preference presence president pressure price principle priority privacy problem procedure process product profile program progress project promise proof property proposal protection protocol provider public purpose
   quality quantity query question queue quota
   race radio range rank rate ratio reaction reader reality reason record recovery reference region registry regression relation relationship release relevance reliability remainder report repository representation request requirement research resolution resource response responsibility rest restriction result retry return revenue review reward risk road role room root round route row rule run runtime
   safety sale sample scale scenario schedule scheme school science scope score screen script search season seat second secret section sector security seed segment selection sense sentence sequence series server service session set setting shape share sheet shell shift ship shop side sign signal significance similarity site situation size skill sky sleep slot snapshot society software solution son song sound source space span speaker specification speech speed spirit sport spot spread stack staff stage standard star start state statement station statistic status step stock storage store story strategy stream street strength stress string structure student study style subject subset success summary supply support surface survey symbol syntax system
   table tag target task tax team technique technology telephone television temperature template term test text theme theory thing thought thread threshold ticket time timeline timeout title today token tool top topic total town track trade traffic training transaction transfer transition tree trend trial trip trouble truth turn type
   understanding union unit university update upgrade usage user utility
   value variable variant variety vector vendor version video view viewer village vision visitor voice volume vote
   wall war warning water wave way weather web website week weight west wheel while window winter woman word work worker workflow world worth writer writing
   yard year youth zone`,

  // Adjectives / adverbs / qualifiers.
  `able absolute abstract active actual additional adequate advanced adverse affordable aggregate alternative ambiguous ancient annual anonymous apparent appropriate arbitrary asynchronous atomic automatic available average aware awful
   bad basic beautiful best better big binary blank blue bold boring bottom brief bright broad broken busy
   calm capable careful central certain cheap chief civil classic clean clear clever close closed cold collective comfortable commercial common competitive complete complex comprehensive concrete confident confusing conscious consistent constant convenient cool core correct costly creative critical crucial cultural current custom
   daily dangerous dark dead deep default defensive deliberate dense dependent desirable detailed different difficult digital direct dirty disabled distinct distributed diverse domestic dominant double downstream dry due dynamic
   eager early easy economic effective efficient elaborate electric elegant eligible embedded empty enabled entire environmental equal equivalent essential eventual evident exact excellent exceptional excited exclusive existing expensive experimental explicit extensive external extra extreme
   fair false familiar famous fast fatal favourite favorite federal final financial fine firm first fit fixed flat flexible foreign formal former forward fragile free frequent fresh friendly full functional fundamental funny future fuzzy
   general generic gentle genuine giant global golden good graceful gradual grand grateful great green gross
   happy hard harmful healthy heavy helpful hidden high historical hollow honest horizontal hostile hot huge human hybrid
   ideal identical idle illegal immediate immutable important impossible improper inactive inclusive incoherent incomplete inconsistent incorrect independent indirect individual industrial inevitable infinite informal initial inner innovative input insufficient intact integral intelligent intended interactive interesting interim intermediate internal international invalid inverse isolated
   joint junior just
   key kind known
   large last late later latest lawful lazy leading legal legitimate lengthy level liable light likely limited linear liquid literal little live lively living local logical long loose lost loud low lower loyal
   main major manual massive mature maximum mean meaningful measurable mechanical medical medium mental mere middle mild military minimal minimum minor missing mixed mobile modern modest modular monthly moral multiple mutual
   narrow national native natural near nearby necessary negative net neutral new next nice noisy normal notable novel numerous
   objective obvious occasional odd official old ongoing online only open operational opposite optimal optional ordinary organic original other outer outstanding overall
   parallel partial particular passive past patient perfect periodic permanent persistent personal physical plain pleasant plural political poor popular positive possible potential powerful practical precise predictable preferred premium present previous primary prime principal prior private probable productive professional profitable progressive prominent proper proportional protective proud public pure
   qualified quality quick quiet
   random rapid rare raw ready real realistic reasonable recent redundant regional regular related relative relevant reliable remaining remote repeated representative required resilient responsible restricted retail reverse rich right rigid robust rough round routine royal rural
   sad safe same satisfied scarce scientific secondary secret secure select selective senior sensible sensitive separate serious severe shallow shared sharp short sick significant silent similar simple single skilled slight slow small smart smooth social soft solid sophisticated sound sour southern spare spatial special specific stable standard static steady steep sticky still straight strange strategic strict strong structural stuck subsequent substantial subtle successful sudden sufficient suitable superior supportive supposed sure surprising suspicious sustainable sweet swift synthetic systematic
   tall technical temporary terrible thick thin third thorough tight tiny tired top total tough toxic traditional transparent tremendous tricky trivial true typical
   ugly ultimate unable unavailable uncertain unclear uncommon underlying undesirable unexpected unfair unfortunate uniform unique universal unknown unlikely unnecessary unrelated unsafe unstable unusual upcoming upper upstream urban urgent useful useless usual
   vague valid valuable variable various vast verbal vertical viable visible visual vital vocal void volatile voluntary vulnerable
   warm weak wealthy weekly weird western wet white whole wide widespread wild willing wise wooden worse worst worthy written wrong
   yearly young zero`,

  // Software / product / business vocabulary the assistant genuinely uses.
  `agent agile algorithm allocation analytics annotation architecture archive argument artifact assertion assignment async attribute authentication authorization automation availability
   backend backlog bandwidth binary boolean bootstrap bottleneck breakpoint broker browser buffer bundle
   callback capacity certificate changelog checkpoint checksum classifier cluster codebase collaboration commit compiler compliance component composite compression concurrency connector console constant constraint container context contributor controller cookie coordinator corpus coverage credential cron cursor
   daemon dashboard debug debugger decorator delegate dependency deploy deployment deprecation descriptor developer diff directory dispatch distribution docker domain driver duplicate
   embedding encoder encryption endpoint entity enumeration environment escalation event exception executor exporter extension
   fallback feature federation fetch fixture flag fork formatter forwarding fragment framework frontend function
   garbage gateway generator governance gradient granularity graph grid guard
   handler hash header heap heuristic hook hostname hypervisor
   identifier idempotent image importer index inference ingestion inheritance initialiser initializer injection instance instrumentation integer integration interceptor interface interpreter invariant iteration iterator
   json kernel keyword kubernetes
   latency layer ledger lexicon lifecycle linter listener literal locale localisation localization locking logger lookup
   manifest mapper marshalling matrix memoization merge metadata microservice middleware migration mock modality model modifier monolith mutation mutex
   namespace neural nightly normalisation normalization notation nullable
   observability observer offset onboarding operator optimisation optimization orchestration ordering overflow override
   packet parameter parser partition payload permission persistence pipeline plugin pointer policy polling pooling portal predicate prefix preprocessing primitive priority procedure processor producer profiler prompt provider provisioning proxy publisher
   quantisation quantization quota
   race recall reconciliation recursion redirect refactor reference regex registry regression release rendering replica repository request resolver response retention retry rollback rollout router routing runbook runtime
   sandbox scaffolding schema scheduler scope screenshot sdk secret selector semantic serialisation serialization serverless service session shard signature simulation singleton snapshot socket specification sprint stack stakeholder standup state stateless storage strategy stream subscription subsystem suite superset supervisor swagger symbol synchronisation synchronization
   telemetry template tenant terminal test testing throughput throttle timestamp tokeniser tokenizer topology trace transaction transformer transpiler traversal trigger tuple typescript
   unit upstream uptime usage utilisation utilization
   validation validator variable vector versioning viewport virtualisation virtualization visualisation visualization
   warehouse watcher webhook websocket widget worker workspace wrapper
   yaml
   ticket sprint roadmap milestone stakeholder retrospective onboarding offboarding compliance invoice payroll headcount revenue margin forecast pipeline quota churn retention acquisition conversion engagement adoption`,
].join(' ');

/** The lexicon set — lowercase stems only. */
const ENGLISH_STEMS: ReadonlySet<string> = new Set(
  ENGLISH_STEMS_RAW.split(/\s+/u).map((w) => w.trim().toLowerCase()).filter(Boolean),
);

/**
 * Regular inflectional/derivational suffixes stripped before a lexicon lookup, longest
 * first. Keeping the lexicon as STEMS (and stripping here) is what lets ~2.5k entries
 * cover ordinary English text without a megabyte of word forms.
 */
const SUFFIXES: readonly string[] = [
  'ationally', 'ability', 'ibility', 'ational', 'iveness', 'fulness', 'lessness',
  'ations', 'ments', 'nesses', 'ingly', 'ation', 'ition', 'ement', 'ments', 'ition',
  'ings', 'ness', 'ment', 'able', 'ible', 'ally', 'ical', 'ance', 'ence', 'sion', 'tion',
  'ised', 'ized', 'ises', 'izes', 'ising', 'izing', 'ise', 'ize',
  'ing', 'ers', 'est', 'ies', 'ied', 'ive', 'ous', 'ful', 'ity', 'ary', 'ory', 'ent', 'ant',
  'ed', 'er', 'es', 'ly', 'al', 'ic', 's', 'y',
];

/** Undo consonant doubling ("commit" + "ing" → "committ" → "commit"). */
function undouble(stem: string): string {
  const n = stem.length;
  if (n >= 4 && stem[n - 1] === stem[n - 2] && !'aeiou'.includes(stem[n - 1] as string)) return stem.slice(0, -1);
  return stem;
}

/** Does the lexicon know this stem, allowing the usual spelling repairs (drop-e, y→i)? */
function stemKnown(stem: string): boolean {
  if (stem.length < 3) return false;
  if (ENGLISH_STEMS.has(stem)) return true;
  if (ENGLISH_STEMS.has(`${stem}e`)) return true;          // us + e → use
  const un = undouble(stem);
  if (un !== stem && ENGLISH_STEMS.has(un)) return true;   // committ → commit
  if (stem.endsWith('i') && ENGLISH_STEMS.has(`${stem.slice(0, -1)}y`)) return true; // appli → apply
  return false;
}

/**
 * Is `word` a plausible English word — either present in the lexicon directly, or a
 * regular inflection of a stem that is? Lowercase input; punctuation already stripped.
 * Deliberately GENEROUS (it decides whether to *accuse* text of being gibberish).
 */
export function isKnownEnglishWord(word: string): boolean {
  const w = word.toLowerCase();
  if (w.length < 3) return true;             // too short to judge — never an accusation
  if (ENGLISH_STEMS.has(w)) return true;
  for (const suf of SUFFIXES) {
    if (w.length > suf.length + 2 && w.endsWith(suf) && stemKnown(w.slice(0, -suf.length))) return true;
  }
  return false;
}

/**
 * Function words for each supported Latin-script language, used ONLY to decide which
 * language (if any) the text is in — never to score quality. Kept deliberately short:
 * these are the highest-frequency, most distinctive markers of each language.
 */
const FUNCTION_WORDS: Readonly<Record<string, readonly string[]>> = {
  en: ['the', 'and', 'that', 'with', 'this', 'for', 'you', 'not', 'are', 'was', 'have', 'from', 'they', 'but', 'what', 'when', 'which', 'there', 'their', 'would', 'about', 'your', 'been', 'will', 'can', 'has', 'its', 'it', 'is', 'of', 'to', 'in', 'on', 'at', 'as', 'by', 'or', 'an', 'be', 'if'],
  es: ['que', 'los', 'las', 'del', 'una', 'por', 'con', 'para', 'como', 'pero', 'este', 'esta', 'son', 'más', 'sus', 'sobre', 'todo', 'ser', 'hay', 'el', 'la', 'de', 'un', 'se', 'no', 'lo', 'al', 'es', 'y'],
  fr: ['les', 'des', 'est', 'une', 'que', 'pour', 'dans', 'sur', 'pas', 'avec', 'sont', 'plus', 'vous', 'nous', 'cette', 'mais', 'aux', 'par', 'ils', 'ce', 'le', 'la', 'de', 'un', 'et', 'du', 'au', 'en', 'il'],
  de: ['der', 'die', 'das', 'und', 'ist', 'nicht', 'mit', 'den', 'von', 'für', 'auf', 'ein', 'eine', 'sich', 'auch', 'dem', 'werden', 'wird', 'aber', 'oder', 'sie', 'wir', 'zu', 'im', 'es', 'als', 'bei', 'nach', 'sind'],
  pt: ['que', 'não', 'uma', 'com', 'para', 'como', 'mais', 'dos', 'das', 'por', 'este', 'esta', 'são', 'ser', 'seu', 'sua', 'pelo', 'ao', 'os', 'as', 'de', 'do', 'da', 'em', 'um', 'no', 'na'],
  it: ['che', 'per', 'con', 'del', 'della', 'una', 'sono', 'più', 'come', 'anche', 'nella', 'questo', 'questa', 'gli', 'nel', 'il', 'la', 'di', 'un', 'da', 'si', 'le', 'ed', 'ma'],
};

/** How many alphabetic characters are Latin-script (a–z plus the accented Latin range). */
function latinLetterShare(text: string): number {
  let letters = 0;
  let latin = 0;
  for (const ch of text) {
    if (!/\p{L}/u.test(ch)) continue;
    letters++;
    if (/[A-Za-zÀ-ɏ]/u.test(ch)) latin++;
  }
  return letters === 0 ? 0 : latin / letters;
}

/** The verdict of the language guard — which Latin language won, and how strongly. */
export interface LanguageVerdict {
  /** Winning language code, or null when the text isn't Latin-script or no language wins. */
  language: string | null;
  /** Share of tokens that are function words of the winning language (0..1). */
  share: number;
  /** Share of tokens that are function words of ANY supported language (0..1). */
  anyShare: number;
  /** True when the text is predominantly Latin-script (so the guard even applies). */
  latin: boolean;
}

/**
 * Decide which supported Latin-script language a text is in, by function-word vote.
 * Returns `language: null` for non-Latin scripts (CJK, Cyrillic, Arabic, …) and when
 * no language clears the floor — in both cases the English lexicon must NOT be applied.
 */
export function detectLatinLanguage(words: readonly string[], text: string): LanguageVerdict {
  const latin = latinLetterShare(text) >= 0.6;
  if (!latin || words.length === 0) return { language: null, share: 0, anyShare: 0, latin };

  const counts = new Map<string, number>();
  const anyHit = new Set<number>();
  for (const [lang, list] of Object.entries(FUNCTION_WORDS)) {
    const set = new Set(list);
    let hits = 0;
    words.forEach((w, i) => {
      if (set.has(w)) { hits++; anyHit.add(i); }
    });
    counts.set(lang, hits);
  }
  let best: string | null = null;
  let bestHits = 0;
  let runnerUp = 0;
  for (const [lang, hits] of counts) {
    if (hits > bestHits) { runnerUp = bestHits; bestHits = hits; best = lang; }
    else if (hits > runnerUp) runnerUp = hits;
  }
  const share = bestHits / words.length;
  const anyShare = anyHit.size / words.length;
  // A win must be both present (≥8% of tokens) and unambiguous (strictly beats the
  // runner-up) — "in/an/no/de" are shared across languages, so a tie decides nothing.
  if (!best || share < 0.08 || bestHits <= runnerUp) return { language: null, share, anyShare, latin };
  return { language: best, share, anyShare, latin };
}

/** Tokens that are legitimately not words: identifiers, paths, urls, numbers, versions. */
const CODEISH = /[0-9_@#$/\\<>{}[\]|`~^*+=]|::|\.\w|--/u;

/**
 * Is this raw token code rather than prose? Used to EXCLUDE tokens from word scoring —
 * `projectEvermindRef`, `api/src/foo.ts`, `v2.1`, `https://…` are all legitimately
 * absent from any dictionary.
 */
export function isCodeishToken(raw: string): boolean {
  if (CODEISH.test(raw)) return true;
  // camelCase / PascalCase with an internal capital → an identifier, not a word.
  if (/^[A-Za-z]+$/u.test(raw) && /[a-z][A-Z]/u.test(raw)) return true;
  // ALLCAPS acronyms (SSM, HTTP, R2) — real, just not lexicon entries.
  if (/^[A-Z]{2,}$/u.test(raw)) return true;
  return false;
}

/** The measured outcome of {@link scoreEnglishWordiness}. */
export interface WordinessScore {
  /** True when the scorer actually ran (English text, enough eligible tokens). */
  scored: boolean;
  /** Eligible content tokens considered. */
  eligible: number;
  /** How many of them matched nothing — not the lexicon, not the context, not a repeat. */
  unknown: number;
  /** unknown / eligible (0 when not scored). */
  unknownShare: number;
}

/**
 * Score what fraction of a text's CONTENT words are unrecognisable. Only meaningful for
 * confidently-English text — the caller must consult {@link detectLatinLanguage} first.
 *
 * A token counts as KNOWN when any of these hold, in order of cost:
 *   - it is code-ish (identifier / path / acronym) → excluded from scoring entirely;
 *   - the lexicon recognises it (with inflection stripping);
 *   - it appears in `context` (the prompt/question) — domain jargon echoes the ask;
 *   - it occurs more than once in the text — real jargon recurs, invented words don't.
 */
export function scoreEnglishWordiness(
  words: readonly string[],
  rawTokens: readonly string[],
  context?: string,
): WordinessScore {
  const contextWords = new Set(
    (context ?? '').toLowerCase().match(/\p{L}[\p{L}'-]*/gu)?.map((w) => w.replace(/[''-]/gu, '')) ?? [],
  );
  const freq = new Map<string, number>();
  for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);

  let eligible = 0;
  let unknown = 0;
  words.forEach((w, i) => {
    // Short words are function words or abbreviations — never evidence of gibberish.
    if (w.length < 4) return;
    const raw = rawTokens[i] ?? w;
    if (isCodeishToken(raw)) return;
    eligible++;
    if (isKnownEnglishWord(w)) return;
    if (contextWords.has(w)) return;
    if ((freq.get(w) ?? 0) > 1) return;
    unknown++;
  });

  // Below this there isn't enough evidence for a verdict either way.
  if (eligible < 10) return { scored: false, eligible, unknown, unknownShare: 0 };
  return { scored: true, eligible, unknown, unknownShare: unknown / eligible };
}
