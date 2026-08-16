/**
 * THE marketing FAQ list.
 *
 * `.mk-faq` / `.mk-q` in `globals.css` have been the canonical marketing FAQ
 * chrome for a while; what was NOT canonical was the markup that consumes them.
 * `ReferencePage` exported a `ReferenceFaq` that rendered it, and `/features`
 * re-inlined the identical `<details>` + chevron by hand against a `{q, a}`
 * shape instead of `{question, answer}` — two declarations of one list, which is
 * how the chevron ends up rotating on one page and not the other.
 *
 * So: one component, one shape, and it self-gates — an empty `items` renders
 * nothing rather than an empty bordered box, so a caller never has to wrap it in
 * a `length > 0 &&` the component can decide for itself.
 *
 * `<details>` rather than a controlled disclosure because every consumer is a
 * server component and the summary/marker semantics come free and
 * keyboard-correct. The left rail's own header deliberately does NOT share this:
 * it is controlled, persisted, and has to stay closed when the rail collapses.
 */
export interface MarketingFaqItem {
  question: string;
  answer: string;
}

export default function MarketingFaq({
  items,
  openFirst = false,
}: {
  items: MarketingFaqItem[];
  /** Start the first answer expanded. The homepage does this deliberately — the
   *  first objection is the one worth answering before anybody clicks. */
  openFirst?: boolean;
}) {
  if (!items?.length) return null;
  return (
    <div className="mk-faq">
      {items.map((item, index) => (
        <details key={item.question} className="mk-q" open={openFirst && index === 0}>
          <summary>
            {item.question}
            <svg
              className="mk-q__chev"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </summary>
          <p>{item.answer}</p>
        </details>
      ))}
    </div>
  );
}
