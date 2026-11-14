/**
 * The muted "Reviewed by {reviewer} with {model}, {date}" line under an uploaded knowledge pack
 * (PRD 40, OD-3). Pure: it picks the catalog key for exactly the parts that are present (a full
 * sentence per combination — joining fragments would write one language's grammar into every
 * catalog) and the values to fill it. Null when the pack carries none of the three.
 */
const present = (s) => {
    const t = s?.trim();
    return t ? t : undefined;
};
/** `formatDate` is the locale-aware formatter (`useFormat().date`); it is only called for a parseable date. */
export function provenanceLine(provenance, formatDate) {
    if (!provenance)
        return null;
    const reviewer = present(provenance.reviewedBy);
    const model = present(provenance.judgeModel);
    const at = present(provenance.reviewedAt);
    const date = at && !Number.isNaN(Date.parse(at)) ? formatDate(at) : undefined;
    const values = { ...(reviewer ? { reviewer } : {}), ...(model ? { model } : {}), ...(date ? { date } : {}) };
    if (reviewer && model && date)
        return { key: 'provenanceByWithOn', values };
    if (reviewer && model)
        return { key: 'provenanceByWith', values };
    if (reviewer && date)
        return { key: 'provenanceByOn', values };
    if (reviewer)
        return { key: 'provenanceBy', values };
    if (model && date)
        return { key: 'provenanceWithOn', values };
    if (model)
        return { key: 'provenanceWith', values };
    if (date)
        return { key: 'provenanceOn', values };
    return null;
}
//# sourceMappingURL=packProvenance.js.map