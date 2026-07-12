# All Button Style Object (TeamMemberAvatarFilter.tsx, lines 153–170)

The 'All' reset button now contains exactly one padding declaration:

- `display: 'inline-flex'`
- `alignItems: 'center'`
- `justifyContent: 'center'`
- `height: 32`
- `padding: '0 10px'`
- `borderRadius: 16`
- `fontSize: 12`
- `fontWeight: 600`
- `border: \`1px solid ${allSelected ? 'var(--coral-bright, #f4726e)' : 'var(--border-subtle)'}\``
- `background: allSelected ? 'var(--coral-bright, #f4726e)' : 'var(--bg-deep)'`
- `color: allSelected ? '#fff' : 'var(--text-muted)'`
- `cursor: disableAll ? 'not-allowed' : 'pointer'`
- `flexShrink: 0`
- `opacity: disableAll ? 0.5 : 1`
- `transition: 'background 0.15s, color 0.15s, border-color 0.15s'`
- `fontFamily: 'inherit'`
- `outline: 'none'`
- `whiteSpace: 'nowrap'`
- `gap: 4`

No duplicate padding exists in this object literal for the 'All' button.