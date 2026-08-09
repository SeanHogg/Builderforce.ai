'use client';

import { Icon } from '@/components/ui/Icon';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEmulation } from '@/lib/EmulationContext';
import { usePermissionDebugger } from '@/lib/PermissionDebuggerContext';
import { copyTextToClipboard } from '@/lib/useCopyToClipboard';

const ROLES = ['owner', 'manager', 'developer', 'viewer'] as const;

function formatElapsed(startedAt: Date): string {
  const secs = Math.floor((Date.now() - startedAt.getTime()) / 1000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Amber emulation bar — renders at the very top of the viewport (position: fixed)
 * whenever a Super Admin is impersonating a user.
 *
 * CSS contract: the bar is 40 px tall. AppShell must add `padding-top: 40px`
 * (via the `.emulation-active` class on the shell div) to prevent content
 * from sliding under the bar.
 *
 * The bar cannot be dismissed — only "End Emulation" removes it.
 */
export default function EmulationBar() {
  const { emulation, endEmulation, switchRole } = useEmulation();
  const { debuggerActive, toggleDebugger } = usePermissionDebugger();
  const t = useTranslations('emulationBar');
  const router = useRouter();
  const [elapsed, setElapsed] = useState('');
  const [roleSwitching, setRoleSwitching] = useState(false);
  const [ending, setEnding] = useState(false);
  const [showRoleMenu, setShowRoleMenu] = useState(false);
  const roleMenuRef = useRef<HTMLDivElement>(null);

  // Tick the elapsed timer every second
  useEffect(() => {
    if (!emulation) return;
    const tick = () => setElapsed(formatElapsed(emulation.startedAt));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [emulation]);

  // Close role menu on outside click
  useEffect(() => {
    if (!showRoleMenu) return;
    function onMouseDown(e: MouseEvent) {
      if (roleMenuRef.current && !roleMenuRef.current.contains(e.target as Node)) {
        setShowRoleMenu(false);
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [showRoleMenu]);

  if (!emulation) return null;

  // Turn amber → red in the last 10 minutes (600 s) of the 1-hour session
  const secsElapsed = Math.floor((Date.now() - emulation.startedAt.getTime()) / 1000);
  const isExpiringSoon = secsElapsed >= 3000; // 50 min

  async function handleEndEmulation() {
    setEnding(true);
    try {
      await endEmulation();
      router.push('/admin');
    } finally {
      setEnding(false);
    }
  }

  async function handleSwitchRole(newRole: string) {
    setShowRoleMenu(false);
    if (newRole === emulation!.role) return;
    setRoleSwitching(true);
    try {
      await switchRole(newRole);
    } finally {
      setRoleSwitching(false);
    }
  }

  async function handleCopyContext() {
    if (!emulation) return;
    const text = [
      `Emulating: ${emulation.targetEmail}`,
      `Tenant: ${emulation.tenantName} (id=${emulation.tenantId})`,
      `Role: ${emulation.role}`,
      `Session: ${emulation.sessionId}`,
      `Started: ${emulation.startedAt.toISOString()}`,
      `Elapsed: ${elapsed}`,
      `Token: ${emulation.emulationToken}`,
    ].join('\n');
    // Fire-and-forget, as before: this bar has no room for a confirmation state, and a
    // refused clipboard resolves false rather than throwing.
    await copyTextToClipboard(text);
  }

  return (
    <div
      className={`emulation-bar${isExpiringSoon ? ' emulation-bar--expiring' : ''}`}
      role="banner"
      aria-label={t('barAria')}
    >
      <span className="emulation-bar__eye" aria-hidden="true"><Icon source="👁" size="1em" /></span>

      <span className="emulation-bar__info">
        {t.rich('emulatingWho', {
          name: emulation.targetDisplayName ?? emulation.targetEmail,
          email: emulation.targetEmail,
          tenant: emulation.tenantName,
          strong: (chunks) => <strong>{chunks}</strong>,
        })}
      </span>

      <span className="emulation-bar__sep" aria-hidden="true">|</span>

      {/* Role switcher */}
      <div ref={roleMenuRef} className="emulation-bar__role-wrap">
        <button
          type="button"
          className="emulation-bar__btn emulation-bar__btn--role"
          onClick={() => setShowRoleMenu((v) => !v)}
          disabled={roleSwitching}
          aria-haspopup="listbox"
          aria-expanded={showRoleMenu}
        >
          {roleSwitching ? t('switching') : emulation.role} ▾
        </button>
        {showRoleMenu && (
          <ul className="emulation-bar__role-menu" role="listbox" aria-label={t('switchRoleAria')}>
            {ROLES.map((r) => (
              <li
                key={r}
                role="option"
                aria-selected={r === emulation.role}
                className={`emulation-bar__role-option${r === emulation.role ? ' emulation-bar__role-option--active' : ''}`}
                onClick={() => handleSwitchRole(r)}
              >
                {r}
              </li>
            ))}
          </ul>
        )}
      </div>

      <span className="emulation-bar__sep" aria-hidden="true">|</span>

      {/* Timer */}
      <span
        className={`emulation-bar__timer${isExpiringSoon ? ' emulation-bar__timer--warn' : ''}`}
        aria-label={t('elapsedAria', { elapsed })}
      >
        
        <Icon source="⏱" size="1em" /> {elapsed}
      </span>

      <span className="emulation-bar__sep" aria-hidden="true">|</span>

      {/* Copy context */}
      <button
        type="button"
        className="emulation-bar__btn"
        onClick={handleCopyContext}
        title={t('copyContextTitle')}
      >
        {t('copyContext')}
      </button>

      {/* Debugger toggle */}
      <button
        type="button"
        className={`emulation-bar__btn${debuggerActive ? ' emulation-bar__btn--active' : ''}`}
        onClick={toggleDebugger}
        title={t('debugTitle')}
        aria-pressed={debuggerActive}
      >
        
        <Icon source="🔍" size="1em" /> {t('debug')}
      </button>

      {/* End emulation */}
      <button
        type="button"
        className="emulation-bar__btn emulation-bar__btn--end"
        onClick={handleEndEmulation}
        disabled={ending}
      >
        {ending ? t('ending') : t('endEmulation')}
      </button>
    </div>
  );
}
