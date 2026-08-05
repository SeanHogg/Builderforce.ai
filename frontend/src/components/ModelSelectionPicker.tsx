'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

export type ChatModelSelection =
  | { mode: 'auto' }
  | { mode: 'byo_pool' }
  | { mode: 'model'; model: string };

export interface ChatModelOptions {
  configured?: Array<{ id: string; label: string }>;
  byo: Array<{ id: string; vendor: string; cost?: string }>;
  free: Array<string | { id: string; cost?: string }>;
  plan: Array<string | { id: string; cost?: string }>;
  paid: Array<string | { id: string; cost?: string }>;
}

type Category = 'auto' | 'byo' | 'free' | 'plan' | 'paid' | 'configured';
type Item = { key: string; label: string; detail: string; category: Category; selection: ChatModelSelection };

const CATEGORY_LABEL: Record<Category, string> = {
  auto: 'Auto', byo: 'BYO', free: 'Free', plan: 'Plan', paid: 'Paid', configured: 'Configured',
};

function buildItems(options: ChatModelOptions): Item[] {
  const items: Item[] = [{ key: 'auto', label: 'Auto', detail: 'Gateway chooses', category: 'auto', selection: { mode: 'auto' } }];
  const normalized = (value: string | { id: string; cost?: string }) => typeof value === 'string' ? { id: value } : value;
  const seen = new Set<string>();
  const add = (id: string, label: string, detail: string, category: Category) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    items.push({ key: `model:${id}`, label, detail, category, selection: { mode: 'model', model: id } });
  };
  // BuilderForce collections lead by default. Within BYO, the server supplies the
  // exact mixed provider/connection priority order configured in Settings.
  for (const value of options.free) { const model = normalized(value); add(model.id, model.id, model.cost ?? 'Free · included with BuilderForce', 'free'); }
  const free = new Set(options.free.map((value) => normalized(value).id));
  for (const value of options.plan) { const model = normalized(value); if (!free.has(model.id)) add(model.id, model.id, model.cost ?? 'Included with your BuilderForce plan', 'plan'); }
  for (const value of options.paid) { const model = normalized(value); add(model.id, model.id, model.cost ?? 'Metered usage', 'paid'); }
  if (options.byo.length) items.push({ key: 'byo_pool', label: 'BYO pool', detail: 'Auto-selects in your provider priority order', category: 'byo', selection: { mode: 'byo_pool' } });
  for (const model of options.byo) add(model.id, model.id, model.cost ?? `Billed by ${model.vendor}`, 'byo');
  for (const model of options.configured ?? []) add(model.id, model.label, model.id, 'configured');
  return items;
}

export function ModelSelectionPicker({ selection, options, onChange, disabled = false, ariaLabel = 'Choose model', triggerVariant = 'label' }: {
  selection: ChatModelSelection;
  options: ChatModelOptions;
  onChange: (selection: ChatModelSelection) => void;
  disabled?: boolean;
  ariaLabel?: string;
  triggerVariant?: 'label' | 'slash';
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | Category>('all');
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const items = useMemo(() => buildItems(options), [options]);
  const activeKey = selection.mode === 'model' ? `model:${selection.model}` : selection.mode;
  const active = items.find((item) => item.key === activeKey);
  const categories = useMemo(() => (Object.keys(CATEGORY_LABEL) as Category[]).filter((category) => items.some((item) => item.category === category)), [items]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => (filter === 'all' || item.category === filter)
      && (!needle || `${item.label} ${item.detail} ${CATEGORY_LABEL[item.category]}`.toLowerCase().includes(needle)));
  }, [items, query, filter]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    const timer = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => { document.removeEventListener('mousedown', close); window.clearTimeout(timer); };
  }, [open]);

  const slashTrigger = triggerVariant === 'slash';
  return <div ref={rootRef} className="bf-model-picker" style={{ position: 'relative', flexShrink: slashTrigger ? 0 : 1, minWidth: 0 }}>
    <button className="bf-model-picker__trigger" type="button" disabled={disabled} aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((value) => !value)} style={{ width: slashTrigger ? 'var(--chat-ctl-size, 32px)' : undefined, height: 'var(--chat-ctl-size, 32px)', minWidth: slashTrigger ? 'var(--chat-ctl-size, 32px)' : 92, maxWidth: slashTrigger ? 'var(--chat-ctl-size, 32px)' : 220, padding: slashTrigger ? 0 : '0 9px', justifyContent: slashTrigger ? 'center' : undefined, borderRadius: slashTrigger ? '50%' : 8, border: '1px solid var(--chat-input-border, var(--border-subtle))', background: 'var(--chat-input-bg, var(--bg-elevated))', color: 'var(--text-primary)', cursor: disabled ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
      {slashTrigger ? <span aria-hidden style={{ fontSize: 18, lineHeight: 1 }}>/</span> : <><span aria-hidden>◉</span><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{active?.label ?? (selection.mode === 'model' ? selection.model : 'Auto')}</span><span aria-hidden style={{ marginLeft: 'auto' }}>⌄</span></>}
    </button>
    {open && <div role="dialog" aria-label="Model picker" style={{ position: 'absolute', left: 0, bottom: 'calc(100% + 7px)', zIndex: 10000, width: 'min(440px, calc(100vw - 32px))', padding: 10, borderRadius: 10, border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', boxShadow: '0 16px 42px rgba(0,0,0,.32)' }}>
      <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search models…" aria-label="Search models" style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 7, border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)' }} />
      <div aria-label="Filter models" style={{ display: 'flex', gap: 5, flexWrap: 'wrap', margin: '9px 0' }}>
        {(['all', ...categories] as const).map((category) => <button key={category} type="button" aria-pressed={filter === category} onClick={() => setFilter(category)} style={{ padding: '3px 8px', borderRadius: 999, border: `1px solid ${filter === category ? 'var(--accent, #4f8cff)' : 'var(--border-subtle)'}`, background: filter === category ? 'rgba(79,140,255,.15)' : 'transparent', color: 'var(--text-primary)', fontSize: 11, cursor: 'pointer' }}>{category === 'all' ? 'All' : CATEGORY_LABEL[category]}</button>)}
      </div>
      <div role="listbox" style={{ maxHeight: 300, overflowY: 'auto', display: 'grid', gap: 3 }}>
        {visible.map((item) => <button key={item.key} type="button" role="option" aria-selected={item.key === activeKey} onClick={() => { onChange(item.selection); setOpen(false); setQuery(''); }} style={{ width: '100%', padding: '8px 9px', borderRadius: 7, border: item.key === activeKey ? '1px solid var(--accent, #4f8cff)' : '1px solid transparent', background: item.key === activeKey ? 'rgba(79,140,255,.12)' : 'transparent', color: 'var(--text-primary)', textAlign: 'left', cursor: 'pointer', display: 'grid', gridTemplateColumns: '1fr auto', gap: '2px 8px' }}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span><span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{CATEGORY_LABEL[item.category]}</span><span style={{ gridColumn: '1 / -1', fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.detail}</span></button>)}
        {!visible.length && <div style={{ padding: 18, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>No matching models</div>}
      </div>
    </div>}
  </div>;
}
