/**
 * Link a ticket of any tier to the chat — a debounced server-side typeahead per tier.
 */
import { useEffect, useMemo, useState } from 'react';
import { S } from './panelStyles';
import { TICKET_KINDS, type ChatTicketsLabels, type LinkType, type TicketKind, type TicketLinkVM, type TicketOptionVM } from './types';

/** How many hits the server returns per tier. When a result set fills this, there
 *  are (probably) more — we nudge the user to type instead of silently truncating. */
const SEARCH_LIMIT = 40;

export function LinkForm({ search, projectId, existing, labels, onLink }: {
  /** Server-side typeahead — the adapter debounces nothing itself; we debounce here. */
  search: (kind: TicketKind, query: string, projectId: number | null) => Promise<TicketOptionVM[]>;
  projectId: number | null;
  existing: TicketLinkVM[];
  labels: ChatTicketsLabels;
  onLink: (kind: TicketKind, ref: string, linkType: LinkType) => Promise<void>;
}) {
  const [kind, setKind] = useState<TicketKind>('task');
  const [ref, setRef] = useState('');
  const [query, setQuery] = useState('');
  const [linkType, setLinkType] = useState<LinkType>('linked');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<TicketOptionVM[]>([]);
  const [loading, setLoading] = useState(false);

  // Debounced server-side typeahead on (kind, query, project). The `live` flag drops
  // a stale response so a slow earlier request can't overwrite a newer one, and the
  // timer is cleared on every keystroke so only the settled query hits the network.
  useEffect(() => {
    let live = true;
    setLoading(true);
    const h = setTimeout(() => {
      search(kind, query, projectId)
        .then((r) => { if (live) setResults(r); })
        .catch(() => { if (live) setResults([]); })
        .finally(() => { if (live) setLoading(false); });
    }, 250);
    return () => { live = false; clearTimeout(h); };
  }, [search, kind, query, projectId]);

  // Hide tickets already linked to this chat (the server doesn't know the chat's links).
  const shown = useMemo(
    () => results.filter((o) => !existing.some((e) => e.kind === kind && e.ref === o.ref)),
    [results, existing, kind],
  );
  const atCap = results.length >= SEARCH_LIMIT;

  // Drop a chosen ref once it's no longer in the visible set (kind switch / new search).
  useEffect(() => { if (ref && !shown.some((o) => o.ref === ref)) setRef(''); }, [shown, ref]);

  const submit = async () => {
    if (!ref) return;
    setBusy(true);
    try { await onLink(kind, ref, linkType); setRef(''); setQuery(''); } finally { setBusy(false); }
  };

  return (
    <div style={S.section}>
      <select aria-label={labels.kindLabel} value={kind} onChange={(e) => { setKind(e.target.value as TicketKind); setRef(''); setQuery(''); }} style={S.select}>
        {TICKET_KINDS.map((k) => <option style={S.option} key={k} value={k}>{labels.kind[k]}</option>)}
      </select>
      <input
        type="search"
        aria-label={labels.searchTicket}
        placeholder={labels.searchTicket}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ ...S.select, minWidth: 150 }}
      />
      <select aria-label={labels.pickTicket} value={ref} onChange={(e) => setRef(e.target.value)} style={{ ...S.select, minWidth: 200 }}>
        <option style={S.option} value="">{labels.pickTicket}</option>
        {shown.map((o) => <option style={S.option} key={o.ref} value={o.ref}>{o.label}</option>)}
      </select>
      {loading ? <span style={S.muted}>{labels.searching}</span>
        : shown.length === 0 ? <span style={S.muted}>{labels.noMatches}</span>
        : atCap ? <span style={S.muted}>{labels.refine}</span>
        : null}
      <select aria-label={labels.linkTypeLabel} value={linkType} onChange={(e) => setLinkType(e.target.value as LinkType)} style={S.select}>
        <option style={S.option} value="linked">{labels.linkTypeLinked}</option>
        <option style={S.option} value="created">{labels.linkTypeCreated}</option>
      </select>
      <button type="button" onClick={() => void submit()} disabled={busy || !ref} style={S.pill(true)}>{busy ? '…' : labels.linkAction}</button>
    </div>
  );
}
