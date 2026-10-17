import { useEffect, useRef } from 'react';
import { brainMessageAnchorId } from '@builderforce/agent-loop';

/**
 * The transcript's scroll behaviour: stick to the newest node while the reader is near
 * the bottom, and jump to a revealed message on request. Returns the refs to attach to
 * the scroller and the content list, plus the `onScroll` handler for the scroller.
 */
export function useTranscriptScroll(autoScroll: boolean, revealMessage: { id: number; nonce: number } | null) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLOListElement>(null);
  const pinnedRef = useRef(true);
  // Track whether the user is pinned to the bottom so streaming doesn't yank them.
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  // Stay pinned to the newest node through EVERY height change — not just when the
  // node list changes, but as late-loading images, code blocks, and streaming markdown
  // reflow after render (the reason a plain `nodes`-keyed effect lands short of bottom).
  useEffect(() => {
    if (!autoScroll) return;
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    const stick = () => {
      if (pinnedRef.current) scroller.scrollTop = scroller.scrollHeight;
    };
    stick();
    const ro = new ResizeObserver(stick);
    ro.observe(content);
    return () => ro.disconnect();
  }, [autoScroll]);

  // A speech bubble (or any other gist of a reply) asked to show THIS turn. Unpin so
  // the stick-to-bottom observer does not yank the reader back to the newest node,
  // then scroll the stamped `#bf-msg-{id}` row into view. The nonce is in the deps
  // so a second click on the same bubble still jumps.
  useEffect(() => {
    if (revealMessage == null) return;
    pinnedRef.current = false;
    const reduce = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const jump = () => {
      // Do not early-return on a missing scroller: the dock may still be laying
      // out when this effect first fires. The rAF + timeout retry until it is there.
      const scroller = scrollRef.current;
      if (!scroller) return;
      const target = document.getElementById(brainMessageAnchorId(revealMessage.id));
      if (!target || !scroller.contains(target)) return;
      // Scroll ONLY the transcript, not every ancestor (the page, the dock).
      const sRect = scroller.getBoundingClientRect();
      const tRect = target.getBoundingClientRect();
      const delta = tRect.top - sRect.top - (sRect.height - tRect.height) / 2;
      scroller.scrollTo({ top: scroller.scrollTop + delta, behavior: reduce ? 'auto' : 'smooth' });
    };
    jump();
    const raf = requestAnimationFrame(jump);
    const later = window.setTimeout(jump, 80);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(later);
    };
  }, [revealMessage]);

  return { scrollRef, contentRef, onScroll };
}
