/**
 * The rail's "Hide done" filter, remembered per viewer — same rationale as
 * useChatTicketSort: the panel remounts on every chat switch, and whether DONE
 * chips are shown is a viewer preference, not a chat's. ON by default so a chat
 * with many completed tickets surfaces its open work; storage that is missing or
 * refuses (private mode, a sandboxed frame, quota) degrades to the in-memory default.
 */
import { useCallback, useState } from 'react';

const HIDE_DONE_KEY = 'bf.chatTickets.hideDone';

function readHideDone(): boolean {
  try {
    const stored = typeof localStorage === 'undefined' ? null : localStorage.getItem(HIDE_DONE_KEY);
    // Absent = the default (hide). Only an explicit '0' turns it off.
    return stored === null ? true : stored === '1';
  } catch {
    return true; // storage unavailable — the default
  }
}

function writeHideDone(hide: boolean): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(HIDE_DONE_KEY, hide ? '1' : '0');
  } catch {
    // storage unavailable — the choice holds for this mount only
  }
}

export function useHideDoneTickets(): [boolean, (hide: boolean) => void] {
  const [hideDone, setHideDone] = useState<boolean>(readHideDone);
  const choose = useCallback((next: boolean) => { setHideDone(next); writeHideDone(next); }, []);
  return [hideDone, choose];
}
