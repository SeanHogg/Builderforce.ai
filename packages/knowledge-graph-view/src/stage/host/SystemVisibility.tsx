import { useMemo, useState } from 'react';
import { cssVar } from '../../scene/themeColors';
import { tailOf } from '../../surface/outlineGraph';
import type { Station } from '../../surface/stations';
import { systemName, type SystemInfo } from '../../surface/systems';
import { TYPE } from '../../surface/ui/type';

interface Scope { key: string; name: string; modules: Map<string, string> }

const systemKey = (station: Station) => station.system ?? '';

export function useSystemVisibility(root: string, stations: readonly Station[], systems: readonly SystemInfo[] | undefined, loose: string) {
    const [choices, setChoices] = useState<{ root: string; hidden: ReadonlySet<string> } | null>(null);
    const hidden = choices?.root === root ? choices.hidden : null;
    const scopes = useMemo(() => {
        const scopes = new Map<string, Scope>();
        for (const station of stations) {
            const key = systemKey(station);
            let scope = scopes.get(key);
            if (!scope) {
                scope = { key, name: systemName(systems, key) || loose, modules: new Map() };
                scopes.set(key, scope);
            }
            if (station.app) scope.modules.set(station.app, tailOf(station.app));
        }
        return [...scopes.values()];
    }, [stations, systems, loose]);
    const hiddenStations = useMemo(() => hidden
        ? stations.filter((s) => hidden.has(`system:${systemKey(s)}`) || (s.app && hidden.has(`module:${s.app}`))).map((s) => s.id).sort()
        : [], [stations, hidden]);
    const toggle = (key: string) => setChoices((current) => {
        const next = new Set(current?.root === root ? current.hidden : []);
        if (next.has(key)) next.delete(key); else next.add(key);
        return { root, hidden: next };
    });
    return { scopes, hidden, hiddenStations, toggle };
}

export function SystemVisibility({ label, scopes, hidden, toggle }: { label: string } & ReturnType<typeof useSystemVisibility>) {
    if (scopes.length < 2 && !scopes[0]?.modules.size) return null;
    const check = (key: string, name: string, disabled = false) => <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input type="checkbox" checked={!hidden?.has(key)} disabled={disabled} onChange={() => toggle(key)} />
        {name}
    </label>;
    return <details data-system-visibility style={{
        maxWidth: 220, padding: '4px 8px', borderRadius: 4, border: `1px solid ${cssVar('border')}`,
        background: cssVar('panel'), color: cssVar('text'), pointerEvents: 'auto', ...TYPE.meta,
    }}>
        <summary style={{ cursor: 'pointer' }}>{label}</summary>
        <div style={{ maxHeight: 'min(50vh, 300px)', overflow: 'auto' }}>
            {scopes.map((scope) => <div key={scope.key}>
                {check(`system:${scope.key}`, scope.name)}
                <div style={{ paddingInlineStart: 16 }}>
                    {[...scope.modules].map(([path, name]) => <div key={path} title={path}>{check(`module:${path}`, name, hidden?.has(`system:${scope.key}`))}</div>)}
                </div>
            </div>)}
        </div>
    </details>;
}
